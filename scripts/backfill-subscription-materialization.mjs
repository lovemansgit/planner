#!/usr/bin/env node
// scripts/backfill-subscription-materialization.mjs
//
// Day 14 / Phase 3 backfill — seeds subscription_materialization for
// every existing active subscription with materialized_through_date =
// today (so the next cron tick generates the full 14-day horizon).
//
// Per memory/plans/day-14-cron-decoupling.md §3.3 (one-time script,
// NOT migration). Migrations stay schema-only per project convention;
// this script is the data-mutation that bootstraps the new
// subscription_materialization table after PR #139's migration 0015
// has applied to prod.
//
// Mirrors the seed-subscriptions.mjs / teardown-merchant.mjs pattern
// for safety + observability.
//
// SAFETY POSTURE:
//   - Default = DRY RUN. Counts what it WOULD insert; makes no changes.
//   - --yes=true required for actual write.
//   - Idempotent — INSERT … ON CONFLICT (subscription_id) DO NOTHING.
//     Subs that already have a materialization row stay as-is. Safe
//     to re-run; existing rows are preserved.
//
// USAGE:
//   # Dry run (no changes; reports the count and target date):
//   npm run backfill-subscription-materialization
//
//   # Actual write:
//   npm run backfill-subscription-materialization -- --yes=true
//
// SEQUENCING:
//   1. PR #139's migration 0015 applied to production via Supabase
//      SQL editor (per memory/handoffs/day-13-eod.md / PR #139 merge
//      note). Verify with: SELECT to_regclass('public.subscription_materialization')
//      should return 'subscription_materialization'.
//   2. Day-14 code PR merged.
//   3. Love runs THIS script against production once.
//   4. Next cron tick at 12:00 UTC materializes the 14-day horizon.
//
// CI / staging / integration tests do NOT run this — they get fresh
// subscription_materialization seeded by their own test fixtures
// (per §3.3 lock).
//
// Required env (from .env.local via dotenv):
//   SUPABASE_DATABASE_URL          — superuser pool (BYPASSRLS)

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=");
    args.set(key, value);
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const isDryRun = args.get("yes") !== "true";

  const databaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) {
    console.error("[error] SUPABASE_DATABASE_URL not set in .env.local");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    // Step 1 — pre-flight: confirm the table exists. If it doesn't,
    // the migration hasn't been applied yet; bail loudly.
    const tableExists = await sql`
      SELECT to_regclass('public.subscription_materialization') AS regclass
    `;
    if (tableExists[0]?.regclass === null) {
      console.error(
        "[error] subscription_materialization table does not exist on this DB.",
      );
      console.error(
        "[error] Apply PR #139 migration 0015 via Supabase SQL editor first.",
      );
      process.exit(1);
    }

    // Step 2 — count existing active subscriptions (potential
    // backfill targets) and how many already have materialization rows.
    const counts = await sql`
      SELECT
        (SELECT count(*)::int FROM subscriptions WHERE status = 'active')   AS active_subs,
        (SELECT count(*)::int FROM subscription_materialization)            AS existing_materialization_rows
    `;
    const activeSubs = counts[0]?.active_subs ?? 0;
    const existingRows = counts[0]?.existing_materialization_rows ?? 0;

    // Step 3 — projected insert count: active subs that DON'T already
    // have a materialization row.
    const projected = await sql`
      SELECT count(*)::int AS n
      FROM subscriptions s
      LEFT JOIN subscription_materialization sm ON sm.subscription_id = s.id
      WHERE s.status = 'active'
        AND sm.subscription_id IS NULL
    `;
    const projectedInsertCount = projected[0]?.n ?? 0;

    console.log(`[info] Active subscriptions:                    ${activeSubs}`);
    console.log(`[info] Existing subscription_materialization:   ${existingRows}`);
    console.log(`[info] Projected new rows (this script):        ${projectedInsertCount}`);

    if (projectedInsertCount === 0) {
      console.log(
        "[info] Nothing to backfill — all active subscriptions already have materialization rows. Exiting.",
      );
      process.exit(0);
    }

    if (isDryRun) {
      console.log("");
      console.log("[dry-run] No changes made. Re-run with --yes=true to apply.");
      process.exit(0);
    }

    // Step 4 — actual INSERT. materialized_through_date = current_date
    // means the next cron tick at 12:00 UTC will compute target_date =
    // today + 14 days and materialize the full horizon for these subs.
    // Per §3.3 SQL sketch:
    //   INSERT INTO subscription_materialization
    //     (subscription_id, tenant_id, materialized_through_date)
    //   SELECT id, tenant_id, current_date
    //   FROM subscriptions
    //   WHERE status = 'active'
    //   ON CONFLICT (subscription_id) DO NOTHING;
    const result = await sql`
      INSERT INTO subscription_materialization
        (subscription_id, tenant_id, materialized_through_date)
      SELECT id, tenant_id, current_date
      FROM subscriptions
      WHERE status = 'active'
      ON CONFLICT (subscription_id) DO NOTHING
      RETURNING subscription_id
    `;
    const insertedCount = result.length;
    const skippedCount = activeSubs - insertedCount;

    console.log("");
    console.log(`[info] Inserted: ${insertedCount} new subscription_materialization rows`);
    console.log(`[info] Skipped:  ${skippedCount} subs already had a row (ON CONFLICT DO NOTHING)`);
    console.log("[info] Backfill complete.");
    console.log("");
    console.log("[info] Next step: confirm next cron tick at 12:00 UTC fires");
    console.log("[info] and materializes the 14-day horizon for these subs.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
