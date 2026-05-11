// Consignee onboarding orchestration — Day 22 / Phase 1 forms lane.
//
// `createConsigneeWithSubscription` is the single-transaction entry
// point for the /consignees/new wizard. Bundles three writes inside
// ONE `withTenant` tx so the wizard's "final submit" is atomic per
// brief §3.3.1 (single-address MVP scope per brief v1.11 amendment):
//
//   1. INSERT consignees row (legacy address columns populated from
//      primaryAddress for back-compat — see "Why" below)
//   2. INSERT addresses row with is_primary=true
//   3. INSERT subscriptions row referencing the new consignee
//
// Zero rotation rows are written. Migration 0014's COALESCE pattern
// (subscription_address_rotations missing → consignee primary
// fallback) handles the per-weekday address resolution. Per brief
// v1.11 amendment §3.3.1, multi-address + per-weekday rotation UI is
// deferred to Phase 2 per
// memory/followup_multi_address_rotation_phase_2.md.
//
// Why both audit events emit AFTER commit:
//   We want `consignee.created` and `subscription.created` to fire if
//   and only if the writes actually committed. Pre-commit emits would
//   leave ghost events on rollback. The shared/audit emit goes through
//   `withServiceRole` internally; calling it after the orchestration's
//   withTenant tx returns guarantees both events reflect committed
//   state.
//
// Why the consignees row's inline address fields mirror primaryAddress:
//   Migration 0014 documents the consignees.address_line / district /
//   emirate_or_region columns as "Phase 2 deprecation"; they remain
//   NOT NULL until that deprecation lands. The wizard must populate
//   them with the primary-address values so the consignee row is
//   well-formed and existing reads (e.g. CalendarPodCard's address
//   indicator pre-Phase-2) stay coherent.
//
// Why the orchestration is ops-manager-only:
//   The wizard creates a subscription on submit, so subscription:create
//   gates entry. consignee:create is also required (the consignee row
//   is the first write inside the tx). Both gates fire pre-tx; if
//   either denies, no writes happen.

