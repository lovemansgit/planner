// Day 17 / Session A — CRM state change server action.
//
// Wraps the existing `changeConsigneeCrmState` service-layer fn (from
// PR #160) with form-state semantics. The CrmStateModal client
// component binds to this action via React's useActionState so the
// modal renders typed result variants (updated / no_op / errors)
// without round-tripping through fetch.
//
// On success: revalidatePath flushes the consignee detail page (header
// badge + History tab) AND the list page (badge column). The two
// surfaces share state via the consignee row, so both revalidations
// are required for a coherent UI after transition.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import {
  changeConsigneeCrmState,
  type ConsigneeCrmState,
} from "@/modules/consignees";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

/**
 * Discriminated-union result for the modal to render. `kind` mirrors
 * the service's status field for the success path + adds error
 * variants the modal renders inline. Audit-grade error mapping happens
 * here so the client component never needs to inspect AppError
 * instances directly.
 */
export type ChangeCrmStateActionResult =
  | { readonly kind: "updated"; readonly fromState: string; readonly toState: string; readonly eventId: string }
  | { readonly kind: "no_op"; readonly fromState: string; readonly toState: string }
  | { readonly kind: "invalid_transition"; readonly message: string }
  | { readonly kind: "reactivation_keyword_required"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string };

/** The six CRM states; mirrored from migration 0016 + brief §3.1.1. */
const ALL_STATES: readonly ConsigneeCrmState[] = [
  "ACTIVE",
  "ON_HOLD",
  "HIGH_RISK",
  "INACTIVE",
  "CHURNED",
  "SUBSCRIPTION_ENDED",
] as const;

function parseToState(raw: FormDataEntryValue | null): ConsigneeCrmState | null {
  if (typeof raw !== "string") return null;
  return (ALL_STATES as readonly string[]).includes(raw)
    ? (raw as ConsigneeCrmState)
    : null;
}

/**
 * Server action invoked by the CrmStateModal form. Bound with the
 * consignee id via .bind(null, id) at the component layer; the
 * remaining params are React's useActionState contract:
 * (prevState, formData) → newState.
 *
 * The first param is React's prevState placeholder; we don't use it
 * (each invocation is independent), but the contract requires the
 * shape.
 */
export async function changeCrmStateAction(
  consigneeId: string,
  _prevState: ChangeCrmStateActionResult | { kind: "idle" },
  formData: FormData,
): Promise<ChangeCrmStateActionResult> {
  const requestId = randomUUID();
  const toState = parseToState(formData.get("to_state"));
  const reasonRaw = formData.get("reason");
  const reason = typeof reasonRaw === "string" ? reasonRaw : "";

  if (toState === null) {
    return {
      kind: "validation",
      message: "Pick a target state.",
    };
  }
  if (reason.trim().length === 0) {
    return {
      kind: "validation",
      message: "Reason is required.",
    };
  }

  try {
    const ctx = await buildRequestContext(
      `/consignees/${consigneeId}`,
      requestId,
    );
    const result = await changeConsigneeCrmState(ctx, consigneeId as Uuid, {
      toState,
      reason,
    });

    if (result.status === "updated") {
      // Revalidate both surfaces — detail page (header badge +
      // History tab) AND list page (badge column).
      revalidatePath(`/consignees/${consigneeId}`, "page");
      revalidatePath("/consignees", "page");
      return {
        kind: "updated",
        fromState: result.fromState,
        toState: result.toState,
        eventId: result.eventId,
      };
    }
    // status === "no_op" — no DB change; no revalidation needed.
    return {
      kind: "no_op",
      fromState: result.fromState,
      toState: result.toState,
    };
  } catch (err) {
    if (err instanceof ConflictError) {
      // Service throws ConflictError for both invalid_transition and
      // reactivation_keyword_required. Distinguish via the error
      // message (which carries the reactivation-specific phrase).
      if (err.message.toLowerCase().includes("reactivation")) {
        return { kind: "reactivation_keyword_required", message: err.message };
      }
      return { kind: "invalid_transition", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return { kind: "forbidden", message: "You don't have permission to change CRM state." };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Consignee not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    // Unknown error — re-throw so Next.js surfaces a 500 / error
    // boundary. Stringifying could leak internal detail.
    throw err;
  }
}
