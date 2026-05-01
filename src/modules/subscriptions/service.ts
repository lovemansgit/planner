// Subscription service-layer operations — Day 6 / S-4.
//
// Pattern (matches src/modules/consignees/service.ts and tasks/service.ts):
//   1. requirePermission(ctx, perm) — throws ForbiddenError on deny.
//   2. assertTenantScoped(ctx, op) — throws ValidationError if tenantId is null.
//   3. Run business logic inside `withTenant(tenantId, …)` so RLS scopes
//      naturally and the work is transactional.
//   4. Pre-fetch / capture before-state via the repository's
//      SELECT FOR UPDATE pattern (S-3) so audit metadata reflects the
//      row at transition time even if a later request mutates it.
//   5. Post-commit `await emit(…)` — never log a "ghost" event for an
//      action that did not actually commit. Errors before / inside
//      withTenant propagate; no audit fires on the denied or failed
//      path.
//
// Reads (`getSubscription`, `listSubscriptions`) are NOT audited per
// R-4. They still go through requirePermission + tenantId check — same
// auth surface as writes — but skip the emit step.
//
// Lifecycle is split between `updateSubscription` (schedule / window /
// cosmetic edits via a generic patch) and three transitional methods
// (`pauseSubscription`, `resumeSubscription`, `endSubscription`). Each
// transitional method is gated by a discrete permission and emits a
// dedicated audit event:
//
//   subscription:pause   → subscription.paused
//   subscription:resume  → subscription.resumed
//   subscription:end     → subscription.ended
//
// 1:1 mapping permission ↔ event keeps audit-log queries simple
// (filter by event_type, no metadata parsing) and lets RBAC restrict a
// pause-only operator without granting end privileges.
//
// Empty-patch short-circuit (subscription:update):
//   The repository's updateSubscription returns
//   `{ before, after: before }` with referentially identical objects
//   when no fields are present in the patch. The service detects this
//   via `result.before === result.after` and SKIPS the audit emit —
//   auditing a no-op pollutes the audit log. A non-empty patch where
//   every value happens to match the current row still produces
//   distinct before/after references (the repo issues UPDATE …
//   RETURNING *), so we additionally diff before-against-after by
//   field. If the diff is empty (operator re-submitted the existing
//   values), we also skip the emit — same convention as
//   consignees/service.ts and tasks/service.ts.

import { emit } from "../audit";
import { withServiceRole, withTenant } from "../../shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import {
  endSubscription as endSubscriptionRow,
  findSubscriptionById,
  insertSubscription,
  listSubscriptionsByTenant,
  pauseSubscription as pauseSubscriptionRow,
  resumeSubscription as resumeSubscriptionRow,
  updateSubscription as updateSubscriptionRow,
} from "./repository";
import type {
  CreateSubscriptionInput,
  Subscription,
  SubscriptionUpdate,
  UpdateSubscriptionPatch,
} from "./types";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Same actor → audit-id mapping as identity / consignees / tasks
 * services. Plan §3.4 forbids cross-module imports of internal helpers,
 * so each module carries the four-line copy.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

/** Trim and reject empty / whitespace-only required strings. */
function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return trimmed;
}

/**
 * Normalise a nullable optional string for the CREATE path: treat
 * undefined / null / empty / whitespace-only as null (insert NULL),
 * trim a real value otherwise. The repository's INSERT binds
 * `${value ?? null}`, so undefined and null are equivalent at the DB
 * layer; this collapse makes the intent explicit.
 */
function nullableTrimForCreate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalise a nullable optional string for the UPDATE patch path:
 *
 *   undefined           → undefined  (do not include in the patch)
 *   null                → null       (clear the column)
 *   ""  / whitespace    → null       (treat as "clear")
 *   "value"             → "value" trimmed
 *
 * Distinguishing undefined-vs-null is load-bearing for partial updates;
 * the create path collapses both to null because the caller cannot
 * partially-specify an INSERT.
 */
