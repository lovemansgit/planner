// Item 2 (22 Jun 2026) — server action for /admin/users/[id]/edit.
//
// Reads FormData, resolves the persisted user (so the tenant — and thus
// the allowed role set — comes from the database, never from a
// client-submitted value), then writes the display name and swaps the
// role. Two service writes behind one submit: updateUser (name) then
// changeUserRole (role; a no-op when unchanged). A failure in
// changeUserRole after a successful updateUser leaves the name persisted
// and the role unchanged — operationally recoverable (re-submit), and
// the typed error surfaces inline. Mirrors the create action's
// two-write-one-submit posture.
//
// Tenant is intentionally NOT editable here. Love ruled (22 Jun 2026)
// that re-homing a user across merchants is OUT OF SCOPE — a user for a
// different merchant is always a NEW user, never moved (moving would
// re-parent tenant-scoped role assignments and touch the C-21 invariant
// on two tenants). The UI directs the operator to create a new user.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import {
  changeUserRole,
  getUserById,
  updateUser,
} from "@/modules/identity/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { parseUserEditForm, roleOptionsForTenant } from "./_helpers";

export type UpdateUserActionResult =
  | { readonly kind: "idle" }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function updateUserAction(
  userId: string,
  _prevState: UpdateUserActionResult,
  formData: FormData,
): Promise<UpdateUserActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext(`/admin/users/${userId}/edit`, requestId);

    // Resolve the persisted user → its tenant is the authority for the
    // allowed role set. getUserById also enforces Item 1 (a test-tenant
    // user is invisible here too).
    const user = await getUserById(ctx, userId as Uuid);
    if (user === null) {
      return { kind: "not_found", message: "User not found." };
    }

    const allowed = roleOptionsForTenant(user.tenantSlug).map((r) => r.slug);
    const parsed = parseUserEditForm(formData, allowed);
    if (!parsed.ok) {
      return { kind: "validation", message: parsed.message };
    }

    await updateUser(ctx, {
      userId: userId as Uuid,
      displayName: parsed.value.displayName,
    });
    await changeUserRole(ctx, {
      userId: userId as Uuid,
      roleSlug: parsed.value.roleSlug,
    });

    revalidatePath(`/admin/users/${userId}`, "page");
    revalidatePath("/admin/users", "page");
  } catch (err) {
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to edit this user.",
      };
    }
    if (err instanceof ConflictError) {
      return { kind: "conflict", message: err.message };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: err.message };
    }
    throw err;
  }

  redirect(`/admin/users/${userId}`);
}
