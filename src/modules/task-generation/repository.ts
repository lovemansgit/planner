// Task-generation repository — Drizzle queries against
// `task_generation_runs` (0012) plus the cross-table INSERT...SELECT
// against subscriptions + tasks for the actual generation step.
//
// "Repository" here is the data-access layer: every function takes a
// `tx: DbTx` from the caller's `withServiceRole` block, runs one or two
// statements, and maps rows to the camelCase domain shape. No
// permission checks, no audit emits, no policy beyond null-vs-undefined
// handling — those belong in the service layer.
//
// All operations run under withServiceRole because the cron is a
// cross-tenant system actor and:
//   - task_generation_runs is tenant-scoped, but the cron handler
//     enumerates tenants via withServiceRole and calls the service
//     once per tenant.
//   - The bulk INSERT into tasks must succeed even when no user session
//     has set app.current_tenant_id — the cron's authorisation is the
//     CRON_SECRET one layer up.
//   - audit_events INSERTs require BYPASSRLS by policy.
//
// Defence in depth: every WHERE clause carries an explicit
// `tenant_id = ${tenantId}` predicate alongside whatever RLS the tenant
// session would have applied, so the query is self-describing in
// pg_stat / EXPLAIN even when running through the BYPASSRLS path.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { IsoTimestamp, Uuid } from "@/shared/types";

import type {
  TaskGenerationRun,
  TaskGenerationRunStatus,
} from "./types";

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------

type TaskGenerationRunRow = {
  id: string;
  tenant_id: string;
  window_start: Date | string;
  window_end: Date | string;
  status: TaskGenerationRunStatus;
  cap_threshold: number;
  projected_count: number | null;
  subscriptions_walked: number | null;
  tasks_created: number | null;
  tasks_skipped_existing: number | null;
  error_text: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): IsoTimestamp {
  return (
    value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  ) as IsoTimestamp;
}

function toIsoOrNull(value: Date | string | null): IsoTimestamp | null {
  return value === null ? null : toIso(value);
}

