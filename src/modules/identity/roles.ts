// Built-in role definitions and their permission sets.
//
// Per resolutions R-1 and §6 of the Day-2 morning brief, role-to-permission
// mapping is code, not data. Adding or revoking a permission from a role is
// a PR — visible, reviewable, audit-trailed in git — never a runtime mutation.
// Custom roles (post-pilot per plan §13.1) will live in the `roles` table
// with `tenant_id = <tenant>`; their permission sets are stored as a column
// on those rows. The five built-in roles below carry `tenant_id IS NULL` in
// the database (per migration 0001) and seed via the C-21 commit's seed
// migration.
//
// Slug discipline: the `slug` field MUST match the `slug` column in the
// roles table verbatim. The C-21 invariant in the identity service layer
// looks up "tenant-admin" by slug — so renaming the slug here without also
// updating the seed and the C-21 enforcement code would silently break the
// invariant. The `tenantAdminSlugIsKnown` invariant test guards against a
// rename without a coordinated update.

import { type PermissionId, PERMISSIONS, SYSTEM_ONLY_PERMISSIONS } from "./permissions";

export interface RoleDef {
  /** Matches the `slug` column on the roles table. Stable identifier. */
  readonly slug: string;
  /** Human-friendly name. Shown in the admin UI. */
  readonly name: string;
  /** One-paragraph description for the role-picker UI. */
  readonly description: string;
  /**
   * If true, this role is granted to Transcorp staff actors only — it must
   * never be visible in the tenant-facing role picker. Built-in tenant
   * roles (Tenant Admin, Ops Manager, CS Agent) are systemOnly=false.
   */
  readonly systemOnly: boolean;
  /** Permission ids granted by this role. */
  readonly permissions: ReadonlySet<PermissionId>;
}

// -----------------------------------------------------------------------------
// Helpers for building permission sets
// -----------------------------------------------------------------------------

/** Every permission id in the catalogue (frozen). */
const ALL: readonly PermissionId[] = Object.freeze(Object.keys(PERMISSIONS) as PermissionId[]);

/** Filter: every non-systemOnly permission. */
const TENANT_SCOPED: readonly PermissionId[] = ALL.filter((id) => !SYSTEM_ONLY_PERMISSIONS.has(id));

/** Filter: every permission whose resource matches `resource`. */
function permsFor(resource: string): readonly PermissionId[] {
  return ALL.filter((id) => PERMISSIONS[id].resource === resource);
}

// -----------------------------------------------------------------------------
// The five built-in roles
// -----------------------------------------------------------------------------