function nullableTrimForPatch(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Common precondition: actor must carry the named permission AND the
 * request must be tenant-scoped. System actors with `tenantId: null`
 * calling subscription methods is a programming error — subscriptions
 * are tenant-owned data.
 */
function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

/**
 * Validate a `daysOfWeek` array against the ISO 1-7 domain. The schema
 * layer enforces this via a CHECK constraint (0009) but we mirror the
 * check here so a malformed input surfaces as ValidationError before
 * the round-trip rather than as a CHECK violation from Postgres.
 */
function validateDaysOfWeek(days: readonly number[]): void {
  if (days.length === 0) {
    throw new ValidationError("daysOfWeek must contain at least one weekday");
  }
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw new ValidationError(
        `daysOfWeek must contain only integers 1–7 (Mon=1, Sun=7); got ${d}`
      );
    }
  }
}

// -----------------------------------------------------------------------------
// createSubscription
// -----------------------------------------------------------------------------

/**
 * Create a single subscription. Validates required fields, inserts
 * inside `withTenant`, and emits `subscription.created` post-commit.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `subscription:create`.
 *   - ValidationError   missing required fields, malformed daysOfWeek,
 *                       or no tenant context.
 */
export async function createSubscription(
  ctx: RequestContext,
  input: CreateSubscriptionInput
): Promise<Subscription> {
  requirePermission(ctx, "subscription:create");
  assertTenantScoped(ctx, "subscription:create");

  validateDaysOfWeek(input.daysOfWeek);

  const normalised: CreateSubscriptionInput = {
    consigneeId: requireNonEmpty(input.consigneeId, "consigneeId") as Uuid,
    status: input.status,
    startDate: requireNonEmpty(input.startDate, "startDate"),
    endDate: input.endDate ?? null,
    daysOfWeek: input.daysOfWeek,
    deliveryWindowStart: requireNonEmpty(input.deliveryWindowStart, "deliveryWindowStart"),
    deliveryWindowEnd: requireNonEmpty(input.deliveryWindowEnd, "deliveryWindowEnd"),
    deliveryAddressOverride: input.deliveryAddressOverride ?? null,
    mealPlanName: nullableTrimForCreate(input.mealPlanName),
    externalRef: nullableTrimForCreate(input.externalRef),
    notesInternal: nullableTrimForCreate(input.notesInternal),
  };

  const tenantId = ctx.tenantId;
  const created = await withTenant(tenantId, async (tx) => {
    return insertSubscription(tx, tenantId, normalised);
  });

  await emit({
    eventType: "subscription.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "subscription",
    resourceId: created.id,
    metadata: {
      subscription_id: created.id,
      consignee_id: created.consigneeId,
      start_date: created.startDate,
      days_of_week: [...created.daysOfWeek],
    },
    requestId: ctx.requestId,
  });

  return created;
}

// -----------------------------------------------------------------------------
// reads — getSubscription / listSubscriptions (not audited per R-4)
// -----------------------------------------------------------------------------

/**
 * Fetch one subscription by id, scoped to the actor's tenant via RLS.
 * Returns null when the row is missing or hidden cross-tenant — same
 * observable state from the caller's viewpoint per R-3.
 */
export async function getSubscription(
  ctx: RequestContext,
  id: Uuid
): Promise<Subscription | null> {
  requirePermission(ctx, "subscription:read");
  assertTenantScoped(ctx, "subscription:read");
  return withTenant(ctx.tenantId, async (tx) => {
    return findSubscriptionById(tx, id);
  });
}

/**
 * List every subscription in the actor's tenant, newest first.
 */
export async function listSubscriptions(
  ctx: RequestContext
): Promise<readonly Subscription[]> {
  requirePermission(ctx, "subscription:read");
  assertTenantScoped(ctx, "subscription:read");
  return withTenant(ctx.tenantId, async (tx) => {
    return listSubscriptionsByTenant(tx, ctx.tenantId!);
  });
}

// -----------------------------------------------------------------------------
// updateSubscription (generic patch — schedule / window / cosmetic)
// -----------------------------------------------------------------------------

