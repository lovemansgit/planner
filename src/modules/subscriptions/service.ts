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

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";

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
  listSweepCandidates,
  pauseSubscription as pauseSubscriptionRow,
  updateSubscription as updateSubscriptionRow,
} from "./repository";
import type {
  CreateSubscriptionInput,
  PauseSubscriptionInput,
  PauseSubscriptionResult,
  ResumeSubscriptionInput,
  ResumeSubscriptionResult,
  Subscription,
  SubscriptionUpdate,
  UpdateSubscriptionPatch,
} from "./types";

// Day-16 / Block 4-C — Service B (bounded pause + resume) imports.
import {
  computePauseExtensionDate,
  countEligibleDeliveryDays,
  walkBackwardEligibleDays,
  type IsoWeekday,
  type SubscriptionForSkip,
} from "../subscription-exceptions";
import {
  findByIdempotencyKey,
  insertException,
} from "../subscription-exceptions/repository";
import {
  markTasksCanceledInWindow,
  markTasksRestoredInWindow,
} from "../tasks";
import {
  computeTodayInDubai,
  isCutOffElapsedForDate,
} from "../task-materialization/dubai-date";

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
// Day-16 Block 4-C — Service B internal helpers (assertSystemActor + IsoWeekday cast)
// -----------------------------------------------------------------------------

/**
 * Per-module 4-line copy of the assertSystemActor pattern (matches
 * `src/modules/tasks/service.ts:173-177`). Used by `resumeSubscription`
 * when the cron handler at `/api/cron/auto-resume` invokes it via
 * `is_auto_resume: true` — the system-actor branch skips the
 * user-permission check.
 */
function assertSystemActor(ctx: RequestContext, forOperation: string): void {
  if (ctx.actor.kind !== "system") {
    throw new ForbiddenError(`${forOperation} requires a system actor`);
  }
}

/**
 * Narrow `readonly number[]` (Subscription.daysOfWeek) to the pure
 * helper's `readonly IsoWeekday[]`. Same A6 cast as Service A; the
 * 0009_subscription.sql CHECK constraint guarantees 1-7 at runtime.
 */
function asIsoWeekdays(days: readonly number[]): readonly IsoWeekday[] {
  return days as readonly IsoWeekday[];
}

const ISO_DATE_REGEX_LIFECYCLE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a subscription by id with FOR UPDATE inside the service's
 * transaction. Returns the minimal shape the lifecycle services need.
 */
type LifecycleSubscriptionRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly status: string;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly days_of_week: number[];
  readonly paused_at: string | null;
} & Record<string, unknown>;

interface LifecycleSubscription {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly status: "active" | "paused" | "ended";
  readonly endDate: string | null;
  readonly daysOfWeek: readonly number[];
  readonly pausedAt: string | null;
}

async function readSubscriptionForLifecycle(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  subscriptionId: Uuid,
): Promise<LifecycleSubscription | null> {
  const rows = await tx.execute<LifecycleSubscriptionRow>(sqlTag`
    SELECT id, tenant_id, status, start_date, end_date, days_of_week, paused_at
    FROM subscriptions
    WHERE id = ${subscriptionId}
    FOR UPDATE
  `);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.status !== "active" && row.status !== "paused" && row.status !== "ended") {
    throw new Error(`readSubscriptionForLifecycle: unexpected status '${row.status}'`);
  }
  return {
    id: row.id as Uuid,
    tenantId: row.tenant_id as Uuid,
    status: row.status,
    endDate: row.end_date,
    daysOfWeek: row.days_of_week,
    pausedAt: row.paused_at,
  };
}

// -----------------------------------------------------------------------------
// Day-16 Block 4-C — pauseSubscription (rewritten — bounded pause per brief §3.1.7)
// -----------------------------------------------------------------------------

