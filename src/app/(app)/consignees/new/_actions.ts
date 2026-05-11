// Day 22 / Phase 1 forms lane — onboard-consignee server action.
//
// Wraps `createConsigneeWithSubscription` (consignees/onboarding.ts)
// with form-state semantics. The OnboardConsigneeWizard client
// component binds via React's useActionState; the action returns a
// discriminated-union result the wizard renders inline.
//
// Pattern mirrors src/app/(admin)/admin/merchants/_actions.ts
// createMerchantAction:
//   - Parse + validate FormData via parseOnboardForm (helpers).
//   - Build RequestContext + call orchestration fn.
//   - Map AppError instances to typed result kinds.
//   - revalidatePath on success.
//
// On success: client component navigates to /consignees/[id] (the new
// consignee's detail page) — operator immediately sees the calendar
// view per brief §3.3.1 redirect target.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { createConsigneeWithSubscription } from "@/modules/consignees";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { parseOnboardForm } from "./_helpers";

/**
 * Discriminated-union result. `kind` mirrors the orchestration's
 * happy-path + error variants.
 */
export type OnboardConsigneeActionResult =
  | { readonly kind: "created"; readonly consigneeId: string; readonly subscriptionId: string }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "internal_error"; readonly message: string };

export async function onboardConsigneeAction(
  _prevState: OnboardConsigneeActionResult | { kind: "idle" },
  formData: FormData,
): Promise<OnboardConsigneeActionResult> {
  const requestId = randomUUID();
  const parsed = parseOnboardForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext("/consignees/new", requestId);
    const result = await createConsigneeWithSubscription(ctx, parsed.value);
    // Revalidate both the list (a new row appears) and the new
    // detail page (preempts an empty-data fetch on first navigation).
    revalidatePath("/consignees", "page");
    revalidatePath(`/consignees/${result.consignee.id}`, "page");
    return {
      kind: "created",
      consigneeId: result.consignee.id,
      subscriptionId: result.subscription.id,
    };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to onboard consignees.",
      };
    }
    if (err instanceof ValidationError) {
      // Service-layer validation differs from client-side (e.g. phone
      // shapes that pass the +/digit check but fail normaliseToE164's
      // stricter parser). Surface as a single combined error in the
      // form-level slot so it's visible regardless of which step the
      // operator stopped on.
      return {
        kind: "validation",
        fieldErrors: { _form: err.message },
      };
    }
    // Unknown error — surface a generic operator-facing banner and log
    // the underlying error to Vercel function logs for ops debugging.
    // Avoids the Vercel generic 500 page (mid-flow operators lose all
    // input on hard error, terrible demo UX).
    console.error("[onboardConsigneeAction] unknown error:", err);
    return {
      kind: "internal_error",
      message:
        "Something went wrong creating the consignee. Please try again or contact ops if this persists.",
    };
  }
}
