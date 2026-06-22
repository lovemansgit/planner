#!/usr/bin/env node
// scripts/delete-fbu-seed-junk.mjs
//
// ⚠️  IRREVERSIBLE PRODUCTION DELETE — single-transaction, marker-scoped.
//
// Permanently deletes the Fresh Butchers DEV-SEED junk (proven by the
// read-only probe scripts/probe-fbu-seed-counts-readonly.mjs:
//   500 consignees / 500 subscriptions / 500 tasks, ALL carrying the
//   external_ref LIKE 'SEED-FBU-%' marker, ZERO real rows, marker exact
//   in both directions).
//
// SCOPE IS THE MARKER, NEVER "everything under fresh-butchers". The moment
// real Fresh Butchers data arrives it must survive untouched — every
// statement below is bounded by external_ref LIKE 'SEED-FBU-%' (tasks: by
// belonging to a seeded consignee/subscription). This is by design and
// must never be relaxed to a tenant-wide delete.
//
// SAFETY POSTURE
//   - DEFAULT = DRY RUN. Performs the FULL delete inside the transaction,
//     verifies every count, then ROLLS BACK. Nothing persists. This is a
//     faithful rehearsal: it proves the deletes produce exactly
//     500/500/500 against live data without committing.
//   - --execute=true runs the IDENTICAL path and COMMITS at the end.
//   - Single transaction. READ COMMITTED (default) so a concurrent cron
//     insert between the re-count and the delete is CAUGHT by the strict
//     equality assertion (deleted count != expected -> ROLLBACK), not
//     silently committed.
//   - FRESH re-count + zero-real re-proof INSIDE the transaction, BEFORE
//     any delete. If the live state differs from 500/500/500/zero-real by
//     even one row -> throw -> ROLLBACK -> STOP. Do NOT re-scope; surface
//     the discrepancy for a fresh ruling.
//   - asset_scan_log -> tasks is ON DELETE RESTRICT. The script asserts
//     ZERO scan rows on the seeded tasks before deleting; if any exist it
//     ABORTS (deleting them would be a re-scope needing Love's ruling).
//   - FK-safe delete order: tasks (children) -> subscriptions -> consignees.
//   - COMMIT only if every deleted count == expected AND post-delete
//     remaining seed-junk == 0. ROLLBACK on ANY mismatch.
//
// USAGE
//   # Dry run (rehearses + rolls back; no changes):
//   node scripts/delete-fbu-seed-junk.mjs
//   # Real, irreversible, COMMITs (only after Love's named authorization):
//   node scripts/delete-fbu-seed-junk.mjs --execute=true
//
// Required env (.env.local via dotenv): SUPABASE_DATABASE_URL (prod pooler).
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const SLUG = "fresh-butchers";
const MARK = "SEED-FBU-%";
// Proven snapshot from the read-only probe. The script ABORTS if live
// state differs from these by even one row — these are a hard gate, not a
// hint. If the count legitimately drifted (e.g. the cron materialised more
// tasks), that is a STOP for a fresh ruling, NOT a number to edit blindly.
const EXPECT = Object.freeze({ consignees: 500, subscriptions: 500, tasks: 500 });

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

// Sentinel used to force ROLLBACK at the end of a successful dry run.
class DryRunRollback extends Error {}

