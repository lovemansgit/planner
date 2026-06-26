#!/usr/bin/env node
// SANDBOX JUNK CLEANUP — SQL generator (in-DB frozen-snapshot variant).
// No literal id list (the ~1,759 ids exceed the SQL-editor CSV export cap). The junk set is
// frozen IN-DATABASE at delete time into a committed normal table, count-guarded against the
// Stage-A audited junk_count, then consumed in rn-range batches. Run: node generate-sandbox-cleanup-sql.mjs
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

// Freeze the junk set into a NORMAL (persistent) table, COMMITTED once before any delete. This is the
// Option-B fix for the Supabase SQL editor: the editor wraps a pasted script in ONE implicit
// transaction, so a TEMP table created before the batches is UNWOUND by the first batch's ROLLBACK
// (dry-run -> 42P01 at batch 2). A committed normal table survives every later ROLLBACK, so DRY-RUN and
// EXECUTE use the IDENTICAL frozen set (guard runs once, == ${AUDITED_COUNT}, before any delete; the deletes
// never shrink it because batches read this static copy, not the live predicate).
const snapshot = `-- Clean any leftover from a prior aborted run, then freeze the junk set (derived ONCE; not a live
-- pattern per batch). rn = stable ORDER BY id for deterministic, disjoint batch ranges.
DROP TABLE IF EXISTS _sandbox_junk_frozen;
CREATE TABLE _sandbox_junk_frozen (tenant_id uuid PRIMARY KEY, rn int);
INSERT INTO _sandbox_junk_frozen (tenant_id, rn)
SELECT t.id, row_number() OVER (ORDER BY t.id)
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE ${JUNK_WHERE};

${fingerprint}

-- FREEZE GUARD: frozen set size MUST equal the Stage-A audited junk_count (${AUDITED_COUNT}). Runs ONCE,
-- before any delete -> valid in BOTH dry-run and execute. If the live count drifted, abort.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _sandbox_junk_frozen;
  IF n <> ${AUDITED_COUNT} THEN
    RAISE EXCEPTION 'FREEZE GUARD: frozen set has % rows, expected audited ${AUDITED_COUNT} — re-audit, do NOT proceed', n;
  END IF;
END $$;

-- SCOPE FENCE: every frozen id is on ${SANDBOX} + has an 8-hex run + is NOT allowlisted.
-- (Tautological vs the predicate above — defense in depth; the 11 keep-set can never be here.)
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t
  WHERE t.id IN (SELECT tenant_id FROM _sandbox_junk_frozen)
    AND ( t.suitefleet_region_id <> ${SANDBOX_ID}
          OR t.slug !~ '${HEX}'
          OR t.slug IN (${allowlist}) );
  IF bad <> 0 THEN RAISE EXCEPTION 'SCOPE FENCE: % frozen id(s) off-Sandbox / non-hex(keep-set) / allowlisted — STOP', bad; END IF;
END $$;

-- Persist the validated frozen set so the per-batch ROLLBACKs below cannot unwind it (the core editor
-- fix). In a wrapping editor this COMMIT commits the leading statements; in an auto-commit editor it is a
-- harmless "no transaction in progress" notice. Either way _sandbox_junk_frozen is committed here.
COMMIT;`;

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

const rangeSel = (lo, hi) => `(SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > ${lo} AND rn <= ${hi})`;

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
${snapshot}

${batches}${finalVerify}

