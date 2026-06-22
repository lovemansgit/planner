// Item 2 (22 Jun 2026) — pure helpers for the user-edit surface.
//
// Role options are tenant-shaped: the Transcorp home tenant takes only
// `transcorp-sysadmin`; merchant tenants take `tenant-admin` or
// `ops-manager` (mirrors the create form + the service-layer
// role/tenant compatibility check). Kept here, separate from the React
// form + the "use server" action, so the option set + the form parser
// are unit-tested without rendering or dragging the service chain.

import type { BuiltInRoleSlug } from "@/modules/identity/roles";

export const TRANSCORP_TENANT_SLUG = "transcorp";

export interface RoleOption {
  readonly slug: BuiltInRoleSlug;
  readonly label: string;
}

const TRANSCORP_ROLE_OPTIONS: readonly RoleOption[] = [
  { slug: "transcorp-sysadmin", label: "Transcorp Sysadmin" },
];

const MERCHANT_ROLE_OPTIONS: readonly RoleOption[] = [
  { slug: "tenant-admin", label: "Tenant Admin" },
  { slug: "ops-manager", label: "Ops Manager" },
];

/**
 * The roles assignable to a user, by the tenant they belong to. The
 * `transcorp` slug is the internal home tenant; everything else is a
 * merchant. Matches `runChangeUserRole`'s server-side allowlist so the
 * dropdown never offers a role the service would reject.
 */
export function roleOptionsForTenant(tenantSlug: string): readonly RoleOption[] {
  return tenantSlug === TRANSCORP_TENANT_SLUG
    ? TRANSCORP_ROLE_OPTIONS
    : MERCHANT_ROLE_OPTIONS;
}

export interface ParsedUserEdit {
  /** Trimmed full name; empty → null (clears it). */
  readonly displayName: string | null;
  readonly roleSlug: BuiltInRoleSlug;
}

export type ParseUserEditResult =
  | { readonly ok: true; readonly value: ParsedUserEdit }
  | { readonly ok: false; readonly message: string };

/**
 * Parse + validate the edit form. `allowedRoleSlugs` is the tenant's
 * option set (server is authority — the action recomputes it from the
 * persisted tenant, never trusting a client-submitted tenant). Name is
 * trimmed; all-whitespace clears to null; >200 chars is rejected. An
 * out-of-set role slug is rejected so a hand-forged POST can't assign a
 * role the tenant can't hold.
 */
export function parseUserEditForm(
  formData: FormData,
  allowedRoleSlugs: readonly string[],
): ParseUserEditResult {
  const rawName = formData.get("displayName");
  const displayNameRaw = typeof rawName === "string" ? rawName.trim() : "";
  if (displayNameRaw.length > 200) {
    return { ok: false, message: "Full name must be 200 characters or fewer." };
  }
  const displayName = displayNameRaw.length > 0 ? displayNameRaw : null;

  const rawRole = formData.get("roleSlug");
  const roleSlug = typeof rawRole === "string" ? rawRole : "";
  if (!allowedRoleSlugs.includes(roleSlug)) {
    return { ok: false, message: "Select a valid role for this tenant." };
  }

  return { ok: true, value: { displayName, roleSlug: roleSlug as BuiltInRoleSlug } };
}
