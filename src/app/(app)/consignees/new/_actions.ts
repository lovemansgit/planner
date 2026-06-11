// Day-25 / brief v1.12 §3.3.1 — flat consignee form server action.
//
// Replaces the v1.11 wizard's onboardConsigneeAction. The flat form
// captures identity + primary address only; subscription creation
// moves to its own surface (Overview-tab CTA → /subscriptions/new).
//
// Wraps the new `createConsignee` service (consignees/service.ts) which
// writes consignees + primary addresses atomically inside one
// withTenant tx. Returns discriminated-union result the form renders
// inline.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { createConsignee } from "@/modules/consignees";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { parseConsigneeForm } from "./_helpers";

export type CreateConsigneeActionResult =
  | { readonly kind: "created"; readonly consigneeId: string }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "internal_error"; readonly message: string };

export async function createConsigneeAction(
  _prevState: CreateConsigneeActionResult | { kind: "idle" },
  formData: FormData,
): Promise<CreateConsigneeActionResult> {
  const requestId = randomUUID();
  const parsed = parseConsigneeForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext("/consignees/new", requestId);
    const created = await createConsignee(ctx, parsed.value);
    revalidatePath("/consignees", "page");
    revalidatePath(`/consignees/${created.id}`, "page");
    return { kind: "created", consigneeId: created.id };
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
      return {
        kind: "validation",
        fieldErrors: { _form: err.message },
      };
    }
    console.error("[createConsigneeAction] unknown error:", err);
    return {
      kind: "internal_error",
      message:
        "Something went wrong creating the consignee. Please try again or contact ops if this persists.",
    };
  }
}
