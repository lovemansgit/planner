// Failed-pushes service-layer operations.
//
// Day 5 / T-7: insert path only — `recordFailedPush`. Same system-
// only shape as createTask / bulkCreateTasks (T-3): runs under
// `withServiceRole` because there is no user-facing failed_pushes
// permission in the catalogue (and shouldn't be — failed-push
// records are only ever written by the cron / adapter assembly).
//
// Pattern (matches src/modules/tasks/service.ts where applicable):
//   1. assertSystemActor — throws ForbiddenError if a user actor
//      reaches this path (routing bug at the API layer).
//   2. assertTenantScoped — throws ValidationError if ctx.tenantId
//      is null. failed_pushes is tenant-owned data.
//   3. Validate input shape — non-empty taskId, valid failure_reason
//      (the type already constrains it; the runtime check is
//      belt-and-braces against bypass routes).
//   4. Run the INSERT inside withServiceRole.
//   5. Post-commit emit task.push_failed with task-id /
//      attempt-count / failure-reason / http-status metadata.
//
// Audit event-types used:
//   task.push_failed (new, systemOnly: true) — emitted by recordFailedPush.
//
// Future expansions (NOT in T-7):
//   - recordFailedPushAttempt — UPDATE the existing unresolved row,
//     increment attempt_count, refresh last_attempted_at + most-recent
//     failure context. Day-7 cron retry path needs this.
//   - markFailedPushResolved — sets resolved_at + resolved_by +
//     resolution_notes. Emits task.push_resolved. Day-7+ when the
//     cron retry succeeds OR post-MVP UI when an operator manually
//     resolves.
//   - listUnresolvedByTenant — Day-7 cron iteration target; also
//     post-MVP operator UI's queue view.

import { emit } from "../audit";
import { withServiceRole } from "../../shared/db";
import { ForbiddenError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { insertFailedPush, updateFailedPushAttempt } from "./repository";
import type { FailedPush, FailureReason, RecordFailedPushInput } from "./types";

// Closed set of valid failure reasons — runtime guard against bypass
// routes that supply a string outside the type's union. The DB CHECK
// would catch this too, but a service-layer reject surfaces cleaner.
const VALID_FAILURE_REASONS: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "network",
  "server_5xx",
  "client_4xx",
  "timeout",
  "unknown",
]);

/**
 * Same actor → audit-id mapping as the tasks / consignees / identity
 * services. Plan §3.4 forbids cross-module imports of internal
 * helpers, so each module carries the four-line copy.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

function requireNonEmpty(value: string, field: string): Uuid {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return trimmed;
}

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

function assertSystemActor(ctx: RequestContext, forOperation: string): void {
  if (ctx.actor.kind !== "system") {
    throw new ForbiddenError(`${forOperation} requires a system actor`);
  }
}

// -----------------------------------------------------------------------------
// recordFailedPush
// -----------------------------------------------------------------------------

/**
 * Record the first failure for a task — INSERT a failed_pushes row
 * and emit task.push_failed post-commit. System-only.
 *
 * If an unresolved failed_pushes row already exists for the task,
 * the underlying SQLSTATE 23505 (unique_violation) propagates from
 * the partial UNIQUE — for T-7 scope, the cron's "is this the first
 * failure?" decision is the cron's responsibility. The
 * upsert / increment path (`recordFailedPushAttempt`) lands Day 7+.
 *
 * Throws:
 *   - ForbiddenError    user actor reached this path (routing bug).
 *   - ValidationError   missing required fields, no tenant context,
 *                       invalid failure_reason value.
 *   - DB errors         23505 (duplicate unresolved), 23503 (FK violation
 *                       — task_id doesn't exist), P0001 (tenant-match
 *                       trigger fired) propagate as-is.
 */
export async function recordFailedPush(
  ctx: RequestContext,
  input: RecordFailedPushInput,
): Promise<FailedPush> {
  assertSystemActor(ctx, "task:push_failed");
  assertTenantScoped(ctx, "task:push_failed");

  const taskId = requireNonEmpty(input.taskId, "taskId");
  if (!VALID_FAILURE_REASONS.has(input.failureReason)) {
    throw new ValidationError(
      `failureReason must be one of: ${Array.from(VALID_FAILURE_REASONS).join(", ")}`,
    );
  }

  const normalised: RecordFailedPushInput = {
    taskId,
    taskPayload: input.taskPayload,
    failureReason: input.failureReason,
    failureDetail:
      input.failureDetail !== undefined && input.failureDetail.trim().length > 0
        ? input.failureDetail.trim()
        : undefined,
    httpStatus: input.httpStatus,
  };

  const tenantId = ctx.tenantId;
  const recorded = await withServiceRole(
    `task:push_failed for tenant ${tenantId} (task ${taskId})`,
    async (tx) => {
      return insertFailedPush(tx, tenantId, normalised);
    },
  );

  await emit({
    eventType: "task.push_failed",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "task",
    resourceId: taskId,
    metadata: {
      task_id: taskId,
      attempt_count: recorded.attemptCount,
      failure_reason: recorded.failureReason,
      http_status: recorded.httpStatus,
    },
    requestId: ctx.requestId,
  });

  return recorded;
}

