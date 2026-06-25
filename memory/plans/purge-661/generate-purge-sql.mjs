#!/usr/bin/env node
// PURGE #661 — SQL generator. Reads the LITERAL 54 Stage-A tenant_ids from
// target_ids.txt and emits the backup + staged-delete SQL keyed to that exact
// list (NEVER re-derived from a slug pattern). Run:  node generate-purge-sql.mjs
//
// Output (written next to this file):
//   stage-b-backup.sql        -- SELECT-only, CSV-ready, one query per table
//   stage-1-child-deletes.sql -- one txn, DRY-RUN + EXECUTE blocks
//   stage-2-tenant-deletes.sql
//   stage-3-region-deletes.sql
//
// Nothing here connects to a database. It only writes .sql text for Love to
// review and (post-authorization, per stage) paste into the Supabase SQL editor.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECTED_COUNT = 54; // Stage-A confirmed: 8 acd / 8 arde / 8 cps-with / 8 cps-no / 6 pfc / 8 src / 8 umr
const PROJECT_REF = "qdotjmwqbyzldfuxphei";
const CANONICAL = ["transcorpsb", "transcorp", "transcorpuae", "transcorpqatar"];
const ALLOWLIST = [
  "meal-plan-scheduler", "dr-nutrition", "fresh-butchers", "transcorp",
  "hem", "mlp", "demo-bistro", "demo-bistro1",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- load + validate the literal id list (authoritative, no pattern) ----
const raw = readFileSync(join(HERE, "target_ids.txt"), "utf8");
const ids = raw
  .split(/\r?\n/)
  .map((l) => l.replace(/^[\s,'"]+|[\s,'"]+$/g, "")) // tolerate paste artifacts: quotes/commas/space
  .filter((l) => l && !l.startsWith("#") && !l.startsWith("--"));

const bad = ids.filter((id) => !UUID_RE.test(id));
if (bad.length) {
  throw new Error(`Non-UUID lines in target_ids.txt (fix these):\n${bad.join("\n")}`);
}
const distinct = [...new Set(ids.map((s) => s.toLowerCase()))];
if (distinct.length !== ids.length) {
  throw new Error(`Duplicate ids in target_ids.txt: ${ids.length} lines, ${distinct.length} distinct`);
}
if (ids.length !== EXPECTED_COUNT) {
  throw new Error(`Expected exactly ${EXPECTED_COUNT} ids (Stage-A), got ${ids.length}`);
}

// ---- SQL fragment helpers ----
const sqlList = (arr) => arr.map((s) => `'${s}'`).join(", ");
const canonicalList = sqlList(CANONICAL);
const allowlist = sqlList(ALLOWLIST);

// 54 ids as a CTE VALUES body (for self-contained backup SELECTs)
const valuesBody = ids.map((id) => `    ('${id}'::uuid)`).join(",\n");
const cte = `WITH tgt(tenant_id) AS (VALUES\n${valuesBody}\n)`;

// 54 ids as a TEMP-table INSERT body (for the single-txn delete stages)
const insertBody = ids.map((id) => `    ('${id}'::uuid)`).join(",\n");

const fingerprint = `-- Project-ref fingerprint pre-flight (${PROJECT_REF}). Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions
   WHERE client_id IN (${canonicalList});
  IF c <> 4 THEN
    RAISE EXCEPTION 'PROJECT-REF FINGERPRINT FAILED: expected 4 canonical regions, found % — STOP, wrong DB or drift', c;
  END IF;
END $$;`;

const seedTargets = `-- Seed the AUTHORITATIVE target set from the literal Stage-A id list (no pattern).
CREATE TEMP TABLE _purge_targets (tenant_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_targets (tenant_id) VALUES
${insertBody};`;

const guardCount = `-- Guard: exactly ${EXPECTED_COUNT} targets AND all ${EXPECTED_COUNT} still present as tenants.
DO $$
DECLARE n int; m int;
BEGIN
  SELECT count(*) INTO n FROM _purge_targets;
  IF n <> ${EXPECTED_COUNT} THEN RAISE EXCEPTION 'target count is % (expected ${EXPECTED_COUNT})', n; END IF;
  SELECT count(*) INTO m FROM tenants WHERE id IN (SELECT tenant_id FROM _purge_targets);
  IF m <> ${EXPECTED_COUNT} THEN RAISE EXCEPTION 'only %/${EXPECTED_COUNT} target tenants present — typo or already-deleted; STOP', m; END IF;
END $$;`;

const guardSafe = `-- SAFETY GUARD: refuse if ANY target is allowlisted-genuine OR bound to a canonical region.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE t.id IN (SELECT tenant_id FROM _purge_targets)
    AND ( t.slug IN (${allowlist})
          OR r.client_id IN (${canonicalList}) );
  IF bad <> 0 THEN RAISE EXCEPTION 'SAFETY GUARD TRIPPED: % target(s) are genuine/canonical — STOP', bad; END IF;
END $$;`;

// Informational drift notice: if the live junk-region predicate now finds MORE than
// our frozen 54, surface it (a new test tenant appeared) — but we still only act on the 54.
const driftNotice = `-- Informational: surface predicate drift since Stage-A (does NOT change scope).
DO $$
DECLARE live int;
BEGIN
  SELECT count(*) INTO live
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id NOT IN (${canonicalList})
    AND t.slug NOT IN (${allowlist});
  IF live <> ${EXPECTED_COUNT} THEN
    RAISE NOTICE 'NOTE: live junk-tenant predicate now matches % (Stage-A froze ${EXPECTED_COUNT}). Acting ONLY on the frozen 54; review the delta separately.', live;
  END IF;
END $$;`;

const banner = (t) => `-- ============================================================\n-- ${t}\n-- ============================================================`;

// ---- BACKUP (Stage B) — SELECT-only, one self-contained CSV-ready query per table ----
// Restore order (parent -> child); cite the FK that ties each table to a tenant.
const BACKUP_TABLES = [
  ["suitefleet_regions", "regions",   "01_suitefleet_regions", "0024:120 — junk regions (parents of tenants); deleted in Stage 3"],
  ["tenants",            "tenant_pk", "02_tenants",            "0001:65 — the 54 target tenants"],
  ["users",              "tenant",    "03_users",              "0001:105 tenant_id -> tenants CASCADE"],
  ["roles",              "tenant",    "04_roles",              "0001:139 tenant_id -> tenants CASCADE"],
  ["role_assignments",   "tenant",    "05_role_assignments",   "0001:193 tenant_id -> tenants CASCADE"],
  ["api_keys",           "tenant",    "06_api_keys",           "0001:218 tenant_id -> tenants CASCADE"],
  ["task_generation_runs","tenant",   "07_task_generation_runs","0012:157 tenant_id -> tenants CASCADE"],
  ["tenant_suitefleet_webhook_credentials","tenant","08_webhook_credentials","0013:148 tenant_id PK -> tenants CASCADE"],
  ["webhook_events",     "tenant",    "09_webhook_events",     "0018:74 tenant_id -> tenants CASCADE"],
  ["consignees",         "tenant",    "10_consignees",         "0004:69 tenant_id -> tenants CASCADE"],
  ["addresses",          "tenant",    "11_addresses",          "0014:124 tenant_id -> tenants CASCADE"],
  ["consignee_crm_events","tenant",   "12_consignee_crm_events","0016:152 tenant_id -> tenants CASCADE"],
  ["subscriptions",      "tenant",    "13_subscriptions",      "0009:134 tenant_id -> tenants CASCADE"],
  ["subscription_address_rotations","tenant","14_subscription_address_rotations","0014:171 tenant_id -> tenants CASCADE"],
  ["subscription_exceptions","tenant","15_subscription_exceptions","0015:136 tenant_id -> tenants CASCADE"],
  ["subscription_materialization","tenant","16_subscription_materialization","0015:212 tenant_id -> tenants CASCADE"],
  ["tasks",              "tenant",    "17_tasks",              "0006:125 tenant_id -> tenants CASCADE"],
  ["task_packages",      "tenant",    "18_task_packages",      "0007:109 tenant_id -> tenants CASCADE"],
  ["failed_pushes",      "tenant",    "19_failed_pushes",      "0008:139 tenant_id -> tenants CASCADE"],
  ["asset_tracking_cache","tenant",   "20_asset_tracking_cache","0011:165 tenant_id -> tenants CASCADE"],
  ["outbound_push_failures","tenant", "21_outbound_push_failures","0023:101 tenant_id -> tenants CASCADE"],
  ["asset_scan_log",     "tenant",    "22_asset_scan_log",     "0032:42 tenant_id -> tenants RESTRICT (Blocker B)"],
  ["audit_events",       "tenant",    "23_audit_events",       "0002:45 tenant_id -> tenants CASCADE (Blocker A — RULE)"],
];

function backupQuery([table, scope, csv, cite]) {
  const where =
    scope === "regions"
      ? `client_id NOT IN (${canonicalList})`
      : scope === "tenant_pk"
        ? `id IN (SELECT tenant_id FROM tgt)`
        : `tenant_id IN (SELECT tenant_id FROM tgt)`;
  const prefix = scope === "regions" ? "" : `${cte}\n`;
  return `-- >>> SAVE RESULT AS: ${csv}.csv   (${cite})
${prefix}SELECT * FROM ${table} WHERE ${where};`;
}

const backupSql = `-- PURGE #661 — STAGE B: BACKUP DUMP (READ ONLY — deletes nothing, writes nothing)
-- Target DB: ${PROJECT_REF} (PROD). Run each query below in the Supabase SQL editor and
-- use "Download CSV" to save the named file into memory/handoffs/purge-661-backup-<date>/.
-- These ${BACKUP_TABLES.length} files ARE the rollback artifact. Save ALL of them before Stage 1.
-- Keyed to the literal ${EXPECTED_COUNT} Stage-A tenant_ids (frozen below), never a pattern.
${fingerprint}

-- Sanity (run first): confirms the frozen list resolves to exactly ${EXPECTED_COUNT} live tenants.
${cte}
SELECT count(*) AS frozen_target_tenants_present FROM tenants WHERE id IN (SELECT tenant_id FROM tgt);
-- Expected: ${EXPECTED_COUNT}. If not ${EXPECTED_COUNT}, STOP and re-check the id list.

${BACKUP_TABLES.map((t) => backupQuery(t)).join("\n\n")}

-- Backup completeness gate: each CSV's row count must equal its Stage-A audit count
-- before the Stage-1 (child-delete) authorization is given.
`;

// ---- SINGLE-FILE BACKUP (one read-only query -> one restorable artifact) ----
// Emits a ready-to-run INSERT statement per row via to_jsonb + jsonb_populate_record,
// so EVERY column is captured automatically (no hand-listing, drift-proof, faithful
// type round-trip) and the one downloaded file restores in parent->child seq order.
// BACKUP_TABLES is already in restore order (regions=1, tenants=2, children 3..23).
function whereFor(scope) {
  return scope === "regions"
    ? `x.client_id NOT IN (${canonicalList})`
    : scope === "tenant_pk"
      ? `x.id IN (SELECT tenant_id FROM tgt)`
      : `x.tenant_id IN (SELECT tenant_id FROM tgt)`;
}
function dumpArm([table, scope, , cite], seq) {
  return `  SELECT ${seq} AS restore_seq, '${table}' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                '${table}', '${table}', to_jsonb(x)::text) AS stmt
  FROM ${table} x WHERE ${whereFor(scope)}   -- ${cite}`;
}
function countArm([table, scope], seq) {
  const w = scope === "regions"
    ? `client_id NOT IN (${canonicalList})`
    : scope === "tenant_pk"
      ? `id IN (SELECT tenant_id FROM tgt)`
      : `tenant_id IN (SELECT tenant_id FROM tgt)`;
  return `  SELECT ${seq} AS restore_seq, '${table}' AS table_name, count(*) AS n FROM ${table} WHERE ${w}`;
}
const dumpArms = BACKUP_TABLES.map((t, i) => dumpArm(t, i + 1)).join("\n  UNION ALL\n");
const countArms = BACKUP_TABLES.map((t, i) => countArm(t, i + 1)).join("\n  UNION ALL\n");

const singleFileSql = `-- PURGE #661 — STAGE B (SINGLE-FILE VARIANT): ONE read-only query -> ONE restorable artifact.
-- Target DB: ${PROJECT_REF} (PROD). READ ONLY — deletes nothing, writes nothing (SELECT only).
-- Captures every row Stage 1/2/3 will delete: all non-canonical regions + the ${EXPECTED_COUNT} tenants
-- + every FK-child row (full dependency map). Keyed to the literal ${EXPECTED_COUNT} ids (frozen below), no pattern.
-- Companion to the 23-file stage-b-backup.sql (kept as an alternative). Use EITHER, not both.
--
-- HOW TO RUN (minimal clicks):
--   Query 1 (SUMMARY): run it, then paste the grid back to the agent to sanity-check completeness.
--   Query 2 (ARTIFACT): run it ONCE, then "Download CSV" -> save as
--     memory/handoffs/purge-661-backup-${"2026-06-25"}.csv  (this single file IS the rollback artifact).
--
-- ONE-DOWNLOAD FEASIBILITY: yes — Query 2 is a single SELECT, so its result is one grid and
-- "Download CSV" yields one file. CAVEAT: the editor may *display* only the first ~1000 rows, but
-- the CSV export contains ALL rows. After download, confirm the CSV's data-row count equals the
-- SUM of Query 1's counts. (For these fixture tenants the total is expected to be small.)
--
-- RESTORE (break-glass, its own named clear): the 'stmt' column, ordered by restore_seq, is a
-- runnable script — each cell is a complete INSERT that rebuilds the row from JSON via
-- jsonb_populate_record (regions before tenants before children; INSERT is allowed on
-- audit_events + asset_scan_log — their RULE/trigger block only UPDATE/DELETE). Paste the CSV
-- back to the agent to reassemble an ordered .sql, or run the stmt column top-to-bottom.
-- CAVEAT: faithful for text/uuid/timestamptz/numeric/boolean/jsonb/array/null. No bytea columns
-- exist in this set; if one is ever added, review its round-trip before relying on it.
${fingerprint}

-- ===== QUERY 1 — ROW-COUNT SUMMARY (run; paste the grid to the agent) =====
${cte}
SELECT * FROM (
${countArms}
) c ORDER BY restore_seq;

-- ===== QUERY 2 — SINGLE-FILE BACKUP ARTIFACT (run once; Download CSV) =====
${cte}
SELECT restore_seq, tbl, stmt FROM (
${dumpArms}
) s ORDER BY restore_seq, stmt;
`;

// ---- STAGE 1: child deletes ----
const stage1Body = (finalWord) => `BEGIN;

${fingerprint}

${seedTargets}

${guardCount}

${guardSafe}

${driftNotice}

-- Blocker A — audit_events_no_delete RULE (0002:90): disable -> delete -> re-enable.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;

-- Blocker B — asset_scan_log RESTRICT + append-only trigger (0032:42-43,95): GUC escape.
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);

-- Graph deletes (child -> parent). Cascades clear task_packages / failed_pushes /
-- asset_tracking_cache / outbound_push_failures (via tasks) and the subscription_* children.
DELETE FROM tasks                WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM subscriptions        WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM addresses            WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM consignees           WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);

-- Verify-before-commit: every child table must be 0 for the target set;
-- tenants themselves remain (deleted in Stage 2).
SELECT 'audit_events'   AS tbl, count(*) AS n FROM audit_events   WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'asset_scan_log', count(*) FROM asset_scan_log   WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'tasks',          count(*) FROM tasks            WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'task_packages',  count(*) FROM task_packages    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'failed_pushes',  count(*) FROM failed_pushes    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'asset_tracking_cache', count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'outbound_push_failures', count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscriptions',  count(*) FROM subscriptions    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_address_rotations', count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_exceptions', count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_materialization', count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'consignee_crm_events', count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'addresses',      count(*) FROM addresses        WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'consignees',     count(*) FROM consignees       WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'tenants_remaining', count(*) FROM tenants       WHERE id        IN (SELECT tenant_id FROM _purge_targets);
-- All child rows must read 0; tenants_remaining must read ${EXPECTED_COUNT}.

${finalWord};`;

const stage1Sql = `-- PURGE #661 — STAGE 1: CHILD DELETES (one transaction). Target: ${PROJECT_REF} (PROD).
-- Authorization: separate named Love clear, AFTER Stage-B backup is fully saved.
-- Run the DRY-RUN block first, read the verify output, THEN the EXECUTE block on clear.

${banner("STAGE 1 — DRY RUN (ends ROLLBACK — changes NOTHING)")}
${stage1Body("ROLLBACK")}

${banner("STAGE 1 — EXECUTE (ends COMMIT — runs ONLY on Love's named clear)")}
${stage1Body("COMMIT")}
`;

// ---- STAGE 2: tenant deletes ----
const stage2Body = (finalWord) => `BEGIN;

${fingerprint}

${seedTargets}

${guardCount}

${guardSafe}

DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _purge_targets);
-- Cascades the remaining leaf children: users, roles, role_assignments, api_keys,
-- task_generation_runs, tenant_suitefleet_webhook_credentials, webhook_events.

-- Verify: targets gone; genuine merchants untouched.
SELECT 'targets_remaining'   AS k, count(*) AS v FROM tenants WHERE id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'allowlisted_present', count(*) FROM tenants WHERE slug IN (${allowlist});
-- targets_remaining must be 0; allowlisted_present must equal its pre-run value (unchanged).

${finalWord};`;

const stage2Sql = `-- PURGE #661 — STAGE 2: TENANT DELETES (one transaction). Target: ${PROJECT_REF} (PROD).
-- Authorization: separate named Love clear, AFTER Stage-1 child deletes are committed + verified.

${banner("STAGE 2 — DRY RUN (ends ROLLBACK)")}
${stage2Body("ROLLBACK")}

${banner("STAGE 2 — EXECUTE (ends COMMIT — runs ONLY on Love's named clear)")}
${stage2Body("COMMIT")}
`;

// ---- STAGE 3: region deletes (region-scoped, not tenant-scoped) ----
const stage3Body = (finalWord) => `BEGIN;

${fingerprint}

-- GUARD: refuse to delete any non-canonical region that STILL has a bound tenant.
DO $$
DECLARE bound int;
BEGIN
  SELECT count(*) INTO bound
  FROM suitefleet_regions r
  WHERE r.client_id NOT IN (${canonicalList})
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.suitefleet_region_id = r.id);
  IF bound <> 0 THEN RAISE EXCEPTION 'REGION GUARD TRIPPED: % junk region(s) still bound — run Stage 2 first', bound; END IF;
END $$;

DELETE FROM suitefleet_regions WHERE client_id NOT IN (${canonicalList});

-- Verify: exactly the 4 canonical regions remain.
SELECT count(*) AS regions_remaining,
       array_agg(client_id ORDER BY client_id) AS client_ids
FROM suitefleet_regions;
-- regions_remaining must be 4; client_ids must be {${[...CANONICAL].sort().join(",")}}.

${finalWord};`;

const stage3Sql = `-- PURGE #661 — STAGE 3: REGION DELETES (one transaction). Target: ${PROJECT_REF} (PROD).
-- Authorization: separate named Love clear, AFTER Stage-2 tenant deletes are committed + verified.
-- Deletes ALL non-canonical regions (the ${EXPECTED_COUNT}-tenants' now-unbound regions + the 16 already-unbound).

${banner("STAGE 3 — DRY RUN (ends ROLLBACK)")}
${stage3Body("ROLLBACK")}

${banner("STAGE 3 — EXECUTE (ends COMMIT — runs ONLY on Love's named clear)")}
${stage3Body("COMMIT")}
`;

// ---- write ----
writeFileSync(join(HERE, "stage-b-backup.sql"), backupSql);
writeFileSync(join(HERE, "stage-b-backup-singlefile.sql"), singleFileSql);
writeFileSync(join(HERE, "stage-1-child-deletes.sql"), stage1Sql);
writeFileSync(join(HERE, "stage-2-tenant-deletes.sql"), stage2Sql);
writeFileSync(join(HERE, "stage-3-region-deletes.sql"), stage3Sql);

console.log(`Generated 5 SQL files keyed to ${ids.length} literal tenant_ids:`);
console.log("  stage-b-backup.sql            (READ ONLY, " + BACKUP_TABLES.length + " CSV dumps)");
console.log("  stage-b-backup-singlefile.sql (READ ONLY, 1 query -> 1 restorable artifact)");
console.log("  stage-1-child-deletes.sql     (DRY-RUN + EXECUTE)");
console.log("  stage-2-tenant-deletes.sql");
console.log("  stage-3-region-deletes.sql");
