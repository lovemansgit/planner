// Day-24 — Server actions for /admin/users/new.
//
// Reads FormData, validates server-side, calls createUser then
// createRoleAssignment, and either returns a typed error variant
// (for inline form display) or redirects to /admin/users?created=1
// for a Toast on landing.
//
// Wraps two distinct service-layer writes in one form action so the
// operator UX is "fill the form, click submit, user is provisioned"
// rather than "create then assign role in a second step." A
// failure in createRoleAssignment after a successful createUser
// leaves an orphaned-without-roles mirror row; that's an operationally
// recoverable state (operator can re-issue the role assignment via a
// future Edit user surface in Phase 1.5) and is logged via the
// `user.created` audit event without a corresponding
// `role_assignment.created` event.

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import {
  createRoleAssignment,
  createUser,
} from "@/modules/identity/service";
import type { BuiltInRoleSlug } from "@/modules/identity/roles";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export type CreateUserActionResult =
  | { readonly kind: "idle" }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

const ALLOWED_ROLE_SLUGS: readonly BuiltInRoleSlug[] = [
  "transcorp-sysadmin",
  "tenant-admin",
  "ops-manager",
];

function parseRoleSlug(raw: FormDataEntryValue | null): BuiltInRoleSlug | null {
  if (typeof raw !== "string") return null;
  if ((ALLOWED_ROLE_SLUGS as readonly string[]).includes(raw)) {
    return raw as BuiltInRoleSlug;
  }
  return null;
}

export async function createUserAction(
  _prevState: CreateUserActionResult,
  formData: FormData,
): Promise<CreateUserActionResult> {
  const requestId = randomUUID();

  const email = (formData.get("email") as string | null)?.trim() ?? "";
  const password = (formData.get("password") as string | null) ?? "";
  const fullName = ((formData.get("fullName") as string | null) ?? "").trim();
  const tenantId = (formData.get("tenantId") as string | null) ?? "";
  const roleSlug = parseRoleSlug(formData.get("roleSlug"));

  if (!email || !password || !tenantId || !roleSlug) {
    return {
      kind: "validation",
      message: "Email, password, tenant and role are all required.",
    };
  }

  try {
    const ctx = await buildRequestContext("/admin/users/new", requestId);
    const { userId } = await createUser(ctx, {
      email,
      password,
      fullName,
      tenantId: tenantId as Uuid,
    });
    await createRoleAssignment(ctx, {
      userId,
      roleSlug,
      tenantId: tenantId as Uuid,
    });
    revalidatePath("/admin/users", "page");
  } catch (err) {
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to create users.",
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

  redirect("/admin/users?created=1");
}
