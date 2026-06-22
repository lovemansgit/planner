#!/usr/bin/env node
// scripts/delete-merchant-seed-junk.mjs
//
// ⚠️  IRREVERSIBLE PRODUCTION DELETE — parameterised, marker-scoped.
// Generalises the proven scripts/delete-fbu-seed-junk.mjs for merchants that
// hold a MIX of junk and real data (dr-nutrition, meal-plan-scheduler).
//
//   node scripts/delete-merchant-seed-junk.mjs --slug=dr-nutrition
//   node scripts/delete-merchant-seed-junk.mjs --slug=meal-plan-scheduler --execute=true
//
// SCOPE IS THE PER-MERCHANT MARKER ONLY: external_ref LIKE 'SEED-<CODE>-%'
// (tasks: belonging to a seeded consignee/subscription). It NEVER touches:
//   - demo personas (external_ref 'SEED-DEMO-%'  — Fatima, Sarah)
//   - unmarked manual rows (external_ref NULL    — incl. Love Mansukhani + the
//     13 MPL test rows pending Love's separate ruling)
//   - any real (non-SEED) data
// A PRESERVATION GATE proves it: the count of non-marker consignees /
// subscriptions / tasks is identical BEFORE and AFTER the delete, or ROLLBACK.
//
// SAFETY POSTURE (same as the FBU script):
//   - DEFAULT = DRY RUN: performs the full delete in-tx, verifies, ROLLS BACK.
//   - --execute=true runs the identical path and COMMITS.
//   - Single transaction, READ COMMITTED (concurrent drift caught by asserts).
//   - Frozen gate on the STABLE marked consignee/subscription counts; tasks
//     are deleted by an in-tx re-count of marked-parent tasks (drift-tolerant,
//     since active subs keep materialising tasks on the rolling horizon).
//   - asset_scan_log -> tasks is ON DELETE RESTRICT: asserts 0 on the seeded
//     tasks or ABORTS (deleting them is a re-scope needing a fresh ruling).
//   - FK-safe order tasks -> subscriptions -> consignees. ROLLBACK on any
//     count mismatch, any preservation breach, or leftover marked rows.
//
// Required env (.env.local): SUPABASE_DATABASE_URL (prod pooler).
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

// Stable per-merchant expectations, frozen from the read-only probe
// (scripts/probe-dnr-mpl-seed-readonly.mjs). The script ABORTS if the live
// marked counts differ — a STOP for a fresh ruling, not a number to edit.
const MERCHANTS = Object.freeze({
  "dr-nutrition":        { code: "DNR", expectConsignees: 145, expectSubscriptions: 145 },
  "meal-plan-scheduler": { code: "MPL", expectConsignees: 200, expectSubscriptions: 200 },
});

const ARG_PATTERN = /^--([a-z][a-z0-9-]*)=(.*)$/;
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = ARG_PATTERN.exec(a);
    if (!m) { console.error(`Unrecognised argument: ${a}`); process.exit(2); }
    out[m[1]] = m[2];
  }
  return out;
}
class DryRunRollback extends Error {}

