// Task-generation service.
//
// One service method: `generateTasksForWindow`. Per-tenant, per-window
// orchestration of the nightly cron's task-creation step. Pure-ish:
// takes a tenant, a window, and a target date; returns a discriminated
// outcome. The cron handler (src/app/api/cron/generate-tasks/route.ts)
// enumerates active tenants and calls this once per tenant per cron
// invocation.
//
// Lifecycle (as code):
//   1. Insert run row in 'running' state (UNIQUE on (tenant, window)).
//      On conflict → skipped_already_run, emit, return.
//   2. Project count via COUNT(*) on matching subscriptions.
//      If projected > capThreshold → 'capped', emit, return.
//   3. Bulk INSERT … SELECT into tasks with ON CONFLICT DO NOTHING on
//      the (subscription_id, delivery_date) partial UNIQUE.
//   4. Update run row to 'completed' with counts.
//   5. Per-task `task.created` audit emits.
//   6. Meta `task.bulk_generated` audit emit.
//
// All steps run under withServiceRole because the cron is a cross-tenant
// system actor and audit_events INSERTs require BYPASSRLS.
//
// Hard cap (memory/decision_daily_cutoff_and_throughput.md, 7K):
//   - On cap exceedance, the run aborts BEFORE any task INSERTs land.
//     Zero tasks generated. The 'capped' status is recorded; the cron
//     handler exits non-zero so Vercel logs flag the failed run.
//   - This is the (a) interpretation confirmed pre-C-2: hard abort, not
//     partial generation. Partial generation creates a silent
//     operational half-state where some subscriptions have tomorrow's
//     task and others don't, with no clean per-subscription recovery.
//
// Idempotency, two layers:
//   1. Run-level: UNIQUE (tenant, window_start, window_end) → re-invocation
//      hits the conflict, returns skipped_already_run.
//   2. Task-level: partial UNIQUE on tasks(subscription_id, delivery_date)
//      WHERE subscription_id IS NOT NULL → individual ON CONFLICT
//      DO NOTHING, defends the rare race where two cron invocations both
//      create runs (different physical retries, READ COMMITTED interleaving)
//      but only one set of tasks lands.
//
// Per-task audit emits use `emitOrLog` (mirrors bulkCreateTasks's posture):
// a per-emit failure logs at error level but does NOT propagate. The bulk
// insert already committed; an audit gap on one task must not poison the
// whole result. The meta-event emit is best-effort for the same reason.

