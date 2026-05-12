// Calendar popover server actions — Day-17 (action 1) + Day-22 / PR-B
// (actions 2-7).
//
// Composes against the existing service-layer fns:
//   - addSubscriptionException (PR #160 Block 4-A) — skip + skip override
//     + address one-off + address forward + cancel-no-append (D1: reuses
//     skipWithoutAppend=true via subscription:override_skip_rules)
//   - pauseSubscription (PR #160 Block 4-C) — pause-from-this-date
//   - addNoteToDriver (Day-22 / PR-B service-layer addition) — add-note
//
// Each action wraps a service call with form-state semantics for the
// DayActionPopover client component to consume via React's useActionState.
//
// Brief §3.3.3 popover surface (lines 500-508):
//   1. skip-default (DONE PR #177) — perm subscription:skip
//   2. skip-with-override — perm subscription:override_skip_rules
//   3. pause-from-this-date — perm subscription:pause
//   4. change-address-one-off — perm subscription:change_address_one_off
//   5. change-address-forward — perm subscription:change_address_forward
//   6. cancel-no-append — perm subscription:override_skip_rules (D1 ruling:
//      reuse existing perm + skipWithoutAppend=true path; not a new perm)
//   7. add-note-to-driver — perm task:add_note (NEW)
//   8. view-task-timeline — read-only drawer; no server action surface
//      here, drawer fetches via the timeline page route handler

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { addSubscriptionException } from "@/modules/subscription-exceptions";
import { pauseSubscription } from "@/modules/subscriptions";
import { addNoteToDriver, getTaskTimeline, type TaskTimeline } from "@/modules/tasks";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

/**
 * Discriminated-union result for the popover's Skip flow. `success`
 * carries `compensatingDate` (the tail-end date the algorithm chose)
 * + `newEndDate` (subscription end_date after extension) so the UI
 * can render "Tail-end reinsertion: <date>" in the success toast.
 *
 * `idempotent_replay` is the 409 path when the same idempotency_key
 * was already used; UX-wise treat as success — operator double-tapped
 * the button or hit retry on a network blip.
 */
export type SkipDeliveryActionResult =
  | { readonly kind: "success"; readonly compensatingDate: string | null; readonly newEndDate: string | null }
  | { readonly kind: "idempotent_replay"; readonly compensatingDate: string | null; readonly newEndDate: string | null }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

/**
 * Skip a single delivery with default rules (tail-end reinsertion,
 * no target_date_override, no skip_without_append).
 *
 * Bound at the component layer with the consigneeId via
 * `.bind(null, consigneeId, subscriptionId, taskId, deliveryDate)`;
 * the prevState + formData params are React's useActionState contract
 * (formData is unused for this action — all params are bound).
 *
 * idempotency_key: server-generated UUID. The brief §3.1.4 + plan
 * #155 §7.1 say client supplies it; for this action, the client is
 * a single button click that translates to one POST, so server-side
 * generation is sufficient. Future enhancement (when the popover
 * gains a confirmation step that could be re-clicked): pass the key
 * through formData so retries dedupe.
 */
export async function skipDeliveryAction(
  consigneeId: string,
  subscriptionId: string,
  deliveryDate: string,
  _prevState: SkipDeliveryActionResult | { readonly kind: "idle" },
  _formData: FormData,
): Promise<SkipDeliveryActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  try {
    const ctx = await buildRequestContext(
      `/consignees/${consigneeId}`,
      requestId,
    );
    const result = await addSubscriptionException(ctx, subscriptionId as Uuid, {
      type: "skip",
      date: deliveryDate,
      idempotencyKey: idempotencyKey as Uuid,
    });

    revalidatePath(`/consignees/${consigneeId}`, "page");

    if (result.status === "idempotent_replay") {
      return {
        kind: "idempotent_replay",
        compensatingDate: result.compensatingDate,
        newEndDate: result.newEndDate,
      };
    }
    return {
      kind: "success",
      compensatingDate: result.compensatingDate,
      newEndDate: result.newEndDate,
    };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to skip deliveries.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Subscription not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    throw err;
  }
}


// -----------------------------------------------------------------------------
// Day-22 / PR-B — actions 2-7 result shape
// -----------------------------------------------------------------------------
//
// Shared shape for the five mutation-style actions (skip-override / pause /
// change-address-one-off / change-address-forward / cancel-no-append /
// add-note). Discriminated by `kind`; the success branch carries an
// optional `message` for inline operator feedback (e.g. "Pause window
// cancels 3 deliveries; new end date is 2026-06-04"). Per-action specifics
// live on the success message, not on a per-action union — keeps the
// useActionState consumer code straight in the popover.

export type CalendarPopoverActionResult =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "idempotent_replay"; readonly message: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

type IdleOrResult = CalendarPopoverActionResult | { readonly kind: "idle" };