async function main() {
  const args = parseArgs(process.argv);
  const execute = args["execute"] === "true";

  const dbUrl = process.env.SUPABASE_DATABASE_URL;
  if (!dbUrl) { console.error("missing SUPABASE_DATABASE_URL"); process.exit(1); }
  const sql = postgres(dbUrl, { max: 1, prepare: false });

  const P = (s) => console.log(s);
  const fail = (msg) => { throw new Error(`ABORT — ${msg}`); };

  let committed = false;
  try {
    await sql.begin(async (tx) => {
      // ---- Phase 0: identity + tenant resolution --------------------------
      const [{ db, host }] = await tx`
        SELECT current_database() AS db, inet_server_addr()::text AS host`;
      const [tenant] = await tx`
        SELECT id, slug, name, status FROM tenants WHERE slug = ${SLUG}`;
      if (!tenant) fail(`tenant ${SLUG} not found`);
      if (tenant.slug !== SLUG) fail(`tenant slug mismatch: ${tenant.slug}`);
      const tid = tenant.id;

      P("");
      P("════════════════════════════════════════════════════════════════");
      P(`  FRESH BUTCHERS seed-junk DELETE  —  mode=${execute ? "EXECUTE (will COMMIT)" : "DRY RUN (will ROLLBACK)"}`);
      P("════════════════════════════════════════════════════════════════");
      P(`  db=${db} server=${host ?? "(masked)"}`);
      P(`  tenant: ${tenant.slug} / "${tenant.name}"  status=${tenant.status}  id=${tid}`);
      P(`  scope: external_ref LIKE '${MARK}' (tasks: belonging to seeded parents)`);
      P("────────────────────────────────────────────────────────────────");

      // ---- Phase 1: FRESH re-count + zero-real re-proof (the gate) --------
      const [con] = await tx`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS junk,
               count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE ${MARK})::int AS real
        FROM consignees WHERE tenant_id = ${tid}`;
      const [sub] = await tx`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE external_ref LIKE ${MARK})::int AS junk,
               count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE ${MARK})::int AS real
        FROM subscriptions WHERE tenant_id = ${tid}`;
      const [task] = await tx`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE c.external_ref LIKE ${MARK} OR s.external_ref LIKE ${MARK})::int AS junk,
               count(*) FILTER (WHERE (c.external_ref IS NULL OR c.external_ref NOT LIKE ${MARK})
                                  AND (s.external_ref IS NULL OR s.external_ref NOT LIKE ${MARK}))::int AS real
        FROM tasks tk
        LEFT JOIN consignees c ON c.id = tk.consignee_id
        LEFT JOIN subscriptions s ON s.id = tk.subscription_id
        WHERE tk.tenant_id = ${tid}`;
      // marker-exactness re-proof (both directions)
      const [safety] = await tx`
        SELECT
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK} AND name NOT LIKE 'FBU Customer %')::int AS marked_odd_name,
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK} AND (phone IS NULL OR phone NOT LIKE '+971540%'))::int AS marked_odd_phone,
          (SELECT count(*) FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK} AND status <> 'active')::int AS marked_sub_not_active,
          (SELECT count(*) FROM consignees WHERE tenant_id=${tid} AND (external_ref IS NULL OR external_ref NOT LIKE ${MARK}) AND (name LIKE 'FBU Customer %' OR phone LIKE '+971540%'))::int AS unmarked_junky`;

      P(`  RE-COUNT (now, inside tx):`);
      P(`    consignees     total=${con.total}  junk=${con.junk}  real=${con.real}`);
      P(`    subscriptions  total=${sub.total}  junk=${sub.junk}  real=${sub.real}`);
      P(`    tasks          total=${task.total}  junk=${task.junk}  real=${task.real}`);
      P(`    marker-exact   marked_odd_name=${safety.marked_odd_name} marked_odd_phone=${safety.marked_odd_phone} marked_sub_not_active=${safety.marked_sub_not_active} unmarked_junky=${safety.unmarked_junky}`);

      // Hard gate — abort on ANY deviation from the proven snapshot.
      if (con.total !== EXPECT.consignees || con.junk !== EXPECT.consignees || con.real !== 0)
        fail(`consignees gate: expected ${EXPECT.consignees}/${EXPECT.consignees}/0, got ${con.total}/${con.junk}/${con.real}`);
      if (sub.total !== EXPECT.subscriptions || sub.junk !== EXPECT.subscriptions || sub.real !== 0)
        fail(`subscriptions gate: expected ${EXPECT.subscriptions}/${EXPECT.subscriptions}/0, got ${sub.total}/${sub.junk}/${sub.real}`);
      if (task.total !== EXPECT.tasks || task.junk !== EXPECT.tasks || task.real !== 0)
        fail(`tasks gate: expected ${EXPECT.tasks}/${EXPECT.tasks}/0, got ${task.total}/${task.junk}/${task.real}`);
      if (safety.marked_odd_name || safety.marked_odd_phone || safety.marked_sub_not_active || safety.unmarked_junky)
        fail(`marker-exactness gate failed: ${JSON.stringify(safety)}`);
      P(`  GATE PASS — live state matches proven 500/500/500 + zero-real.`);
      P("────────────────────────────────────────────────────────────────");

      // ---- Phase 2: child / cascade inventory (full blast radius) ---------
      // Seeded-parent task id set, scoped by marker (never tenant-wide).
      const seededTaskFilter = tx`
        tk.tenant_id = ${tid} AND (
          tk.consignee_id IN (SELECT id FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK})
          OR tk.subscription_id IN (SELECT id FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK})
        )`;
      const [restrict] = await tx`
        SELECT count(*)::int AS asset_scan_log
        FROM asset_scan_log asl
        WHERE asl.task_id IN (SELECT tk.id FROM tasks tk WHERE ${seededTaskFilter})`;
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

      P(`  CHILD INVENTORY (auto-removed by ON DELETE CASCADE unless noted):`);
      P(`    asset_scan_log (RESTRICT — must be 0)         : ${restrict.asset_scan_log}`);
      P(`    task_packages                                 : ${cascade.task_packages}`);
      P(`    failed_pushes                                 : ${cascade.failed_pushes}`);
      P(`    asset_tracking_cache                          : ${cascade.asset_tracking_cache}`);
      P(`    outbound_push_failures                        : ${cascade.outbound_push_failures}`);
      P(`    addresses                                     : ${cascade.addresses}`);
      P(`    consignee_crm_events                          : ${cascade.crm_events}`);
      P(`    subscription_address_rotations                : ${cascade.rotations}`);
      P(`    subscription_exceptions                       : ${cascade.exceptions}`);
      P(`    subscription_materialization                  : ${cascade.materialization}`);

      // RESTRICT guard — asset_scan_log would BLOCK the task delete.
      if (restrict.asset_scan_log !== 0)
        fail(`asset_scan_log has ${restrict.asset_scan_log} row(s) on seeded tasks (ON DELETE RESTRICT). ` +
             `Deleting those is a RE-SCOPE that needs Love's explicit ruling — STOP.`);
      P("────────────────────────────────────────────────────────────────");

      // ---- Phase 3: deletes, FK-safe order, strict count assertions -------
      const delTasks = await tx`DELETE FROM tasks tk WHERE ${seededTaskFilter}`;
      if (delTasks.count !== EXPECT.tasks) fail(`deleted tasks=${delTasks.count}, expected ${EXPECT.tasks}`);

      const delSubs = await tx`
        DELETE FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}`;
      if (delSubs.count !== EXPECT.subscriptions) fail(`deleted subscriptions=${delSubs.count}, expected ${EXPECT.subscriptions}`);

      const delCons = await tx`
        DELETE FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}`;
      if (delCons.count !== EXPECT.consignees) fail(`deleted consignees=${delCons.count}, expected ${EXPECT.consignees}`);

      P(`  DELETED: tasks=${delTasks.count}  subscriptions=${delSubs.count}  consignees=${delCons.count}`);

      // ---- Phase 4: post-delete verification (still in tx) ----------------
      const [postCon] = await tx`SELECT count(*)::int AS c FROM consignees WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}`;
      const [postSub] = await tx`SELECT count(*)::int AS c FROM subscriptions WHERE tenant_id=${tid} AND external_ref LIKE ${MARK}`;
      const [postTask] = await tx`
        SELECT count(*)::int AS c FROM tasks tk
        LEFT JOIN consignees c ON c.id = tk.consignee_id
        LEFT JOIN subscriptions s ON s.id = tk.subscription_id
        WHERE tk.tenant_id=${tid} AND (c.external_ref LIKE ${MARK} OR s.external_ref LIKE ${MARK})`;
      P(`  POST-DELETE remaining seed-junk: consignees=${postCon.c}  subscriptions=${postSub.c}  tasks=${postTask.c}  (expect 0/0/0)`);
      if (postCon.c !== 0 || postSub.c !== 0 || postTask.c !== 0)
        fail(`post-delete remaining seed-junk not zero: ${postCon.c}/${postSub.c}/${postTask.c}`);

      P("────────────────────────────────────────────────────────────────");
      if (!execute) {
        P(`  DRY RUN complete — all assertions passed. Rolling back (no changes persisted).`);
        throw new DryRunRollback(); // forces ROLLBACK
      }
      P(`  EXECUTE — all assertions passed. COMMITTING.`);
      committed = true;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) {
      P(`  ✔ DRY RUN rolled back cleanly. Re-run with --execute=true to COMMIT (after authorization).`);
      P("════════════════════════════════════════════════════════════════\n");
      await sql.end({ timeout: 5 });
      return;
    }
    console.error("");
    console.error(`  ✖ ${err.message}`);
    console.error(`  Transaction ROLLED BACK — no changes persisted. Surface this and STOP.`);
    console.error("════════════════════════════════════════════════════════════════\n");
    await sql.end({ timeout: 5 });
    process.exit(1);
  }

  P(committed ? `  ✔ COMMITTED. Fresh Butchers seed-junk permanently deleted.` : `  (no commit)`);
  P("════════════════════════════════════════════════════════════════\n");
  await sql.end({ timeout: 5 });
}

main().catch((e) => { console.error(e); process.exit(1); });