/**
 * Update selected scalar fields on one subscription. Validates patch
 * field shapes, calls the repository (which captures before/after
 * under SELECT FOR UPDATE in the same transaction as the UPDATE), and
 * emits `subscription.updated` post-commit with `changed_fields[]`.
 *
 * Skips the audit emit when:
 *   - The patch is empty (repo short-circuits to before === after by
 *     reference; no UPDATE issued).
 *   - The patch is non-empty but every field equals the current value
 *     (the diff is empty — operator re-submitted existing values).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `subscription:update`.
 *   - ValidationError   malformed patch field, no tenant context.
 *   - NotFoundError     no subscription with that id in the tenant.
 */
export async function updateSubscription(
  ctx: RequestContext,
  id: Uuid,
  patch: UpdateSubscriptionPatch
): Promise<Subscription> {
  requirePermission(ctx, "subscription:update");
  assertTenantScoped(ctx, "subscription:update");

  if (patch.daysOfWeek !== undefined) {
    validateDaysOfWeek(patch.daysOfWeek);
  }

  // Normalise present fields. Required-string fields (when present)
  // must be non-empty after trim. Optional/nullable fields trim;
  // empty/whitespace-only collapses to null (not undefined) — passing
  // the patch field as null clears the column, which is the documented
  // shape for nullable updates per UpdateSubscriptionPatch.
  const normalised: UpdateSubscriptionPatch = {
    consigneeId:
      patch.consigneeId !== undefined ? (requireNonEmpty(patch.consigneeId, "consigneeId") as Uuid) : undefined,
    startDate:
      patch.startDate !== undefined ? requireNonEmpty(patch.startDate, "startDate") : undefined,
    endDate: patch.endDate,
    daysOfWeek: patch.daysOfWeek,
    deliveryWindowStart:
      patch.deliveryWindowStart !== undefined
        ? requireNonEmpty(patch.deliveryWindowStart, "deliveryWindowStart")
        : undefined,
    deliveryWindowEnd:
      patch.deliveryWindowEnd !== undefined
        ? requireNonEmpty(patch.deliveryWindowEnd, "deliveryWindowEnd")
        : undefined,
    deliveryAddressOverride: patch.deliveryAddressOverride,
    mealPlanName: nullableTrimForPatch(patch.mealPlanName),
    externalRef: nullableTrimForPatch(patch.externalRef),
    notesInternal: nullableTrimForPatch(patch.notesInternal),
  };

  const tenantId = ctx.tenantId;
  const result = await withTenant(tenantId, async (tx) => {
    return updateSubscriptionRow(tx, tenantId, id, normalised);
  });

  if (result === null) {
    throw new NotFoundError(`subscription not found: ${id}`);
  }

  // Empty-patch short-circuit detection: the repository returns the
  // SAME object reference for before and after when the patch had no
  // keys present. Skip the emit.
  if (result.before === result.after) {
    return result.after;
  }

  // Non-empty patch: diff field-by-field to compute the actually-
  // changed list. If the diff is empty (operator re-submitted current
  // values), still skip the emit — same convention as consignees /
  // tasks. The UPDATE has already run; we just don't audit the no-op.
  const changedFields = diffSubscriptionFields(result.before, result.after);
  if (changedFields.length > 0) {
    await emit({
      eventType: "subscription.updated",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId,
      resourceType: "subscription",
      resourceId: id,
      metadata: { changed_fields: changedFields },
      requestId: ctx.requestId,
    });
  }

  return result.after;
}

/**
 * Return the camelCase field names whose value differs between before
 * and after. Lifecycle fields (status, pausedAt, endedAt) are excluded
 * because they are written by transitional methods — never by the
 * generic update path. Identity columns (id, tenantId, createdAt,
 * updatedAt) are also excluded.
 */