const ROLES_DRAFT = {
  /**
   * Full tenant-scoped admin. Holds every non-systemOnly permission. The
   * §6 brief specifies all four bulk-import perms; in practice this means
   * "everything tenant-side." Specifically does NOT hold tenant.migration_*
   * permissions — those are systemOnly so a Tenant Admin cannot self-trigger
   * a migration import without Transcorp Systems Team having first set the
   * cleanup gate.
   *
   * C-21 invariant ("at least one Tenant Admin per tenant") references this
   * role by slug. Do not rename `tenant-admin` without coordinating with
   * the C-21 enforcement in the identity service layer.
   */
  "tenant-admin": {
    slug: "tenant-admin",
    name: "Tenant Admin",
    description:
      "Full administrative access within the tenant: users, roles, consignees, subscriptions, tasks, API keys. Cannot trigger migration imports — those require Transcorp staff coordination.",
    systemOnly: false,
    permissions: new Set<PermissionId>(TENANT_SCOPED),
  },

  /**
   * Day-to-day operations. Manages consignees and subscriptions including
   * bulk imports for ongoing self-serve flows. Does NOT manage users, roles,
   * or API keys — that's Tenant Admin's surface. Read-only on audit log.
   */
  "ops-manager": {
    slug: "ops-manager",
    name: "Ops Manager",
    description:
      "Operational management of consignees, subscriptions, and tasks. Includes bulk CSV imports for ongoing onboarding. No user / role / API-key administration. Holds migration_gate_get + migration_gate_check so the cut-over UI can render readiness, but NOT migration_gate_set (that stays Transcorp-staff-only).",
    systemOnly: false,
    permissions: new Set<PermissionId>([
      "tenant:read",
      "tenant:migration_gate_get",
      "tenant:migration_gate_check",
      ...permsFor("consignee"), // includes bulk_create
      ...permsFor("subscription"), // includes bulk_create
      ...permsFor("task"),
      "audit_event:read",
      // Day 9 / P4a — webhook configuration page visibility. Operational
      // debugging concern (is the webhook firing? are credentials drifting?)
      // belongs to OM same as TA. Explicit add because ops-manager doesn't
      // auto-pickup tenant/webhook_config-resource perms.
      "webhook_config:read",
    ]),
  },

  /**
   * Customer-support read-mostly. Can edit individual consignees and read
   * subscriptions/tasks for issue investigation. No bulk operations, no
   * destructive deletes outside of consignee:delete (kept because CS owns
   * de-duplication and bad-data cleanup at the row level — bulk_create is
   * what's gated, not single-row mutation).
   */
  "cs-agent": {
    slug: "cs-agent",
    name: "CS Agent",
    description:
      "Customer-support read-mostly access: edit individual consignees, view subscriptions and tasks for case investigation. No bulk operations, no admin surface.",
    systemOnly: false,
    permissions: new Set<PermissionId>([
      "tenant:read",
      "consignee:read",
      "consignee:update",
      "consignee:delete",
      "subscription:read",
      "task:read",
      // Day 8 / D8-6 — CS Agent's hand-rolled list mirrors the
      // "every role with task:read also grants task:print_labels"
      // intent. Without this explicit add, CS Agent would see tasks
      // but not be able to print their labels — operationally wrong
      // for support investigations where they need the AWB sheet.
      "task:print_labels",
      "audit_event:read",
    ]),
  },

  /**
   * Transcorp Systems Team — the operators who clear merchants' pre-existing
   * future-dated tasks from SuiteFleet before a migration cut-over. Their
   * scope is intentionally narrow: they hold `tenant:migration_gate_set`
   * (mark cleanup complete) but NOT `tenant:migration_import` itself. The
   * import is triggered by a separate Transcorp role or system actor only
   * after the gate is set. Two-person rule by permission split.
   *
   * systemOnly: hidden from tenant-facing UIs. Granted to Transcorp staff
   * via internal tooling, never via tenant admin UI.
   */
  "transcorp-systems": {
    slug: "transcorp-systems",
    name: "Transcorp Systems Team",
    description:
      "Transcorp staff that prepares merchants for migration cut-over. Marks the migration gate complete after clearing pre-existing future-dated tasks from SuiteFleet. Cannot run the import itself.",
    systemOnly: true,
    permissions: new Set<PermissionId>([
      "tenant:read",
      "tenant:migration_gate_set",
      "tenant:migration_gate_get",
      "tenant:migration_gate_check",
      "audit_event:read",
    ]),
  },

  /**
   * Transcorp Sysadmin — the highest-privilege Transcorp role. Holds every
   * permission, including both systemOnly migration permissions. Used for
   * incident response, cross-tenant operations, and the migration import
   * trigger itself (paired with Transcorp Systems Team's gate-set per the
   * two-person rule above).
   *
   * systemOnly: never granted to merchants. Granted to a small set of
   * named Transcorp engineers, audited via the audit log.
   */
  "transcorp-sysadmin": {
    slug: "transcorp-sysadmin",
    name: "Transcorp Sysadmin",
    description:
      "Transcorp engineering staff. Full cross-tenant access including migration import. Highest-privilege role. Use is logged in the audit trail under actor_kind='user' with the staff member's user id.",
    systemOnly: true,
    permissions: new Set<PermissionId>(ALL),
  },
} as const satisfies Record<string, RoleDef>;

/**
 * Frozen role catalogue. Maps role slug to its definition. Module-import
 * freezes the object so no consumer can mutate it.
 */
export const ROLES = Object.freeze(ROLES_DRAFT);

/** Stable union of built-in role slugs. */
export type BuiltInRoleSlug = keyof typeof ROLES;

/** Iteration order matches declaration order above. */
export const ALL_ROLE_SLUGS: readonly BuiltInRoleSlug[] = Object.freeze(
  Object.keys(ROLES) as BuiltInRoleSlug[]
);

/**
 * The slug C-21 enforcement looks up. Centralized here so a future rename
 * is a single-touch change with type-system support; the
 * `tenantAdminSlugIsKnown` invariant test catches drift if anyone forgets.
 */
export const TENANT_ADMIN_ROLE_SLUG: BuiltInRoleSlug = "tenant-admin";