/** Translate service-layer errors to the discriminated-result shape. */
function mapErrorToResult(err: unknown, resourceLabel: string): CalendarPopoverActionResult {
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return { kind: "forbidden", message: "You don't have permission for that action." };
  }
  if (err instanceof NotFoundError) {
    return { kind: "not_found", message: `${resourceLabel} not found.` };
  }
  if (err instanceof ValidationError) {
    return { kind: "validation", message: err.message };
  }
  throw err;
}


// -----------------------------------------------------------------------------
// Action 2 — Skip with override (move-to-date OR skip-without-append)
// -----------------------------------------------------------------------------
//
// Two override variants per brief §3.3.3 + the subscription-exceptions
// service surface:
//   - target_date_override: operator picks a specific compensating date
//     instead of the algorithm's tail-end choice
//   - skip_without_append: skip the delivery WITHOUT extending end_date
//     (cancel-only; reduces total deliveries)
//
// FormData fields:
//   override_kind: 'move_to_date' | 'skip_without_append'
//   target_date_override: ISO YYYY-MM-DD (required for move_to_date,
//     ignored for skip_without_append)

export async function skipWithOverrideAction(
  consigneeId: string,
  subscriptionId: string,
  deliveryDate: string,
  _prevState: IdleOrResult,
  formData: FormData,
): Promise<CalendarPopoverActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  const overrideKind = formData.get("override_kind");
  if (overrideKind !== "move_to_date" && overrideKind !== "skip_without_append") {
    return {
      kind: "validation",
      message: "Choose move-to-date or skip-without-append.",
    };
  }

  let targetDateOverride: string | undefined;
  if (overrideKind === "move_to_date") {
    const raw = formData.get("target_date_override");
    if (typeof raw !== "string" || raw.trim() === "") {
      return {
        kind: "validation",
        message: "Target date is required when moving the delivery.",
      };
    }
    targetDateOverride = raw.trim();
  }

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const result = await addSubscriptionException(ctx, subscriptionId as Uuid, {
      type: "skip",
      date: deliveryDate,
      idempotencyKey: idempotencyKey as Uuid,
      ...(targetDateOverride !== undefined ? { targetDateOverride } : {}),
      ...(overrideKind === "skip_without_append" ? { skipWithoutAppend: true } : {}),
    });

    revalidatePath(`/consignees/${consigneeId}`, "page");

    const message =
      overrideKind === "move_to_date"
        ? `Skip applied; delivery moved to ${targetDateOverride}.`
        : "Skip applied without tail-end append; subscription count reduced by one.";
    return {
      kind: result.status === "idempotent_replay" ? "idempotent_replay" : "success",
      message,
    };
  } catch (err) {
    return mapErrorToResult(err, "Subscription");
  }
}


// -----------------------------------------------------------------------------
// Action 3 — Pause from this date
// -----------------------------------------------------------------------------
//
// Operator picks a pause window starting at the popover's deliveryDate
// and ending at the operator-supplied pause_end. pauseSubscription handles
// the bounded-pause semantics per brief §3.1.7 (cancel tasks in window,
// extend end_date by eligible-day count). Cut-off enforced inside the
// service.
//
// FormData fields:
//   pause_end: ISO YYYY-MM-DD (required, strictly > deliveryDate)
//   reason:    optional free text

export async function pauseFromDateAction(
  consigneeId: string,
  subscriptionId: string,
  deliveryDate: string,
  _prevState: IdleOrResult,
  formData: FormData,
): Promise<CalendarPopoverActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  const rawPauseEnd = formData.get("pause_end");
  if (typeof rawPauseEnd !== "string" || rawPauseEnd.trim() === "") {
    return { kind: "validation", message: "Pause end date is required." };
  }
  const pauseEnd = rawPauseEnd.trim();
  const rawReason = formData.get("reason");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const result = await pauseSubscription(ctx, subscriptionId as Uuid, {
      pause_start: deliveryDate,
      pause_end: pauseEnd,
      idempotency_key: idempotencyKey,
      ...(reason.length > 0 ? { reason } : {}),
    });

    revalidatePath(`/consignees/${consigneeId}`, "page");

    return {
      kind: result.status === "idempotent_replay" ? "idempotent_replay" : "success",
      message: `Pause applied; new end date is ${result.new_end_date}.`,
    };
  } catch (err) {
    return mapErrorToResult(err, "Subscription");
  }
}


// -----------------------------------------------------------------------------
// Action 4 — Change address for this delivery only
// -----------------------------------------------------------------------------
//
// FormData fields:
//   address_override_id: Uuid (required)