function mapRun(row: TaskGenerationRunRow): TaskGenerationRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    windowStart: toIso(row.window_start),
    windowEnd: toIso(row.window_end),
    status: row.status,
    capThreshold: row.cap_threshold,
    projectedCount: row.projected_count,
    subscriptionsWalked: row.subscriptions_walked,
    tasksCreated: row.tasks_created,
    tasksSkippedExisting: row.tasks_skipped_existing,
    errorText: row.error_text,
    startedAt: toIso(row.started_at),
    completedAt: toIsoOrNull(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// -----------------------------------------------------------------------------
// Operations on task_generation_runs
// -----------------------------------------------------------------------------

/**
 * Discriminated outcome for the run-row creation step. The
 * service layer switches on `kind`:
 *   - 'created' → proceed with generation
 *   - 'already_exists' → emit skipped event, return without generating
 */
export type InsertRunOutcome =
  | { kind: "created"; run: TaskGenerationRun }
  | { kind: "already_exists"; existing: TaskGenerationRun };

/**
 * Attempt to INSERT a run row in 'running' state. If the
 * (tenant_id, window_start, window_end) UNIQUE constraint fires
 * (SQLSTATE 23505), fall through to a SELECT for the existing row and
 * return it under `kind: 'already_exists'`.
 *
 * Implementation uses INSERT … ON CONFLICT … DO NOTHING RETURNING *
 * so the conflict path returns zero rows (instead of raising) and we
 * follow with a SELECT for the existing row. This avoids a try/catch
 * around the SQLSTATE — both paths are explicit query results.
 *
 * Note on partial-index ON CONFLICT: this constraint is a plain
 * non-partial UNIQUE on three columns, so Postgres infers the index
 * directly from the column list with no `WHERE` index_predicate
 * required.
 */
export async function insertRunOrGetExisting(
  tx: DbTx,
  tenantId: Uuid,
  windowStart: IsoTimestamp,
  windowEnd: IsoTimestamp,
  capThreshold: number,
): Promise<InsertRunOutcome> {
  const insertedRows = await tx.execute<TaskGenerationRunRow>(sqlTag`
    INSERT INTO task_generation_runs (
      tenant_id,
      window_start,
      window_end,
      status,
      cap_threshold
    ) VALUES (
      ${tenantId},
      ${windowStart},
      ${windowEnd},
      'running',
      ${capThreshold}
    )
    ON CONFLICT (tenant_id, window_start, window_end) DO NOTHING
    RETURNING *
  `);

  if (insertedRows.length === 1) {
    return { kind: "created", run: mapRun(insertedRows[0]) };
  }

  // Conflict path: the row already exists. Read it.
  const existingRows = await tx.execute<TaskGenerationRunRow>(sqlTag`
    SELECT * FROM task_generation_runs
    WHERE tenant_id = ${tenantId}
      AND window_start = ${windowStart}
      AND window_end = ${windowEnd}
  `);
  if (existingRows.length === 0) {
    // Should be impossible: ON CONFLICT DO NOTHING returned no row, so
    // either we inserted (handled above) or the conflict row exists.
    // Surface loudly rather than silently treat as a fresh insert path.
    throw new Error(
      `insertRunOrGetExisting: ON CONFLICT DO NOTHING produced zero RETURNING rows but no existing row found for tenant=${tenantId} window=[${windowStart}, ${windowEnd}]`,
    );
  }
  return { kind: "already_exists", existing: mapRun(existingRows[0]) };
}

/**
 * UPDATE one run row by id with the supplied terminal-state fields.
 * Returns the updated row. Throws if the row does not exist (which
 * should be impossible — the caller just inserted it).
 */
export async function finaliseRun(
  tx: DbTx,
  runId: Uuid,
  patch: {
    status: Exclude<TaskGenerationRunStatus, "running">;
    projectedCount?: number;
    subscriptionsWalked?: number;
    tasksCreated?: number;
    tasksSkippedExisting?: number;
    errorText?: string;
  },
): Promise<TaskGenerationRun> {
  const rows = await tx.execute<TaskGenerationRunRow>(sqlTag`
    UPDATE task_generation_runs SET
      status                 = ${patch.status},
      projected_count        = COALESCE(${patch.projectedCount ?? null}, projected_count),
      subscriptions_walked   = COALESCE(${patch.subscriptionsWalked ?? null}, subscriptions_walked),
      tasks_created          = COALESCE(${patch.tasksCreated ?? null}, tasks_created),
      tasks_skipped_existing = COALESCE(${patch.tasksSkippedExisting ?? null}, tasks_skipped_existing),
      error_text             = COALESCE(${patch.errorText ?? null}, error_text),
      completed_at           = now()
    WHERE id = ${runId}
    RETURNING *
  `);
  if (rows.length === 0) {
    throw new Error(`finaliseRun: no run found with id=${runId}`);
  }
  return mapRun(rows[0]);
}

/**
 * SELECT one run by id. Returns null if not found. Used by tests and by
 * the admin "stuck-runs" query path.
 */
export async function findRunById(tx: DbTx, runId: Uuid): Promise<TaskGenerationRun | null> {
  const rows = await tx.execute<TaskGenerationRunRow>(sqlTag`
    SELECT * FROM task_generation_runs WHERE id = ${runId}
  `);
  return rows[0] ? mapRun(rows[0]) : null;
}

// -----------------------------------------------------------------------------
// Subscription-walk and task generation
// -----------------------------------------------------------------------------

/**
 * COUNT subscriptions matching the generation criteria for `tenantId`
 * on `targetDate`. Used by the cap-projection step.
 *
 * Criteria:
 *   - status = 'active'
 *   - start_date <= targetDate AND (end_date IS NULL OR end_date >= targetDate)
 *   - EXTRACT(ISODOW FROM targetDate)::int = ANY(days_of_week)
 *
 * Postgres ISODOW returns 1=Mon..7=Sun, matching the days_of_week
 * domain CHECK in 0009.
 */
export async function countMatchingSubscriptions(
  tx: DbTx,
  tenantId: Uuid,
  targetDate: string,
): Promise<number> {
  type CountRow = { n: number } & Record<string, unknown>;
  const rows = await tx.execute<CountRow>(sqlTag`
    SELECT count(*)::int AS n
    FROM subscriptions s
    WHERE s.tenant_id = ${tenantId}
      AND s.status = 'active'
      AND s.start_date <= ${targetDate}::date
      AND (s.end_date IS NULL OR s.end_date >= ${targetDate}::date)
      AND EXTRACT(ISODOW FROM ${targetDate}::date)::int = ANY(s.days_of_week)
  `);
  return rows[0]?.n ?? 0;
}

/**
 * Bulk INSERT of generated tasks via a single INSERT … SELECT against
 * subscriptions, with ON CONFLICT on the partial UNIQUE
 * (subscription_id, delivery_date) WHERE subscription_id IS NOT NULL
 * (added in 0012). The conflict path silently skips per-task
 * duplicates.
 *
 * RETURNING (id, subscription_id) gives the freshly-inserted ids; the
 * caller derives `tasksCreated = returned.length` and
 * `tasksSkippedExisting = walked - tasksCreated`.
 *
 * Field defaults:
 *   - customer_order_number: deterministic 'SUB-<sub_id_short>-<YYYYMMDD>'.
 *     `sub_id_short` is the first 12 hex chars of the subscription UUID
 *     with dashes stripped (48 bits of entropy → ~10⁻⁶ collision rate
 *     per tenant per year at the 7K cap; the 8-char variant proposed at
 *     C-2 PR open carried 0.57%/year/tenant which is non-trivial since
 *     customer_order_number has no UNIQUE constraint to fail-closed and
 *     the failure mode is silent operator-confusion duplicates). Stable
 *     across re-runs (joins ON CONFLICT cleanly), identifiable in
 *     operator UIs.
 *   - created_via: 'subscription' — composite CHECK in 0010 requires
 *     this when subscription_id IS NOT NULL.
 *   - internal_status: 'CREATED' — task is local-only until pushed by
 *     C-3.
 *   - delivery_date: targetDate (the next-day calendar date in
 *     Asia/Dubai per memory/decision_daily_cutoff_and_throughput.md).
 *   - delivery_start_time / delivery_end_time: from
 *     subscription.delivery_window_start / _end.
 *   - task_kind: 'DELIVERY' (pilot default per 0006).
 *
 * The INSERT … SELECT pattern is one round-trip regardless of subscription
 * count; for the 7K cap that's a single statement instead of 7K. Audit
 * emits remain per-task (called by service.ts after this returns).
 *
 * IMPORTANT: SELECT pulls `delivery_window_start` and `delivery_window_end`
 * from the subscription. These are `time` columns (HH:MM:SS); the tasks
 * table accepts `time` directly.
 */
export async function bulkInsertTasksForSubscriptions(
  tx: DbTx,
  tenantId: Uuid,
  targetDate: string,
): Promise<readonly { id: Uuid; subscriptionId: Uuid }[]> {
  type InsertedRow = { id: string; subscription_id: string } & Record<string, unknown>;
  const rows = await tx.execute<InsertedRow>(sqlTag`
    INSERT INTO tasks (
      tenant_id,
      consignee_id,
      subscription_id,
      created_via,
      customer_order_number,
      internal_status,
      delivery_date,
      delivery_start_time,
      delivery_end_time,
      delivery_type,
      task_kind
    )
    SELECT
      s.tenant_id,
      s.consignee_id,
      s.id,
      'subscription',
      'SUB-' || substring(replace(s.id::text, '-', ''), 1, 12) || '-' || to_char(${targetDate}::date, 'YYYYMMDD'),
      'CREATED',
      ${targetDate}::date,
      s.delivery_window_start,
      s.delivery_window_end,
      'STANDARD',
      'DELIVERY'
    FROM subscriptions s
    WHERE s.tenant_id = ${tenantId}
      AND s.status = 'active'
      AND s.start_date <= ${targetDate}::date
      AND (s.end_date IS NULL OR s.end_date >= ${targetDate}::date)
      AND EXTRACT(ISODOW FROM ${targetDate}::date)::int = ANY(s.days_of_week)
    ON CONFLICT (subscription_id, delivery_date) WHERE subscription_id IS NOT NULL DO NOTHING
    RETURNING id, subscription_id
  `);
  return rows.map((r) => ({ id: r.id, subscriptionId: r.subscription_id }));
}
