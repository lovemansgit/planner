#!/usr/bin/env node
// SANDBOX JUNK CLEANUP — SQL generator (sibling of #661's generate-purge-sql.mjs).
// Reads the LITERAL frozen junk tenant_ids from target_ids.txt (Stage-A Query D output) and
// emits backup + BATCHED delete SQL keyed to that exact list (NEVER a live pattern at delete time).
// Run:  node generate-sandbox-cleanup-sql.mjs
//
// Output (next to this file):
//   stage-b-backup-singlefile.sql   READ-ONLY, one query -> one restorable artifact (modest sets)
//   stage-b-backup-perbatch.sql     READ-ONLY, one CSV per batch (recommended at ~1,821 scale)
//   delete-batched.sql              one txn PER BATCH; DRY-RUN (ROLLBACK) + EXECUTE (COMMIT) sections
//
// No DB connection. Writes .sql text only. NOTHING executes.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = "qdotjmwqbyzldfuxphei";
const SANDBOX = "transcorpsb";
const CANONICAL = ["transcorpsb", "transcorp", "transcorpuae", "transcorpqatar"];
const ALLOWLIST = [
  "meal-plan-scheduler", "dr-nutrition", "fresh-butchers", "transcorp",
  "hem", "mlp", "demo-bistro", "demo-bistro1",
];
const HEX = "[0-9a-f]{8}";       // un-anchored test-isolation run (genuine-merchants.ts:75)
const BATCH_SIZE = 100;          // tenants per transaction — bounds lock/WAL/timeout at ~1,821 scale
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- load + validate the frozen id list (authoritative; never a pattern at delete time) ----
const raw = readFileSync(join(HERE, "target_ids.txt"), "utf8");
const lines = raw.split(/\r?\n/);
// Optional header line: "# AUDITED_COUNT: <n>" — Stage-A Query A's junk_count. Freeze guard.
let auditedCount = null;
for (const l of lines) {
  const m = l.match(/^#\s*AUDITED_COUNT:\s*(\d+)\s*$/i);
  if (m) auditedCount = parseInt(m[1], 10);
}
const ids = lines
  .map((l) => l.replace(/^[\s,'"]+|[\s,'"]+$/g, ""))
  .filter((l) => l && !l.startsWith("#") && !l.startsWith("--"));

const bad = ids.filter((id) => !UUID_RE.test(id));
if (bad.length) throw new Error(`Non-UUID lines in target_ids.txt:\n${bad.join("\n")}`);
const distinct = [...new Set(ids.map((s) => s.toLowerCase()))];
if (distinct.length !== ids.length) {
  throw new Error(`Duplicate ids: ${ids.length} lines, ${distinct.length} distinct`);
}
if (ids.length === 0) throw new Error("target_ids.txt has no ids yet (placeholder).");
// FREEZE GUARD: frozen list length must equal Stage-A's audited junk_count.
if (auditedCount === null) {
  throw new Error("target_ids.txt is missing the '# AUDITED_COUNT: <n>' header (Stage-A Query A). Add it.");
}
if (ids.length !== auditedCount) {
  throw new Error(`FREEZE MISMATCH: ${ids.length} frozen ids != AUDITED_COUNT ${auditedCount}. Re-audit or fix the list.`);
}

// ---- SQL fragment helpers ----
const sqlList = (arr) => arr.map((s) => `'${s}'`).join(", ");
const canonicalList = sqlList(CANONICAL);
const allowlist = sqlList(ALLOWLIST);
const SANDBOX_ID = `(SELECT id FROM suitefleet_regions WHERE client_id = '${SANDBOX}')`;

const fingerprint = `-- Project-ref fingerprint (${PROJECT_REF}) + Sandbox presence. Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions WHERE client_id IN (${canonicalList});
  IF c <> 4 THEN RAISE EXCEPTION 'FINGERPRINT FAILED: expected 4 canonical regions, found %', c; END IF;
  PERFORM 1 FROM suitefleet_regions WHERE client_id = '${SANDBOX}';
  IF NOT FOUND THEN RAISE EXCEPTION '${SANDBOX} region missing — STOP'; END IF;
END $$;`;

// Tables to dump (restore order: tenants -> identity leaves -> consignee graph -> subs -> tasks ->
// scan log -> audit). Region is KEPT, so it is NOT dumped. All scoped by tenant_id (tenants by id).
const BACKUP_TABLES = [
  ["tenants", "id", "0001:65 the junk tenants"],
  ["users", "tenant_id", "0001:105 CASCADE"],
  ["roles", "tenant_id", "0001:139 CASCADE"],
  ["role_assignments", "tenant_id", "0001:193 CASCADE"],
  ["api_keys", "tenant_id", "0001:218 CASCADE"],
  ["task_generation_runs", "tenant_id", "0012:157 CASCADE"],
  ["tenant_suitefleet_webhook_credentials", "tenant_id", "0013:148 CASCADE"],
  ["webhook_events", "tenant_id", "0018:74 CASCADE"],
  ["consignees", "tenant_id", "0004:69 CASCADE"],
  ["addresses", "tenant_id", "0014:124 CASCADE"],
  ["consignee_crm_events", "tenant_id", "0016:152 CASCADE"],
  ["subscriptions", "tenant_id", "0009:134 CASCADE"],
  ["subscription_address_rotations", "tenant_id", "0014:171 CASCADE"],
  ["subscription_exceptions", "tenant_id", "0015:136 CASCADE"],
  ["subscription_materialization", "tenant_id", "0015:212 CASCADE"],
  ["tasks", "tenant_id", "0006:125 CASCADE"],
  ["task_packages", "tenant_id", "0007:109 CASCADE"],
  ["failed_pushes", "tenant_id", "0008:139 CASCADE"],
  ["asset_tracking_cache", "tenant_id", "0011:165 CASCADE"],
  ["outbound_push_failures", "tenant_id", "0023:101 CASCADE"],
  ["asset_scan_log", "tenant_id", "0032:42 RESTRICT (Blocker B)"],
  ["audit_events", "tenant_id", "0002:45 CASCADE (Blocker A — RULE)"],
];

// Explicit per-batch delete order (child -> parent). RESTRICT anchors (asset_scan_log, tasks RESTRICT
// to consignees/subscriptions/addresses) cleared before their parents; tenants last.
const DELETE_SEQUENCE = [
  ["asset_scan_log", "tenant_id"],     // RESTRICT anchor on tasks+tenant; needs GUC
  ["tasks", "tenant_id"],              // cascades task_packages/failed_pushes/asset_tracking_cache/outbound_push_failures
  ["subscriptions", "tenant_id"],      // cascades subscription_address_rotations/exceptions/materialization
  ["task_generation_runs", "tenant_id"],
  ["consignee_crm_events", "tenant_id"],
  ["addresses", "tenant_id"],
  ["consignees", "tenant_id"],
  ["audit_events", "tenant_id"],       // explicit (every-row-verified); rule disabled
  ["tenants", "id"],                   // parent; rule disabled for the CASCADE probe
];

// All 22 tenant-scoped tables, for the per-batch residual-sum verify (incl. the 6 cascade-only
// identity tables + the cascade-via-parent children).
const VERIFY_TABLES = BACKUP_TABLES.map(([t, col]) => [t, col]);

// ---- chunk frozen ids into batches ----
const batches = [];
for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push(ids.slice(i, i + BATCH_SIZE));
const N = batches.length;

// ---- per-batch DELETE block ----
function valuesBody(arr) {
  return arr.map((id) => `    ('${id}'::uuid)`).join(",\n");
}
function batchBlock(batch, idx, finalWord) {
  const i = idx + 1;
  const k = batch.length;
  const deletes = DELETE_SEQUENCE.map(([t, col]) =>
    `DELETE FROM ${t} WHERE ${col} IN (SELECT tenant_id FROM _batch);`).join("\n");
  const verifySum = VERIFY_TABLES.map(([t, col]) =>
    `    + (SELECT count(*) FROM ${t} WHERE ${col} IN (SELECT tenant_id FROM _batch))`).join("\n");
  return `-- ===== BATCH ${i}/${N}  (${k} tenants) =====
BEGIN;
${fingerprint}
CREATE TEMP TABLE _batch (tenant_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _batch (tenant_id) VALUES
${valuesBody(batch)};
-- Guards: exact count, every id live, and SCOPE FENCE (on ${SANDBOX} + hex-match + not allowlisted).
DO $$
DECLARE n int; bad int;
BEGIN
  SELECT count(*) INTO n FROM _batch;
  IF n <> ${k} THEN RAISE EXCEPTION 'BATCH ${i}: expected ${k} targets, got %', n; END IF;
  SELECT count(*) INTO bad FROM _batch b WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = b.tenant_id);
  IF bad <> 0 THEN RAISE EXCEPTION 'BATCH ${i}: % id(s) not present as tenants (typo/already-deleted)', bad; END IF;
  SELECT count(*) INTO bad
  FROM tenants t
  WHERE t.id IN (SELECT tenant_id FROM _batch)
    AND ( t.suitefleet_region_id <> ${SANDBOX_ID}
          OR t.slug !~ '${HEX}'
          OR t.slug IN (${allowlist}) );
  IF bad <> 0 THEN RAISE EXCEPTION 'BATCH ${i} SCOPE GUARD: % id(s) off-Sandbox / non-hex(keep-set) / allowlisted — STOP', bad; END IF;
END $$;
-- Blocker A: audit_events_no_delete RULE (0002:90) rewrites both the explicit audit delete AND the
-- tenant-delete CASCADE probe -> disable for the batch, re-enable before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only trigger (0032:95) — GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
${deletes}
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this batch.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
${verifySum}
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH ${i} VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH ${i}/${N} verified: 0 residual (tenant + all FK children) for % targets', ${k};
END $$;
${finalWord};`;
}

const deleteHeader = `-- SANDBOX JUNK CLEANUP — BATCHED DELETE. Target: ${PROJECT_REF} (PROD).
-- ${ids.length} frozen junk tenants on ${SANDBOX} (KEPT region), in ${N} batches of <= ${BATCH_SIZE}.
-- No region delete, no Stage 3. Each batch is its own transaction + its own verified unit.
-- Authorization: run the DRY-RUN section (all batches ROLLBACK; watch the NOTICE lines), then on
-- Love's named clear run the EXECUTE section (all batches COMMIT). If a batch aborts, prior committed
-- batches stand (junk, safe partial progress) — fix and re-run the remaining batches.
-- Every batch: fingerprint -> frozen seed -> count+existence+SCOPE guards -> Blocker A/B ->
-- child->parent deletes -> rule re-enable -> 0-residual verify.`;

const deleteSql = `${deleteHeader}

-- ############################################################
-- # DRY-RUN SECTION  (every batch ends ROLLBACK — changes NOTHING)
-- ############################################################
${batches.map((b, i) => batchBlock(b, i, "ROLLBACK")).join("\n\n")}

-- ############################################################
-- # EXECUTE SECTION  (every batch ends COMMIT — runs ONLY on Love's named clear)
-- ############################################################
${batches.map((b, i) => batchBlock(b, i, "COMMIT")).join("\n\n")}

-- FINAL VERIFY (run separately, read-only): zero junk tenants remain on ${SANDBOX}.
SELECT count(*) AS junk_tenants_remaining
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = '${SANDBOX}' AND t.slug ~ '${HEX}' AND t.slug NOT IN (${allowlist});
-- Expected 0.
`;

// ---- SINGLE-FILE BACKUP (one read-only query -> one restorable artifact; modest sets only) ----
const allIdsCte = `WITH tgt(tenant_id) AS (VALUES\n${valuesBody(ids)}\n)`;
function dumpArm([table, col, cite], seq) {
  const where = col === "id" ? "x.id IN (SELECT tenant_id FROM tgt)"
                             : `x.${col} IN (SELECT tenant_id FROM tgt)`;
  return `  SELECT ${seq} AS restore_seq, '${table}' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                '${table}', '${table}', to_jsonb(x)::text) AS stmt
  FROM ${table} x WHERE ${where}   -- ${cite}`;
}
function countArm([table, col], seq) {
  const where = col === "id" ? "id IN (SELECT tenant_id FROM tgt)"
                             : `${col} IN (SELECT tenant_id FROM tgt)`;
  return `  SELECT ${seq} AS restore_seq, '${table}' AS table_name, count(*) AS n FROM ${table} WHERE ${where}`;
}
const singleFileSql = `-- SANDBOX JUNK CLEANUP — SINGLE-FILE BACKUP (READ ONLY). Target: ${PROJECT_REF} (PROD).
-- One restorable artifact for all ${ids.length} frozen junk tenants + every FK-child row.
-- WARNING (scale): at ~1,821 tenants this may be a LARGE result. Run QUERY 1 (summary) first; if the
-- total row count is beyond a comfortable single-CSV export (>~50,000 rows) or QUERY 2 errors/truncates,
-- DO NOT rely on this file — use stage-b-backup-perbatch.sql instead (recommended at this scale).
-- Restore: the 'stmt' column ordered by restore_seq is runnable SQL (jsonb_populate_record rebuilds
-- each row; tenants restore first since the transcorpsb region is KEPT). Faithful for
-- text/uuid/timestamptz/numeric/boolean/jsonb/array/null.
${fingerprint}

-- ===== QUERY 1 — ROW-COUNT SUMMARY (run first; paste to agent; sizes the backup) =====
${allIdsCte}
SELECT * FROM (
${BACKUP_TABLES.map((t, i) => countArm(t, i + 1)).join("\n  UNION ALL\n")}
) c ORDER BY restore_seq;

-- ===== QUERY 2 — SINGLE-FILE ARTIFACT (run once; Download CSV) — modest sets only =====
${allIdsCte}
SELECT restore_seq, tbl, stmt FROM (
${BACKUP_TABLES.map((t, i) => dumpArm(t, i + 1)).join("\n  UNION ALL\n")}
) s ORDER BY restore_seq, stmt;
`;

// ---- PER-BATCH BACKUP (recommended at scale): one modest CSV per delete batch ----
function batchBackup(batch, idx) {
  const i = idx + 1;
  const cte = `WITH tgt(tenant_id) AS (VALUES\n${valuesBody(batch)}\n)`;
  return `-- >>> BATCH ${i}/${N} BACKUP — run, then Download CSV as: backup-batch-${String(i).padStart(3, "0")}.csv
${cte}
SELECT restore_seq, tbl, stmt FROM (
${BACKUP_TABLES.map((t, j) => dumpArm(t, j + 1)).join("\n  UNION ALL\n")}
) s ORDER BY restore_seq, stmt;`;
}
const perBatchSql = `-- SANDBOX JUNK CLEANUP — PER-BATCH BACKUP (READ ONLY). Target: ${PROJECT_REF} (PROD).
-- ${N} queries; run each, Download CSV -> memory/handoffs/sandbox-backup-<date>/backup-batch-NNN.csv.
-- Each CSV is one batch's frozen ${BATCH_SIZE}-tenant slice (matches the delete batches). The ${N} files
-- together ARE the rollback artifact. Recommended over the single-file backup at this scale.
-- Restore: concatenate the 'stmt' columns across batches, ordered within each by restore_seq.
${fingerprint}

${batches.map((b, i) => batchBackup(b, i)).join("\n\n")}
`;

// ---- write ----
writeFileSync(join(HERE, "delete-batched.sql"), deleteSql);
writeFileSync(join(HERE, "stage-b-backup-singlefile.sql"), singleFileSql);
writeFileSync(join(HERE, "stage-b-backup-perbatch.sql"), perBatchSql);

console.log(`Generated keyed to ${ids.length} frozen ids (AUDITED_COUNT ${auditedCount}), ${N} batches of <=${BATCH_SIZE}:`);
console.log("  delete-batched.sql              (DRY-RUN + EXECUTE sections)");
console.log("  stage-b-backup-singlefile.sql   (READ ONLY, 1 query; modest sets)");
console.log("  stage-b-backup-perbatch.sql     (READ ONLY, 1 CSV per batch; recommended at scale)");
