#!/usr/bin/env node
/**
 * Post-deploy verification probe — reusable post-deploy smoke test.
 *
 * Captures the post-deploy verification pattern used Day-15 evening to confirm
 * migration 0020 + cron-handler decoupling landed cleanly in production:
 *   - Active subscriptions count matches subscription_materialization rows
 *   - task_generation_runs has expected target_date population
 *   - Sample materialization rows show today's materialized_through_date
 *
 * Generalizes to any future deploy that affects subscription/task generation
 * paths. Parameterize the verification queries per deploy.
 *
 * Status: durable. Header rewritten Day 16 (PR #<TBD>) per plan-sync bundle item 8.
 */

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local", quiet: true });

const sql = postgres(process.env.SUPABASE_DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 5,
});

try {
  const counts = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active')           AS active_subs,
      (SELECT COUNT(*)::int FROM subscription_materialization)                    AS materialization_rows,
      (SELECT COUNT(*)::int FROM task_generation_runs WHERE target_date IS NULL)  AS runs_with_null_target,
      (SELECT COUNT(*)::int FROM task_generation_runs)                            AS total_runs,
      (SELECT COUNT(*)::int FROM tasks WHERE pushed_to_external_at IS NULL
         AND address_id IS NOT NULL)                                              AS phase1_reconciliation_candidates
  `;
  const colShape = await sql`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'task_generation_runs'
      AND column_name = 'target_date'
  `;
  const sample = await sql`
    SELECT subscription_id, materialized_through_date::text AS materialized_through_date
    FROM subscription_materialization
    ORDER BY last_materialized_at DESC
    LIMIT 3
  `;
  console.log(JSON.stringify({
    counts: counts[0],
    target_date_column: colShape[0],
    sample_materialization_rows: sample,
  }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
