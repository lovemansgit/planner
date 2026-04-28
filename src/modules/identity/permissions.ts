// Permission catalogue per resolutions R-1.
//
// This file IS the permission catalogue. Plan §7.3 + R-1 chose code over a
// `permissions` table because the catalogue is small, code-reviewed, and
// statically analyzable — adding a permission is a PR (visible, gated,
// audit-trailed in git), not a runtime mutation. There is no admin UI for
// "create a permission" and there will not be one before pilot.
//
// Identifier shape: `${resource}:${action}` per plan §7.3. The `:` separator
// is load-bearing as a surface marker — permission ids carry `:`, while
// audit event types in 0002_audit.sql carry `.` (e.g., `consignee.bulk_created`,
// past-tense). Different surfaces, different separators: at-a-glance you can
// tell whether a string is a permission check or an audit event without
// reading its context. Matches the `Permission` template type in
// `src/shared/types.ts`.
//
// Day-2 scope: the bulk-import perms from §6 of the morning brief are wired
// in alongside standard CRUD. Permissions for resources whose service code
// hasn't landed yet are still listed because (a) RBAC is a system-wide
// invariant — partial coverage means partial enforcement — and (b) the
// requirePermission middleware (R-2) needs a complete catalogue to validate
// against. Routes that don't exist yet simply never call the corresponding
// permission check; the catalogue entry is dormant until they do.

import type { Permission } from "@/shared/types";

/**
 * A single entry in the catalogue. The id duplicates the map key — by
 * design, so that array iteration over the catalogue carries the id without
 * a `.entries()` round-trip.
 */
export interface PermissionDef {
  /** Canonical `resource.action` identifier. Matches the map key. */
  readonly id: Permission;
  readonly resource: string;
  readonly action: string;
  /** One-line human-readable description for admin UIs and audit traces. */
  readonly description: string;
  /**
   * If true, this permission can only be granted to system actors —
   * Transcorp staff roles or cron / webhook contexts — never to a
   * tenant-controlled actor through any tenant-facing UI.
   *
   * Tenant Admin roles must NEVER include systemOnly permissions in their
   * permission set. The `systemOnlyPermissionsAreNotInTenantRoles` invariant
   * test enforces this.
   */
  readonly systemOnly: boolean;
}

// -----------------------------------------------------------------------------
// The catalogue
// -----------------------------------------------------------------------------
// Frozen-by-construction via `as const` + Object.freeze. Adding a permission
// is one entry here plus role-assignment updates in `roles.ts`.

