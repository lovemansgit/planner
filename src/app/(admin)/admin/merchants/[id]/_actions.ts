// F4 — Server action for the per-merchant asset-tracking gate toggle on
// the merchant detail page. Service-layer permission enforcement
// (setMerchantAssetTracking) is the authority; this maps its typed
// AppError subclasses to a discriminated-union result for inline
// rendering, and revalidates the detail page so the badge reflects the
// new gate state on re-render.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { setMerchantAssetTracking } from "@/modules/merchants/service";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export type AssetTrackingActionResult =
  | { readonly kind: "idle" }
  | { readonly kind: "done"; readonly enabled: boolean }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

/**
 * Bound at the trigger site with the target tenantId and the desired
 * next value (`nextEnabled = !current`). No form payload.
 */
export async function setAssetTrackingAction(
  tenantId: string,
  nextEnabled: boolean,
  _prevState: AssetTrackingActionResult,
  _formData: FormData,
): Promise<AssetTrackingActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext(
      `/admin/merchants/${tenantId}`,
      requestId,
    );
    const result = await setMerchantAssetTracking(ctx, {
      tenantId: tenantId as Uuid,
      enabled: nextEnabled,
    });
    revalidatePath(`/admin/merchants/${tenantId}`, "page");
    return { kind: "done", enabled: result.enabled };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to change asset tracking for this merchant.",
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
