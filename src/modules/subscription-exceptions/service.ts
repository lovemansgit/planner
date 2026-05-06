// Subscription-exceptions service layer — Day-16 Block 4-B Service A.
//
// Implements the brief §3.1.4-§3.1.8 surface for `addSubscriptionException`
// + `appendWithoutSkip`. Wraps the pure
// `skip-algorithm.ts:computeCompensatingDate` helper rather than
// duplicating the algorithm — see
// `memory/followup_plan_path_drift_subscription_exceptions.md` §2 for
// the wrapper-pattern resolution.
//
// Module path note: this module lives at the sibling
// `src/modules/subscription-exceptions/` per the Day-13 PR #139
// convention. Merged plan PR #155 §3.1 specified a nested path
// `src/modules/subscriptions/exceptions/` which contradicts the
// shipped convention; the nested-path drift is captured in the
// followup memo cited above.
//
// Five DB-level type values are admissible on `subscription_exceptions`
// per the schema CHECK constraint (0015 migration). This service
// surface handles four of them — three skip variants + two address-
// override variants. The two type values NOT handled here:
//
//   - 'pause_window'        → REJECTED at addSubscriptionException
//                             entry per merged plan §3.6 line 343.
//                             Service B (`pauseSubscription`) owns
//                             the pause-window write surface.
//   - 'append_without_skip' → REJECTED at addSubscriptionException
//                             entry per merged plan §3.6 line 346.
//                             `appendWithoutSkip` (this module,
//                             below) is the dedicated entry point;
//                             routing through addSubscriptionException
//                             would skip the goodwill-flow audit
//                             event-pair.
//
// correlation_id minting: `crypto.randomUUID()` (uuid v4). The
// schema's correlation_id column is plain `uuid` (not v7-restricted)
// per 0015's header comment. v7 swap deferred per
// `memory/followup_correlation_id_v7_swap.md`.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";

import { withTenant } from "@/shared/db";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/errors";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { emit } from "@/modules/audit";
import { requirePermission } from "@/modules/identity";
import type { PermissionId } from "@/modules/identity/permissions";

import {
  computeCompensatingDate as pureComputeCompensatingDate,
  type IsoDate,
  type IsoWeekday,
  type PauseWindow,
} from "./skip-algorithm";
import {
  computeTodayInDubai,
  isCutOffElapsedForDate,
} from "@/modules/task-materialization/dubai-date";

import type {
  AddSubscriptionExceptionInput,
  AddSubscriptionExceptionResult,
  AppendWithoutSkipInput,
  AppendWithoutSkipResult,
  SubscriptionException,
} from "./types";
import {
  findByIdempotencyKey,
  insertException,
  listActivePauseWindows,
} from "./repository";
import { markTaskSkipped } from "@/modules/tasks/repository";

// -----------------------------------------------------------------------------
// Helpers (mirrors subscriptions/service.ts pattern — four-line copies
// per §3.4 cross-module-import prohibition)
// -----------------------------------------------------------------------------

function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, field: string): IsoDate {
  if (typeof value !== "string" || !ISO_DATE_REGEX.test(value)) {
    throw new ValidationError(`${field} must be YYYY-MM-DD; got '${value}'`);
  }
  return value;
}

/**
 * Narrow `readonly number[]` (Subscription.daysOfWeek) to the pure
 * helper's `readonly IsoWeekday[]`. The DB CHECK constraint on
 * subscriptions.days_of_week (per `0009_subscription.sql`) enforces
 * the 1-7 range at insert/update time; values reaching this code path
 * are guaranteed to be valid IsoWeekday values. Cast at the boundary
 * matches the A6 ambiguity resolution from Block 4-B.
 */
function asIsoWeekdays(days: readonly number[]): readonly IsoWeekday[] {
  return days as readonly IsoWeekday[];
}

// -----------------------------------------------------------------------------
// Permission resolution (skip-permission split per merged plan §1)
// -----------------------------------------------------------------------------

