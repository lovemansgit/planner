// src/modules/task-materialization/run-row.ts
//
// Day-14 task_generation_runs INSERT + 23505-conflict branching per
// memory/plans/day-14-cron-decoupling.md §4.4. Replaces the legacy
// task-generation/repository.ts:118-163 insertRunOrGetExisting +
// finaliseRun two-step pattern with a single-statement INSERT-as-
// terminal-status direct-write + 6-branch conflict reaction.
//
// Post-cutover state machine: the new handler writes status='completed'
// (or 'capped' on cap-gate) directly at end of the Phase 2-4 tx. No
// intermediate 'running' state from the new handler. On 23505 conflict
// against the new (tenant_id, target_date) UNIQUE (from migration
// 0020), the handler reads the existing row and branches per §4.4:
//
//   completed                                 → skip (idempotent re-run)
//   running AND started_at >= 15min ago       → skip (concurrent run wins)
//   running AND started_at < 15min ago        → STALE — recover via CAS
//   capped                                    → skip (volumetric guard prior)
//   skipped_already_run                       → skip (treat as completed;
//                                                legacy semi-redundant status)
//   failed                                    → skip (no auto-retry; ops triage)
//
// The §4.4 stale-running recovery branch uses an optimistic CAS
// predicate to handle the race where TWO concurrent handlers detect
// the same stale row and both try to reclaim:
//   UPDATE … WHERE id = $stale_id
//                 AND started_at = $original_stale_started_at
//   RETURNING id
// If RETURNING is empty, another invocation already reclaimed; this
// one short-circuits. If RETURNING returns the row, this invocation
// owns the recovery and proceeds.
//
// The recovery branch primarily handles legacy rows surviving cutover
// (rows the old handler wrote with status='running' and crashed
// before updating to 'completed'). The new handler never creates
// 'running' rows in steady state, so the recovery branch is also
// defense-in-depth against any future code path that might re-
// introduce a multi-tx pattern writing 'running' first.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

const log = logger.with({ component: "task_generation_run_row" });

const STALE_RUNNING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes per §4.4

export type RunRowStatus = "completed" | "capped";

export interface RunRowInput {
  tenantId: Uuid;
  targetDate: string;
  /** ISO timestamp — start of the cron invocation. Mirrors legacy run shape. */
  windowStart: string;
  /** ISO timestamp — windowStart + 1h, mirrors legacy run shape. */
  windowEnd: string;
  /** ISO timestamp — Phase 2 start (cap-check time). */
  startedAt: string;
  capThreshold: number;
  projectedCount: number;
  subscriptionsWalked: number;
  /** 0 on capped path (no INSERT happened) — set by caller. */
  tasksCreated: number;
  /** 0 on capped path. */
  tasksSkippedExisting: number;
  /** 'completed' on happy path; 'capped' when cap-gate fired. */
  status: RunRowStatus;
  requestId: string;
}

export type RunRowOutcome =
  | { kind: "inserted"; runId: Uuid; status: RunRowStatus }
  | {
      kind: "skipped_idempotent";
      existingRunId: Uuid;
      existingStatus: string;
    }
  | {
      kind: "stale_running_recovered";
      recoveredRunId: Uuid;
      originalStartedAt: string;
    }
  | {
      kind: "stale_running_lost_race";
      staleRunId: Uuid;
      originalStartedAt: string;
    };

/**
 * Phase 4 — INSERT task_generation_runs row directly at terminal
 * status ('completed' or 'capped'). On 23505 conflict against
 * (tenant_id, target_date) UNIQUE, branches per §4.4. Returns
 * RunRowOutcome describing which branch fired so the caller can log +
 * update Phase 6 summary.
 *
 * Caller wraps in withServiceRole; this function expects the SAME
 * open tx as Phases 2-3. On the 'capped' path, Phases 2-3 do NOT run
 * (cap-gate skips them); this function is the only DB write.
 */