const PERMISSIONS_DRAFT = {
  // ---- tenant ------------------------------------------------------------
  "tenant:read": {
    id: "tenant:read",
    resource: "tenant",
    action: "read",
    description: "View tenant settings and metadata.",
    systemOnly: false,
  },
  "tenant:update": {
    id: "tenant:update",
    resource: "tenant",
    action: "update",
    description: "Modify tenant settings (name, status, source-of-truth).",
    systemOnly: false,
  },
  "tenant:migration_import": {
    id: "tenant:migration_import",
    resource: "tenant",
    action: "migration_import",
    description:
      "Trigger the one-shot migration cut-over import. Gated on Transcorp Systems Team having cleared the merchant's pre-existing future-dated tasks from SuiteFleet (otherwise produces duplicate tasks). Tenant Admins MUST NOT self-trigger this.",
    systemOnly: true,
  },
  "tenant:migration_gate_set": {
    id: "tenant:migration_gate_set",
    resource: "tenant",
    action: "migration_gate_set",
    description:
      "Mark a tenant's SuiteFleet cleanup as complete, unblocking migration_import. Held by Transcorp Systems Team only.",
    systemOnly: true,
  },
  // Day 3 / C-6: read + check counterparts to migration_gate_set. Both
  // are intentionally NOT systemOnly — Tenant Admins need to see their
  // own gate state (so the UI can render readiness), and the migration
  // import code path needs an internal-callable check helper.
  "tenant:migration_gate_get": {
    id: "tenant:migration_gate_get",
    resource: "tenant",
    action: "migration_gate_get",
    description:
      "Read the migration gate state (status + when last set). Tenant Admins see status + set_at; sysadmin actors additionally see set_by.",
    systemOnly: false,
  },
  "tenant:migration_gate_check": {
    id: "tenant:migration_gate_check",
    resource: "tenant",
    action: "migration_gate_check",
    description:
      "Internal helper: returns whether the gate is open, ready for migration import. Held by Tenant Admin (so the UI can pre-check before allowing the click) and by the migration import system actor.",
    systemOnly: false,
  },

  // ---- user --------------------------------------------------------------
  "user:create": {
    id: "user:create",
    resource: "user",
    action: "create",
    description: "Invite a new user to the tenant.",
    systemOnly: false,
  },
  "user:read": {
    id: "user:read",
    resource: "user",
    action: "read",
    description: "View users and their role assignments.",
    systemOnly: false,
  },
  "user:update": {
    id: "user:update",
    resource: "user",
    action: "update",
    description: "Edit a user's display name or disable status.",
    systemOnly: false,
  },
  "user:delete": {
    id: "user:delete",
    resource: "user",
    action: "delete",
    description: "Remove a user from the tenant. Cascade-deletes their role assignments.",
    systemOnly: false,
  },

  // ---- role --------------------------------------------------------------
  // Pilot ships built-in roles only (per migration 0001 plus the seed migration
  // landing in C-21). Custom roles are post-pilot per plan §13.1, so role:create
  // / :update / :delete are present but unused at pilot — they exist so the
  // requirePermission middleware has a complete catalogue and so the permission
  // surface does not change shape when custom roles land.
  "role:create": {
    id: "role:create",
    resource: "role",
    action: "create",
    description: "Create a custom role within the tenant. Post-pilot.",
    systemOnly: false,
  },
  "role:read": {
    id: "role:read",
    resource: "role",
    action: "read",
    description: "View built-in and custom roles.",
    systemOnly: false,
  },
  "role:update": {
    id: "role:update",
    resource: "role",
    action: "update",
    description: "Edit a custom role's name or permission set. Post-pilot.",
    systemOnly: false,
  },
  "role:delete": {
    id: "role:delete",
    resource: "role",
    action: "delete",
    description: "Delete a custom role. Post-pilot.",
    systemOnly: false,
  },

  // ---- role_assignment ---------------------------------------------------
  // No `role_assignment:update` — assignments are immutable per plan §9.1
  // (delete + recreate to change). C-21 ("at least one Tenant Admin per
  // tenant") is enforced at the service layer, not in the catalogue.
  "role_assignment:create": {
    id: "role_assignment:create",
    resource: "role_assignment",
    action: "create",
    description: "Assign a role to a user.",
    systemOnly: false,
  },
  "role_assignment:read": {
    id: "role_assignment:read",
    resource: "role_assignment",
    action: "read",
    description: "View role assignments.",
    systemOnly: false,
  },
  "role_assignment:delete": {
    id: "role_assignment:delete",
    resource: "role_assignment",
    action: "delete",
    description: "Revoke a role from a user. Service layer rejects the last Tenant Admin (C-21).",
    systemOnly: false,
  },

  // ---- api_key -----------------------------------------------------------
  "api_key:create": {
    id: "api_key:create",
    resource: "api_key",
    action: "create",
    description: "Mint a new API key with a scoped permission subset.",
    systemOnly: false,
  },
  "api_key:read": {
    id: "api_key:read",
    resource: "api_key",
    action: "read",
    description: "List API key metadata. Hashes are never returned.",
    systemOnly: false,
  },
  "api_key:update": {
    id: "api_key:update",
    resource: "api_key",
    action: "update",
    description: "Rename an API key or modify its IP allowlist / rate limit.",
    systemOnly: false,
  },
  "api_key:delete": {
    id: "api_key:delete",
    resource: "api_key",
    action: "delete",
    description: "Revoke an API key. Sets revoked_at; the row remains for audit.",
    systemOnly: false,
  },

  // ---- consignee ---------------------------------------------------------
  "consignee:create": {
    id: "consignee:create",
    resource: "consignee",
    action: "create",
    description: "Create a single consignee.",
    systemOnly: false,
  },
  "consignee:read": {
    id: "consignee:read",
    resource: "consignee",
    action: "read",
    description: "View consignees within the tenant.",
    systemOnly: false,
  },
  "consignee:update": {
    id: "consignee:update",
    resource: "consignee",
    action: "update",
    description: "Edit consignee details (address, contact, geocode).",
    systemOnly: false,
  },
  "consignee:delete": {
    id: "consignee:delete",
    resource: "consignee",
    action: "delete",
    description: "Soft-delete a consignee (preserves history).",
    systemOnly: false,
  },
  "consignee:bulk_create": {
    id: "consignee:bulk_create",
    resource: "consignee",
    action: "bulk_create",
    description:
      "Create many consignees in one operation via CSV upload. Ongoing self-serve flow (separate from the migration cut-over import).",
    systemOnly: false,
  },

  // ---- subscription ------------------------------------------------------
  "subscription:create": {
    id: "subscription:create",
    resource: "subscription",
    action: "create",
    description: "Create a single subscription.",
    systemOnly: false,
  },
  "subscription:read": {
    id: "subscription:read",
    resource: "subscription",
    action: "read",
    description: "View subscriptions within the tenant.",
    systemOnly: false,
  },
  "subscription:update": {
    id: "subscription:update",
    resource: "subscription",
    action: "update",
    description: "Edit subscription frequency, end-date, pause/resume.",
    systemOnly: false,
  },
  "subscription:delete": {
    id: "subscription:delete",
    resource: "subscription",
    action: "delete",
    description: "End or remove a subscription.",
    systemOnly: false,
  },
  "subscription:bulk_create": {
    id: "subscription:bulk_create",
    resource: "subscription",
    action: "bulk_create",
    description:
      "Create many subscriptions in one operation via CSV upload. Ongoing self-serve flow.",
    systemOnly: false,
  },

  // ---- task --------------------------------------------------------------
  // No `task:create` / `:delete` — tasks are generated by the nightly batch
  // (plan §4.6.2), not created or deleted by users.
  "task:read": {
    id: "task:read",
    resource: "task",
    action: "read",
    description: "View generated tasks within the rolling 14-day horizon.",
    systemOnly: false,
  },
  "task:update": {
    id: "task:update",
    resource: "task",
    action: "update",
    description: "Mark a task complete, update its delivery notes, or skip it.",
    systemOnly: false,
  },

  // ---- audit_event -------------------------------------------------------
  // No write permissions — emit is a system-only path through `withServiceRole`,
  // not an action a tenant actor can take. Only `read` is in the catalogue.
  "audit_event:read": {
    id: "audit_event:read",
    resource: "audit_event",
    action: "read",
    description: "View the tenant's own audit events. Cross-tenant events are not visible.",
    systemOnly: false,
  },
} as const satisfies Record<Permission, PermissionDef>;

