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
import { requirePermission } from "../identity";
import type { LastMileAdapter } from "../integration";
import { withServiceRole, withTenant } from "../../shared/db";
import { ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext, SystemActor } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

// task-push types are consumed below for the retry path. Imported as
// types only — the runtime function `pushSingleTask` is INJECTED as
// a parameter to `retryFailedPush` rather than imported here, which
// avoids a circular dependency (task-push already imports
// failed-pushes' write primitives recordFailedPushAttempt +
// markFailedPushResolved). The route handler at
// src/app/api/failed-pushes/[id]/retry/route.ts is the orchestration
// layer that imports both modules and wires the function into
// retryFailedPush at call time.
import type { SinglePushOutcome } from "../task-push";

import {
  findFailedPushById,
  insertFailedPush,
  listUnresolvedByTenant,
  markUnresolvedAsResolved,
  updateFailedPushAttempt,
} from "./repository";
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
// markFailedPushResolved
// -----------------------------------------------------------------------------

/**
 * Day 8 / D8-4b. Resolve the unresolved failed_pushes row for `taskId`,
 * if one exists. System-only — the cron's AWB-exists reconcile branch
 * is the canonical caller. Idempotent: returns `null` (and emits no
 * event) when no unresolved row matches.
 *
 * NO audit emit is added here — the calling reconcile branch emits
 * `task.pushed_via_reconcile` once per reconcile pass and threads the
 * boolean `prior_failed_push_resolved` into that event's metadata.
 * Emitting a second event from this method would double-count the
 * reconcile in audit-log queries (one event per logical operation).
 *
 * `resolved_by` is set to NULL — the failed_pushes.resolved_by column
 * is FK to users(id), so the synthetic system-actor identifier
 * (e.g. 'cron:generate_tasks') can't land there. System identity is
 * preserved in `resolution_notes` instead. The post-MVP operator-UI
 * path will need a sibling method that accepts a real userId.
 */