import { emit } from "../audit";
import { withTenant } from "../../shared/db";
import { ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";

import { requirePermission } from "../identity";
import { insertAddress } from "../addresses";
import type { AddressLabel } from "../addresses";
import { insertSubscription } from "../subscriptions";
import type { Subscription } from "../subscriptions";
import { computeTargetDateInDubai } from "../task-materialization/dubai-date";
import { enqueueTaskPushBatch } from "../task-materialization/queue";
import { materializeSubscriptionForDateRange } from "../task-materialization/service";

import { normaliseToE164 } from "./phone";
import { insertConsignee } from "./repository";
import type { Consignee } from "./types";

function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

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

function optionalTrim(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function nullableTrim(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateDaysOfWeek(days: readonly number[]): void {
  if (days.length === 0) {
    throw new ValidationError("daysOfWeek must contain at least one weekday");
  }
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) {
      throw new ValidationError(
        `daysOfWeek must contain only integers 1–7 (Mon=1, Sun=7); got ${d}`,
      );
    }
  }
}

/**
 * Operator input for the /consignees/new wizard. Three sections mirror
 * the three wizard steps (identity → primary address → subscription).
 */
export interface CreateConsigneeWithSubscriptionInput {
  readonly consignee: {
    readonly name: string;
    readonly phone: string;
    readonly email?: string;
    readonly deliveryNotes?: string;
    readonly externalRef?: string;
    readonly notesInternal?: string;
  };
  readonly primaryAddress: {
    readonly label: AddressLabel;
    readonly line: string;
    readonly district: string;
    readonly emirate: string;
    readonly lat?: number | null;
    readonly lng?: number | null;
  };
  readonly subscription: {
    readonly startDate: string;
    readonly endDate?: string | null;
    readonly daysOfWeek: readonly number[];
    readonly deliveryWindowStart: string;
    readonly deliveryWindowEnd: string;
    readonly mealPlanName?: string | null;
    readonly externalRef?: string | null;
    readonly notesInternal?: string | null;
  };
}

export interface CreateConsigneeWithSubscriptionResult {
  readonly consignee: Consignee;
  readonly subscription: Subscription;
}

/**
 * Atomic onboarding orchestration. Validates inputs, opens ONE
 * withTenant tx, writes consignee + primary address + subscription,
 * then emits both audit events post-commit.
 *
 * Throws:
 *   - ForbiddenError    actor lacks consignee:create OR
 *                       subscription:create.
 *   - ValidationError   missing required fields, malformed phone,
 *                       malformed daysOfWeek, no tenant context.
 *
 * Postgres-layer errors propagate via Drizzle's tx.execute throws —
 * RLS WITH CHECK violations, partial-UNIQUE violations on the address
 * primary flag, etc. The withTenant wrapper rolls back on any throw,
 * so partial writes are impossible.
 */
export async function createConsigneeWithSubscription(
  ctx: RequestContext,
  input: CreateConsigneeWithSubscriptionInput,
): Promise<CreateConsigneeWithSubscriptionResult> {
  // Both permissions gate entry. Both fire before tenant assertion so
  // permission denial is not masked by a tenant-context failure.
  requirePermission(ctx, "consignee:create");
  requirePermission(ctx, "subscription:create");

  if (!ctx.tenantId) {
    throw new ValidationError(
      "createConsigneeWithSubscription requires a tenant context",
    );
  }
  const tenantId = ctx.tenantId;

  // Normalise consignee inputs.
  const consigneeName = requireNonEmpty(input.consignee.name, "consignee.name");
  const consigneePhone = normaliseToE164(input.consignee.phone);
  const consigneeEmail = optionalTrim(input.consignee.email);
  const consigneeDeliveryNotes = optionalTrim(input.consignee.deliveryNotes);
  const consigneeExternalRef = optionalTrim(input.consignee.externalRef);
  const consigneeNotesInternal = optionalTrim(input.consignee.notesInternal);

  // Normalise address inputs. Required per brief v1.11 §3.3.1 step 2.
  const addressLabel = input.primaryAddress.label;
  if (!["home", "office", "other"].includes(addressLabel)) {
    throw new ValidationError(
      `primaryAddress.label must be home | office | other; got ${addressLabel}`,
    );
  }
  const addressLine = requireNonEmpty(input.primaryAddress.line, "primaryAddress.line");
  const addressDistrict = requireNonEmpty(input.primaryAddress.district, "primaryAddress.district");
  const addressEmirate = requireNonEmpty(input.primaryAddress.emirate, "primaryAddress.emirate");
  const addressLat = input.primaryAddress.lat ?? null;
  const addressLng = input.primaryAddress.lng ?? null;

  // Normalise subscription inputs.
  validateDaysOfWeek(input.subscription.daysOfWeek);
  const startDate = requireNonEmpty(input.subscription.startDate, "subscription.startDate");
  const deliveryWindowStart = requireNonEmpty(
    input.subscription.deliveryWindowStart,
    "subscription.deliveryWindowStart",
  );
  const deliveryWindowEnd = requireNonEmpty(
    input.subscription.deliveryWindowEnd,
    "subscription.deliveryWindowEnd",
  );

  const created = await withTenant(tenantId, async (tx) => {
    // 1. consignees row. Legacy inline address fields mirror the primary
    //    address values per migration 0014's Phase-2 deprecation note —
    //    NOT NULL columns must hold something coherent until the
    //    deprecation lands.
    const consignee = await insertConsignee(tx, tenantId, {
      name: consigneeName,
      phone: consigneePhone,
      email: consigneeEmail,
      addressLine,
      emirateOrRegion: addressEmirate,
      district: addressDistrict,
      deliveryNotes: consigneeDeliveryNotes,
      externalRef: consigneeExternalRef,
      notesInternal: consigneeNotesInternal,
    });

    // 2. addresses row. is_primary=true; partial UNIQUE on
    //    (consignee_id) WHERE is_primary=true catches drift if a future
    //    second primary slips through.
    await insertAddress(tx, tenantId, consignee.id, {
      label: addressLabel,
      isPrimary: true,
      line: addressLine,
      district: addressDistrict,
      emirate: addressEmirate,
      lat: addressLat,
      lng: addressLng,
    });

    // 3. subscriptions row referencing the new consignee. Zero rotation
    //    rows — COALESCE fallback per migration 0014 routes every
    //    materialised task to the primary address.
    const subscription = await insertSubscription(tx, tenantId, {
      consigneeId: consignee.id,
      startDate,
      endDate: input.subscription.endDate ?? null,
      daysOfWeek: input.subscription.daysOfWeek,
      deliveryWindowStart,
      deliveryWindowEnd,
      deliveryAddressOverride: null,
      mealPlanName: nullableTrim(input.subscription.mealPlanName),
      externalRef: nullableTrim(input.subscription.externalRef),
      notesInternal: nullableTrim(input.subscription.notesInternal),
    });

    // Defence-in-depth assertion: catch any silent FK race where the
    // returned subscription claims a different consignee than the one
    // we just inserted. Should be impossible inside the tx; throwing
    // here triggers a rollback.
    if (subscription.consigneeId !== consignee.id) {
      throw new Error(
        `createConsigneeWithSubscription invariant: subscription.consigneeId ${subscription.consigneeId} != consignee.id ${consignee.id}`,
      );
    }

    // Day-22 PM §3.22 — synchronous materialization for the 14-day
    // rolling horizon. Operators see tasks immediately on submit
    // rather than waiting until the next 12:00 UTC cron tick (and the
    // cron doesn't fire on Vercel preview deployments at all). Same
    // withTenant tx as the inserts so a materialization throw rolls
    // back the entire orchestration — no orphan subscription state.
    // The daily cron remains the horizon-extender that materialises
    // newly-eligible dates as the rolling window advances.
    const horizonEnd = computeTargetDateInDubai(new Date());
    const rangeEnd =
      subscription.endDate !== null && subscription.endDate < horizonEnd
        ? subscription.endDate
        : horizonEnd;
    const materializeResult = await materializeSubscriptionForDateRange(tx, {
      subscriptionId: subscription.id,
      startDate: subscription.startDate,
      endDate: rangeEnd,
      requestId: ctx.requestId,
    });

    return {
      consignee,
      subscription,
      newInsertedTaskIds: materializeResult.newInsertedTaskIds,
    };
  });

  // Day-22 PM §3.22 B5 — Phase-5 outbound SF push enqueue, post-commit.
  // Mirrors the cron handler's Phase-5 posture (queue.ts:88-97): enqueue
  // runs OUTSIDE the withTenant tx because already-committed task rows
  // are durable, and a failed enqueue must NOT roll back the materialised
  // tasks. Next-tick cron reconciliation re-discovers any tasks whose
  // Phase-5 enqueue dropped on the floor (Phase-1 reconciliation tuples
  // in generate-tasks/route.ts). On preview deployments where the cron
  // never fires, the operator can manually retry via subsequent
  // operator-driven flows; the failure mode is "saved locally; SF push
  // pending" rather than "user-visible 5xx that hides the successful
  // commit".
  try {
    await enqueueTaskPushBatch({
      tenantId,
      taskIds: created.newInsertedTaskIds,
      requestId: ctx.requestId,
    });
  } catch (err) {
    console.error(
      "[createConsigneeWithSubscription] post-commit SF push enqueue failed:",
      err,
    );
    // Intentionally swallow per Phase-5 self-healing posture.
  }

  // Post-commit audit emits. consignee.created fires first because it
  // is the parent resource; subscription.created references the new
  // consignee_id. Both go through the audit module's own withServiceRole
  // wrapper — separate from the consignee/subscription tx above.
  await emit({
    eventType: "consignee.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "consignee",
    resourceId: created.consignee.id,
    metadata: {
      consignee_id: created.consignee.id,
      source: "planner",
      onboarded_via: "wizard",
    },
    requestId: ctx.requestId,
  });

  await emit({
    eventType: "subscription.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "subscription",
    resourceId: created.subscription.id,
    metadata: {
      subscription_id: created.subscription.id,
      consignee_id: created.subscription.consigneeId,
      start_date: created.subscription.startDate,
      days_of_week: [...created.subscription.daysOfWeek],
      onboarded_via: "wizard",
    },
    requestId: ctx.requestId,
  });

  return { consignee: created.consignee, subscription: created.subscription };
}
