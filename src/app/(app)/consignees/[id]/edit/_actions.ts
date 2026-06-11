// Day 22 / Phase 1 forms lane — edit-consignee server action.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { updateConsignee } from "@/modules/consignees";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { parseEditConsigneeForm } from "./_helpers";

export type EditConsigneeActionResult =
  | { readonly kind: "updated"; readonly consigneeId: string }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function editConsigneeAction(
  consigneeId: string,
  _prevState: EditConsigneeActionResult | { kind: "idle" },
  formData: FormData,
): Promise<EditConsigneeActionResult> {
  const requestId = randomUUID();
  const parsed = parseEditConsigneeForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext(
      `/consignees/${consigneeId}/edit`,
      requestId,
    );
    await updateConsignee(ctx, consigneeId as Uuid, parsed.value);
    revalidatePath(`/consignees/${consigneeId}`, "page");
    revalidatePath("/consignees", "page");
    return { kind: "updated", consigneeId };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to edit consignees.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Consignee not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", fieldErrors: { _form: err.message } };
    }
    throw err;
  }
}