import { emit, type EmitInput } from "../audit";
import { withServiceRole } from "../../shared/db";
import { ForbiddenError, ValidationError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import {
  bulkInsertTasksForSubscriptions,
  countMatchingSubscriptions,
  finaliseRun,
  insertRunOrGetExisting,
} from "./repository";
import type {
  GenerateForWindowInput,
  GenerateForWindowResult,
  TaskGenerationRun,
} from "./types";

const log = logger.with({ component: "task_generation_service" });

/**
 * Same actor → audit-id mapping as identity/service.ts and others.
 * Plan §3.4 forbids cross-module imports of internal helpers; each
 * module carries the four-line copy.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

/**
 * System-only path guard. The cron is the only legitimate caller. A
 * user actor reaching this method is a routing bug at the cron layer
 * — surface it as ForbiddenError so it shows up in logs.
 */
function assertSystemActor(ctx: RequestContext, op: string): void {
  if (ctx.actor.kind !== "system") {
    throw new ForbiddenError(`${op} requires a system actor`);
  }
}

/**
 * Validate the YYYY-MM-DD targetDate format. Cron handler computes
 * this from the window; defensive check at the service boundary.
 */
function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD, got '${value}'`);
  }
}

/**
 * Generate next-day tasks for one tenant for the given window.
 *
 * Outcome is one of four:
 *   - completed             — generation succeeded; counts recorded.
 *   - capped                — projected count exceeded capThreshold;
 *                             zero tasks generated, run row recorded.
 *   - skipped_already_run   — a prior run exists for this window;
 *                             no-op, existing run returned.
 *   - failed                — error during the project+generate tx; the
 *                             tx rolls back so zero tasks committed. The
 *                             run row is updated to 'failed' on a best-
 *                             effort separate tx; if that also fails,
 *                             the row stays 'running' for ops to surface.
 *
 * Throws (caller is the cron handler; throws bubble to the handler's
 * top-level try/catch, which logs + returns 500 to Vercel):
 *   - ForbiddenError    user actor reached this path.
 *   - ValidationError   inputs malformed (capThreshold <= 0,
 *                       targetDate not YYYY-MM-DD).
 */
export async function generateTasksForWindow(
  ctx: RequestContext,
  input: GenerateForWindowInput,
): Promise<GenerateForWindowResult> {
  assertSystemActor(ctx, "task-generation:generate_for_window");
  assertIsoDate(input.targetDate, "targetDate");
  if (input.capThreshold <= 0) {
    throw new ValidationError(
      `capThreshold must be > 0, got ${input.capThreshold}`,
    );
  }

  const runLog = log.with({
    tenant_id: input.tenantId,
    window_start: input.windowStart,
    window_end: input.windowEnd,
    target_date: input.targetDate,
  });

  // ---------------------------------------------------------------------------
  // Step 1: insert run row OR return skipped_already_run
  // ---------------------------------------------------------------------------
  const runOutcome = await withServiceRole(
    `task-generation:insert_run for tenant ${input.tenantId}`,
    async (tx) => {
      return insertRunOrGetExisting(
        tx,
        input.tenantId,
        input.windowStart,
        input.windowEnd,
        input.capThreshold,
      );
    },
  );

  if (runOutcome.kind === "already_exists") {
    runLog.info(
      { existing_run_id: runOutcome.existing.id },
      "task generation skipped — run already exists for window",
    );
    await emitOrLog({
      eventType: "task.bulk_generation_skipped_already_run",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId: input.tenantId,
      resourceType: "task_generation_run",
      resourceId: runOutcome.existing.id,
      metadata: {
        window_start: input.windowStart,
        window_end: input.windowEnd,
        existing_run_id: runOutcome.existing.id,
      },
      requestId: ctx.requestId,
    });
    return { kind: "skipped_already_run", existingRun: runOutcome.existing };
  }

  const run = runOutcome.run;

  // ---------------------------------------------------------------------------
  // Step 2 / 3: project count, gate on cap, generate
  // ---------------------------------------------------------------------------
  // The whole "project + gate + generate" sequence runs in one
  // withServiceRole tx so the projection and the INSERT see the same
  // snapshot of subscriptions. A subscription added/paused between
  // projection and INSERT could otherwise drift the count.
  let outcome: GenerateForWindowResult;
  try {
    outcome = await withServiceRole(
      `task-generation:project_and_generate for tenant ${input.tenantId}`,
      async (tx) => {
        const projectedCount = await countMatchingSubscriptions(
          tx,
          input.tenantId,
          input.targetDate,
        );

        if (projectedCount > input.capThreshold) {
          runLog.warn(
            { projected_count: projectedCount, cap_threshold: input.capThreshold },
            "task generation capped — projection exceeds threshold; aborting before any INSERT",
          );
          const cappedRun = await finaliseRun(tx, run.id, {
            status: "capped",
            projectedCount,
          });
          return {
            kind: "capped" as const,
            run: cappedRun,
            projectedCount,
            capThreshold: input.capThreshold,
          };
        }

        const inserted = await bulkInsertTasksForSubscriptions(
          tx,
          input.tenantId,
          input.targetDate,
        );
        const tasksCreated = inserted.length;
        const tasksSkippedExisting = projectedCount - tasksCreated;

        const completedRun = await finaliseRun(tx, run.id, {
          status: "completed",
          projectedCount,
          subscriptionsWalked: projectedCount,
          tasksCreated,
          tasksSkippedExisting,
        });

        return {
          kind: "completed" as const,
          run: completedRun,
          subscriptionsWalked: projectedCount,
          tasksCreated,
          tasksSkippedExisting,
          insertedIds: inserted,
        };
      },
    );
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err);
    runLog.error({ error: errorText }, "task generation failed before completion");
    // Try to record the failure on the run row — best-effort. If this
    // also fails, the run stays in 'running' state and operations'
    // stuck-runs query surfaces it.
    try {
      const failedRun = await withServiceRole(
        `task-generation:finalise_failed for tenant ${input.tenantId}`,
        async (tx) =>
          finaliseRun(tx, run.id, {
            status: "failed",
            errorText: errorText.slice(0, 1000),
          }),
      );
      return { kind: "failed", run: failedRun, errorText };
    } catch {
      return { kind: "failed", run, errorText };
    }
  }

  // ---------------------------------------------------------------------------
  // Step 4: emit cap audit event if applicable, then return
  // ---------------------------------------------------------------------------
  if (outcome.kind === "capped") {
    await emitOrLog({
      eventType: "task.bulk_generation_capped",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId: input.tenantId,
      resourceType: "task_generation_run",
      resourceId: outcome.run.id,
      metadata: {
        run_id: outcome.run.id,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        projected_count: outcome.projectedCount,
        cap_threshold: outcome.capThreshold,
      },
      requestId: ctx.requestId,
    });
    return outcome;
  }

  // ---------------------------------------------------------------------------
  // Step 5/6: per-task task.created emits + meta task.bulk_generated emit
  // ---------------------------------------------------------------------------
  // outcome.kind === "completed". TS narrows via the `if` above, but the
  // generated insertedIds field is internal to this function (not on
  // the public GenerateForWindowResult union) — strip before returning.
  const insertedIds = (outcome as typeof outcome & {
    insertedIds: readonly { id: Uuid; subscriptionId: Uuid }[];
  }).insertedIds;

  for (const t of insertedIds) {
    await emitOrLog({
      eventType: "task.created",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId: input.tenantId,
      resourceType: "task",
      resourceId: t.id,
      metadata: {
        task_id: t.id,
        scheduled_for: input.targetDate,
        run_id: outcome.run.id,
        subscription_id: t.subscriptionId,
      },
      requestId: ctx.requestId,
    });
  }

  await emitOrLog({
    eventType: "task.bulk_generated",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: input.tenantId,
    resourceType: "task_generation_run",
    resourceId: outcome.run.id,
    metadata: {
      run_id: outcome.run.id,
      window_start: input.windowStart,
      window_end: input.windowEnd,
      subscriptions_walked: outcome.subscriptionsWalked,
      tasks_created: outcome.tasksCreated,
      tasks_skipped_existing: outcome.tasksSkippedExisting,
    },
    requestId: ctx.requestId,
  });

  return {
    kind: "completed",
    run: outcome.run,
    subscriptionsWalked: outcome.subscriptionsWalked,
    tasksCreated: outcome.tasksCreated,
    tasksSkippedExisting: outcome.tasksSkippedExisting,
  };
}

/**
 * Emit one audit event; on failure log at error level but do NOT
 * propagate. Mirrors the `emitOrLog` posture in tasks/service.ts —
 * post-commit audit telemetry must not poison an already-committed
 * batch result.
 */
async function emitOrLog(input: EmitInput): Promise<void> {
  try {
    await emit(input);
  } catch (err) {
    log.error(
      {
        eventType: input.eventType,
        resourceId: input.resourceId,
        error: err instanceof Error ? err.message : String(err),
      },
      "audit emit failed during task generation (non-blocking)",
    );
  }
}

// Re-export types at the service surface for the cron handler import path.
export type { TaskGenerationRun };
