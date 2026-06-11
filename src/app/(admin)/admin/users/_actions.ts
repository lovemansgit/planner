// Day-24 — Server actions for /admin/users row-level disable / enable.
//
// Mirrors the (admin)/admin/merchants/_actions.ts shape: typed
// discriminated-union result for inline rendering by the modal /
// row-button client components. revalidatePath flushes the list view
// after each successful mutation so the Status column reflects the
// new state on next render.
//
// Service-layer permission enforcement is the authority — every error
// kind below maps from a typed AppError subclass thrown by
// disableUser / enableUser in src/modules/identity/service.ts.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { disableUser, enableUser } from "@/modules/identity/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export type UserStatusActionResult =
  | { readonly kind: "idle" }
  | { readonly kind: "disabled"; readonly userId: string }
  | { readonly kind: "enabled"; readonly userId: string }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

/**
 * Bound at the trigger-button render site with the target userId so
 * the form posts an empty payload aside from the optional `reason`
 * text input.
 */
export async function disableUserAction(
  userId: string,
  _prevState: UserStatusActionResult,
  formData: FormData,
): Promise<UserStatusActionResult> {
  const requestId = randomUUID();
  const rawReason = (formData.get("reason") as string | null) ?? "";
  const reason = rawReason.trim().length > 0 ? rawReason.trim() : undefined;
  try {
    const ctx = await buildRequestContext("/admin/users", requestId);
    await disableUser(ctx, { userId: userId as Uuid, reason });
    revalidatePath("/admin/users", "page");
    return { kind: "disabled", userId };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * No-payload action — triggered directly from a row button on the
 * list page (per brief, Enable has no confirmation modal because it
 * is the less-destructive direction of the pair).
 */
export async function enableUserAction(
  userId: string,
  _prevState: UserStatusActionResult,
  _formData: FormData,
): Promise<UserStatusActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/admin/users", requestId);
    await enableUser(ctx, { userId: userId as Uuid });
    revalidatePath("/admin/users", "page");
    return { kind: "enabled", userId };
  } catch (err) {
    return mapError(err);
  }
}

function mapError(err: unknown): UserStatusActionResult {
  if (err instanceof ValidationError) {
    return { kind: "validation", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return {
      kind: "forbidden",
      message: "You don't have permission to change this user's login status.",
    };
  }
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof NotFoundError) {
    return { kind: "not_found", message: err.message };
  }
  // Unknown error — surface a clean conflict variant so the modal /
  // row button renders a visible message rather than throwing to the
  // Next.js error boundary. Matches the PR #259 Defect-2 lesson:
  // operators need visibility into the failure even when the root
  // cause is upstream (env-var drift, SDK failure, etc.).
  return {
    kind: "conflict",
    message:
      err instanceof Error
        ? `Unexpected error: ${err.message}`
        : "Unexpected error.",
  };
}