/**
 * Per §1's skip-permission split: the skip type's required permission
 * depends on input shape. Default skips need only `subscription:skip`
 * (CS Agent); override variants (target_date_override, skip_without_append)
 * need `subscription:override_skip_rules` (Operations Manager / Tenant
 * Admin only).
 *
 * For non-skip types, the permission is type-specific per plan §1's
 * service-permission table.
 *
 * Throws ValidationError on `pause_window` (Service B owns) or
 * `append_without_skip` (use the dedicated entry point) — these
 * REJECTs happen BEFORE permission resolution so the service surfaces
 * the right error class to the caller.
 */
function resolveRequiredPermission(input: AddSubscriptionExceptionInput): PermissionId {
  switch (input.type) {
    case "skip": {
      if (input.targetDateOverride !== undefined) return "subscription:override_skip_rules";
      if (input.skipWithoutAppend === true) return "subscription:override_skip_rules";
      return "subscription:skip";
    }
    case "address_override_one_off":
      return "subscription:change_address_one_off";
    case "address_override_forward":
      return "subscription:change_address_forward";
    case "pause_window":
      throw new ValidationError(
        "addSubscriptionException does not accept type='pause_window' — use pauseSubscription instead",
      );
    case "append_without_skip":
      throw new ValidationError(
        "addSubscriptionException does not accept type='append_without_skip' — use appendWithoutSkip instead",
      );
  }
}

// -----------------------------------------------------------------------------
// Subscription read for the service flow
// -----------------------------------------------------------------------------

interface SubscriptionForExceptionFlow {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly status: "active" | "paused" | "ended";
  readonly startDate: IsoDate;
  readonly endDate: IsoDate | null;
  readonly daysOfWeek: readonly number[];
}

type SubscriptionRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly status: string;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly days_of_week: number[];
} & Record<string, unknown>;

/**
 * SELECT … FOR UPDATE on the subscription row inside the service's
 * transaction. The lock prevents concurrent skip writes on the same
 * subscription from racing the end_date extension — the second tx
 * blocks on the FOR UPDATE until the first commits, then sees the
 * already-extended end_date and walks forward from there per brief
 * §3.1.6 edge B (multiple skips stacking).
 */
