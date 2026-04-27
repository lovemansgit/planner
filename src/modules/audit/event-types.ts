// Audit event-type vocabulary per resolutions R-4.
//
// This file IS the controlled vocabulary referenced by the comment in
// supabase/migrations/0002_audit.sql ("New event types added by PR —
// never invented inline (R-4)"). The audit_events table holds event_type
// as plain text — the DB does not constrain values; this catalogue does.
//
// Adding an event type is one entry here plus the call-site emit. New
// event types arrive via PR — visible, gated, audit-trailed in git —
// never as ad-hoc string literals at call sites.
//
// Identifier shape: `${resource}.${action_past_tense}`. Past tense is
// the convention because audit events describe things that HAVE
// happened (consignee.bulk_created, not consignee.bulk_create — the
// latter is a permission, not an event). The `.` separator is the
// other half of the perm-vs-event distinction baked in by R-1: perm
// ids carry `:`, audit event types carry `.`.
//
// Day-2 scope: ship the full vocabulary even where call sites don't
// exist yet. Same approach as R-1's permission catalogue — RBAC and
// audit are system-wide invariants; partial coverage is partial
// enforcement.

/**
 * One entry in the vocabulary.
 *
 * `metadataNotes` documents what callers SHOULD include in the
 * `metadata` jsonb of audit_events for this event type. It is NOT
 * runtime-enforced — the audit table accepts any jsonb and call
 * sites are responsible for following the convention. Documenting
 * the schema here means a reviewer can catch a missing field at
 * call-site review time, and it shows up in admin tooling that
 * renders the catalogue.
 */
export interface EventTypeDef {
  /** Canonical `resource.action_past_tense` identifier. Matches the map key. */
  readonly id: string;
  readonly resource: string;
  /** Past-tense verb. */
  readonly action: string;
  /** One-line description for admin UIs and event-type pickers. */
  readonly description: string;
  /**
   * Notes on the metadata fields this event type expects to carry,
   * if any. Empty string for events whose metadata is purely
   * descriptive (or nothing).
   */
  readonly metadataNotes: string;
  /**
   * If true, this event type is emitted only from system-actor or
   * Transcorp-staff code paths — never from a tenant-controlled
   * call site. Documentation flag (cf. RLS for cross-tenant events
   * with tenant_id IS NULL, which is the actual mechanism limiting
   * read access).
   */
  readonly systemOnly: boolean;
}

