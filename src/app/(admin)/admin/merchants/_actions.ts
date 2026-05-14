// Day 18 / C1 — Transcorp-staff merchant lifecycle server actions.
//
// Wraps the existing merchants/service.ts surface (createMerchant,
// activateMerchant, deactivateMerchant) with form-state semantics so
// the (admin)/merchants client surfaces (MerchantStatusModal +
// /merchants/new create form) can bind via React's useActionState.
//
// On success: revalidatePath flushes the list page so the table
// reflects the new state immediately. The list is the only
// merchant-data surface today.
//
// Permission enforcement is service-layer-only per the registered
// Phase-2 deferral (memory/followup_admin_middleware_phase2.md);
// each service fn calls requirePermission on the relevant
// merchant:* permission and ForbiddenError surfaces here as a
// `forbidden` result kind, which the client component renders inline.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import {
  activateMerchant,
  createMerchant,
  deactivateMerchant,
  updateMerchant,
} from "@/modules/merchants/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { parseCreateMerchantForm, parseEditMerchantForm } from "./_helpers";

// -----------------------------------------------------------------------------
// Activate / deactivate (status modal)
// -----------------------------------------------------------------------------

/**
 * Result variants for the status modal. `kind` discriminates success
 * (status flip applied) from each error class so the modal can render
 * inline without inspecting AppError instances.
 */
export type StatusActionResult =
  | { readonly kind: "activated"; readonly tenantId: string }
  | { readonly kind: "deactivated"; readonly tenantId: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string };

export async function activateMerchantAction(
  tenantId: string,
  _prevState: StatusActionResult | { kind: "idle" },
  _formData: FormData,
): Promise<StatusActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/admin/merchants", requestId);
    const result = await activateMerchant(ctx, tenantId as Uuid);
    revalidatePath("/admin/merchants", "page");
    return { kind: "activated", tenantId: result.tenantId };
  } catch (err) {
    return mapStatusError(err);
  }
}

export async function deactivateMerchantAction(
  tenantId: string,
  _prevState: StatusActionResult | { kind: "idle" },
  _formData: FormData,
): Promise<StatusActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/admin/merchants", requestId);
    const result = await deactivateMerchant(ctx, tenantId as Uuid);
    revalidatePath("/admin/merchants", "page");
    return { kind: "deactivated", tenantId: result.tenantId };
  } catch (err) {
    return mapStatusError(err);
  }
}

function mapStatusError(err: unknown): StatusActionResult {
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return {
      kind: "forbidden",
      message: "You don't have permission to change merchant status.",
    };
  }
  if (err instanceof NotFoundError) {
    return { kind: "not_found", message: "Merchant not found." };
  }
  if (err instanceof ValidationError) {
    return { kind: "validation", message: err.message };
  }
  throw err;
}

// -----------------------------------------------------------------------------
// Create (new merchant form)
// -----------------------------------------------------------------------------

export type CreateActionResult =
  | { readonly kind: "created"; readonly tenantId: string }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string };

export async function createMerchantAction(
  _prevState: CreateActionResult | { kind: "idle" },
  formData: FormData,
): Promise<CreateActionResult> {
  const requestId = randomUUID();
  const parsed = parseCreateMerchantForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext("/admin/merchants/new", requestId);
    const result = await createMerchant(ctx, {
      name: parsed.value.name,
      slug: parsed.value.slug,
      pickupAddress: {
        line: parsed.value.line,
        district: parsed.value.district,
        emirate: parsed.value.emirate,
      },
      suitefleetCustomerCode: parsed.value.suitefleetCustomerCode,
    });
    revalidatePath("/admin/merchants", "page");
    return { kind: "created", tenantId: result.tenantId };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to create merchants.",
      };
    }
    if (err instanceof ValidationError) {
      // Service-side validation differs from client-side (e.g.,
      // unicode-tricky names that pass our trim-only check).
      // Surface as a single combined error on `name` so it's visible.
      return {
        kind: "validation",
        fieldErrors: { _form: err.message },
      };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Update (edit merchant form) — Day 25 / T3
// -----------------------------------------------------------------------------

/**
 * Result variants for the edit-merchant form. Mirrors
 * `CreateActionResult` shape with an additional `not_found` variant
 * (the merchant could be archived/deleted between page load and submit
 * — surfaces as inline error + nudge to return to list).
 */
export type UpdateActionResult =
  | {
      readonly kind: "updated";
      readonly tenantId: string;
      readonly changedFields: readonly string[];
    }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function updateMerchantAction(
  tenantId: string,
  _prevState: UpdateActionResult | { kind: "idle" },
  formData: FormData,
): Promise<UpdateActionResult> {
  const requestId = randomUUID();
  const parsed = parseEditMerchantForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext(
      `/admin/merchants/${tenantId}/edit`,
      requestId,
    );
    const result = await updateMerchant(ctx, tenantId as Uuid, {
      name: parsed.value.name,
      pickupAddress: parsed.value.pickupAddress,
      suitefleetCustomerCode: parsed.value.suitefleetCustomerCode,
      suitefleetRegionId: parsed.value.suitefleetRegionId as Uuid,
    });
    revalidatePath("/admin/merchants", "page");
    return {
      kind: "updated",
      tenantId: result.tenantId,
      changedFields: result.changedFields,
    };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to edit merchants.",
      };
    }
    if (err instanceof NotFoundError) {
      return {
        kind: "not_found",
        message: "Merchant not found. It may have been archived or deleted.",
      };
    }
    if (err instanceof ValidationError) {
      // Service-side validation surface (no-changes, length cap drift,
      // etc.) — single combined error on `_form`.
      return {
        kind: "validation",
        fieldErrors: { _form: err.message },
      };
    }
    throw err;
  }
}