async function getSubscriptionForUpdate(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  subscriptionId: Uuid,
): Promise<SubscriptionForExceptionFlow | null> {
  const rows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT id, tenant_id, status, start_date, end_date, days_of_week
    FROM subscriptions
    WHERE id = ${subscriptionId}
    FOR UPDATE
  `);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.status !== "active" && row.status !== "paused" && row.status !== "ended") {
    throw new Error(`getSubscriptionForUpdate: unexpected status '${row.status}'`);
  }
  return {
    id: row.id as Uuid,
    tenantId: row.tenant_id as Uuid,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    daysOfWeek: row.days_of_week,
  };
}

/**
 * UPDATE subscriptions.end_date inside the service's transaction.
 * Used by the skip-default + target_date_override + append_without_skip
 * flows when the new end_date extends past the current end_date.
 */
async function updateSubscriptionEndDate(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: Uuid,
  subscriptionId: Uuid,
  newEndDate: IsoDate,
): Promise<void> {
  await tx.execute(sqlTag`
    UPDATE subscriptions
    SET end_date = ${newEndDate},
        updated_at = now()
    WHERE id = ${subscriptionId}
      AND tenant_id = ${tenantId}
  `);
}

// -----------------------------------------------------------------------------
// Wrapper around skip-algorithm.ts:computeCompensatingDate
// -----------------------------------------------------------------------------

/**
 * Service-layer wrapper around the pure
 * `skip-algorithm.ts:computeCompensatingDate` helper. Fetches the
 * subscription's active pause windows (and the existing skip count
 * for the §10.1 cap bookkeeping; cap not enforced in MVP) and calls
 * the pure helper with pre-fetched state.
 *
 * The pure helper handles the algorithm (per brief §3.1.6 worked
 * examples + edge cases A-I); this wrapper handles I/O. No algorithm
 * duplication per the A2-+-A3 ambiguity resolutions in Block 4-B.
 *
 * Throws `ValidationError` with the helper's `reason` mapped to a
 * caller-friendly message; throws `ConflictError` for
 * 'no_compensating_date_found' (the iteration cap was hit, which is
 * a state-conflict per the merged plan §3.3 row A 422 mapping).
 */
async function computeCompensatingDateForSkip(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  subscription: SubscriptionForExceptionFlow,
  skipDate: IsoDate,
  today: IsoDate,
): Promise<IsoDate> {
  const pauseWindowRows = await listActivePauseWindows(tx, subscription.id, today);
  const pauseWindows: readonly PauseWindow[] = pauseWindowRows.map((r) => ({
    start: r.start,
    end: r.end,
  }));

  // §10.1 confirms NO cap in MVP — `maxSkipsPerSubscription: undefined`
  // disables the helper's check. Phase 2 will import + call
  // `countExistingSkipsForCap` (defined in repository.ts) when the
  // tenant-config-driven cap lands.

  if (subscription.endDate === null) {
    // The pure helper requires a non-null endDate to walk forward
    // from. An open-ended subscription has no tail to extend; reject
    // the skip flow with a clear error.
    throw new ConflictError(
      "subscription has no end_date — cannot compute compensating tail-end date for skip flow",
    );
  }

  const result = pureComputeCompensatingDate({
    subscription: {
      endDate: subscription.endDate,
      daysOfWeek: asIsoWeekdays(subscription.daysOfWeek),
      status: subscription.status,
    },
    skipDate,
    today,
    pauseWindows,
  });

  if (result.kind === "ok") return result.compensatingDate;

  switch (result.reason) {
    case "subscription_not_active":
      throw new ConflictError(
        "subscription must be active to accept a skip — current status blocks the skip flow",
      );
    case "past_date":
      throw new ValidationError(
        "skip date must be in the future — historical-correction workflow is Phase 2",
      );
    case "skip_date_not_eligible_weekday":
      throw new ValidationError(
        "skip date is not an eligible delivery weekday for this subscription",
      );
    case "skip_date_in_blackout":
      throw new ValidationError("skip date falls in a blackout window");
    case "skip_date_in_pause_window":
      throw new ValidationError("skip date falls inside an active pause window");
    case "max_skips_exceeded":
      // MVP does not enforce the cap (per §10.1); reaching this branch
      // would mean a future caller passed maxSkipsPerSubscription. Map
      // to ConflictError for parity with the helper's vocabulary.
      throw new ConflictError("maximum skips per subscription exceeded");
    case "no_compensating_date_found":
      throw new ConflictError(
        "could not find a compensating tail-end date within the 365-day safety window",
      );
  }
}

// -----------------------------------------------------------------------------
// addSubscriptionException
// -----------------------------------------------------------------------------

/**
 * Add a subscription exception per brief §3.1.4-§3.1.6. Single
 * transaction: permission → state → cut-off → days_of_week →
 * idempotency → compensating → INSERT exception → UPDATE end_date →
 * UPDATE task → audit emission with shared correlation_id.
 *
 * Throws:
 *   - ForbiddenError    actor lacks the resolved permission.
 *   - ValidationError   no tenant context, malformed date, type rejected
 *                       at this entry, cut-off elapsed, weekday ineligible,
 *                       missing addressOverrideId for address-override
 *                       types.
 *   - NotFoundError     no subscription with that id in the tenant.
 *   - ConflictError     subscription not in 'active' state, or no
 *                       compensating date found within the 365-day cap.
 */
export async function addSubscriptionException(
  ctx: RequestContext,
  subscriptionId: Uuid,
  input: AddSubscriptionExceptionInput,
  options?: { readonly now?: Date },
): Promise<AddSubscriptionExceptionResult> {
  // Step 1 — resolve required permission (also rejects pause_window /
  // append_without_skip with ValidationError before permission check).
  const requiredPermission = resolveRequiredPermission(input);

  // Step 2 — RBAC.
  requirePermission(ctx, requiredPermission);
  assertTenantScoped(ctx, requiredPermission);

  const tenantId = ctx.tenantId;

  // Step 3 — input shape validation (date, type-specific fields).
  const skipDate = assertIsoDate(input.date, "date");

  if (
    (input.type === "address_override_one_off" || input.type === "address_override_forward") &&
    input.addressOverrideId === undefined
  ) {
    throw new ValidationError(`${input.type} requires addressOverrideId`);
  }

  if (input.targetDateOverride !== undefined) {
    assertIsoDate(input.targetDateOverride, "targetDateOverride");
  }

  // Step 4 — cut-off check (brief §3.1.8). 18:00 Dubai the day before.
  // For address_override_forward, the start_date may apply to
  // not-yet-materialized future tasks — the cut-off still applies to
  // the start date itself per plan §7.2 (the cut-off is a "cannot
  // mutate today's delivery after 18:00" guard, not a skip-specific
  // rule).
  const now = options?.now ?? new Date();
  if (isCutOffElapsedForDate(now, skipDate)) {
    throw new ValidationError(
      "delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception",
    );
  }

  const today = computeTodayInDubai(now);

  // Step 5-13 — DB work in a single tenant-scoped transaction.
  const txResult = await withTenant(tenantId, async (tx) => {
    // 5. Read subscription with FOR UPDATE.
    const subscription = await getSubscriptionForUpdate(tx, subscriptionId);
    if (subscription === null) {
      throw new NotFoundError(`subscription not found: ${subscriptionId}`);
    }
    if (subscription.tenantId !== tenantId) {
      // RLS should have hidden cross-tenant rows; defence-in-depth.
      throw new NotFoundError(`subscription not found: ${subscriptionId}`);
    }
    if (subscription.status !== "active") {
      throw new ConflictError(
        `subscription must be active to accept exception; current status is '${subscription.status}'`,
      );
    }

    // 6. Days-of-week eligibility. Skip + one-off require the date
    // to be an eligible delivery weekday; forward overrides may
    // start on a non-eligible weekday (effective from there forward).
    if (input.type === "skip" || input.type === "address_override_one_off") {
      const weekday = isoWeekdayOf(skipDate);
      if (!subscription.daysOfWeek.includes(weekday)) {
        throw new ValidationError(
          `date ${skipDate} is not an eligible delivery weekday for this subscription`,
        );
      }
    }

    // 7. Idempotency check (pre-INSERT SELECT path per A3 resolution).
    const replay = await findByIdempotencyKey(tx, subscriptionId, input.idempotencyKey);
    if (replay !== null) {
      return { replay } as const;
    }

    // 8. Type-branched compensating-date + end-date logic.
    let compensatingDate: IsoDate | null = null;
    let newEndDate: IsoDate | null = null;
    let endDateExtended = false;

    if (input.type === "skip") {
      if (input.skipWithoutAppend === true) {
        // Cancel-only: no compensating date, no end_date change.
        compensatingDate = null;
        newEndDate = null;
      } else if (input.targetDateOverride !== undefined) {
        // Operator-picked compensating date.
        const target = input.targetDateOverride;
        const targetWeekday = isoWeekdayOf(target);
        if (!subscription.daysOfWeek.includes(targetWeekday)) {
          throw new ValidationError(
            `targetDateOverride ${target} is not an eligible delivery weekday for this subscription`,
          );
        }
        // Per merged plan §3.2 step 13b: if a task already exists at
        // the override date, cron's normal flow tags it on next tick.
        // No exception-create-time task INSERT or collision check
        // needed — the cron-decoupled materialization handler
        // (PR #153 §4.4) is the address-resolution authority for
        // materialized tasks.
        compensatingDate = target;
        if (subscription.endDate !== null && target > subscription.endDate) {
          newEndDate = target;
          endDateExtended = true;
        } else {
          newEndDate = null;
        }
      } else {
        // Default skip: walk forward from current end_date via wrapper.
        compensatingDate = await computeCompensatingDateForSkip(
          tx,
          subscription,
          skipDate,
          today,
        );
        newEndDate = compensatingDate;
        endDateExtended = true;
      }
    }
    // Address-override variants: no compensating-date, no end_date change.
    // (compensatingDate remains null; newEndDate remains null.)

    // 9. Generate correlation_id — single id shared across all audit
    // events emitted by this service call.
    const correlationId = randomUUID() as Uuid;

    // 10. INSERT subscription_exceptions row.
    const exception = await insertException(tx, tenantId, {
      subscriptionId,
      type: input.type,
      startDate: skipDate,
      endDate: null,
      targetDateOverride: input.targetDateOverride ?? null,
      skipWithoutAppend: input.skipWithoutAppend === true,
      reason: input.reason ?? null,
      addressOverrideId: (input.addressOverrideId ?? null) as Uuid | null,
      compensatingDate,
      correlationId,
      idempotencyKey: input.idempotencyKey,
      createdBy: actorIdFor(ctx.actor) as Uuid,
    });

    // 11. UPDATE subscriptions.end_date for skip flows that extend.
    if (endDateExtended && newEndDate !== null) {
      await updateSubscriptionEndDate(tx, tenantId, subscriptionId, newEndDate);
    }

    // 12. UPDATE the affected target task → SKIPPED (skip flows only).
    // rowsAffected discarded; the SKIPPED state is the durable record
    // and 0-rows-affected sub-cases are documented in
    // `markTaskSkipped`'s JSDoc + the disambiguation followup memo.
    if (input.type === "skip") {
      await markTaskSkipped(tx, tenantId, subscriptionId, skipDate);
    }

    return {
      replay: null,
      exception,
      newEndDate,
      compensatingDate,
      endDateExtended,
    } as const;
  });

  // Idempotent-replay path — return existing fields as 409. NO audit
  // events emit on replay (matches plan §3.2 step 6 semantics).
  if (txResult.replay !== null) {
    return idempotentReplayResult(txResult.replay);
  }

  const { exception, newEndDate, endDateExtended } = txResult;

  // Step 14 — audit emit (post-commit). Shared correlation_id across
  // all events emitted by this call.
  const baseEmit = {
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    requestId: ctx.requestId,
  } as const;

  await emit({
    ...baseEmit,
    eventType: "subscription.exception.created",
    resourceType: "subscription_exception",
    resourceId: exception.id,
    metadata: {
      subscription_id: subscriptionId,
      exception_id: exception.id,
      type: exception.type,
      start_date: exception.startDate,
      target_date_override: exception.targetDateOverride,
      skip_without_append: exception.skipWithoutAppend,
      compensating_date: exception.compensatingDate,
      address_override_id: exception.addressOverrideId,
      correlation_id: exception.correlationId,
      reason: exception.reason,
    },
  });

  if (endDateExtended && newEndDate !== null) {
    await emit({
      ...baseEmit,
      eventType: "subscription.end_date.extended",
      resourceType: "subscription",
      resourceId: subscriptionId,
      metadata: {
        subscription_id: subscriptionId,
        new_end_date: newEndDate,
        triggered_by: "skip",
        correlation_id: exception.correlationId,
      },
    });
  }

  if (
    exception.type === "address_override_one_off" ||
    exception.type === "address_override_forward"
  ) {
    await emit({
      ...baseEmit,
      eventType: "subscription.address_override.applied",
      resourceType: "subscription",
      resourceId: subscriptionId,
      metadata: {
        subscription_id: subscriptionId,
        exception_id: exception.id,
        scope: exception.type === "address_override_one_off" ? "one_off" : "forward",
        effective_from: exception.startDate,
        address_override_id: exception.addressOverrideId,
        correlation_id: exception.correlationId,
      },
    });
  }

  return {
    exceptionId: exception.id,
    correlationId: exception.correlationId,
    compensatingDate: exception.compensatingDate,
    newEndDate,
    status: "inserted",
    httpStatus: 201,
  };
}

// -----------------------------------------------------------------------------
// appendWithoutSkip
// -----------------------------------------------------------------------------

/**
 * Operator-initiated tail-end addition (goodwill / complaint resolution).
 * Inserts subscription_exceptions row with type='append_without_skip',
 * extends subscription.end_date by one eligible-day step (or the
 * operator's targetDateOverride if supplied), and emits the same
 * correlation-id-paired event pair as the skip-default flow:
 * `subscription.exception.created` + `subscription.end_date.extended`.
 *
 * Per merged plan §3.5 step 7 — the materialization handler (cron)
 * generates the new task on the next tick; this service does NOT
 * INSERT into tasks (preserves the materialization-as-source-of-
 * truth invariant established by the cron-decoupling work).
 *
 * Permission: subscription:override_skip_rules (Operations Manager /
 * Tenant Admin only — CS Agent does NOT have this).
 */
export async function appendWithoutSkip(
  ctx: RequestContext,
  subscriptionId: Uuid,
  input: AppendWithoutSkipInput,
  options?: { readonly now?: Date },
): Promise<AppendWithoutSkipResult> {
  requirePermission(ctx, "subscription:override_skip_rules");
  assertTenantScoped(ctx, "subscription:override_skip_rules");

  const tenantId = ctx.tenantId;

  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    throw new ValidationError("appendWithoutSkip requires a non-empty reason");
  }

  if (input.targetDateOverride !== undefined) {
    assertIsoDate(input.targetDateOverride, "targetDateOverride");
  }

  const now = options?.now ?? new Date();
  const today = computeTodayInDubai(now);

  const txResult = await withTenant(tenantId, async (tx) => {
    const subscription = await getSubscriptionForUpdate(tx, subscriptionId);
    if (subscription === null) {
      throw new NotFoundError(`subscription not found: ${subscriptionId}`);
    }
    if (subscription.tenantId !== tenantId) {
      throw new NotFoundError(`subscription not found: ${subscriptionId}`);
    }
    if (subscription.status !== "active") {
      throw new ConflictError(
        `subscription must be active to accept goodwill addition; current status is '${subscription.status}'`,
      );
    }

    const replay = await findByIdempotencyKey(tx, subscriptionId, input.idempotencyKey);
    if (replay !== null) {
      return { replay } as const;
    }

    // Compute the new tail-end date — operator-supplied override, or
    // walk forward from current end_date via the wrapper.
    let newEndDate: IsoDate;
    if (input.targetDateOverride !== undefined) {
      const target = input.targetDateOverride;
      const targetWeekday = isoWeekdayOf(target);
      if (!subscription.daysOfWeek.includes(targetWeekday)) {
        throw new ValidationError(
          `targetDateOverride ${target} is not an eligible delivery weekday for this subscription`,
        );
      }
      if (subscription.endDate !== null && target <= subscription.endDate) {
        throw new ValidationError(
          `targetDateOverride ${target} must be strictly after current end_date ${subscription.endDate}`,
        );
      }
      // Cut-off check on the operator's override target.
      if (isCutOffElapsedForDate(now, target)) {
        throw new ValidationError(
          "targetDateOverride is past the 18:00 Dubai cut-off the day before",
        );
      }
      newEndDate = target;
    } else {
      // Walk forward via the wrapper, with `skipDate = today` standing
      // in as a no-op skip-date input (the algorithm only uses
      // skipDate for the past-date guard, which `today` passes
      // trivially). The actual outcome is governed by endDate +
      // daysOfWeek + pauseWindows.
      newEndDate = await computeCompensatingDateForSkip(tx, subscription, today, today);
    }

    const correlationId = randomUUID() as Uuid;

    const exception = await insertException(tx, tenantId, {
      subscriptionId,
      type: "append_without_skip",
      startDate: newEndDate,
      endDate: null,
      targetDateOverride: input.targetDateOverride ?? null,
      skipWithoutAppend: false,
      reason: input.reason,
      addressOverrideId: null,
      // CHECK constraint exc_compensating_date_only_for_skip: NULL for
      // non-skip types. The new tail-end date is captured on
      // subscriptions.end_date (the durable record) + on this row's
      // start_date (the exception's audit anchor).
      compensatingDate: null,
      correlationId,
      idempotencyKey: input.idempotencyKey,
      createdBy: actorIdFor(ctx.actor) as Uuid,
    });

    await updateSubscriptionEndDate(tx, tenantId, subscriptionId, newEndDate);

    return { replay: null, exception, newEndDate } as const;
  });

  if (txResult.replay !== null) {
    return idempotentReplayResultForAppend(txResult.replay);
  }

  const { exception, newEndDate } = txResult;

  const baseEmit = {
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    requestId: ctx.requestId,
  } as const;

  await emit({
    ...baseEmit,
    eventType: "subscription.exception.created",
    resourceType: "subscription_exception",
    resourceId: exception.id,
    metadata: {
      subscription_id: subscriptionId,
      exception_id: exception.id,
      type: "append_without_skip",
      start_date: exception.startDate,
      reason: exception.reason,
      correlation_id: exception.correlationId,
    },
  });

  await emit({
    ...baseEmit,
    eventType: "subscription.end_date.extended",
    resourceType: "subscription",
    resourceId: subscriptionId,
    metadata: {
      subscription_id: subscriptionId,
      new_end_date: newEndDate,
      triggered_by: "append_without_skip",
      correlation_id: exception.correlationId,
    },
  });

  return {
    exceptionId: exception.id,
    correlationId: exception.correlationId,
    newEndDate,
    status: "inserted",
    httpStatus: 201,
  };
}

// -----------------------------------------------------------------------------
// Idempotent-replay result builders
// -----------------------------------------------------------------------------

function idempotentReplayResult(
  replay: SubscriptionException,
): AddSubscriptionExceptionResult {
  return {
    exceptionId: replay.id,
    correlationId: replay.correlationId,
    compensatingDate: replay.compensatingDate,
    newEndDate: replay.compensatingDate,
    status: "idempotent_replay",
    httpStatus: 409,
  };
}

function idempotentReplayResultForAppend(
  replay: SubscriptionException,
): AppendWithoutSkipResult {
  return {
    exceptionId: replay.id,
    correlationId: replay.correlationId,
    // For append_without_skip, the new end_date is captured on the
    // exception row's start_date (which equals the new end_date) since
    // compensating_date is reserved for type='skip' per the
    // exc_compensating_date_only_for_skip CHECK constraint.
    newEndDate: replay.startDate,
    status: "idempotent_replay",
    httpStatus: 409,
  };
}

// -----------------------------------------------------------------------------
// ISO weekday helper
// -----------------------------------------------------------------------------

/**
 * ISO weekday for an ISO YYYY-MM-DD date — Mon=1, Sun=7. Mirrors the
 * pure helper's `isoWeekday` function but operates directly on ISO
 * date strings (the service layer only has dates, not Date objects,
 * at the input boundary).
 */
function isoWeekdayOf(date: IsoDate): IsoWeekday {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`invalid date: ${date}`);
  }
  const jsDay = d.getUTCDay();
  return (((jsDay + 6) % 7) + 1) as IsoWeekday;
}
