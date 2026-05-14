// Day 26 / T3 Sub-PR 3 — SuiteFleet regions admin server actions.
//
// Wraps the credentials/service.ts region surface (createRegion +
// deactivateRegion) with form-state semantics for the /admin/regions
// pages. On success, revalidatePath flushes the list page so the table
// reflects the new state immediately.
//
// Permission enforcement is service-layer (every region service fn
// calls requirePermission("region:manage") internally); ForbiddenError
// surfaces here as a `forbidden` result kind, which the client component
// renders inline.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { createRegion, deactivateRegion } from "@/modules/credentials";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { parseCreateRegionForm } from "./_helpers";

// -----------------------------------------------------------------------------
// Create region
// -----------------------------------------------------------------------------

export type CreateRegionActionResult =
  | { readonly kind: "created"; readonly regionId: string }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string };

export async function createRegionAction(
  _prevState: CreateRegionActionResult | { kind: "idle" },
  formData: FormData,
): Promise<CreateRegionActionResult> {
  const requestId = randomUUID();
  const parsed = parseCreateRegionForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext("/admin/regions/new", requestId);
    const result = await createRegion(ctx, {
      clientId: parsed.value.clientId,
      displayName: parsed.value.displayName,
      authMethod: parsed.value.authMethod,
    });
    revalidatePath("/admin/regions", "page");
    return { kind: "created", regionId: result.regionId };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to create regions.",
      };
    }
    if (err instanceof ValidationError) {
      // Service-side validation (e.g., empty trimmed display_name).
      // Surface as combined _form error so it's visible.
      return {
        kind: "validation",
        fieldErrors: { _form: err.message },
      };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Deactivate region
// -----------------------------------------------------------------------------

export type DeactivateRegionActionResult =
  | { readonly kind: "deactivated"; readonly regionId: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function deactivateRegionAction(
  regionId: string,
  _prevState: DeactivateRegionActionResult | { kind: "idle" },
  _formData: FormData,
): Promise<DeactivateRegionActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext(`/admin/regions/${regionId}`, requestId);
    const result = await deactivateRegion(ctx, regionId as Uuid);
    revalidatePath("/admin/regions", "page");
    revalidatePath(`/admin/regions/${regionId}`, "page");
    return { kind: "deactivated", regionId: result.regionId };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to deactivate regions.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Region not found." };
    }
    throw err;
  }
}