function diffSubscriptionFields(before: Subscription, after: Subscription): string[] {
  const changed: string[] = [];
  if (before.consigneeId !== after.consigneeId) changed.push("consigneeId");
  if (before.startDate !== after.startDate) changed.push("startDate");
  if (before.endDate !== after.endDate) changed.push("endDate");
  if (!arraysEqual(before.daysOfWeek, after.daysOfWeek)) changed.push("daysOfWeek");
  if (before.deliveryWindowStart !== after.deliveryWindowStart) {
    changed.push("deliveryWindowStart");
  }
  if (before.deliveryWindowEnd !== after.deliveryWindowEnd) changed.push("deliveryWindowEnd");
  if (before.deliveryAddressOverride !== after.deliveryAddressOverride) {
    changed.push("deliveryAddressOverride");
  }
  if (before.mealPlanName !== after.mealPlanName) changed.push("mealPlanName");
  if (before.externalRef !== after.externalRef) changed.push("externalRef");
  if (before.notesInternal !== after.notesInternal) changed.push("notesInternal");
  return changed;
}

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// pauseSubscription (lifecycle: active → paused)
// -----------------------------------------------------------------------------

/**
 * Transition a subscription from 'active' to 'paused'. Emits
 * `subscription.paused` post-commit with previous_status / new_status /
 * paused_at.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `subscription:pause`.
 *   - ValidationError   no tenant context.
 *   - NotFoundError     no subscription with that id in the tenant.
 *   - ConflictError     row exists but is not in 'active' state
 *                       (propagated from repo).
 */
export async function pauseSubscription(
  ctx: RequestContext,
  id: Uuid
): Promise<Subscription> {
  requirePermission(ctx, "subscription:pause");
  assertTenantScoped(ctx, "subscription:pause");

  const tenantId = ctx.tenantId;
  const result = await withTenant(tenantId, async (tx) => {
    return pauseSubscriptionRow(tx, tenantId, id);
  });

  if (result === null) {
    throw new NotFoundError(`subscription not found: ${id}`);
  }

  await emit({
    eventType: "subscription.paused",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "subscription",
    resourceId: id,
    metadata: {
      subscription_id: id,
      previous_status: result.before.status,
      new_status: result.after.status,
      paused_at: result.after.pausedAt,
    },
    requestId: ctx.requestId,
  });

  return result.after;
}

// -----------------------------------------------------------------------------
// resumeSubscription (lifecycle: paused → active)
// -----------------------------------------------------------------------------

/**
 * Transition a subscription from 'paused' back to 'active'. Emits
 * `subscription.resumed` post-commit. The audit metadata captures the
 * `paused_at_was` timestamp (the now-cleared pause-since marker) so
 * forensics can reconstruct the pause duration.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `subscription:resume`.
 *   - ValidationError   no tenant context.
 *   - NotFoundError     no subscription with that id in the tenant.
 *   - ConflictError     row exists but is not in 'paused' state.
 */
export async function resumeSubscription(
  ctx: RequestContext,
  id: Uuid
): Promise<Subscription> {
  requirePermission(ctx, "subscription:resume");
  assertTenantScoped(ctx, "subscription:resume");

  const tenantId = ctx.tenantId;
  const result = await withTenant(tenantId, async (tx) => {
    return resumeSubscriptionRow(tx, tenantId, id);
  });

  if (result === null) {
    throw new NotFoundError(`subscription not found: ${id}`);
  }

  await emit({
    eventType: "subscription.resumed",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "subscription",
    resourceId: id,
    metadata: {
      subscription_id: id,
      previous_status: result.before.status,
      new_status: result.after.status,
      paused_at_was: result.before.pausedAt,
    },
    requestId: ctx.requestId,
  });

  return result.after;
}

// -----------------------------------------------------------------------------
// endSubscription (lifecycle: active|paused → ended, terminal)
// -----------------------------------------------------------------------------

/**
 * Transition a subscription to the terminal 'ended' state. Cron stops
 * generating tasks; reactivation is not supported (create a new
 * subscription instead). Emits `subscription.ended` post-commit.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `subscription:end`.
 *   - ValidationError   no tenant context.
 *   - NotFoundError     no subscription with that id in the tenant.
 *   - ConflictError     row is already 'ended' (propagated from repo).
 */
