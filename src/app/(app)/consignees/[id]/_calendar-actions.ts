// Day 17 / Session A — calendar Week view server actions.
//
// Composes against the existing service-layer fns from PR #160
// (Block 4-A subscription exceptions). Each action wraps a service
// call with form-state semantics for the DayActionPopover client
// component to consume via React's useActionState.
//
// Scope-locked per Day-17 reviewer ruling: ONLY skip-default action
// is wired in this PR. Six other actions (target_date_override,
// skip-without-append, pause, address one-off, address forward,
// cancel) are deferred per
// `memory/followup_calendar_popover_action_expansion.md`.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { addSubscriptionException } from "@/modules/subscription-exceptions";
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