// -----------------------------------------------------------------------------
// recordFailedPushAttempt
// -----------------------------------------------------------------------------

/**
 * Day 8 / D8-4. Insert-or-update upsert path for repeated failures
 * on the same task. Tries `insertFailedPush` first; on SQLSTATE
 * 23505 (the partial UNIQUE on `(task_id) WHERE resolved_at IS NULL`
 * — meaning an unresolved row already exists) routes to
 * `updateFailedPushAttempt` which increments attempt_count and
 * refreshes the failure context (reason, detail, http_status,
 * payload). Mirrors the C-2 cron pattern (insert-then-update-on-
 * conflict) so cron re-runs are idempotent.
 *
 * The resulting `attempt_count` reflects how many times this task
 * has failed since the last resolution: 1 on first failure, N on
 * the Nth attempt while the row remains unresolved. The MP-14
 * auto-pause logic (Day 7 / C-7) reads this counter to detect
 * "failed N times" → auto-pause subscription.
 *
 * Audit emit on every attempt (not just first failure): each
 * attempt is independently observable in the audit log; the
 * `attempt_count` metadata distinguishes first-failure from retry.
 *
 * Throws:
 *   - ForbiddenError    user actor reached this path.
 *   - ValidationError   missing required fields, no tenant context,
 *                       invalid failureReason value.
 *   - Other DB errors propagate as-is.
 */
export async function recordFailedPushAttempt(
  ctx: RequestContext,
  input: RecordFailedPushInput,
): Promise<FailedPush> {
  assertSystemActor(ctx, "task:push_failed");
  assertTenantScoped(ctx, "task:push_failed");

  const taskId = requireNonEmpty(input.taskId, "taskId");
  if (!VALID_FAILURE_REASONS.has(input.failureReason)) {
    throw new ValidationError(
      `failureReason must be one of: ${Array.from(VALID_FAILURE_REASONS).join(", ")}`,
    );
  }

  // Cap failure_detail at ~4KB. Long SF responses (HTML error pages,
  // stack traces, multi-line vendor messages) bloat the audit and
  // failed_pushes rows without adding diagnostic value beyond the
  // first few thousand chars. Keep first 4000 chars; truncate marker
  // at end so operators know it was capped.
  const FAILURE_DETAIL_CAP = 4000;
  const cappedDetail =
    input.failureDetail !== undefined && input.failureDetail.length > FAILURE_DETAIL_CAP
      ? `${input.failureDetail.slice(0, FAILURE_DETAIL_CAP)}…[truncated]`
      : input.failureDetail !== undefined && input.failureDetail.trim().length > 0
        ? input.failureDetail.trim()
        : undefined;

  const normalised: RecordFailedPushInput = {
    taskId,
    taskPayload: input.taskPayload,
    failureReason: input.failureReason,
    failureDetail: cappedDetail,
    httpStatus: input.httpStatus,
  };

  const tenantId = ctx.tenantId;
  const recorded = await withServiceRole(
    `task:push_failed_attempt for tenant ${tenantId} (task ${taskId})`,
    async (tx) => {
      try {
        return await insertFailedPush(tx, tenantId, normalised);
      } catch (err) {
        // SQLSTATE 23505 from the partial UNIQUE: an unresolved row
        // already exists for this task. Route to UPDATE-attempt path.
        const code = (err as { code?: string }).code;
        if (code === "23505") {
          return updateFailedPushAttempt(tx, tenantId, normalised);
        }
        // 23503 (FK violation) / P0001 (tenant-match trigger) / etc.
        // surface as-is — these are programming errors, not retry
        // conditions.
        throw err;
      }
    },
  );

  await emit({
    eventType: "task.push_failed",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "task",
    resourceId: taskId,
    metadata: {
      task_id: taskId,
      attempt_count: recorded.attemptCount,
      failure_reason: recorded.failureReason,
      http_status: recorded.httpStatus,
    },
    requestId: ctx.requestId,
  });

  return recorded;
}
