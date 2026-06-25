#!/usr/bin/env node
// SANDBOX JUNK CLEANUP — SQL generator (in-DB frozen-snapshot variant).
// No literal id list (the ~1,759 ids exceed the SQL-editor CSV export cap). The junk set is
// frozen IN-DATABASE at delete time into a TEMP table, count-guarded against the Stage-A audited
// junk_count, then consumed in rn-range batches. Run:  node generate-sandbox-cleanup-sql.mjs
//
// Output (next to this file):
//   delete-batched.sql            DRY-RUN + EXECUTE sections; each: snapshot -> guards -> rn-range batches
//   stage-b-backup-perbatch.sql   READ-ONLY, one CSV per rn-range batch (same predicate as the delete)
//
// No DB connection. Writes .sql text only. NOTHING executes.

import { writeFileSync } from "node:fs";
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
const HEX = "[0-9a-f]{8}";        // un-anchored test-isolation run (genuine-merchants.ts:75)
const AUDITED_COUNT = 1759;       // Stage-A Query A junk_count (live, authoritative). FREEZE guard target.
const BATCH_SIZE = 100;           // tenants per transaction
const N = Math.ceil(AUDITED_COUNT / BATCH_SIZE);

const sqlList = (a) => a.map((s) => `'${s}'`).join(", ");
const canonicalList = sqlList(CANONICAL);
const allowlist = sqlList(ALLOWLIST);
const SANDBOX_ID = `(SELECT id FROM suitefleet_regions WHERE client_id = '${SANDBOX}')`;

// The junk predicate — the SINGLE source of the frozen set (snapshot + backup use it identically).
const JUNK_WHERE = `r.client_id = '${SANDBOX}'
      AND t.slug ~ '${HEX}'
      AND t.slug NOT IN (${allowlist})`;

const fingerprint = `-- Project-ref fingerprint (${PROJECT_REF}) + Sandbox presence. Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions WHERE client_id IN (${canonicalList});
  IF c <> 4 THEN RAISE EXCEPTION 'FINGERPRINT FAILED: expected 4 canonical regions, found %', c; END IF;
  PERFORM 1 FROM suitefleet_regions WHERE client_id = '${SANDBOX}';
  IF NOT FOUND THEN RAISE EXCEPTION '${SANDBOX} region missing — STOP'; END IF;
END $$;`;

// Snapshot the frozen junk set ONCE (rn = stable order for deterministic batching). PRESERVE ROWS so it
// survives the per-batch COMMIT/ROLLBACKs within one SQL-editor Run.
const snapshot = `-- Freeze the junk set in-DB (derived once; NOT a live pattern per batch).
DROP TABLE IF EXISTS _sandbox_junk;
CREATE TEMP TABLE _sandbox_junk (tenant_id uuid PRIMARY KEY, rn int) ON COMMIT PRESERVE ROWS;
INSERT INTO _sandbox_junk (tenant_id, rn)
SELECT t.id, row_number() OVER (ORDER BY t.id)
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE ${JUNK_WHERE};

-- FREEZE GUARD: snapshot size MUST equal the Stage-A audited junk_count (${AUDITED_COUNT}).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _sandbox_junk;
  IF n <> ${AUDITED_COUNT} THEN
    RAISE EXCEPTION 'FREEZE GUARD: snapshot has % rows, expected audited ${AUDITED_COUNT} — re-audit, do NOT proceed', n;
  END IF;
END $$;

-- SCOPE FENCE: re-assert every snapshot id is on ${SANDBOX} + has an 8-hex run + is NOT allowlisted.
-- (Tautological vs the predicate above — defense in depth; the 11 keep-set can never be here.)
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t
  WHERE t.id IN (SELECT tenant_id FROM _sandbox_junk)
    AND ( t.suitefleet_region_id <> ${SANDBOX_ID}
          OR t.slug !~ '${HEX}'
          OR t.slug IN (${allowlist}) );
  IF bad <> 0 THEN RAISE EXCEPTION 'SCOPE FENCE: % snapshot id(s) off-Sandbox / non-hex(keep-set) / allowlisted — STOP', bad; END IF;
END $$;`;