/**
 * Pause a subscription for a bounded window per brief §3.1.7. Single
 * transaction: permission → cut-off → state → idempotency → compute
 * extension → INSERT pause_window exception → UPDATE tasks in window
 * → CANCELED → UPDATE subscription end_date + status='paused' →
 * audit emission with shared correlation_id.
 *
 * The pre-Day-16 placeholder signature `(ctx, id) → Subscription`
 * was rewritten in place per Block 4-C routing (β); merged plan
 * §4.1 path drift captured in
 * `memory/followup_plan_path_drift_subscription_exceptions.md` §3.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `subscription:pause`.
 *   - ValidationError   tenant context missing, malformed dates,
 *                       pause_end <= pause_start, cut-off elapsed.
 *   - NotFoundError     no subscription with that id in the tenant.
 *   - ConflictError     subscription not in 'active' state, or
 *                       extension walk hit the safety stop.
 */
export async function pauseSubscription(
  ctx: RequestContext,
  id: Uuid,
  input: PauseSubscriptionInput,
  options?: { readonly now?: Date },
): Promise<PauseSubscriptionResult> {
  requirePermission(ctx, "subscription:pause");
  assertTenantScoped(ctx, "subscription:pause");

  const tenantId = ctx.tenantId;

  // Step 1 — input shape validation.
  if (!ISO_DATE_REGEX_LIFECYCLE.test(input.pause_start)) {
    throw new ValidationError(`pause_start must be YYYY-MM-DD; got '${input.pause_start}'`);
  }
  if (!ISO_DATE_REGEX_LIFECYCLE.test(input.pause_end)) {
    throw new ValidationError(`pause_end must be YYYY-MM-DD; got '${input.pause_end}'`);
  }
  if (input.pause_end <= input.pause_start) {
    throw new ValidationError(
      `pause_end (${input.pause_end}) must be strictly after pause_start (${input.pause_start})`,
    );
  }

  // Step 2 — cut-off enforcement on pause_start (brief §3.1.8 + plan §7.3).
  const now = options?.now ?? new Date();
  if (isCutOffElapsedForDate(now, input.pause_start)) {
    throw new ValidationError(
      "pause_start is past the 18:00 Dubai cut-off the day before; cannot apply pause",
    );
  }

  // Step 3-7 — single tenant-scoped transaction.
  const txResult = await withTenant(tenantId, async (tx) => {
    const subscription = await readSubscriptionForLifecycle(tx, id);
    if (subscription === null) {
      throw new NotFoundError(`subscription not found: ${id}`);
    }
    if (subscription.tenantId !== tenantId) {
      throw new NotFoundError(`subscription not found: ${id}`);
    }
    if (subscription.status !== "active") {
      throw new ConflictError(
        `subscription must be active to pause; current status is '${subscription.status}'`,
      );
    }

    // Idempotency check — replay returns existing exception fields.
    const replay = await findByIdempotencyKey(tx, id, input.idempotency_key as Uuid);
    if (replay !== null) {
      return { replay } as const;
    }

    // Compute extension days (eligible-delivery-days in pause window).
    const subForHelpers: SubscriptionForSkip = {
      endDate: subscription.endDate ?? input.pause_end, // null end_date treated as far-future for the count
      daysOfWeek: asIsoWeekdays(subscription.daysOfWeek),
      status: subscription.status,
    };
    const extensionDays = countEligibleDeliveryDays(
      subForHelpers,
      input.pause_start,
      input.pause_end,
    );

    // Compute new end_date — only if subscription has a finite end_date.
    // Open-ended subscriptions (end_date IS NULL) skip the extension
    // (an unbounded subscription has no tail to extend; the pause
    // simply cancels the in-window tasks).
    let newEndDate: string | null = subscription.endDate;
    if (subscription.endDate !== null && extensionDays > 0) {
      const result = computePauseExtensionDate({
        subscription: subForHelpers,
        currentEndDate: subscription.endDate,
        extensionDays,
        pauseWindows: [], // existing pause windows for this sub are excluded; the new one is not yet inserted
      });
      if (result.kind === "rejected") {
        throw new ConflictError(
          "pause extension hit the 365-day safety stop; pause window is too long for the subscription's day-of-week schedule",
        );
      }
      newEndDate = result.newEndDate;
    }

    const correlationId = randomUUID() as Uuid;

    const exception = await insertException(tx, tenantId, {
      subscriptionId: id,
      type: "pause_window",
      startDate: input.pause_start,
      endDate: input.pause_end,
      targetDateOverride: null,
      skipWithoutAppend: false,
      reason: input.reason ?? null,
      addressOverrideId: null,
      compensatingDate: null,
      correlationId,
      idempotencyKey: input.idempotency_key as Uuid,
      createdBy: actorIdFor(ctx.actor) as Uuid,
    });

    // Bulk-cancel tasks in window.
    const canceledTaskCount = await markTasksCanceledInWindow(
      tx,
      tenantId,
      id,
      input.pause_start,
      input.pause_end,
    );

    // Flip subscription status + end_date.
    if (newEndDate !== null && newEndDate !== subscription.endDate) {
      await tx.execute(sqlTag`
        UPDATE subscriptions
        SET status = 'paused',
            paused_at = now(),
            end_date = ${newEndDate},
            updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
    } else {
      await tx.execute(sqlTag`
        UPDATE subscriptions
        SET status = 'paused',
            paused_at = now(),
            updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
    }

    return {
      replay: null,
      exception,
      newEndDate,
      previousEndDate: subscription.endDate,
      canceledTaskCount,
    } as const;
  });

  // Idempotent-replay path — return existing fields as 409. NO audit
  // events emit on replay.
  if (txResult.replay !== null) {
    return {
      exception_id: txResult.replay.id,
      correlation_id: txResult.replay.correlationId,
      new_end_date: txResult.replay.endDate ?? "",
      canceled_task_count: 0, // not tracked on replay; forensic field only
      status: "idempotent_replay",
      http_status: 409,
    };
  }

  const { exception, newEndDate, previousEndDate, canceledTaskCount } = txResult;

  // Post-commit audit emission with shared correlation_id.
  const baseEmit = {
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    requestId: ctx.requestId,
  } as const;

  await emit({
    ...baseEmit,
    eventType: "subscription.paused",
    resourceType: "subscription",
    resourceId: id,
    metadata: {
      subscription_id: id,
      exception_id: exception.id,
      pause_start: input.pause_start,
      pause_end: input.pause_end,
      reason: input.reason ?? null,
      canceled_task_count: canceledTaskCount,
      correlation_id: exception.correlationId,
    },
  });

  if (newEndDate !== null && newEndDate !== previousEndDate) {
    await emit({
      ...baseEmit,
      eventType: "subscription.end_date.extended",
      resourceType: "subscription",
      resourceId: id,
      metadata: {
        subscription_id: id,
        previous_end_date: previousEndDate,
        new_end_date: newEndDate,
        triggered_by: "pause_resume",
        correlation_id: exception.correlationId,
      },
    });
  }

  return {
    exception_id: exception.id,
    correlation_id: exception.correlationId,
    new_end_date: newEndDate ?? "",
    canceled_task_count: canceledTaskCount,
    status: "inserted",
    http_status: 201,
  };
}

// -----------------------------------------------------------------------------
// Day-16 Block 4-C — resumeSubscription (rewritten — bounded resume per brief §3.1.7)
// -----------------------------------------------------------------------------

/**
 * Active pause-window exception lookup. Returns the most-recent pause
 * window for which no resume audit event has fired (by
 * correlation_id). At most one row matches in a paused subscription
 * by construction (the pause-creation flow inserts exactly one
 * pause_window exception when transitioning the subscription to
 * 'paused', and the audit-event NOT EXISTS guard becomes false
 * after this service emits the resume event).
 */
type ActivePauseWindowRow = {
  readonly id: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly correlation_id: string;
} & Record<string, unknown>;

async function findActivePauseWindow(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  subscriptionId: Uuid,
): Promise<ActivePauseWindowRow | null> {
  const rows = await tx.execute<ActivePauseWindowRow>(sqlTag`
    SELECT id, start_date, end_date, correlation_id
    FROM subscription_exceptions
    WHERE subscription_id = ${subscriptionId}
      AND type = 'pause_window'
      AND NOT EXISTS (
        SELECT 1 FROM audit_events
        WHERE event_type = 'subscription.resumed'
          AND (metadata->>'correlation_id')::uuid = subscription_exceptions.correlation_id
      )
    ORDER BY start_date DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * Resume a paused subscription per brief §3.1.7. Manual operator
 * resume (default) and auto-resume cron path (via
 * `options.is_auto_resume = true`) share this entry point — the
 * cron handler at `/api/cron/auto-resume` builds a system actor
 * + sets the flag.
 *
 * Behavior diverges by source:
 *   - Manual + before pause_end: end_date shrinks; tasks in
 *     [today, pause_end] restored to 'CREATED'.
 *   - Manual + at/after pause_end: end_date unchanged; no task
 *     restoration (full duration honored).
 *   - Auto: actual_resume_date = pause_end; no recompute, no
 *     restoration (the originally-scheduled end fired naturally).
 *
 * Idempotent across overlapping cron ticks: if `subscription.status
 * === 'active'` already OR the audit-event NOT EXISTS guard returns
 * no row (already resumed), returns `status: 'already_active'` with
 * HTTP 200, no audit emit.
 *
 * Throws:
 *   - ForbiddenError    user actor lacks `subscription:resume` (manual)
 *                       OR system actor required (auto path mismatch).
 *   - ValidationError   no tenant context (manual).
 *   - NotFoundError     no subscription with that id.
 */
export async function resumeSubscription(
  ctx: RequestContext,
  id: Uuid,
  input: ResumeSubscriptionInput,
  options?: { readonly now?: Date; readonly is_auto_resume?: boolean },
): Promise<ResumeSubscriptionResult> {
  const isAutoResume = options?.is_auto_resume === true;

  if (isAutoResume) {
    assertSystemActor(ctx, "subscription:resume:auto");
  } else {
    requirePermission(ctx, "subscription:resume");
    assertTenantScoped(ctx, "subscription:resume");
  }

  // ctx.tenantId may be null on system actors with cross-tenant scope,
  // but the cron handler builds per-tenant ctxs — null is treated as
  // a programming error here.
  if (!ctx.tenantId) {
    throw new ValidationError("subscription:resume requires a tenant context");
  }
  const tenantId = ctx.tenantId;

  const now = options?.now ?? new Date();
  const today = computeTodayInDubai(now);

  const txResult = await withTenant(tenantId, async (tx) => {
    const subscription = await readSubscriptionForLifecycle(tx, id);
    if (subscription === null) {
      throw new NotFoundError(`subscription not found: ${id}`);
    }
    if (subscription.tenantId !== tenantId) {
      throw new NotFoundError(`subscription not found: ${id}`);
    }

    // Already-active idempotent path.
    if (subscription.status !== "paused") {
      return { kind: "already_active" } as const;
    }

    const pauseWindow = await findActivePauseWindow(tx, id);
    if (pauseWindow === null) {
      // No active pause window — subscription is paused but no
      // exception row found OR all pause windows have resume audits.
      // Treat as already-active idempotent (defence-in-depth).
      return { kind: "already_active" } as const;
    }

    const actualResumeDate = isAutoResume ? pauseWindow.end_date : today;
    const earlyManual = !isAutoResume && actualResumeDate < pauseWindow.end_date;

    // Compute new end_date for early-manual-resume path.
    let newEndDate: string | null = subscription.endDate;
    let endDateChanged = false;
    let restoredTaskCount = 0;

    if (earlyManual && subscription.endDate !== null) {
      const subForHelpers: SubscriptionForSkip = {
        endDate: subscription.endDate,
        daysOfWeek: asIsoWeekdays(subscription.daysOfWeek),
        status: "paused", // status at the time of compute; algorithm doesn't gate on this
      };
      const originalExtension = countEligibleDeliveryDays(
        subForHelpers,
        pauseWindow.start_date,
        pauseWindow.end_date,
      );
      // Effective extension is days in [pause_start, actual_resume_date - 1] —
      // the actual_resume_date itself stays canceled IF target_date matches
      // a delivery day; the operator can re-enable today's task only if cut-off not yet elapsed.
      // For simplicity in MVP, count [pause_start, actual_resume_date - 1].
      const dayBeforeResume = (() => {
        const d = new Date(`${actualResumeDate}T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const effectiveExtension = countEligibleDeliveryDays(
        subForHelpers,
        pauseWindow.start_date,
        dayBeforeResume,
      );
      const shrinkBy = originalExtension - effectiveExtension;

      if (shrinkBy > 0) {
        const result = walkBackwardEligibleDays({
          fromDate: subscription.endDate,
          daysToWalk: shrinkBy,
          daysOfWeek: asIsoWeekdays(subscription.daysOfWeek),
          pauseWindows: [],
        });
        if (result.kind === "ok") {
          newEndDate = result.newEndDate;
          endDateChanged = true;
        }
      }

      // Restore tasks where target_date >= actual_resume_date AND <= pause_end.
      restoredTaskCount = await markTasksRestoredInWindow(
        tx,
        tenantId,
        id,
        actualResumeDate,
        pauseWindow.end_date,
      );
    }

    // Flip subscription status + end_date.
    if (endDateChanged && newEndDate !== null) {
      await tx.execute(sqlTag`
        UPDATE subscriptions
        SET status = 'active',
            paused_at = NULL,
            end_date = ${newEndDate},
            updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
    } else {
      await tx.execute(sqlTag`
        UPDATE subscriptions
        SET status = 'active',
            paused_at = NULL,
            updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
    }

    return {
      kind: "resumed" as const,
      pauseWindow,
      actualResumeDate,
      newEndDate,
      previousEndDate: subscription.endDate,
      endDateChanged,
      restoredTaskCount,
    };
  });

  if (txResult.kind === "already_active") {
    return {
      correlation_id: null,
      actual_resume_date: null,
      new_end_date: null,
      restored_task_count: 0,
      status: "already_active",
      http_status: 200,
    };
  }

  const { pauseWindow, actualResumeDate, newEndDate, previousEndDate, endDateChanged, restoredTaskCount } = txResult;

  const baseEmit = {
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    requestId: ctx.requestId,
  } as const;

  await emit({
    ...baseEmit,
    eventType: "subscription.resumed",
    resourceType: "subscription",
    resourceId: id,
    metadata: {
      subscription_id: id,
      actual_resume_date: actualResumeDate,
      new_end_date: newEndDate,
      restored_task_count: restoredTaskCount,
      is_auto_resume: isAutoResume,
      idempotency_key: input.idempotency_key,
      correlation_id: pauseWindow.correlation_id,
    },
  });

  if (endDateChanged) {
    await emit({
      ...baseEmit,
      eventType: "subscription.end_date.extended",
      resourceType: "subscription",
      resourceId: id,
      metadata: {
        subscription_id: id,
        previous_end_date: previousEndDate,
        new_end_date: newEndDate,
        triggered_by: "pause_resume",
        correlation_id: pauseWindow.correlation_id,
      },
    });
  }

  return {
    correlation_id: pauseWindow.correlation_id,
    actual_resume_date: actualResumeDate,
    new_end_date: newEndDate,
    restored_task_count: restoredTaskCount,
    status: "resumed",
    http_status: 200,
  };
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
      trigger_source: "user" as const,
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

        // Auto-pause uses the legacy single-table status-flip helper
        // at repository.ts:pauseSubscription (kept scope-limited to
        // this caller per Day-16 Block 4-C — see that helper's
        // JSDoc). Bounded-pause semantics don't apply to the
        // system-actor emergency-halt flow.
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

// -----------------------------------------------------------------------------
// sweepEndedSubscriptions (lifecycle: active|paused → ended, system actor)
// -----------------------------------------------------------------------------

/**
 * Result of one sweep invocation. The cron handler (Day 12 work)
 * aggregates these per-tenant for the run-summary payload.
 */
export interface SweepResult {
  readonly swept: number;
  readonly subscriptionIds: readonly Uuid[];
  readonly skippedDueToRace: number;
}

/**
 * Day 7 / C-8 — End-date sweeper service.
 *
 * Walks subscriptions whose `end_date < asOfDate` and `status != 'ended'`
 * for the bound tenant, transitioning each to ENDED via the existing
 * `endSubscription` repository method. Per-row idempotent: if another
 * actor (operator-driven endSubscription, prior sweep) already transitioned
 * the row between the candidate-list query and the per-row update, the
 * repository's `SELECT … FOR UPDATE` + status re-check raises ConflictError
 * which the sweep catches and counts as `skippedDueToRace`. No audit emit
 * fires for race-loser rows.
 *
 * Today's scope is service-layer ONLY. The cron handler that calls this
 * on a schedule lands Day 12 per `docs/plan.docx`. The current callers
 * are integration tests + (eventually) the Day-12 cron.
 *
 * Design choice — `trigger_source: "user" | "sweeper"` metadata:
 *   The brief's C-8 watch-item asked: should the system-driven sweep
 *   reuse `subscription.ended` (currently systemOnly: false, used by
 *   operator-driven endSubscription), or get its own event type? Two
 *   options:
 *     (a) reuse the same event type, add a `trigger_source` metadata
 *         field to disambiguate — same precedent as
 *         `asset_tracking.state_changed` (webhook | read_through)
 *     (b) keep ctx.actor as "system" (vs "user") and infer trigger
 *         from actor.kind alone, no metadata field
 *
 *   Path (a) chosen: the metadata field is queryable in audit logs
 *   without joining against the actors table; the field name is
 *   explicit; it follows an existing precedent in the catalogue. The
 *   user-driven endSubscription emit was updated to carry
 *   `trigger_source: "user"` in the same commit so the field is
 *   present on every emit — never undefined.
 *
 * System-only — the cron is the only legitimate caller. A user actor
 * reaching this path is a routing bug; surface as ForbiddenError.
 *
 * Throws:
 *   - ForbiddenError    user actor reached this path.
 *   - ValidationError   no tenant context, or asOfDate not YYYY-MM-DD.
 */
export async function sweepEndedSubscriptions(
  ctx: RequestContext,
  asOfDate: string,
): Promise<SweepResult> {
  if (ctx.actor.kind !== "system") {
    throw new ForbiddenError(
      "subscription:sweep requires a system actor",
    );
  }
  assertTenantScoped(ctx, "subscription:sweep");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new ValidationError(
      `asOfDate must be YYYY-MM-DD, got '${asOfDate}'`,
    );
  }

  const tenantId = ctx.tenantId;

  // Phase 1: fetch the candidate id list via the repository.
  const candidates = await withServiceRole(
    `subscription:sweep list for tenant ${tenantId} asOfDate=${asOfDate}`,
    async (tx) => listSweepCandidates(tx, tenantId, asOfDate),
  );

  if (candidates.length === 0) {
    return { swept: 0, subscriptionIds: [], skippedDueToRace: 0 };
  }

  // Phase 2: per-row transition. Each row gets its own withServiceRole
  // tx to keep the per-row lock window short — the sweep can be hours
  // long for a high-volume tenant; bundling all rows into one tx would
  // hold every row's lock until the last one commits. Per-row tx also
  // means a single ConflictError doesn't roll back the whole batch.
  const sweptIds: Uuid[] = [];
  let skippedDueToRace = 0;

  for (const id of candidates) {
    try {
      const transition = await withServiceRole(
        `subscription:sweep end ${id}`,
        async (tx) => endSubscriptionRow(tx, tenantId, id),
      );
      if (transition === null) {
        // Row vanished between the candidate list and the end call.
        // Treat the same as a race-loser: count and continue.
        skippedDueToRace += 1;
        continue;
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
          previous_status: transition.before.status,
          new_status: transition.after.status,
          ended_at: transition.after.endedAt,
          trigger_source: "sweeper" as const,
        },
        requestId: ctx.requestId,
      });

      sweptIds.push(id);
    } catch (err) {
      // Race-loser: the row was already 'ended' by the time the per-row
      // SELECT FOR UPDATE acquired the lock. Repository raises
      // ConflictError; sweep counts and continues.
      if (err instanceof ConflictError) {
        skippedDueToRace += 1;
        continue;
      }
      throw err;
    }
  }

  return {
    swept: sweptIds.length,
    subscriptionIds: sweptIds,
    skippedDueToRace,
  };
}
