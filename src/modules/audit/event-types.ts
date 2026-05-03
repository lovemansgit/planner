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
//
// Lifecycle-event metadata convention (SET vs CLEAR):
//
//   Events that SET a timestamp column carry the freshly-written value
//   under the column's own name. Examples: subscription.paused sets
//   paused_at and emits `paused_at: <iso>`; subscription.ended sets
//   ended_at and emits `ended_at: <iso>`.
//
//   Events that CLEAR a timestamp column carry the about-to-be-cleared
//   value under a *_was-suffixed name, preserving the historical
//   timestamp for forensic reconstruction (e.g. computing pause
//   duration). Example: subscription.resumed clears paused_at and
//   emits `paused_at_was: <iso>` — the value pulled from before-state.
//
//   The suffix is the tell: a `*_was` field is the historical value,
//   not the current one. New lifecycle events that follow the
//   SET-or-CLEAR shape must obey this convention so audit-log queries
//   stay consistent across resources.

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
      "The migration gate (Transcorp Systems Team's signoff that pre-existing future-dated SuiteFleet tasks are cleared) transitioned to a new state for a tenant.",
    metadataNotes:
      "previous_status (string: closed|open|completed), new_status (string), reason (string). Note: original Day-2 metadataNotes spec'd booleans before C-5 finalised the three-state machine; updated in C-6 to match the actual state-machine alphabet.",
    systemOnly: true,
  },
  "tenant.push_skipped": {
    id: "tenant.push_skipped",
    resource: "tenant",
    action: "push_skipped",
    description:
      "Day 8 / D8-4. The cron's bulk-push phase fail-closed an entire tenant's batch because of a tenant-level configuration gap (e.g. missing suitefleet_customer_code). One event per tenant per cron pass — NOT one per task — because the cause is a tenant-level config gap, not a per-task failure. Surfaces operationally as one alert per tenant per pass instead of N alerts. System-only — only the cron's per-tenant push-service writes here.",
    metadataNotes:
      "tenant_id (uuid), reason (string union: 'missing_customer_code' for D8-4; extensible for future tenant-level skip causes like 'tenant_suspended'), skipped_task_count (int — number of tasks that would have been pushed in this pass).",
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
  // Lifecycle taxonomy: created → (updated | paused → resumed)* → ended.
  // 'ended' is terminal — no `subscription.deleted` event because hard
  // delete is not a planned operation in pilot (S-3 / Day 6). Each
  // transition has a dedicated event type so audit-log queries can
  // discriminate "operator paused" from "operator resumed" without
  // parsing metadata.
  "subscription.created": {
    id: "subscription.created",
    resource: "subscription",
    action: "created",
    description: "A single subscription was created.",
    metadataNotes:
      "subscription_id (uuid), consignee_id (uuid), start_date (YYYY-MM-DD), days_of_week (number[] of ISO 1-7).",
    systemOnly: false,
  },
  "subscription.updated": {
    id: "subscription.updated",
    resource: "subscription",
    action: "updated",
    description:
      "A subscription's schedule, delivery window, address override, or cosmetic fields changed. Excludes lifecycle transitions, which have dedicated event types.",
    metadataNotes: "changed_fields[].",
    systemOnly: false,
  },
  "subscription.paused": {
    id: "subscription.paused",
    resource: "subscription",
    action: "paused",
    description:
      "A subscription was transitioned from 'active' to 'paused'. Cron stops generating tasks while paused.",
    metadataNotes:
      "subscription_id (uuid), previous_status ('active'), new_status ('paused'), paused_at (iso timestamp).",
    systemOnly: false,
  },
  "subscription.resumed": {
    id: "subscription.resumed",
    resource: "subscription",
    action: "resumed",
    description: "A subscription was transitioned from 'paused' back to 'active'.",
    metadataNotes:
      "subscription_id (uuid), previous_status ('paused'), new_status ('active'), paused_at_was (iso timestamp — when the now-cleared pause began).",
    systemOnly: false,
  },
  "subscription.ended": {
    id: "subscription.ended",
    resource: "subscription",
    action: "ended",
    description:
      "A subscription was transitioned to the terminal 'ended' state. Cron stops generating tasks; reactivation is not supported. Two trigger sources: operator-driven (subscription:end permission via API route) and system-driven (Day-7 / C-8 end-date sweeper that walks subscriptions whose end_date has passed). Both surface as the same event type with `trigger_source` metadata to disambiguate — same precedent as `asset_tracking.state_changed` (webhook | read_through).",
    metadataNotes:
      "subscription_id (uuid), previous_status ('active' | 'paused'), new_status ('ended'), ended_at (iso timestamp), trigger_source ('user' | 'sweeper' — distinguishes operator-driven end from end-date sweeper auto-end).",
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
  // Day 7 / C-7 — MP-14 push-failure auto-pause rule.
  "subscription.auto_paused": {
    id: "subscription.auto_paused",
    resource: "subscription",
    action: "auto_paused",
    description:
      "A subscription was transitioned 'active' → 'paused' automatically by the system because one of its pushed tasks failed N times (N=3 in pilot). Distinct from `subscription.paused` (operator-driven) so audit-log queries can isolate auto-pause incidents from intentional pauses without parsing metadata. Counterpart resume is the operator-driven `subscription.resumed` (no auto-resume in pilot — operator decides whether to retry after fixing root cause).",
    metadataNotes:
      "subscription_id (uuid), failure_count (int — attempt_count on the failed_pushes row that triggered the pause), last_error (string — failure_detail or short summary, no credentials/PII), task_id (uuid — the task whose repeated failure tripped the threshold).",
    systemOnly: true,
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
  "task.bulk_created": {
    id: "task.bulk_created",
    resource: "task",
    action: "bulk_created",
    description:
      "Many tasks were created in one transactional bulk-insert. System-only — emitted alongside per-task task.created events for traceability of the meta-operation (count, tenant) when investigating a batch's success or failure.",
    metadataNotes: "task_ids[] (uuid), count (int).",
    systemOnly: true,
  },
  "task.push_failed": {
    id: "task.push_failed",
    resource: "task",
    action: "push_failed",
    description:
      "A SuiteFleet push for a task exhausted its application-layer retries. A DLQ row was written to failed_pushes with the request payload + categorised failure reason for the Day-7 cron's retry-with-audit-trail flow. System-only — only the cron / adapter assembly path writes here.",
    metadataNotes: "task_id (uuid), attempt_count (int), failure_reason (enum), http_status (int, nullable for network/timeout).",
    systemOnly: true,
  },
  // Day 8 / D8-4b — AWB-exists reconcile path. SF returned 23505/AWB-exists
  // on createTask (i.e. the AWB already exists in SF, typically because a
  // prior cron pass got the request through but the response was lost on
  // the planner side). The reconcile path GETs the SF task by AWB,
  // extracts the existing SF task id, and marks the local task as pushed
  // with that id — closing the duplicate-physical-delivery loop without
  // a second create. Distinct from `task.pushed` (which doesn't exist as
  // a typed event yet) so audit-log queries can isolate reconcile-path
  // pushes from clean first-attempt pushes; the metadata also flags
  // whether a prior `failed_pushes` row was resolved as part of this
  // reconcile (i.e. we're closing out a parse-only-era DLQ entry from
  // a D8-4a-shipped pre-reconcile cron pass).
  "task.pushed_via_reconcile": {
    id: "task.pushed_via_reconcile",
    resource: "task",
    action: "pushed_via_reconcile",
    description:
      "Day 8 / D8-4b. The cron's bulk-push phase received a 23505/AWB-exists from SF on createTask, then GET /api/tasks/awb/{awb}/task-activities to extract the existing SF task id and marked the local task as pushed via that id. System-only — only the cron's reconcile branch writes here. Distinct from a hypothetical `task.pushed` so reconcile-path pushes are isolable in audit-log queries (operationally meaningful — repeated reconciles for the same tenant signal upstream duplicate-AWB exposure).",
    metadataNotes:
      "task_id (uuid), external_id (string — SF task id from the timeline GET, stringified), awb (string — the AWB parsed from the AWB-exists error message), customer_order_number (string — the planner-side order id we'd have sent on the original create), prior_failed_push_resolved (boolean — true when an unresolved failed_pushes row from a prior cron pass was resolved as part of this reconcile, false on first-time AWB-exists with no DLQ history).",
    systemOnly: true,
  },

  // Day 8 / D8-6 — operator-driven SuiteFleet label print. POST
  // /api/tasks/labels triggers a server-side fetch to SF's
  // generate-label endpoint and streams the rendered PDF back to
  // the operator. The visibility filter at the route layer drops
  // task IDs the requesting tenant doesn't own; the
  // requested_count vs printed_count split surfaces that filter
  // for forensic queries — useful when an operator says "I selected
  // 30 tasks but only got 28 in the PDF."
  //
  // systemOnly: false because actor.kind === 'user' for the
  // operator flow. The downstream SF call is server-side but
  // attribution stays with the operator.
  "task.labels_printed": {
    id: "task.labels_printed",
    resource: "task",
    action: "labels_printed",
    description:
      "Day 8 / D8-6. An operator generated SuiteFleet shipment labels for one or more tasks via /api/tasks/labels. Server-side passthrough of the SF generate-label endpoint — token never reaches the operator browser. Single event per operator click; metadata captures the requested-vs-printed split so post-hoc queries can surface visibility-filter drops.",
    metadataNotes:
      "task_ids[] (uuid[] — IDs the operator submitted, after Zod validation but before the visibility filter), format (string — 'indv-small' in pilot; documented for future per-format dispatch), requested_count (int — task_ids.length), printed_count (int — count after the visibility filter; differs from requested when some submitted IDs aren't in the requesting tenant's task table).",
    systemOnly: false,
  },

  // Day 8 / D8-5 — manual DLQ retry from /admin/failed-pushes. Operator-
  // driven: a Tenant Admin clicks the retry button on the admin UI;
  // the route handler authorizes via `failed_pushes:retry`, then a
  // service-level bridge (retryFailedPush in failed-pushes/service.ts)
  // builds an internal `system:dlq_retry` system context to call into
  // the task-push module's pushSingleTask helper, which reuses the
  // exact same per-task push logic as the cron loop.
  //
  // This event captures the OPERATOR ACTION (who clicked retry,
  // against which task, what was the prior attempt count, what was
  // the outcome). The downstream task push emits its own audit
  // events (task.pushed_via_reconcile on AWB reconcile success,
  // task.push_failed on retry failure) — this event sits one layer
  // above and is operator-attributed, not system-attributed.
  // systemOnly: false because actor.kind === 'user' for legitimate
  // emits.
  "failed_push.retried": {
    id: "failed_push.retried",
    resource: "failed_push",
    action: "retried",
    description:
      "Day 8 / D8-5. A Tenant Admin manually retried an unresolved failed_pushes row from the /admin/failed-pushes UI. Operator-attributed (user actor); the downstream task-push outcome emits its own task.pushed_via_reconcile or task.push_failed event. Distinct from the cron-path retries (which are system-attributed via task.push_failed alone) so audit-log queries can isolate operator-initiated retries.",
    metadataNotes:
      "task_id (uuid), failed_push_id (uuid), prior_attempt_count (int — attempt_count BEFORE the retry; the post-retry value lands on the task.push_failed or task.pushed_via_reconcile event), retry_outcome (string union: 'succeeded' | 'awb_reconciled' | 'awb_exists' | 'failed_to_dlq' | 'skipped_district' | 'tenant_skipped' | 'task_already_pushed' | 'task_not_found').",
    systemOnly: false,
  },

  // Day 7 / C-2 — nightly cron generation lifecycle. These are
  // META events (one per cron invocation per tenant), not per-task.
  // The cron also emits per-task `task.created` events for traceability;
  // these record the cron-run-level facts (window, projection, counts).
  // Distinct from `task.bulk_created` which is the bulk-import meta-event
  // (different metadata shape: import_id vs window_start/window_end).
  "task.bulk_generated": {
    id: "task.bulk_generated",
    resource: "task",
    action: "bulk_generated",
    description:
      "Nightly cron walked subscriptions for a (tenant, window) and generated the next-day tasks. One emit per tenant per cron invocation. Pairs with per-task `task.created` events written during the same run. The run row id ties this event to the task_generation_runs forensic record.",
    metadataNotes:
      "run_id (uuid), window_start (iso), window_end (iso), subscriptions_walked (int), tasks_created (int), tasks_skipped_existing (int — pre-existing rows that the per-task ON CONFLICT skipped).",
    systemOnly: true,
  },
  "task.bulk_generation_capped": {
    id: "task.bulk_generation_capped",
    resource: "task",
    action: "bulk_generation_capped",
    description:
      "Nightly cron projected a task count exceeding the structural cap (memory/decision_daily_cutoff_and_throughput.md, currently 7,000 per tenant per run) and ABORTED before any tasks were generated. Hard abort, not partial generation — partial generation creates a silent operational half-state where some subscriptions have tomorrow's task and others don't. Human investigation required before the next window. Cron handler exits non-zero so Vercel logs flag the run as failed.",
    metadataNotes:
      "run_id (uuid), window_start (iso), window_end (iso), projected_count (int), cap_threshold (int — limit in effect at run-time, recorded so historical capped runs stay interpretable if the cap is later changed).",
    systemOnly: true,
  },
  "task.bulk_generation_skipped_already_run": {
    id: "task.bulk_generation_skipped_already_run",
    resource: "task",
    action: "bulk_generation_skipped_already_run",
    description:
      "Nightly cron was invoked for a (tenant, window) for which a row already exists in task_generation_runs. The UNIQUE (tenant_id, window_start, window_end) constraint prevented a duplicate run. Most commonly fires when Vercel retries a cron handler after a network blip. Idempotent no-op: the prior run's tasks are durable, no new ones generated, no audit pollution.",
    metadataNotes:
      "window_start (iso), window_end (iso), existing_run_id (uuid — the prior run for this window). No new run row is written for the skipped invocation; the existing row stays the canonical record.",
    systemOnly: true,
  },

  // ---- asset_tracking (Day 6 / B-2) --------------------------------------
  // Three lifecycle events for the read-through asset-tracking cache
  // per memory/decision_bag_tracking_mvp.md. The cache reads
  // themselves are NOT audited (R-4 read-not-audited convention plus
  // anti-flood reasoning — see the memo).
  "asset_tracking.refreshed": {
    id: "asset_tracking.refreshed",
    resource: "asset_tracking",
    action: "refreshed",
    description:
      "A cache miss or TTL-expired lookup triggered an outbound SuiteFleet GET /api/task-asset-tracking and the cache was upserted with the result. Lets ops reconstruct refresh frequency from the audit log if cache hit-rate debugging surfaces.",
    metadataNotes:
      "awb (string), previous_synced_at (iso timestamp | null — null on first refresh for an AWB), record_count (int — number of package records returned by SF).",
    systemOnly: false,
  },
  "asset_tracking.state_changed": {
    id: "asset_tracking.state_changed",
    resource: "asset_tracking",
    action: "state_changed",
    description:
      "A cached package's state column transitioned from one value to another (whether triggered by webhook or by read-through GET). Load-bearing forensic event for bag-loss investigation. Per the SET-vs-CLEAR convention at the top of this file: the new state is the operational signal, the old state is the historical one.",
    metadataNotes:
      "tracking_id (string, format <awb>-<index>), task_id_external (int), previous_state ('COLLECTED' | 'EN_ROUTE' | 'RECEIVED' | 'RETURNED'), new_state (same domain), trigger_source ('webhook' | 'read_through').",
    systemOnly: false,
  },
  "asset_tracking.orphan_dropped": {
    id: "asset_tracking.orphan_dropped",
    resource: "asset_tracking",
    action: "orphan_dropped",
    description:
      "SuiteFleet returned an asset-tracking record whose taskId does not match any Planner-side tasks.external_id. The cache write is dropped because asset_tracking_cache.task_id is NOT NULL (path (i) from B-1 race-path design). System-only because only the ingestion path emits it; no user actor triggers it. Documented for ops to reconstruct WHICH SF event was dropped if a webhook-period data gap surfaces.",
    metadataNotes:
      "tracking_id (string), task_id_external (int — the SF taskId that did not resolve), awb (string — derived from tracking_id stem).",
    systemOnly: true,
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

  // ---- webhook (Day 8 / D8-8) --------------------------------------------
  // Tier-2 mismatch only — fired when the tenant has a credentials row
  // in tenant_suitefleet_webhook_credentials AND the inbound request's
  // clientid/clientsecret headers did not match the stored values.
  // Distinct from Tier-1 (no creds row → no audit; legitimate state per
  // memory/followup_d8_8_webhook_auth_model.md) and from unknown-tenant
  // probes (silent 401, no audit — DDoS protection per Day-4 §10
  // posture). Tier-2 mismatch IS a real signal: the merchant
  // configured credentials, the inbound request claims to know them,
  // but the values don't match — partial knowledge by an attacker, or
  // a legitimate operator-side credential drift.
  //
  // systemOnly because no user actor triggers it; emitted by the
  // receiver path under withServiceRole.
  "webhook.auth_failed": {
    id: "webhook.auth_failed",
    resource: "webhook",
    action: "auth_failed",
    description:
      "Day 8 / D8-8. An inbound SuiteFleet webhook request failed Tier-2 credential verification — the tenant has a credentials row in tenant_suitefleet_webhook_credentials but the request's clientid/clientsecret headers did not match the stored values. Distinct from Tier-1 absence (no creds row → no audit) and unknown-tenant probes (silent 401 → no audit). systemOnly because no user actor triggers it.",
    metadataNotes:
      "tenant_id (uuid), failure (enum 'creds_mismatch'), header_keys_present (string[] — names of credential-related headers seen on the request, lowercase, no values).",
    systemOnly: true,
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