export async function changeAddressOneOffAction(
  consigneeId: string,
  subscriptionId: string,
  deliveryDate: string,
  _prevState: IdleOrResult,
  formData: FormData,
): Promise<CalendarPopoverActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  const rawAddressId = formData.get("address_override_id");
  if (typeof rawAddressId !== "string" || rawAddressId.trim() === "") {
    return { kind: "validation", message: "Pick an address." };
  }
  const addressOverrideId = rawAddressId.trim();

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const result = await addSubscriptionException(ctx, subscriptionId as Uuid, {
      type: "address_override_one_off",
      date: deliveryDate,
      idempotencyKey: idempotencyKey as Uuid,
      addressOverrideId: addressOverrideId as Uuid,
    });

    revalidatePath(`/consignees/${consigneeId}`, "page");

    return {
      kind: result.status === "idempotent_replay" ? "idempotent_replay" : "success",
      message: "Address overridden for this delivery only.",
    };
  } catch (err) {
    return mapErrorToResult(err, "Subscription");
  }
}


// -----------------------------------------------------------------------------
// Action 5 — Change address from this delivery onwards
// -----------------------------------------------------------------------------
//
// FormData fields:
//   address_override_id: Uuid (required)

export async function changeAddressForwardAction(
  consigneeId: string,
  subscriptionId: string,
  deliveryDate: string,
  _prevState: IdleOrResult,
  formData: FormData,
): Promise<CalendarPopoverActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  const rawAddressId = formData.get("address_override_id");
  if (typeof rawAddressId !== "string" || rawAddressId.trim() === "") {
    return { kind: "validation", message: "Pick an address." };
  }
  const addressOverrideId = rawAddressId.trim();

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const result = await addSubscriptionException(ctx, subscriptionId as Uuid, {
      type: "address_override_forward",
      date: deliveryDate,
      idempotencyKey: idempotencyKey as Uuid,
      addressOverrideId: addressOverrideId as Uuid,
    });

    revalidatePath(`/consignees/${consigneeId}`, "page");

    return {
      kind: result.status === "idempotent_replay" ? "idempotent_replay" : "success",
      message: `Address overridden from ${deliveryDate} onwards.`,
    };
  } catch (err) {
    return mapErrorToResult(err, "Subscription");
  }
}


// -----------------------------------------------------------------------------
// Action 6 — Cancel delivery (no append)
// -----------------------------------------------------------------------------
//
// D1 ruling: reuses existing `subscription:override_skip_rules` perm +
// the existing skipWithoutAppend=true path on addSubscriptionException —
// NOT a new perm and NOT a new service-layer fn (brief-spec-first per
// §3.24). Semantically identical to the skip-without-append variant of
// action 2, but surfaces as a distinct popover button per brief §3.3.3
// line 506. No formData input — the operator's click IS the confirmation.

export async function cancelNoAppendAction(
  consigneeId: string,
  subscriptionId: string,
  deliveryDate: string,
  _prevState: IdleOrResult,
  _formData: FormData,
): Promise<CalendarPopoverActionResult> {
  const requestId = randomUUID();
  const idempotencyKey = randomUUID();

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const result = await addSubscriptionException(ctx, subscriptionId as Uuid, {
      type: "skip",
      date: deliveryDate,
      idempotencyKey: idempotencyKey as Uuid,
      skipWithoutAppend: true,
    });

    revalidatePath(`/consignees/${consigneeId}`, "page");

    return {
      kind: result.status === "idempotent_replay" ? "idempotent_replay" : "success",
      message: "Delivery cancelled; subscription count reduced by one.",
    };
  } catch (err) {
    return mapErrorToResult(err, "Subscription");
  }
}


// -----------------------------------------------------------------------------
// Action 7 — Add note to driver
// -----------------------------------------------------------------------------
//
// FormData fields:
//   note: string (required, max 1000 chars; trimmed)

export async function addNoteToDriverAction(
  consigneeId: string,
  taskId: string,
  _prevState: IdleOrResult,
  formData: FormData,
): Promise<CalendarPopoverActionResult> {
  const requestId = randomUUID();

  const rawNote = formData.get("note");
  if (typeof rawNote !== "string" || rawNote.trim() === "") {
    return { kind: "validation", message: "Note cannot be empty." };
  }

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    await addNoteToDriver(ctx, taskId as Uuid, rawNote);

    revalidatePath(`/consignees/${consigneeId}`, "page");

    return { kind: "success", message: "Driver note saved." };
  } catch (err) {
    return mapErrorToResult(err, "Task");
  }
}


// -----------------------------------------------------------------------------
// Action 8 — Fetch task timeline (read-only, drawer)
// -----------------------------------------------------------------------------
//
// Lightweight server-action wrapper so the timeline drawer (client
// component) can fetch on open without a separate route handler. Per
// R-4 read-not-audited convention, no audit emit; the service-layer
// `getTaskTimeline` is the permission gate.

export type GetTaskTimelineActionResult =
  | { readonly kind: "success"; readonly timeline: TaskTimeline }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string };

export async function getTaskTimelineAction(
  consigneeId: string,
  taskId: string,
): Promise<GetTaskTimelineActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const timeline = await getTaskTimeline(ctx, taskId as Uuid);
    return { kind: "success", timeline };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to view the task timeline.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Task not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    throw err;
  }
}