// FK delete order per batch (child -> parent). RESTRICT anchors first; tenants last.
const DELETE_SEQUENCE = [
  "asset_scan_log", "tasks", "subscriptions", "task_generation_runs",
  "consignee_crm_events", "addresses", "consignees", "audit_events", "tenants",
];
// All 22 tenant-scoped tables for the per-batch 0-residual verify (col: tenants keyed by id).
const VERIFY_TABLES = [
  ["tenants", "id"], ["users", "tenant_id"], ["roles", "tenant_id"], ["role_assignments", "tenant_id"],
  ["api_keys", "tenant_id"], ["task_generation_runs", "tenant_id"],
  ["tenant_suitefleet_webhook_credentials", "tenant_id"], ["webhook_events", "tenant_id"],
  ["consignees", "tenant_id"], ["addresses", "tenant_id"], ["consignee_crm_events", "tenant_id"],
  ["subscriptions", "tenant_id"], ["subscription_address_rotations", "tenant_id"],
  ["subscription_exceptions", "tenant_id"], ["subscription_materialization", "tenant_id"],
  ["tasks", "tenant_id"], ["task_packages", "tenant_id"], ["failed_pushes", "tenant_id"],
  ["asset_tracking_cache", "tenant_id"], ["outbound_push_failures", "tenant_id"],
  ["asset_scan_log", "tenant_id"], ["audit_events", "tenant_id"],
];

const rangeSel = (lo, hi) => `(SELECT tenant_id FROM _sandbox_junk WHERE rn > ${lo} AND rn <= ${hi})`;

function batchBlock(idx, finalWord) {
  const i = idx + 1;
  const lo = idx * BATCH_SIZE;
  const hi = Math.min((idx + 1) * BATCH_SIZE, AUDITED_COUNT);
  const k = hi - lo;
  const sel = rangeSel(lo, hi);
  const deletes = DELETE_SEQUENCE.map((t) =>
    t === "tenants"
      ? `DELETE FROM tenants WHERE id IN ${sel};`
      : `DELETE FROM ${t} WHERE tenant_id IN ${sel};`).join("\n");
  const verifySum = VERIFY_TABLES.map(([t, col]) =>
    `    + (SELECT count(*) FROM ${t} WHERE ${col} IN ${sel})`).join("\n");
  return `-- ===== BATCH ${i}/${N}  (rn ${lo + 1}..${hi}, ${k} tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
${deletes}
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
${verifySum}
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH ${i} VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH ${i}/${N} verified: 0 residual (tenant + all FK children), % tenants', ${k};
END $$;
${finalWord};`;
}

function section(title, finalWord, withFinalVerify) {
  const batches = Array.from({ length: N }, (_, i) => batchBlock(i, finalWord)).join("\n\n");
  const finalVerify = withFinalVerify
    ? `\n\n-- FINAL VERIFY: zero junk tenants remain on ${SANDBOX}.
SELECT count(*) AS junk_tenants_remaining
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE ${JUNK_WHERE};
-- Expected 0.`
    : "";
  return `-- ############################################################
-- # ${title}
-- ############################################################
${fingerprint}

${snapshot}

${batches}${finalVerify}

DROP TABLE IF EXISTS _sandbox_junk;`;
}

const deleteSql = `-- SANDBOX JUNK CLEANUP — BATCHED DELETE (in-DB frozen snapshot). Target: ${PROJECT_REF} (PROD).
-- ${AUDITED_COUNT} junk tenants on ${SANDBOX} (KEPT region), ${N} batches of <= ${BATCH_SIZE}. No region delete.
-- RUN EACH SECTION AS ONE SQL-EDITOR RUN (one session) so the TEMP snapshot persists across the
-- per-batch transactions. The snapshot is frozen once and count-guarded == ${AUDITED_COUNT}; batches consume
-- disjoint rn-ranges over it (never a live pattern per batch). Watch the NOTICE lines for per-batch verify.
-- Authorization: run DRY-RUN (all batches ROLLBACK), then on Love's named clear run EXECUTE (all COMMIT).
-- If EXECUTE is interrupted, committed batches stand (junk; safe partial). To resume: re-audit the now-
-- smaller junk_count and regenerate (the == ${AUDITED_COUNT} freeze guard will intentionally abort a stale re-run).

${section("DRY-RUN SECTION  (every batch ends ROLLBACK — changes NOTHING)", "ROLLBACK", false)}

${section("EXECUTE SECTION  (every batch ends COMMIT — runs ONLY on Love's named clear)", "COMMIT", true)}
`;