export async function endSubscription(
  ctx: RequestContext,
  id: Uuid
): Promise<Subscription> {
  requirePermission(ctx, "subscription:end");
  assertTenantScoped(ctx, "subscription:end");

  const tenantId = ctx.tenantId;
  const result = await withTenant(tenantId, async (tx) => {
    return endSubscriptionRow(tx, tenantId, id);
  });

  if (result === null) {
    throw new NotFoundError(`subscription not found: ${id}`);
  }

  await emit({
    eventType: "subscription.ended",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "subscription",
    resourceId: id,
    metadata: {
      subscription_id: id,
      previous_status: result.before.status,
      new_status: result.after.status,
      ended_at: result.after.endedAt,
    },
    requestId: ctx.requestId,
  });

  return result.after;
}

// -----------------------------------------------------------------------------
// autoPauseSubscriptionForRepeatedFailure (lifecycle: active → paused, system actor)
// -----------------------------------------------------------------------------

/**
 * Input for the MP-14 auto-pause rule. Caller is the failed-push retry
 * path (Day-8 / C-3 work) which detects that a single task's
 * attempt_count has reached the threshold and triggers this method.
 */
export interface AutoPauseInput {
  readonly subscriptionId: Uuid;
  readonly taskId: Uuid;
  readonly failureCount: number;
  /**
   * Short error summary — `failure_detail` from the failed_pushes row,
   * truncated by the caller. The catalogue's metadataNotes warns
   * against credentials/PII; the cron must redact before passing.
   */
  readonly lastError: string;
}

/**
 * Internal result of the project+pause transaction. Exported as a type
 * only for the race-handling try/catch in
 * autoPauseSubscriptionForRepeatedFailure to declare its variable.
 */
type AutoPauseRunResult =
  | { kind: "not_found" }
  | { kind: "no_op"; current: Subscription }
  | { kind: "paused"; transition: SubscriptionUpdate };

/**
 * MP-14: auto-pause a subscription whose pushed task has failed N
 * times in a row (N=3 in pilot per memory/notes/day7_schedule_drift.md
 * §"Day-7 row carry-forwards"). System-only — no `subscription:pause`
 * permission consumed; the cron's authorisation lives in the
 * CRON_SECRET layer one above. Mirrors the system-only posture of
 * createTask / bulkCreateTasks per
 * memory/decision_task_module_no_user_create_delete.md.
 *
 * Idempotent: if the subscription is already 'paused' or 'ended', the
 * method is a no-op (no state transition, no audit emit). Same task
 * could trigger this method multiple times if the cron retries are
 * interleaved across passes; only the first reaches the active row.
 *
 * Why a dedicated `subscription.auto_paused` event (not reuse
 * `subscription.paused`):
 *   - Operator-driven pauses and system auto-pauses are operationally
 *     distinct events. An operator pause is intent; an auto-pause is
 *     a signal that something is broken upstream (SF API change,
 *     consignee data corruption, repeated geocoding failure).
 *   - Audit-log queries that count "operators pausing subscriptions"
 *     should not be polluted by system noise; queries that count
 *     "subscriptions auto-paused this week" should not be polluted by
 *     operator actions.
 *   - The 1:1 event-per-permission convention used by the rest of the
 *     subscription lifecycle (subscription:pause → subscription.paused,
 *     etc.) extends naturally: the system-only auto-pause path gets
 *     its own event even though it has no permission.
 *
 * Throws:
 *   - ForbiddenError    user actor reached this path (routing bug —
 *                       only the cron / failed-push retry should call).
 *   - ValidationError   no tenant context.
 *   - NotFoundError     subscription does not exist in the tenant.
 *
 * Returns the subscription post-pause OR the unchanged row if it was
 * already paused/ended (idempotent no-op path).
 */