async function main() {
  const args = parseArgs(process.argv);
  const slug = args["slug"];
  const execute = args["execute"] === "true";
  const cfg = MERCHANTS[slug];
  if (!cfg) {
    console.error(`--slug must be one of: ${Object.keys(MERCHANTS).join(", ")}`);
    process.exit(2);
  }
  const MARK = `SEED-${cfg.code}-%`;
  const CLEAN_NAME = `${cfg.code} Customer %`;

  const dbUrl = process.env.SUPABASE_DATABASE_URL;
  if (!dbUrl) { console.error("missing SUPABASE_DATABASE_URL"); process.exit(1); }
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  const P = (s = "") => console.log(s);
  const fail = (m) => { throw new Error(`ABORT — ${m}`); };

  let committed = false;
  try {
    await sql.begin(async (tx) => {
      const [{ db, host }] = await tx`SELECT current_database() AS db, inet_server_addr()::text AS host`;
      const [tenant] = await tx`SELECT id, slug, name, status FROM tenants WHERE slug = ${slug}`;
      if (!tenant) fail(`tenant ${slug} not found`);
      const tid = tenant.id;

      P("");
      P("════════════════════════════════════════════════════════════════");
      P(`  ${cfg.code} (${slug}) seed-junk DELETE — mode=${execute ? "EXECUTE (COMMIT)" : "DRY RUN (ROLLBACK)"}`);
      P("════════════════════════════════════════════════════════════════");
      P(`  db=${db} server=${host ?? "(masked)"}`);
      P(`  tenant "${tenant.name}" status=${tenant.status} id=${tid}`);
      P(`  scope: external_ref LIKE '${MARK}' (tasks: by seeded parent). Preserves SEED-DEMO-% + NULL-ref + real.`);
      P("────────────────────────────────────────────────────────────────");

      // ---- Phase 1: re-count + marker-exactness gate ----------------------
      const [con] = await tx`
        SELECT count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS marked,
               count(*) FILTER (WHERE external_ref LIKE ${MARK} AND name NOT LIKE ${CLEAN_NAME})::int AS marked_odd_name,
               count(*) FILTER (WHERE external_ref LIKE 'SEED-DEMO-%' AND external_ref LIKE ${MARK})::int AS marked_demo,
               count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE ${MARK})::int AS non_marker
        FROM consignees WHERE tenant_id = ${tid}`;
      const [sub] = await tx`
        SELECT count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS marked,
               count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE ${MARK})::int AS non_marker
        FROM subscriptions WHERE tenant_id = ${tid}`;
      const [tsk] = await tx`
        SELECT count(*) FILTER (WHERE c.external_ref LIKE ${MARK} OR s.external_ref LIKE ${MARK})::int AS marked_parent,
               count(*) FILTER (WHERE (c.external_ref IS NULL OR c.external_ref NOT LIKE ${MARK})
                                  AND (s.external_ref IS NULL OR s.external_ref NOT LIKE ${MARK}))::int AS non_marker
        FROM tasks tk
        LEFT JOIN consignees c ON c.id = tk.consignee_id
        LEFT JOIN subscriptions s ON s.id = tk.subscription_id
        WHERE tk.tenant_id = ${tid}`;

      P(`  RE-COUNT: consignees marked=${con.marked} (expect ${cfg.expectConsignees}); subs marked=${sub.marked} (expect ${cfg.expectSubscriptions}); tasks marked-parent=${tsk.marked_parent}`);
      P(`  PRESERVE (non-marker, must be unchanged after): consignees=${con.non_marker} subs=${sub.non_marker} tasks=${tsk.non_marker}`);
      P(`  marker-exact: marked_odd_name=${con.marked_odd_name} marked_demo=${con.marked_demo} (must be 0)`);

      if (con.marked !== cfg.expectConsignees) fail(`marked consignees=${con.marked}, expected stable ${cfg.expectConsignees}`);
      if (sub.marked !== cfg.expectSubscriptions) fail(`marked subscriptions=${sub.marked}, expected stable ${cfg.expectSubscriptions}`);
      if (con.marked_odd_name !== 0) fail(`${con.marked_odd_name} marked consignee(s) not named '${cfg.code} Customer #' — marker may be over-broad`);
      if (con.marked_demo !== 0) fail(`marker overlaps SEED-DEMO- personas — STOP`);
      const beforeCon = con.non_marker, beforeSub = sub.non_marker, beforeTask = tsk.non_marker;
      const targetTasks = tsk.marked_parent;
      P(`  GATE PASS.`);
      P("────────────────────────────────────────────────────────────────");

      // ---- Phase 2: child inventory + asset_scan_log RESTRICT guard -------
      const seededTaskFilter = tx`
        tk.tenant_id = ${tid} AND (
          tk.consignee_id IN (SELECT id FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK})
          OR tk.subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}))`;
      const [restrict] = await tx`
        SELECT count(*)::int AS asset_scan_log
        FROM asset_scan_log asl WHERE asl.task_id IN (SELECT tk.id FROM tasks tk WHERE ${seededTaskFilter})`;
      const [cascade] = await tx`
        SELECT
          (SELECT count(*) FROM task_packages tp WHERE tp.task_id IN (SELECT tk.id FROM tasks tk WHERE ${seededTaskFilter}))::int AS task_packages,
          (SELECT count(*) FROM failed_pushes fp WHERE fp.task_id IN (SELECT tk.id FROM tasks tk WHERE ${seededTaskFilter}))::int AS failed_pushes,
          (SELECT count(*) FROM asset_tracking_cache atc WHERE atc.task_id IN (SELECT tk.id FROM tasks tk WHERE ${seededTaskFilter}))::int AS asset_tracking_cache,
          (SELECT count(*) FROM outbound_push_failures opf WHERE opf.task_id IN (SELECT tk.id FROM tasks tk WHERE ${seededTaskFilter}))::int AS outbound_push_failures,
          (SELECT count(*) FROM addresses a WHERE a.consignee_id IN (SELECT id FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}))::int AS addresses,
          (SELECT count(*) FROM consignee_crm_events ce WHERE ce.consignee_id IN (SELECT id FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}))::int AS crm_events,
          (SELECT count(*) FROM subscription_address_rotations r WHERE r.subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}))::int AS rotations,
          (SELECT count(*) FROM subscription_exceptions se WHERE se.subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}))::int AS exceptions,
          (SELECT count(*) FROM subscription_materialization sm WHERE sm.subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}))::int AS materialization`;
      P(`  CHILD INVENTORY of seeded rows (CASCADE unless noted):`);
      P(`    asset_scan_log (RESTRICT — must be 0): ${restrict.asset_scan_log}  task_packages:${cascade.task_packages} failed_pushes:${cascade.failed_pushes} asset_tracking_cache:${cascade.asset_tracking_cache} outbound_push_failures:${cascade.outbound_push_failures}`);
      P(`    addresses:${cascade.addresses} crm_events:${cascade.crm_events} rotations:${cascade.rotations} exceptions:${cascade.exceptions} materialization:${cascade.materialization}`);
      if (restrict.asset_scan_log !== 0)
        fail(`asset_scan_log has ${restrict.asset_scan_log} row(s) on seeded tasks (RESTRICT) — re-scope needs a ruling. STOP.`);
      P("────────────────────────────────────────────────────────────────");

      // ---- Phase 3: deletes, FK-safe order --------------------------------
      const delTasks = await tx`DELETE FROM tasks tk WHERE ${seededTaskFilter}`;
      if (delTasks.count !== targetTasks) fail(`deleted tasks=${delTasks.count}, expected in-tx re-count ${targetTasks}`);
      const delSubs = await tx`DELETE FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}`;
      if (delSubs.count !== cfg.expectSubscriptions) fail(`deleted subscriptions=${delSubs.count}, expected ${cfg.expectSubscriptions}`);
      const delCons = await tx`DELETE FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}`;
      if (delCons.count !== cfg.expectConsignees) fail(`deleted consignees=${delCons.count}, expected ${cfg.expectConsignees}`);
      P(`  DELETED: tasks=${delTasks.count}  subscriptions=${delSubs.count}  consignees=${delCons.count}`);

      // ---- Phase 4: post-delete + PRESERVATION verification ---------------
      const [postMarked] = await tx`
        SELECT
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK})::int AS con,
          (SELECT count(*) FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK})::int AS sub`;
      const [postNon] = await tx`
        SELECT
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND (external_ref IS NULL OR external_ref NOT LIKE ${MARK}))::int AS con,
          (SELECT count(*) FROM subscriptions WHERE tenant_id=${tid} AND (external_ref IS NULL OR external_ref NOT LIKE ${MARK}))::int AS sub,
          (SELECT count(*) FROM tasks tk
             LEFT JOIN consignees c ON c.id=tk.consignee_id
             LEFT JOIN subscriptions s ON s.id=tk.subscription_id
           WHERE tk.tenant_id=${tid}
             AND (c.external_ref IS NULL OR c.external_ref NOT LIKE ${MARK})
             AND (s.external_ref IS NULL OR s.external_ref NOT LIKE ${MARK}))::int AS task`;
      P(`  POST-DELETE remaining marked: consignees=${postMarked.con} subs=${postMarked.sub} (expect 0/0)`);
      P(`  PRESERVED non-marker: consignees ${beforeCon}->${postNon.con}  subs ${beforeSub}->${postNon.sub}  tasks ${beforeTask}->${postNon.task}`);
      if (postMarked.con !== 0 || postMarked.sub !== 0) fail(`marked rows remain: con=${postMarked.con} sub=${postMarked.sub}`);
      if (postNon.con !== beforeCon || postNon.sub !== beforeSub || postNon.task !== beforeTask)
        fail(`PRESERVATION BREACH — non-marker rows changed (con ${beforeCon}->${postNon.con}, sub ${beforeSub}->${postNon.sub}, task ${beforeTask}->${postNon.task})`);

      P("────────────────────────────────────────────────────────────────");
      if (!execute) { P(`  DRY RUN — all assertions passed. Rolling back.`); throw new DryRunRollback(); }
      P(`  EXECUTE — all assertions passed. COMMITTING.`);
      committed = true;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      P(`  ✔ DRY RUN rolled back cleanly. Re-run with --execute=true to COMMIT (after authorization).`);
      P("════════════════════════════════════════════════════════════════\n");
      await sql.end({ timeout: 5 }); return;
    }
    console.error(`\n  ✖ ${err.message}\n  Transaction ROLLED BACK — no changes persisted. Surface and STOP.`);
    console.error("════════════════════════════════════════════════════════════════\n");
    await sql.end({ timeout: 5 }); process.exit(1);
  }
  P(committed ? `  ✔ COMMITTED. ${slug} seed-junk permanently deleted.` : `  (no commit)`);
  P("════════════════════════════════════════════════════════════════\n");
  await sql.end({ timeout: 5 });
}
main().catch((e) => { console.error(e); process.exit(1); });
