// F6 — Server action for the /admin/subscriptions manual-materialization
// trigger. Mirrors the /admin/users action shape: typed discriminated
// union for inline rendering by the row button. Service-layer permission
// enforcement (triggerManualMaterialization) is the authority — every
// error kind maps from a typed AppError subclass it throws.

"use server";

import { randomUUID } from "node:crypto";

import { triggerManualMaterialization } from "@/modules/subscriptions/service";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export type MaterializeActionResult =
  | { readonly kind: "idle" }
  | { readonly kind: "done"; readonly newCount: number; readonly failedCount: number }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/**
 * Bound at the trigger-button render site with the target subscriptionId.
 * No-payload action (no form fields) — the subscription id is the only
 * input and it is bound, not posted.
 */
export async function triggerMaterializationAction(
  subscriptionId: string,
  _prevState: MaterializeActionResult,
  _formData: FormData,
): Promise<MaterializeActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/admin/subscriptions", requestId);
    const result = await triggerManualMaterialization(ctx, {
      subscriptionId: subscriptionId as Uuid,
    });
    return {
      kind: "done",
      newCount: result.newInsertedTaskCount,
      failedCount: result.addressResolutionFailedCount,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to materialize this subscription.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: err.message };
    }
    return {
      kind: "error",
      message:
        err instanceof Error
          ? `Unexpected error: ${err.message}`
          : "Unexpected error.",
    };
  }
}