export async function autoPauseSubscriptionForRepeatedFailure(
  ctx: RequestContext,
  input: AutoPauseInput,
): Promise<Subscription> {
  if (ctx.actor.kind !== "system") {
    throw new ForbiddenError(
      "subscription:auto_pause requires a system actor",
    );
  }
  assertTenantScoped(ctx, "subscription:auto_pause");

  const tenantId = ctx.tenantId;

  // Use withServiceRole because the cron is a cross-tenant system
  // actor (no user session has set app.current_tenant_id). The repo's
  // pauseSubscription expects to run inside a tenant-scoped tx, so we
  // bind the GUC inside the service-role transaction the same way
  // demo-context does for setup writes.
  //
  // Race-safety mechanism (load-bearing — reviewer-verified at C-7 PR):
  //   The repository's pauseSubscription does SELECT … FOR UPDATE
  //   followed by a status re-check. Under two concurrent invocations
  //   T1 / T2 that both observe `status='active'` at pre-check time:
  //
  //     1. T1's pauseRow call acquires the row lock, status check
  //        passes, UPDATE commits, lock releases.
  //     2. T2's pauseRow call blocks waiting for the lock; once
  //        acquired, the post-lock status re-check sees `paused` and
  //        the repo throws ConflictError.
  //
  //   We CATCH ConflictError below and return `no_op`. T1 emits one
  //   `subscription.auto_paused`; T2 returns the now-paused row
  //   without an emit. Audit-emit-once invariant preserved; idempotency
  //   honored on the race-loser side without surfacing a 5xx to the
  //   cron caller.
  let result: AutoPauseRunResult;
  try {
    result = await withServiceRole(
      `subscription:auto_pause for tenant ${tenantId} (subscription ${input.subscriptionId})`,
      async (tx) => {
        // Pre-check: idempotent no-op for paused/ended subscriptions.
        const current = await findSubscriptionById(tx, input.subscriptionId);
        if (!current) {
          return { kind: "not_found" as const };
        }
        if (current.tenantId !== tenantId) {
          // Cross-tenant access via system actor — surface as not-found
          // to the caller (the cron passes the tenantId from its
          // per-tenant loop; if it ever drifts from the subscription's
          // owning tenant, that's a routing bug worth surfacing).
          return { kind: "not_found" as const };
        }
        if (current.status !== "active") {
          return { kind: "no_op" as const, current };
        }

        const transition = await pauseSubscriptionRow(tx, tenantId, input.subscriptionId);
        if (transition === null) {
          // Race: row vanished between the pre-check and the pause.
          return { kind: "not_found" as const };
        }
        return { kind: "paused" as const, transition };
      },
    );
  } catch (err) {
    // Race-loser path — see header comment. T2's pauseSubscription
    // call observed a non-active state under the FOR UPDATE lock and
    // the repo threw ConflictError. T1 already paused and emitted;
    // T2 is a no-op. We re-fetch the now-paused row to return a
    // consistent shape to the caller.
    if (err instanceof ConflictError) {
      const refetched = await withServiceRole(
        `subscription:auto_pause refetch for tenant ${tenantId}`,
        async (tx) => findSubscriptionById(tx, input.subscriptionId),
      );
      if (refetched && refetched.tenantId === tenantId) {
        return refetched;
      }
      // If we cannot re-fetch (vanished, cross-tenant), surface the
      // original ConflictError rather than fabricate state.
      throw err;
    }
    throw err;
  }

  if (result.kind === "not_found") {
    throw new NotFoundError(
      `subscription not found: ${input.subscriptionId}`,
    );
  }
  if (result.kind === "no_op") {
    return result.current;
  }

  await emit({
    eventType: "subscription.auto_paused",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "subscription",
    resourceId: input.subscriptionId,
    metadata: {
      subscription_id: input.subscriptionId,
      task_id: input.taskId,
      failure_count: input.failureCount,
      last_error: input.lastError,
    },
    requestId: ctx.requestId,
  });

  return result.transition.after;
}