/**
 * Frozen catalogue — runtime source of truth for all permission identifiers.
 * Module-import freezes the object so no consumer can extend or mutate it.
 */
export const PERMISSIONS = Object.freeze(PERMISSIONS_DRAFT);

/** Static union of every permission id, derived from the catalogue. */
export type PermissionId = keyof typeof PERMISSIONS;

/**
 * Every permission id in the catalogue. Stable iteration order matches the
 * declaration order above, which is grouped by resource — useful for admin
 * UIs that render the catalogue.
 */
export const ALL_PERMISSION_IDS: readonly PermissionId[] = Object.freeze(
  Object.keys(PERMISSIONS) as PermissionId[]
);

/**
 * Permissions that can only be held by system actors. Tenant Admins MUST
 * NOT have any of these in their permission set; the
 * `systemOnlyPermissionsAreNotInTenantRoles` test in the spec enforces it
 * statically.
 */
export const SYSTEM_ONLY_PERMISSIONS: ReadonlySet<PermissionId> = Object.freeze(
  new Set(
    (Object.entries(PERMISSIONS) as [PermissionId, PermissionDef][])
      .filter(([, def]) => def.systemOnly)
      .map(([id]) => id)
  )
);

/**
 * Permissions that an API key MUST NOT carry, per resolutions §2.5. API
 * keys are scoped service credentials — they have no business performing
 * destructive identity operations or migration-gated actions even if their
 * owner has those permissions.
 *
 * The set is intentionally broader than systemOnly: it also blocks
 * tenant-scoped destructive operations (api_key creation/deletion, role
 * mutation, user deletion) because an API key minting another API key or
 * deleting users would be a clean privilege-escalation path on credential
 * exfiltration.
 */
export const API_KEY_FORBIDDEN_PERMISSIONS: ReadonlySet<PermissionId> = Object.freeze(
  new Set<PermissionId>([
    // System-only — definitionally not for API keys.
    "tenant:migration_import",
    "tenant:migration_gate_set",
    // Identity write paths — exfiltrated keys must not be able to mint/escalate.
    "api_key:create",
    "api_key:update",
    "api_key:delete",
    "user:create",
    "user:delete",
    "role:create",
    "role:update",
    "role:delete",
    "role_assignment:create",
    "role_assignment:delete",
  ])
);

/**
 * Type guard / runtime check. Use in adapters that take an unknown string
 * (e.g., a permission read off an API key row) and need to narrow it to
 * a known catalogue entry before passing to `requirePermission`.
 */
export function isKnownPermission(value: string): value is PermissionId {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