// ---- PER-BATCH BACKUP: same predicate + rn-ranges, each a self-contained read-only query ----
const BACKUP_TABLES = [
  ["tenants", "id", "0001:65"],
  ["users", "tenant_id", "0001:105"], ["roles", "tenant_id", "0001:139"],
  ["role_assignments", "tenant_id", "0001:193"], ["api_keys", "tenant_id", "0001:218"],
  ["task_generation_runs", "tenant_id", "0012:157"],
  ["tenant_suitefleet_webhook_credentials", "tenant_id", "0013:148"],
  ["webhook_events", "tenant_id", "0018:74"], ["consignees", "tenant_id", "0004:69"],
  ["addresses", "tenant_id", "0014:124"], ["consignee_crm_events", "tenant_id", "0016:152"],
  ["subscriptions", "tenant_id", "0009:134"], ["subscription_address_rotations", "tenant_id", "0014:171"],
  ["subscription_exceptions", "tenant_id", "0015:136"], ["subscription_materialization", "tenant_id", "0015:212"],
  ["tasks", "tenant_id", "0006:125"], ["task_packages", "tenant_id", "0007:109"],
  ["failed_pushes", "tenant_id", "0008:139"], ["asset_tracking_cache", "tenant_id", "0011:165"],
  ["outbound_push_failures", "tenant_id", "0023:101"], ["asset_scan_log", "tenant_id", "0032:42"],
  ["audit_events", "tenant_id", "0002:45"],
];
function dumpArm([table, col, cite], seq) {
  const where = col === "id" ? "x.id IN (SELECT tenant_id FROM b)" : `x.${col} IN (SELECT tenant_id FROM b)`;
  return `  SELECT ${seq} AS restore_seq, '${table}' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                '${table}', '${table}', to_jsonb(x)::text) AS stmt
  FROM ${table} x WHERE ${where}   -- ${cite}`;
}
function backupBatch(idx) {
  const i = idx + 1;
  const lo = idx * BATCH_SIZE;
  const hi = Math.min((idx + 1) * BATCH_SIZE, AUDITED_COUNT);
  return `-- >>> BATCH ${i}/${N} BACKUP (rn ${lo + 1}..${hi}) — run, Download CSV: backup-batch-${String(i).padStart(3, "0")}.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE ${JUNK_WHERE}
),
b AS (SELECT tenant_id FROM snap WHERE rn > ${lo} AND rn <= ${hi})
SELECT restore_seq, tbl, stmt FROM (
${BACKUP_TABLES.map((t, j) => dumpArm(t, j + 1)).join("\n  UNION ALL\n")}
) s ORDER BY restore_seq, stmt;`;
}
const perBatchSql = `-- SANDBOX JUNK CLEANUP — PER-BATCH BACKUP (READ ONLY). Target: ${PROJECT_REF} (PROD).
-- ${N} queries, each the same rn-range as the delete batch (same in-DB predicate, identical frozen set).
-- Run each, Download CSV -> memory/handoffs/sandbox-backup-<date>/backup-batch-NNN.csv. Restore: the
-- 'stmt' column ordered by restore_seq is runnable SQL (tenants first; transcorpsb is KEPT so the FK
-- parent exists). The ${N} files together are the row-level rollback artifact.
--
-- SCALE CAVEAT: total ~20k rows. If a batch CSV hits the editor's export cap (~1k rows) or any batch is
-- audit_events-heavy, that CSV may truncate. The RECOMMENDED primary rollback artifact at this scale is a
-- Supabase database backup (Dashboard -> Database -> Backups, or confirm PITR covers the window) taken
-- immediately BEFORE the EXECUTE — one click, full fidelity, no row cap. Use these CSVs as the granular
-- secondary. (See plan §5.)
${fingerprint}

${Array.from({ length: N }, (_, i) => backupBatch(i)).join("\n\n")}
`;

writeFileSync(join(HERE, "delete-batched.sql"), deleteSql);
writeFileSync(join(HERE, "stage-b-backup-perbatch.sql"), perBatchSql);

console.log(`Generated for AUDITED_COUNT ${AUDITED_COUNT}, ${N} batches of <= ${BATCH_SIZE} (in-DB frozen snapshot):`);
console.log("  delete-batched.sql            (DRY-RUN + EXECUTE; TEMP snapshot + rn-range batches)");
console.log("  stage-b-backup-perbatch.sql   (READ ONLY, " + N + " per-batch CSVs)");