const EVENT_TYPES_DRAFT = {
  // ---- tenant ------------------------------------------------------------
  "tenant.created": {
    id: "tenant.created",
    resource: "tenant",
    action: "created",
    description: "A new tenant was created. Onboarding flow.",
    metadataNotes: "slug, name.",
    systemOnly: true,
  },
  "tenant.updated": {
    id: "tenant.updated",
    resource: "tenant",
    action: "updated",
    description: "Tenant settings were modified.",
    metadataNotes: "changed_fields[] — list of field names that were updated.",
    systemOnly: false,
  },
  "tenant.migration_imported": {
    id: "tenant.migration_imported",
    resource: "tenant",
    action: "migration_imported",
    description:
      "One-shot migration cut-over import was executed for a tenant. Pairs with the `tenant:migration_import` permission (R-1, systemOnly).",
    metadataNotes:
      "import_id (uuid), row_count (int), file_hash (sha256 hex string), source_file_name (string).",
    systemOnly: true,
  },
  "tenant.migration_gate_changed": {
    id: "tenant.migration_gate_changed",
    resource: "tenant",
    action: "migration_gate_changed",
    description:
      "The migration gate (Transcorp Systems Team's signoff that pre-existing future-dated SuiteFleet tasks are cleared) was set or unset for a tenant.",
    metadataNotes: "previous_state (boolean), new_state (boolean), reason (string).",
    systemOnly: true,
  },

  // ---- user --------------------------------------------------------------
  "user.created": {
    id: "user.created",
    resource: "user",
    action: "created",
    description: "A new user was added to the tenant (invitation accepted).",
    metadataNotes: "email — recorded for forensic linkability across the auth.users mirror.",
    systemOnly: false,
  },
  "user.updated": {
    id: "user.updated",
    resource: "user",
    action: "updated",
    description: "A user's display name or disable status changed.",
    metadataNotes: "changed_fields[].",
    systemOnly: false,
  },
  "user.deleted": {
    id: "user.deleted",
    resource: "user",
    action: "deleted",
    description:
      "A user was removed from the tenant. Cascade-deletes their role assignments. Distinct from auth.users deletion (which cascades through the FK).",
    metadataNotes: "email — captured before the row went away.",
    systemOnly: false,
  },

  // ---- role --------------------------------------------------------------
  // The built-in roles are seeded, not "created" via UI; these events fire
  // for custom roles (post-pilot per plan §13.1).
  "role.created": {
    id: "role.created",
    resource: "role",
    action: "created",
    description: "A custom role was created within the tenant. Post-pilot.",
    metadataNotes: "slug, name, permission_count.",
    systemOnly: false,
  },
  "role.updated": {
    id: "role.updated",
    resource: "role",
    action: "updated",
    description: "A custom role's name or permission set was modified. Post-pilot.",
    metadataNotes: "changed_fields[] — name | permissions.",
    systemOnly: false,
  },
  "role.deleted": {
    id: "role.deleted",
    resource: "role",
    action: "deleted",
    description: "A custom role was deleted. Cascade-removes role_assignments. Post-pilot.",
    metadataNotes: "slug.",
    systemOnly: false,
  },

  // ---- role_assignment ---------------------------------------------------
  // No `role_assignment.updated` — assignments are immutable per plan §9.1.
  "role_assignment.created": {
    id: "role_assignment.created",
    resource: "role_assignment",
    action: "created",
    description: "A role was assigned to a user.",
    metadataNotes: "role_slug, target_user_id.",
    systemOnly: false,
  },
  "role_assignment.deleted": {
    id: "role_assignment.deleted",
    resource: "role_assignment",
    action: "deleted",
    description:
      "A role was revoked from a user. Service layer rejects the last Tenant Admin per C-21.",
    metadataNotes: "role_slug, target_user_id.",
    systemOnly: false,
  },

  // ---- api_key -----------------------------------------------------------
  "api_key.created": {
    id: "api_key.created",
    resource: "api_key",
    action: "created",
    description: "A new API key was minted.",
    metadataNotes: "name, permission_count, has_ip_allowlist (boolean), expires_at (iso|null).",
    systemOnly: false,
  },
  "api_key.updated": {
    id: "api_key.updated",
    resource: "api_key",
    action: "updated",
    description: "An API key's name, IP allowlist, or rate limit was modified.",
    metadataNotes: "changed_fields[].",
    systemOnly: false,
  },
  "api_key.deleted": {
    id: "api_key.deleted",
    resource: "api_key",
    action: "deleted",
    description: "An API key was revoked. Sets revoked_at; the row remains for forensic audit.",
    metadataNotes: "name.",
    systemOnly: false,
  },

  // ---- consignee ---------------------------------------------------------
  "consignee.created": {
    id: "consignee.created",
    resource: "consignee",
    action: "created",
    description: "A single consignee was created.",
    metadataNotes: "consignee_id (uuid), source — planner | suitefleet (per C-19).",
    systemOnly: false,
  },
  "consignee.updated": {
    id: "consignee.updated",
    resource: "consignee",
    action: "updated",
    description: "A consignee's address, contact, or geocode was modified.",
    metadataNotes: "changed_fields[].",
    systemOnly: false,
  },
  "consignee.deleted": {
    id: "consignee.deleted",
    resource: "consignee",
    action: "deleted",
    description: "A consignee was soft-deleted (history preserved).",
    metadataNotes: "consignee_id.",
    systemOnly: false,
  },
  "consignee.bulk_created": {
    id: "consignee.bulk_created",
    resource: "consignee",
    action: "bulk_created",
    description:
      "Many consignees were created in one CSV-upload operation. Ongoing self-serve flow (separate from the migration cut-over).",
    metadataNotes:
      "import_id (uuid), row_count (int), file_hash (sha256 hex string), source_file_name (string). Brief §7 hard requirement.",
    systemOnly: false,
  },

  // ---- subscription ------------------------------------------------------
  "subscription.created": {
    id: "subscription.created",
    resource: "subscription",
    action: "created",
    description: "A single subscription was created.",
    metadataNotes: "subscription_id, frequency, start_date.",
    systemOnly: false,
  },
  "subscription.updated": {
    id: "subscription.updated",
    resource: "subscription",
    action: "updated",
    description: "A subscription's frequency, end date, or pause/resume state changed.",
    metadataNotes: "changed_fields[].",
    systemOnly: false,
  },
  "subscription.deleted": {
    id: "subscription.deleted",
    resource: "subscription",
    action: "deleted",
    description: "A subscription was ended or removed.",
    metadataNotes: "subscription_id.",
    systemOnly: false,
  },
  "subscription.bulk_created": {
    id: "subscription.bulk_created",
    resource: "subscription",
    action: "bulk_created",
    description: "Many subscriptions were created in one CSV-upload operation. Ongoing self-serve.",
    metadataNotes:
      "import_id (uuid), row_count (int), file_hash (sha256 hex string), source_file_name (string). Brief §7 hard requirement.",
    systemOnly: false,
  },

  // ---- task --------------------------------------------------------------
  "task.created": {
    id: "task.created",
    resource: "task",
    action: "created",
    description: "A task was generated by the nightly batch (plan §4.6.2).",
    metadataNotes: "task_id, scheduled_for (iso date).",
    systemOnly: true,
  },
  "task.updated": {
    id: "task.updated",
    resource: "task",
    action: "updated",
    description: "A task's status, notes, or scheduled_for changed.",
    metadataNotes: "changed_fields[], previous_status, new_status (when status changed).",
    systemOnly: false,
  },
  "task.completed": {
    id: "task.completed",
    resource: "task",
    action: "completed",
    description: "A task was marked complete. Distinct from .updated for high-signal querying.",
    metadataNotes: "task_id, completed_via — ui | api | webhook.",
    systemOnly: false,
  },

  // ---- import (bulk-import operations cross-cutting) ---------------------
  "import.validation_failed": {
    id: "import.validation_failed",
    resource: "import",
    action: "validation_failed",
    description:
      "A bulk-import CSV was rejected at the validation stage. Brief §7 — important for migration debugging and surfacing repeat-offender merchants who keep uploading malformed files.",
    metadataNotes:
      "import_id (uuid), source_file_name (string), file_hash (sha256 hex string), failure_count (int), failure_reasons[] — small enumerated list of which of the 9 validation checks failed.",
    systemOnly: false,
  },

  // ---- db (system-internal) ----------------------------------------------
  "db.service_role.use": {
    id: "db.service_role.use",
    resource: "db",
    action: "service_role.use",
    description:
      "withServiceRole was invoked. Emitted by the audit module's serviceRoleObserver per the R-3 + R-4 contract. Recursion-skip prevents this event from emitting on its own audit-emit pathway.",
    metadataNotes: "reason — the string passed to withServiceRole (e.g. 'audit emit: x.created').",
    systemOnly: true,
  },
} as const satisfies Record<string, EventTypeDef>;

/**
 * Frozen vocabulary. Module-import freezes the object so no consumer
 * can extend or mutate it. Adding an event type is an entry here plus
 * a corresponding emit at the call site.
 */
export const EVENT_TYPES = Object.freeze(EVENT_TYPES_DRAFT);

/** Static union of every event type id. */
export type EventTypeId = keyof typeof EVENT_TYPES;

/** Stable iteration order matches the declaration order above. */
export const ALL_EVENT_TYPE_IDS: readonly EventTypeId[] = Object.freeze(
  Object.keys(EVENT_TYPES) as EventTypeId[]
);

/**
 * Type guard for catalogue membership. Use in adapters that take an
 * unknown string (e.g., reading event_type out of an audit_events row)
 * and need to narrow it before passing to typed code.
 */
export function isKnownEventType(value: string): value is EventTypeId {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, value);
}