-- CLEANUP: drop the frozen helper table. If the script ABORTED at a batch above, this line may not have
-- run — then run it manually to clean up:  DROP TABLE IF EXISTS _sandbox_junk_frozen;
DROP TABLE IF EXISTS _sandbox_junk_frozen;`;
}

const deleteSql = `-- SANDBOX JUNK CLEANUP — BATCHED DELETE (committed frozen table). Target: ${PROJECT_REF} (PROD).
-- ${AUDITED_COUNT} junk tenants on ${SANDBOX} (KEPT region), ${N} batches of <= ${BATCH_SIZE}. No region delete.
--
-- EDITOR-SAFE DESIGN: each section freezes the junk set into a NORMAL table _sandbox_junk_frozen and
-- COMMITs it BEFORE the batches, so it survives the per-batch ROLLBACKs (a TEMP table did not — the
-- editor wraps the script in one implicit transaction, so batch 1's ROLLBACK unwound it -> 42P01). The
-- freeze guard (== ${AUDITED_COUNT}) runs ONCE before any delete, so DRY-RUN and EXECUTE use the IDENTICAL frozen
-- set and the dry-run faithfully predicts the execute. Batches consume disjoint rn-ranges of the static
-- frozen table (deletes never shrink it). Watch the NOTICE lines for per-batch verify.
--
-- HOW TO RUN: paste and Run the DRY-RUN SECTION as ONE block; confirm every "BATCH k/18 verified: 0
-- residual" NOTICE and that nothing errored. Then, on Love's named clear, paste and Run the EXECUTE
-- SECTION as ONE block. Each section creates + drops its own _sandbox_junk_frozen.
-- If a section ABORTS mid-run, the helper table may remain — clean it with:
--   DROP TABLE IF EXISTS _sandbox_junk_frozen;
-- DRY-RUN is data-safe: it commits/drops only the helper table (net nothing) and rolls back ALL deletes.
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
// Non-generated column list for a table (omits GENERATED ALWAYS columns, e.g.
// asset_tracking_cache.awb 0011:152 — inserting into a generated column raises 428C9 and would
// abort the whole psql -1 restore). Generic via the catalog, so future generated cols are covered.
const COLS_LATERAL = (table) =>
  `CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = '${table}'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c`;

function dumpArm([table, col, cite], seq) {
  const where = col === "id" ? "x.id IN (SELECT tenant_id FROM b)" : `x.${col} IN (SELECT tenant_id FROM b)`;
  return `  SELECT ${seq} AS restore_seq, '${table}' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                '${table}', c.cols, c.cols, '${table}', to_jsonb(x)::text) AS stmt
  FROM ${table} x
  ${COLS_LATERAL(table)}
  WHERE ${where}   -- ${cite}`;
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

// ---- SINGLE-FILE psql BACKUP (no row cap): one read-only query -> sandbox-cleanup-backup-<date>.sql ----
// Run via:  psql "$SUPABASE_DB_URL" -At -f backup-query.sql > sandbox-cleanup-backup-<date>.sql
// -At = unaligned + tuples-only, so the output is ONLY the INSERT statements (a runnable restore file).
function psqlDumpArm([table, col, cite], seq) {
  const where = col === "id" ? "x.id IN (SELECT tenant_id FROM snap)" : `x.${col} IN (SELECT tenant_id FROM snap)`;
  return `  SELECT ${seq} AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                '${table}', c.cols, c.cols, '${table}', to_jsonb(x)::text) AS stmt
  FROM ${table} x
  ${COLS_LATERAL(table)}
  WHERE ${where}   -- ${cite}`;
}
const backupQuerySql = `-- SANDBOX JUNK CLEANUP — SINGLE-FILE BACKUP QUERY (READ ONLY). Target: ${PROJECT_REF} (PROD).
-- Emits one INSERT per row for all ${AUDITED_COUNT} junk tenants + every FK-child row, in restore order
-- (tenants first; transcorpsb is KEPT so the FK parent exists). Run with psql -At to bypass the SQL-editor
-- ~1k CSV cap and write ONE runnable restore file:
--   psql "$SUPABASE_DB_URL" -At -f backup-query.sql > sandbox-cleanup-backup-<date>.sql
-- Same frozen predicate as the delete (derived in-DB). See BACKUP-RUNBOOK.md for the full steps.
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE ${JUNK_WHERE}
)
SELECT stmt FROM (
${BACKUP_TABLES.map((t, j) => psqlDumpArm(t, j + 1)).join("\n  UNION ALL\n")}
) s ORDER BY restore_seq, stmt;`;

// Row-count cross-check (one number) — compare to `wc -l` of the backup file.
const rowcountSql = `-- SANDBOX JUNK CLEANUP — EXPECTED BACKUP ROW COUNT (READ ONLY). Target: ${PROJECT_REF} (PROD).
-- Run:  psql "$SUPABASE_DB_URL" -At -f backup-rowcount.sql
-- Prints one number = total rows the backup will contain (cross-check vs Stage-A Query E, ~20k).
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE ${JUNK_WHERE}
)
SELECT 0
${BACKUP_TABLES.map(([t, col]) =>
  `    + (SELECT count(*) FROM ${t} WHERE ${col === "id" ? "id" : col} IN (SELECT tenant_id FROM snap))`).join("\n")}
  AS expected_backup_rows;`;

// ---- EDITOR-CSV BACKUP (no psql / no DB password): one .sql, run each block in the SQL editor ----
// The editor caps CSV export at ~1,000 rows; big tables split into 900-row parts via ORDER BY id +
// LIMIT/OFFSET (only chunked tables are ordered, each by its REAL primary key — see PK_COL). Same
// frozen predicate + generated-column fix. Chunk counts from Stage-A Query E estimates; Query 0 is live-authoritative.
const EDITOR_CHUNK = 900;
// Chunked tables (rows over ~900). tenant_suitefleet_webhook_credentials (PK tenant_id, <=1 per
// tenant -> <=1759) and subscription_materialization (PK subscription_id, 1 per junk subscription)
// exceed 900, so they are chunked too. Counts are generous upper bounds; trailing empty parts return
// 0 rows (skip them) and Query 0 is authoritative.
const EDITOR_CHUNKS = {
  tenants: 2, consignees: 2, task_generation_runs: 4, tasks: 6, audit_events: 6,
  tenant_suitefleet_webhook_credentials: 2, subscription_materialization: 4,
};
const EDITOR_EST = { tenants: 1759, consignees: 1090, task_generation_runs: 3094, tasks: 4507, audit_events: 4996 };
// Real primary-key column per table (default `id`); the ORDER BY for chunked LIMIT/OFFSET MUST use the
// actual PK or it errors (42703) on tables whose PK is not `id`. Verified against migrations.
const PK_COL = {
  tenant_suitefleet_webhook_credentials: "tenant_id",  // 0013:148
  subscription_materialization: "subscription_id",     // 0015:212
};
const pkOf = (table) => PK_COL[table] || "id";
const pad2 = (n) => String(n).padStart(2, "0");
const SNAP_CTE = `WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE ${JUNK_WHERE}
)`;
function editorArm([table, col, cite], seq, part, total) {
  const label = total > 1 ? `${pad2(seq)}_${table}_part${part}of${total}.csv` : `${pad2(seq)}_${table}.csv`;
  const where = col === "id" ? "x.id IN (SELECT tenant_id FROM snap)" : `x.${col} IN (SELECT tenant_id FROM snap)`;
  const page = total > 1 ? `\nORDER BY x.${pkOf(table)} LIMIT ${EDITOR_CHUNK} OFFSET ${(part - 1) * EDITOR_CHUNK}` : "";
  const note = total > 1 ? `  (part ${part}/${total}: rows ${(part - 1) * EDITOR_CHUNK + 1}..${part * EDITOR_CHUNK})` : "";
  return `-- >>> SAVE RESULT AS: ${label}${note}   [${cite}]
${SNAP_CTE}
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              '${table}', c.cols, c.cols, '${table}', to_jsonb(x)::text) AS restore_sql
FROM ${table} x
${COLS_LATERAL(table)}
WHERE ${where}${page};`;
}
const sizeCheck = `${SNAP_CTE}
SELECT * FROM (
${BACKUP_TABLES.map(([t, col], i) =>
  `  SELECT ${i + 1} AS nn, '${t}' AS table_name, count(*) AS rows, ceil(count(*) / ${EDITOR_CHUNK}.0)::int AS chunks_needed FROM ${t} WHERE ${col === "id" ? "id" : col} IN (SELECT tenant_id FROM snap)`
).join("\n  UNION ALL\n")}
) v ORDER BY nn;`;
const editorQueries = BACKUP_TABLES.map((t, i) => {
  const total = EDITOR_CHUNKS[t[0]] || 1;
  if (total === 1) return editorArm(t, i + 1, 1, 1);
  return Array.from({ length: total }, (_, k) => editorArm(t, i + 1, k + 1, total)).join("\n\n");
}).join("\n\n");
const expectedTable = BACKUP_TABLES.map(([t], i) => {
  const est = EDITOR_EST[t];
  const total = EDITOR_CHUNKS[t] || 1;
  const desc = est
    ? `~${est} rows (${total} files)`
    : total > 1
      ? `${total} files max (see Query 0; skip empty trailing parts)`
      : "expect <900 -> 1 file, or 0 -> skip";
  return `--   ${pad2(i + 1)}_${t}: ${desc}`;
}).join("\n");
const editorBackupSql = `-- SANDBOX JUNK CLEANUP — BACKUP via SUPABASE SQL EDITOR (READ ONLY). Target: ${PROJECT_REF} (PROD).
-- For Love, entirely in the dashboard SQL editor — no psql, no Terminal, no DB password.
--
-- WHY MANY FILES: the editor caps CSV export at ~1,000 rows; the backup is ~20k rows, so big tables
-- split into 900-row parts. Each query emits one runnable INSERT per row (generated columns such as
-- asset_tracking_cache.awb are omitted — they recompute on restore).
--
-- HOW TO RUN (per block):
--   1) Run QUERY 0 (SIZE CHECK) first. It lists every table's live row count + how many 900-row parts
--      it needs. SKIP any table with rows = 0. If a table's chunks_needed is MORE than the parts
--      provided below for it, STOP and tell the agent.
--   2) For each block below: highlight the whole block -> Run -> "Download CSV" -> save it under the
--      exact name in its "SAVE RESULT AS" label, into  memory/handoffs/sandbox-backup-<date>/ .
--   3) After saving, check the CSV's row count vs QUERY 0. FEWER than expected = it truncated -> STOP
--      and tell the agent. Save files in NN order (parents before children = restore order).
--
-- EXPECTED ROWS PER FILE (cross-check vs Stage-A Query E; grand total ~20k):
${expectedTable}
--   (Tables not listed: expect <900 -> one file, or 0 -> skip. QUERY 0 is the live authority.)
--
-- RESTORE (break-glass, its own clear — NOT now): run the saved files in NN order. Each file's
-- 'restore_sql' column IS the INSERT statements; to replay in the editor, open the CSV, copy the
-- restore_sql column, paste into a SQL-editor query, Run. Parents insert before children; INSERT is
-- allowed on append-only tables (audit_events / asset_scan_log). Or hand the files to the agent to
-- reassemble one runnable .sql.

-- ============================================================================
-- QUERY 0 — SIZE CHECK (run FIRST; read-only). rows = 0 -> skip; chunks_needed -> # of part files.
-- ============================================================================
${sizeCheck}

${editorQueries}
`;

writeFileSync(join(HERE, "delete-batched.sql"), deleteSql);
writeFileSync(join(HERE, "stage-b-backup-perbatch.sql"), perBatchSql);
writeFileSync(join(HERE, "backup-query.sql"), backupQuerySql);
writeFileSync(join(HERE, "backup-rowcount.sql"), rowcountSql);
writeFileSync(join(HERE, "stage-b-backup-editor.sql"), editorBackupSql);

console.log(`Generated for AUDITED_COUNT ${AUDITED_COUNT}, ${N} batches of <= ${BATCH_SIZE} (in-DB frozen snapshot):`);
console.log("  delete-batched.sql            (DRY-RUN + EXECUTE; committed frozen table + rn-range batches)");
console.log("  stage-b-backup-editor.sql     (READ ONLY, SQL-editor CSV backup — PRIMARY for Love)");
console.log("  stage-b-backup-perbatch.sql   (READ ONLY, " + N + " per-batch CSVs; older editor variant)");
console.log("  backup-query.sql              (READ ONLY, psql backup — only if a DB password exists)");
console.log("  backup-rowcount.sql           (READ ONLY, psql expected row count cross-check)");