export async function writeRunRowPhase4(
  tx: DbTx,
  input: RunRowInput,
): Promise<RunRowOutcome> {
  const {
    tenantId,
    targetDate,
    windowStart,
    windowEnd,
    startedAt,
    capThreshold,
    projectedCount,
    subscriptionsWalked,
    tasksCreated,
    tasksSkippedExisting,
    status,
    requestId,
  } = input;
  const runLog = log.with({
    tenant_id: tenantId,
    target_date: targetDate,
    request_id: requestId,
  });

  // ---------------------------------------------------------------------------
  // INSERT directly at terminal status. ON CONFLICT DO NOTHING so we
  // can detect the conflict via empty RETURNING and branch in
  // application code. (DO UPDATE would auto-resolve but bypasses our
  // 6-branch logic.)
  // ---------------------------------------------------------------------------
  type InsertedRow = { id: Uuid };
  const insertedRows = await tx.execute<InsertedRow>(sqlTag`
    INSERT INTO task_generation_runs (
      tenant_id,
      window_start,
      window_end,
      target_date,
      status,
      cap_threshold,
      projected_count,
      subscriptions_walked,
      tasks_created,
      tasks_skipped_existing,
      started_at,
      completed_at
    )
    VALUES (
      ${tenantId},
      ${windowStart}::timestamptz,
      ${windowEnd}::timestamptz,
      ${targetDate}::date,
      ${status},
      ${capThreshold},
      ${projectedCount},
      ${subscriptionsWalked},
      ${tasksCreated},
      ${tasksSkippedExisting},
      ${startedAt}::timestamptz,
      now()
    )
    ON CONFLICT (tenant_id, target_date) DO NOTHING
    RETURNING id
  `);

  if (insertedRows.length === 1) {
    return { kind: "inserted", runId: insertedRows[0].id, status };
  }

  // ---------------------------------------------------------------------------
  // 23505-equivalent: ON CONFLICT DO NOTHING returned 0 rows. Read the
  // existing row to determine which §4.4 branch fires.
  // ---------------------------------------------------------------------------
  type ExistingRow = {
    id: Uuid;
    status: string;
    started_at: string;
  };
  const existingRows = await tx.execute<ExistingRow>(sqlTag`
    SELECT id, status, started_at::text AS started_at
    FROM task_generation_runs
    WHERE tenant_id = ${tenantId}
      AND target_date = ${targetDate}::date
    LIMIT 1
  `);

  if (existingRows.length === 0) {
    runLog.error({}, "ON CONFLICT fired but existing row not found");
    throw new Error(
      `task_generation_runs ON CONFLICT inconsistency: conflict fired but no existing row for (${tenantId}, ${targetDate})`,
    );
  }

  const existing = existingRows[0];
  const existingStartedAtMs = new Date(existing.started_at).getTime();
  const nowMs = Date.now();

  // Branch per §4.4 status table.
  switch (existing.status) {
    case "completed":
    case "capped":
    case "skipped_already_run":
    case "failed":
      runLog.info(
        { existing_run_id: existing.id, existing_status: existing.status },
        "phase 4 conflict — existing row in terminal status; skip per §4.4",
      );
      return {
        kind: "skipped_idempotent",
        existingRunId: existing.id,
        existingStatus: existing.status,
      };

    case "running": {
      const ageMs = nowMs - existingStartedAtMs;
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) {
        runLog.info(
          { existing_run_id: existing.id, age_ms: ageMs },
          "phase 4 conflict — concurrent running run within 15min; skip per §4.4",
        );
        return {
          kind: "skipped_idempotent",
          existingRunId: existing.id,
          existingStatus: "running",
        };
      }

      // STALE — attempt CAS recovery per §4.4 amendment 2 + §9 A4.
      runLog.warn(
        {
          event: "cron.stale_running_detected",
          existing_run_id: existing.id,
          original_started_at: existing.started_at,
          age_ms: ageMs,
          tenant_id: tenantId,
          target_date: targetDate,
        },
        "phase 4 conflict — stale running detected; attempting CAS recovery",
      );

      type RecoveredRow = { id: Uuid };
      const recoveredRows = await tx.execute<RecoveredRow>(sqlTag`
        UPDATE task_generation_runs
        SET
          status = ${status},
          started_at = ${startedAt}::timestamptz,
          completed_at = now(),
          window_start = ${windowStart}::timestamptz,
          window_end = ${windowEnd}::timestamptz,
          cap_threshold = ${capThreshold},
          projected_count = ${projectedCount},
          subscriptions_walked = ${subscriptionsWalked},
          tasks_created = ${tasksCreated},
          tasks_skipped_existing = ${tasksSkippedExisting},
          error_text = NULL
        WHERE id = ${existing.id}
          AND started_at = ${existing.started_at}::timestamptz
        RETURNING id
      `);

      if (recoveredRows.length === 1) {
        runLog.info(
          { recovered_run_id: recoveredRows[0].id },
          "phase 4 stale-running CAS recovery succeeded",
        );
        return {
          kind: "stale_running_recovered",
          recoveredRunId: recoveredRows[0].id,
          originalStartedAt: existing.started_at,
        };
      }

      runLog.info(
        {
          stale_run_id: existing.id,
          original_started_at: existing.started_at,
        },
        "phase 4 stale-running CAS lost race; another invocation reclaimed first",
      );
      return {
        kind: "stale_running_lost_race",
        staleRunId: existing.id,
        originalStartedAt: existing.started_at,
      };
    }

    default:
      // Intentionally fail-loud rather than silent skip. The 5-value
      // status enum at 0012:180-186 is the canonical vocabulary; a
      // status outside that set indicates schema drift (e.g., a future
      // migration added a status value without updating this code).
      // Failing the in-flight tx surfaces drift loudly during the cron
      // run rather than masking it as a silent skip and accumulating
      // unhandled-status rows that ops only discovers via metric
      // anomaly weeks later.
      runLog.error(
        { existing_run_id: existing.id, existing_status: existing.status },
        "phase 4 conflict — unknown status (schema CHECK should prevent this; failing loud per §4.4 fail-loud posture)",
      );
      throw new Error(
        `task_generation_runs unknown status '${existing.status}' on conflict resolution for (${tenantId}, ${targetDate})`,
      );
  }
}