export async function markFailedPushResolved(
  ctx: RequestContext,
  taskId: Uuid,
  resolutionNotes: string,
): Promise<FailedPush | null> {
  assertSystemActor(ctx, "task:push_resolved");
  assertTenantScoped(ctx, "task:push_resolved");

  const normalisedTaskId = requireNonEmpty(taskId, "taskId");
  const trimmedNotes = resolutionNotes.trim();
  if (trimmedNotes.length === 0) {
    throw new ValidationError("resolutionNotes must be non-empty");
  }

  const tenantId = ctx.tenantId;
  return withServiceRole(
    `task:push_resolved for tenant ${tenantId} (task ${normalisedTaskId})`,
    async (tx) => markUnresolvedAsResolved(tx, tenantId, normalisedTaskId, null, trimmedNotes),
  );
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

// =============================================================================
// listUnresolvedFailedPushes — Day 8 / D8-5
// =============================================================================

/**
 * List unresolved failed_pushes rows for the requesting tenant. Gated
 * by `failed_pushes:retry` — same permission protects both the read
 * (admin UI list) and the write (retry button); reuses one perm
 * because the surface is admin-only and they ship together.
 *
 * Tenant-scoped via `withTenant` so RLS does the boundary work
 * (defence-in-depth alongside the explicit `WHERE tenant_id = $1`
 * in the repo query). Cross-tenant rows are invisible.
 *
 * Read-not-audited per R-4 — listing the queue is operator-routine,
 * not a state change.
 */
export async function listUnresolvedFailedPushes(
  ctx: RequestContext,
): Promise<readonly FailedPush[]> {
  requirePermission(ctx, "failed_pushes:retry");
  assertTenantScoped(ctx, "failed_pushes:list");
  const tenantId = ctx.tenantId;
  return withTenant(tenantId, async (tx) => listUnresolvedByTenant(tx, tenantId));
}

// =============================================================================
// retryFailedPush — Day 8 / D8-5
// =============================================================================
// Operator-driven manual retry of a failed_pushes row. The
// /admin/failed-pushes UI's retry button POSTs to
// /api/failed-pushes/[id]/retry which calls here.
//
// Architectural posture (reviewer-locked):
//   - User-attributed authorisation. Tenant Admin clicks retry; the
//     route builds a USER ctx; this service requires
//     `failed_pushes:retry`. The audit `failed_push.retried` event is
//     emitted with that USER actor — the operator is on the hook
//     for the decision to retry.
//   - System-attributed execution. The actual SF push runs through
//     `pushSingleTask` which requires a system actor (because the
//     downstream recordFailedPushAttempt / markFailedPushResolved
//     primitives are system-only). So this method synthesises a
//     `system:dlq_retry` context for the push call, and
//     pushSingleTask's downstream emits (task.pushed_via_reconcile /
//     task.push_failed) carry the system actor.
//   - The two layers are intentionally separate so audit-log queries
//     can isolate "which operator initiated retries today" from
//     "which retries succeeded vs went back to DLQ" without parsing
//     metadata.
//
// Retry-failure posture: recordFailedPushAttempt (called via
// pushSingleTask) does the C-2-style 23505 → UPDATE upsert. Existing
// failed_pushes row's attempt_count increments; failure_detail
// refreshes; first_failed_at is preserved. Mirrors the cron's retry
// path so manual + automatic retries have identical DLQ semantics.

const SYSTEM_DLQ_RETRY_ACTOR = "system:dlq_retry" satisfies SystemActor;

/**
 * Build a synthetic system context from a user ctx for the bridge
 * call into task-push. Preserves tenantId and requestId so log
 * correlation works (one request_id ties operator authorisation +
 * downstream system push events together).
 */
function buildSystemDlqRetryContext(userCtx: RequestContext): RequestContext {
  if (!userCtx.tenantId) {
    throw new ValidationError("retryFailedPush: caller ctx must carry a tenantId");
  }
  return {
    actor: {
      kind: "system",
      system: SYSTEM_DLQ_RETRY_ACTOR,
      tenantId: userCtx.tenantId,
      permissions: new Set(),
    },
    tenantId: userCtx.tenantId,
    requestId: userCtx.requestId,
    path: userCtx.path,
  };
}

/**
 * Result returned to the route handler. Carries the underlying
 * SinglePushOutcome (so the route can render an outcome-specific
 * message) plus the failed_push row at the moment of retry-dispatch
 * (for /admin/failed-pushes UI updates).
 */
export interface RetryFailedPushResult {
  readonly failedPush: FailedPush;
  readonly outcome: SinglePushOutcome;
}

/**
 * Type of the injected push function. Matches `pushSingleTask` from
 * the task-push module exactly. The injection avoids the circular
 * import that would otherwise arise from `task-push` already
 * depending on this module's `recordFailedPushAttempt` and
 * `markFailedPushResolved`.
 */
export type PushSingleTaskFn = (
  ctx: RequestContext,
  taskId: Uuid,
  adapter: LastMileAdapter,
) => Promise<SinglePushOutcome>;

/**
 * Retry a failed_pushes row. Idempotent guards:
 *   - `failed_pushes:retry` permission required
 *   - row must exist and be tenant-scoped (NotFoundError on miss)
 *   - row must be unresolved (ValidationError on already-resolved)
 *
 * `pushTask` is injected (typically `pushSingleTask` from
 * `@/modules/task-push`); see PushSingleTaskFn jsdoc for why this is
 * a parameter rather than an import.
 *
 * Throws:
 *   - ForbiddenError    actor lacks failed_pushes:retry permission
 *                       (CS Agent, Ops Manager, etc.)
 *   - ValidationError   id missing/invalid, no tenant context, row
 *                       already resolved
 *   - NotFoundError     row not found in tenant
 */
export async function retryFailedPush(
  ctx: RequestContext,
  failedPushId: Uuid,
  adapter: LastMileAdapter,
  pushTask: PushSingleTaskFn,
): Promise<RetryFailedPushResult> {
  requirePermission(ctx, "failed_pushes:retry");
  assertTenantScoped(ctx, "failed_pushes:retry");

  const id = requireNonEmpty(failedPushId, "failedPushId");
  const tenantId = ctx.tenantId;

  // Look up via withTenant so RLS gates the read (defence-in-depth).
  const failedPush = await withTenant(tenantId, async (tx) =>
    findFailedPushById(tx, tenantId, id),
  );
  if (failedPush === null) {
    throw new NotFoundError(`failed_pushes row not found: ${id}`);
  }
  if (failedPush.resolvedAt !== null) {
    // Idempotency guard — operator double-click or concurrent retry
    // race. Surface as ValidationError (400) so the UI can render
    // "already resolved, refresh the list" without confusion.
    throw new ValidationError(
      `failed_pushes row ${id} is already resolved (resolved_at=${failedPush.resolvedAt}); refresh the list`,
    );
  }

  // Bridge: synthesise system context to call into task-push via the
  // injected push function.
  const systemCtx = buildSystemDlqRetryContext(ctx);
  const outcome = await pushTask(systemCtx, failedPush.taskId, adapter);

  // Operator-attributed audit event. Emitted regardless of outcome —
  // the operator's action is recorded; the outcome is metadata.
  await emit({
    eventType: "failed_push.retried",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "failed_push",
    resourceId: failedPush.id,
    metadata: {
      task_id: failedPush.taskId,
      failed_push_id: failedPush.id,
      prior_attempt_count: failedPush.attemptCount,
      retry_outcome: outcome.kind,
    },
    requestId: ctx.requestId,
  });

  // Re-fetch the row post-retry so the caller's response carries the
  // updated state (recordFailedPushAttempt may have incremented
  // attempt_count, or markFailedPushResolved may have closed it out
  // on success). Read happens through withTenant for symmetry with
  // the initial lookup.
  const refreshed = await withTenant(tenantId, async (tx) =>
    findFailedPushById(tx, tenantId, id),
  );
  return {
    failedPush: refreshed ?? failedPush,
    outcome,
  };
}
