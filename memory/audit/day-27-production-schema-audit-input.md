# Day-27 production schema audit input

**Filed:** Day-27 (15 May 2026), AM.
**Tier:** T1 docs artifact (the audit file itself); input for a T3 reconciliation lane (audit → plan → execute).
**Status:** AUDIT-ONLY. This document does NOT propose, sketch, or draft any reconciliation/fix SQL. Reconciliation is a separate, reviewed plan-PR after Love runs Part B against production.

**Context.** Day-26 production cutover for migration 0024 was attempted and stopped; diagnostic queries against Supabase project `qdotjmwqbyzldfuxphei` found four of five core identity tables absent (`public.tenants`, `public.roles`, `public.role_assignments`, `public.api_keys`), `set_updated_at()` function absent, and `public.users` exists but is missing its `updated_at` column. Full background in [`memory/followup_production_identity_schema_absent.md`](../followup_production_identity_schema_absent.md).

This audit produces two things:
- **Part A** — the repo-side expectation of what production's `public` schema SHOULD look like after migration 0023.
- **Part B** — a read-only SQL block, annotated query-by-query, for Love to paste into the Supabase SQL editor against production. Establishes the actual state to diff against Part A.

The open question Part B is designed to answer: production has apparently been running the pilot — how, if those identity tables don't exist? Three unconfirmed explanations: (a) pilot running against a different DB than the one queried Day-26, (b) `0001` never applied to this DB or applied then partially wiped, (c) an environment/config issue not visible from schema queries.

---

## Part A — Repo-side expectation

### A.1 Per-migration schema-object inventory (0001–0023)

#### 0001_identity.sql

- **CREATE FUNCTION:** `set_updated_at()` RETURNS trigger — canonical home for the updated_at trigger function. **Load-bearing.**
- **CREATE TABLE `tenants`:** `id uuid PK DEFAULT gen_random_uuid()`, `slug text NOT NULL UNIQUE`, `name text NOT NULL`, `status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning','active','suspended','inactive'))`, `source_of_truth text NOT NULL DEFAULT 'planner' CHECK (source_of_truth IN ('planner','suitefleet'))`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- **CREATE TABLE `users`:** `id uuid PK REFERENCES auth.users(id) ON DELETE CASCADE`, `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, `email text NOT NULL`, `display_name text`, `disabled_at timestamptz`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- **CREATE TABLE `roles`:** `id uuid PK DEFAULT gen_random_uuid()`, `tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE` (NULLABLE — global vs per-tenant), `name text NOT NULL`, `slug text NOT NULL`, `description text`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`. CONSTRAINTS: `roles_tenant_name_unique UNIQUE NULLS NOT DISTINCT (tenant_id, name)`, `roles_tenant_slug_unique UNIQUE NULLS NOT DISTINCT (tenant_id, slug)` — Postgres 15+ feature.
- **CREATE TABLE `role_assignments`:** `id uuid PK DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE`, `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, `assigned_at timestamptz NOT NULL DEFAULT now()`. CONSTRAINT: `role_assignments_unique UNIQUE (user_id, role_id, tenant_id)`. NO `updated_at` column (assignments are immutable; delete+recreate to change).
- **CREATE TABLE `api_keys`:** `id uuid PK DEFAULT gen_random_uuid()`, `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`, `name text NOT NULL`, `hash text NOT NULL UNIQUE` (argon2id PHC), `permissions text[] NOT NULL DEFAULT '{}'::text[]`, `ip_allowlist inet[]`, `rate_limit_rpm integer`, `expires_at timestamptz`, `created_at timestamptz NOT NULL DEFAULT now()`, `last_used_at timestamptz`, `revoked_at timestamptz`. NO `updated_at` column (distinct lifecycle timestamps).
- **CREATE INDEX:** `users_tenant_id_idx`, `role_assignments_user_idx`, `role_assignments_tenant_idx`, `api_keys_tenant_id_idx`, `api_keys_active_idx (tenant_id) WHERE revoked_at IS NULL`.
- **CREATE TRIGGER (set_updated_at attachments):** `tenants_set_updated_at`, `users_set_updated_at`, `roles_set_updated_at` — all BEFORE UPDATE FOR EACH ROW. NO trigger on `role_assignments` or `api_keys` (no `updated_at` column).
- **CREATE POLICY (RLS):** `tenants_self_isolation` (FOR ALL), `users_tenant_isolation` (FOR ALL), `roles_select` (SELECT), `roles_insert` (INSERT), `roles_update` (UPDATE), `roles_delete` (DELETE), `role_assignments_tenant_isolation` (FOR ALL), `api_keys_tenant_isolation` (FOR ALL). RLS enabled on all five tables. Predicates use defensive form `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` (fail-closed on unset).

#### 0002_audit.sql

- **CREATE TABLE `audit_events`:** `id uuid PK DEFAULT gen_random_uuid()`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `actor_kind text NOT NULL CHECK (actor_kind IN ('user','system','api_key'))`, `actor_id text NOT NULL`, `tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE` (nullable for system events), `event_type text NOT NULL`, `resource_type text`, `resource_id text`, `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, `request_id text`, `ip_address inet`, `user_agent text`.
- **CREATE INDEX:** `audit_tenant_time (tenant_id, occurred_at DESC)`, `audit_resource (resource_type, resource_id) WHERE resource_id IS NOT NULL` partial, `audit_event_type (event_type, occurred_at DESC)`.
- **CREATE POLICY (RLS):** `audit_tenant_read` (SELECT only — append-only at app layer).
- **CREATE RULE:** `audit_events_no_update` (ON UPDATE DO INSTEAD NOTHING), `audit_events_no_delete` (ON DELETE DO INSTEAD NOTHING). Append-only enforced at DB layer. Interacts with ON DELETE CASCADE from tenants — see [`memory/followup_audit_rule_cascade_conflict.md`](../followup_audit_rule_cascade_conflict.md).

#### 0003_app_role.sql

- **CREATE ROLE:** `planner_app` (NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION, INHERIT) inside an idempotent DO block.
- **GRANTS:** USAGE on `public` + `auth` schemas; SELECT on `auth.users`; SELECT/INSERT/UPDATE/DELETE on all public tables + sequences; ALTER DEFAULT PRIVILEGES for postgres-created future objects.
- No DDL on tables. **Load-bearing for the production runtime** — the application connects to production as `planner_app`. If absent, app can't authenticate; if present without LOGIN, app can't connect (LOGIN granted out-of-band per migration header).

#### 0004_consignee.sql

- **CREATE TABLE `consignees`:** id uuid PK, tenant_id uuid NOT NULL FK→tenants, name text NOT NULL, phone text NOT NULL, email text, address_line text NOT NULL, emirate_or_region text NOT NULL, delivery_notes text, external_ref text, notes_internal text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL.
- **CREATE INDEX:** `consignees_tenant_id_idx`, `consignees_tenant_phone_idx`.
- **CREATE POLICY:** `consignees_tenant_isolation` (FOR ALL).
- **CREATE TRIGGER:** `consignees_set_updated_at` — calls `set_updated_at()`.

#### 0005_tenant_migration_gate.sql

- **ALTER TABLE tenants ADD COLUMN:** `migration_gate_status text NOT NULL DEFAULT 'closed' CHECK (... IN ('closed','open','completed'))`, `migration_gate_set_at timestamptz`, `migration_gate_set_by uuid REFERENCES users(id) ON DELETE SET NULL`.

#### 0006_task.sql

- **CREATE TABLE `tasks`:** id uuid PK, tenant_id uuid NOT NULL FK→tenants, consignee_id uuid NOT NULL FK→consignees ON DELETE RESTRICT, subscription_id uuid (FK added later in 0010), customer_order_number text NOT NULL, reference_number text, `internal_status text NOT NULL DEFAULT 'CREATED' CHECK (internal_status IN ('CREATED','ASSIGNED','IN_TRANSIT','DELIVERED','FAILED','CANCELED','ON_HOLD'))` (extended in 0019), external_id text, external_tracking_number text, delivery_date date NOT NULL, delivery_start_time time NOT NULL, delivery_end_time time NOT NULL, delivery_type text NOT NULL DEFAULT 'STANDARD', `task_kind text NOT NULL DEFAULT 'DELIVERY' CHECK (task_kind IN ('DELIVERY','PICKUP'))`, payment_method text, cod_amount numeric(10,2), declared_value numeric(10,2), weight_kg numeric(8,3), notes text, signature_required boolean NOT NULL DEFAULT false, sms_notifications boolean NOT NULL DEFAULT false, deliver_to_customer_only boolean NOT NULL DEFAULT false, `pushed_to_external_at timestamptz`, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL.
- **CREATE INDEX:** `tasks_tenant_id_idx`, `tasks_tenant_date_idx`, `tasks_tenant_status_idx`, `tasks_tenant_consignee_idx`, `tasks_external_id_idx` partial WHERE external_id IS NOT NULL.
- **CREATE POLICY:** `tasks_tenant_isolation` (FOR ALL).
- **CREATE TRIGGER:** `tasks_set_updated_at`.

#### 0007_task_package.sql

- **CREATE TABLE `task_packages`:** id, task_id FK→tasks CASCADE, tenant_id FK→tenants CASCADE, external_package_id text, tracking_id text, `package_status text NOT NULL DEFAULT 'ORDERED' CHECK (package_status IN ('ORDERED','PICKED_UP','IN_TRANSIT','DELIVERED','FAILED','RETURNED'))`, position integer NOT NULL, created_at, updated_at. CONSTRAINT `task_packages_position_unique UNIQUE (task_id, position)`.
- **CREATE INDEX:** `task_packages_tenant_task_idx`.
- **CREATE POLICY:** `task_packages_tenant_isolation`.
- **CREATE FUNCTION:** `task_packages_assert_tenant_match()` (CREATE OR REPLACE).
- **CREATE TRIGGER:** `task_packages_set_updated_at`, `task_packages_tenant_match` (BEFORE INSERT OR UPDATE).

#### 0008_failed_pushes.sql

- **CREATE TABLE `failed_pushes`:** id, tenant_id FK→tenants CASCADE, task_id FK→tasks CASCADE, attempt_count integer NOT NULL DEFAULT 1 CHECK (>= 1), task_payload jsonb NOT NULL, `failure_reason text NOT NULL CHECK (failure_reason IN ('network','server_5xx','client_4xx','timeout','unknown'))`, failure_detail text, http_status integer, first_failed_at, last_attempted_at, resolved_at timestamptz, resolved_by uuid REFERENCES users(id) ON DELETE SET NULL, resolution_notes text, created_at, updated_at.
- **CREATE INDEX:** `failed_pushes_tenant_id_idx`, `failed_pushes_unresolved_idx` partial, `failed_pushes_chronological_idx`, `failed_pushes_active_unique_idx UNIQUE (task_id) WHERE resolved_at IS NULL` (partial UNIQUE).
- **CREATE POLICY:** `failed_pushes_tenant_isolation`.
- **CREATE FUNCTION:** `failed_pushes_assert_tenant_match()`.
- **CREATE TRIGGER:** `failed_pushes_set_updated_at`, `failed_pushes_tenant_match`.

#### 0009_subscription.sql

- **CREATE TABLE `subscriptions`:** id, tenant_id FK CASCADE, consignee_id FK→consignees ON DELETE RESTRICT, `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended'))`, start_date date NOT NULL, end_date date, days_of_week integer[] NOT NULL, delivery_window_start time NOT NULL, delivery_window_end time NOT NULL, delivery_address_override jsonb, meal_plan_name text, external_ref text, notes_internal text, paused_at timestamptz, ended_at timestamptz, created_at, updated_at. CONSTRAINTS: `subscriptions_end_date_after_start`, `subscriptions_days_of_week_non_empty CHECK (cardinality BETWEEN 1 AND 7)`, `subscriptions_days_of_week_iso_domain CHECK (days_of_week <@ ARRAY[1..7])`, `subscriptions_delivery_window_strict CHECK (start < end)`.
- **CREATE INDEX:** `subscriptions_tenant_id_idx`, `subscriptions_tenant_status_idx`, `subscriptions_tenant_consignee_idx`, `subscriptions_tenant_dates_idx`.
- **CREATE POLICY:** `subscriptions_tenant_isolation`.
- **CREATE TRIGGER:** `subscriptions_set_updated_at`.

#### 0010_task_subscription_link.sql

- **ALTER TABLE tasks:** `ADD COLUMN created_via text NOT NULL DEFAULT 'subscription' CHECK (created_via IN ('subscription','migration_import','manual_admin'))`; `ADD CONSTRAINT tasks_subscription_id_fk FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE RESTRICT`; `ADD CONSTRAINT tasks_creation_source_invariant CHECK ((created_via='subscription' AND subscription_id IS NOT NULL) OR (created_via!='subscription' AND subscription_id IS NULL))`.
- **CREATE INDEX:** `tasks_subscription_id_idx` partial WHERE subscription_id IS NOT NULL.
- **DATA:** `UPDATE tasks SET created_via='manual_admin' WHERE subscription_id IS NULL` (backfill of pre-existing rows).

#### 0011_asset_tracking_cache.sql

- **CREATE TABLE `asset_tracking_cache`:** id, task_id FK→tasks CASCADE, task_id_external bigint NOT NULL, external_record_id bigint NOT NULL, tracking_id text NOT NULL, `awb text GENERATED ALWAYS AS (substring(tracking_id from '^(.+)-[^-]+$')) STORED NOT NULL`, type text NOT NULL CHECK (type IN ('BAGS')), state text NOT NULL CHECK (state IN ('COLLECTED','EN_ROUTE','RECEIVED','RETURNED')), photos jsonb, notes text, supplementary_quantity integer, container_id bigint, collected_by jsonb, enroute_by jsonb, received_by jsonb, returned_by jsonb, tenant_id FK→tenants CASCADE, last_synced_at, created_at, updated_at. CONSTRAINT `tracking_id_unique UNIQUE`, `tracking_id_format CHECK (tracking_id ~ '^.+-[^-]+$')`.
- **CREATE INDEX:** `asset_tracking_cache_tenant_awb_idx`, `asset_tracking_cache_tenant_task_idx`.
- **CREATE POLICY:** `asset_tracking_cache_tenant_isolation`.
- **CREATE FUNCTION:** `asset_tracking_cache_assert_tenant_match()`.
- **CREATE TRIGGER:** `asset_tracking_cache_set_updated_at`, `asset_tracking_cache_tenant_match`.

#### 0012_task_generation_runs.sql

- **CREATE TABLE `task_generation_runs`:** id, tenant_id FK CASCADE, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, `status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','capped','skipped_already_run','failed'))`, cap_threshold integer NOT NULL CHECK (>0), projected_count integer CHECK (NULL or >= 0), subscriptions_walked integer (same), tasks_created integer (same), tasks_skipped_existing integer (same), error_text text, started_at, completed_at, created_at, updated_at. CONSTRAINTS: `window_strict CHECK (start < end)`, `window_unique UNIQUE (tenant_id, window_start, window_end)`.
- **CREATE INDEX:** `task_generation_runs_tenant_id_idx`, `tenant_started_idx`, `tenant_running_idx` partial. Also **on tasks table:** `tasks_subscription_delivery_date_unique_idx UNIQUE (subscription_id, delivery_date) WHERE subscription_id IS NOT NULL` (partial UNIQUE).
- **CREATE POLICY:** `task_generation_runs_tenant_isolation`.
- **CREATE TRIGGER:** `task_generation_runs_set_updated_at`.

#### 0013_sf_integration_required_fields.sql

- **ALTER TABLE consignees:** `ADD COLUMN district text` then `ALTER COLUMN district SET NOT NULL` (after backfill).
- **ALTER TABLE tenants:** `ADD COLUMN suitefleet_customer_code text` (nullable). NB: stores numeric `customerId` despite name; rename deferred under forward-only rule.
- **CREATE TABLE `tenant_suitefleet_webhook_credentials`:** `tenant_id uuid PK REFERENCES tenants(id) ON DELETE CASCADE`, client_id text NOT NULL, client_secret_hash text NOT NULL, rotated_at timestamptz, created_at, updated_at.
- **CREATE POLICY:** `tenant_suitefleet_webhook_credentials_tenant_isolation`.
- **CREATE TRIGGER:** `tenant_suitefleet_webhook_credentials_set_updated_at`.
- **DATA:** `UPDATE consignees SET district='UNKNOWN' WHERE district IS NULL` (placeholder backfill).

#### 0014_addresses_and_subscription_address_rotations.sql

- **CREATE TABLE `addresses`:** id, consignee_id FK CASCADE, tenant_id FK CASCADE, `label text NOT NULL CHECK (label IN ('home','office','other'))`, is_primary boolean NOT NULL DEFAULT false, line text NOT NULL, district text NOT NULL, emirate text NOT NULL, lat numeric(9,6), lng numeric(9,6), created_at, updated_at.
- **CREATE TABLE `subscription_address_rotations`:** id, subscription_id FK CASCADE, tenant_id FK CASCADE, `weekday int NOT NULL CHECK (BETWEEN 1 AND 7)`, address_id FK→addresses ON DELETE RESTRICT.
- **ALTER TABLE tasks:** `ADD COLUMN address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT`.
- **CREATE INDEX:** `addresses_tenant_idx`, `addresses_consignee_idx`, `addresses_one_primary_per_consignee_idx UNIQUE (consignee_id) WHERE is_primary=true` partial UNIQUE, `subscription_address_rotations_sub_weekday_idx UNIQUE (subscription_id, weekday)`, `subscription_address_rotations_tenant_idx`, `tasks_address_idx`.
- **CREATE POLICY:** `addresses_tenant_isolation`, `subscription_address_rotations_tenant_isolation`.
- **CREATE TRIGGER:** `addresses_set_updated_at`. (No trigger on subscription_address_rotations — no updated_at column.)

#### 0015_subscription_exceptions_and_materialization.sql

- **CREATE TABLE `subscription_exceptions`:** id, subscription_id FK CASCADE, tenant_id FK CASCADE, `type text NOT NULL CHECK (type IN ('skip','pause_window','address_override_one_off','address_override_forward','append_without_skip'))`, start_date date NOT NULL, end_date date, target_date_override date, skip_without_append boolean NOT NULL DEFAULT false, reason text, address_override_id FK→addresses ON DELETE RESTRICT, compensating_date date, correlation_id uuid NOT NULL, idempotency_key uuid NOT NULL, created_by uuid NOT NULL, created_at. Multiple CHECK constraints (address_override requires address_id; pause_window requires end_date; skip_without_append only for skip; compensating_date only for skip). NO `updated_at`, NO trigger.
- **CREATE TABLE `subscription_materialization`:** `subscription_id uuid PK FK→subscriptions CASCADE`, tenant_id FK, materialized_through_date date NOT NULL, last_materialized_at timestamptz NOT NULL. NO `updated_at`, NO trigger.
- **CREATE INDEX:** `subscription_exceptions_sub_start_idx`, `subscription_exceptions_tenant_idx`, `subscription_exceptions_idempotency_idx UNIQUE (subscription_id, idempotency_key)`, `subscription_materialization_tenant_idx`, `subscription_materialization_through_date_idx`.
- **CREATE POLICY:** both tables tenant_isolation.

#### 0016_consignee_crm_state_and_events.sql

- **ALTER TABLE consignees:** `ADD COLUMN crm_state text NOT NULL DEFAULT 'ACTIVE'`; `ADD CONSTRAINT consignees_crm_state_check CHECK (crm_state IN ('ACTIVE','ON_HOLD','HIGH_RISK','INACTIVE','CHURNED','SUBSCRIPTION_ENDED'))`.
- **CREATE TABLE `consignee_crm_events`:** id, consignee_id FK CASCADE, tenant_id FK CASCADE, from_state text (CHECK in same domain), to_state text NOT NULL (same CHECK domain), reason text, actor uuid NOT NULL, occurred_at timestamptz NOT NULL.
- **CREATE INDEX:** `consignees_tenant_crm_state_idx`, `consignee_crm_events_consignee_idx`, `consignee_crm_events_tenant_idx`.
- **CREATE POLICY:** `consignee_crm_events_tenant_isolation`.
- **CREATE VIEW `consignee_timeline_events`:** `WITH (security_invoker = true)` (Postgres 15+) — UNION ALL over CRM events + subscription exceptions + task terminal-status rows. GRANT SELECT to `planner_app`.

#### 0017_tenants_pickup_address.sql

- **ALTER TABLE tenants:** `ADD COLUMN pickup_address_line text` (nullable), `pickup_address_district text` (nullable), `pickup_address_emirate text` (nullable). No backfill, no CHECK.

#### 0018_webhook_events.sql

- **CREATE TABLE `webhook_events`:** id, tenant_id FK CASCADE, suitefleet_task_id text NOT NULL, action text NOT NULL, event_timestamp timestamptz NOT NULL, raw_payload jsonb NOT NULL, received_at timestamptz NOT NULL.
- **CREATE INDEX:** `webhook_events_dedup_idx UNIQUE (suitefleet_task_id, action, event_timestamp)`, `webhook_events_tenant_idx`, `webhook_events_task_idx`.
- **CREATE POLICY:** `webhook_events_tenant_isolation`. GRANT SELECT+INSERT only to `planner_app` (append-only, mirrors audit_events).

#### 0019_tasks_internal_status_skipped.sql

- **ALTER TABLE tasks:** `DROP CONSTRAINT tasks_internal_status_check`, then `ADD CONSTRAINT tasks_internal_status_check CHECK (internal_status IN ('CREATED','ASSIGNED','IN_TRANSIT','DELIVERED','FAILED','CANCELED','ON_HOLD','SKIPPED'))`. Extends 7→8 values.

#### 0020_task_generation_runs_target_date_column_and_unique.sql

- Wrapped in BEGIN/COMMIT.
- **ALTER TABLE task_generation_runs:** `ADD COLUMN target_date date` (initially nullable); then backfill `UPDATE ... SET target_date = ((window_start AT TIME ZONE 'Asia/Dubai')::date + 1)`; then `DELETE` duplicates; then `ALTER COLUMN target_date SET NOT NULL`.
- **CREATE INDEX:** `task_generation_runs_tenant_target_date_unique_idx UNIQUE (tenant_id, target_date)`.

#### 0021_tenants_status_archived.sql

- **ALTER TABLE tenants:** `DROP CONSTRAINT tenants_status_check`, then `ADD CONSTRAINT tenants_status_check CHECK (status IN ('provisioning','active','suspended','inactive','archived'))`. Widens 4→5.
- **DATA:** `UPDATE tenants SET status='archived' WHERE slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers') AND status!='archived'`.

#### 0022_tasks_webhook_extracted_columns.sql

- **ALTER TABLE tasks ADD COLUMN (×10, all nullable):** `pod_photos jsonb`, `recipient_name text`, `signature text`, `consignee_rating smallint`, `consignee_comment text`, `driver_comment text`, `number_of_attempts smallint`, `failure_reason_comment text`, `completion_latitude numeric`, `completion_longitude numeric`.

#### 0023_outbound_push_failures.sql

- **CREATE TABLE `outbound_push_failures`:** id, tenant_id FK CASCADE, task_id FK→tasks CASCADE, `operation text NOT NULL CHECK (operation IN ('update','cancel','bulk_cancel'))`, correlation_id uuid NOT NULL, `failure_reason text NOT NULL CHECK (failure_reason IN ('network','server_5xx','client_4xx','timeout','bulk_partial_failure','unknown'))`, failure_payload jsonb, retry_count integer NOT NULL DEFAULT 0 CHECK (>=0), created_at, resolved_at timestamptz. NO `updated_at`.
- **CREATE INDEX:** `outbound_push_failures_tenant_id_idx`, `unresolved_idx` partial, `task_id_idx`.
- **CREATE POLICY:** `outbound_push_failures_tenant_isolation`.
- **CREATE FUNCTION:** `outbound_push_failures_assert_tenant_match()`.
- **CREATE TRIGGER:** `outbound_push_failures_tenant_match`. (No set_updated_at trigger — no updated_at column.)

### A.2 Consolidated expected `public` schema state at 0023

**21 expected tables in `public`** (alphabetical):

| # | Table | Created in |
|---|---|---|
| 1 | `addresses` | 0014 |
| 2 | `api_keys` | 0001 |
| 3 | `asset_tracking_cache` | 0011 |
| 4 | `audit_events` | 0002 |
| 5 | `consignee_crm_events` | 0016 |
| 6 | `consignees` | 0004 |
| 7 | `failed_pushes` | 0008 |
| 8 | `outbound_push_failures` | 0023 |
| 9 | `role_assignments` | 0001 |
| 10 | `roles` | 0001 |
| 11 | `subscription_address_rotations` | 0014 |
| 12 | `subscription_exceptions` | 0015 |
| 13 | `subscription_materialization` | 0015 |
| 14 | `subscriptions` | 0009 |
| 15 | `task_generation_runs` | 0012 |
| 16 | `task_packages` | 0007 |
| 17 | `tasks` | 0006 |
| 18 | `tenant_suitefleet_webhook_credentials` | 0013 |
| 19 | `tenants` | 0001 |
| 20 | `users` | 0001 |
| 21 | `webhook_events` | 0018 |

**1 expected view in `public`:** `consignee_timeline_events` (0016, `security_invoker=true`).

**Expected final column shape for the five identity tables** (per A.1 plus A.3 deltas):

- **`tenants`** (14 columns): `id`, `slug`, `name`, `status` (5-value CHECK after 0021), `source_of_truth`, `created_at`, `updated_at`, `migration_gate_status`, `migration_gate_set_at`, `migration_gate_set_by`, `suitefleet_customer_code`, `pickup_address_line`, `pickup_address_district`, `pickup_address_emirate`.
- **`users`** (7 columns, unchanged from 0001): `id`, `tenant_id`, `email`, `display_name`, `disabled_at`, `created_at`, `updated_at`.
- **`roles`** (7 columns, unchanged from 0001): `id`, `tenant_id`, `name`, `slug`, `description`, `created_at`, `updated_at`. Note: `tenant_id` is nullable (global roles).
- **`role_assignments`** (5 columns, unchanged from 0001): `id`, `user_id`, `role_id`, `tenant_id`, `assigned_at`. NO `updated_at`.
- **`api_keys`** (11 columns, unchanged from 0001): `id`, `tenant_id`, `name`, `hash`, `permissions`, `ip_allowlist`, `rate_limit_rpm`, `expires_at`, `created_at`, `last_used_at`, `revoked_at`. NO `updated_at`.

### A.3 set_updated_at() — function definition site + every attaching migration

- **Function defined in:** `0001_identity.sql` (lines 50–56). `CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;`
- **No later migration redefines it.** If production lacks this function, every table that wants its `updated_at` to advance on UPDATE is silently degraded — the DEFAULT now() only fires on INSERT.

**12 expected `set_updated_at` triggers** (all BEFORE UPDATE FOR EACH ROW):

| # | Table | Trigger name | Source |
|---|---|---|---|
| 1 | `tenants` | `tenants_set_updated_at` | 0001 |
| 2 | `users` | `users_set_updated_at` | 0001 |
| 3 | `roles` | `roles_set_updated_at` | 0001 |
| 4 | `consignees` | `consignees_set_updated_at` | 0004 |
| 5 | `tasks` | `tasks_set_updated_at` | 0006 |
| 6 | `task_packages` | `task_packages_set_updated_at` | 0007 |
| 7 | `failed_pushes` | `failed_pushes_set_updated_at` | 0008 |
| 8 | `subscriptions` | `subscriptions_set_updated_at` | 0009 |
| 9 | `asset_tracking_cache` | `asset_tracking_cache_set_updated_at` | 0011 |
| 10 | `task_generation_runs` | `task_generation_runs_set_updated_at` | 0012 |
| 11 | `tenant_suitefleet_webhook_credentials` | `tenant_suitefleet_webhook_credentials_set_updated_at` | 0013 |
| 12 | `addresses` | `addresses_set_updated_at` | 0014 |

**Tables that deliberately DO NOT carry a `set_updated_at` trigger** (no `updated_at` column, by design): `role_assignments`, `api_keys`, `audit_events` (append-only RULE), `subscription_address_rotations`, `subscription_exceptions`, `subscription_materialization`, `consignee_crm_events`, `webhook_events` (append-only GRANT), `outbound_push_failures`.

**Additional trigger functions** (CREATE OR REPLACE) — tenant-match assertions:
- `task_packages_assert_tenant_match()` (0007)
- `failed_pushes_assert_tenant_match()` (0008)
- `asset_tracking_cache_assert_tenant_match()` (0011)
- `outbound_push_failures_assert_tenant_match()` (0023)

### A.4 0001's expected shape of `public.users` — load-bearing

Production has reported `public.users` exists but is missing `updated_at`. The repo's `0001_identity.sql` (lines 103–111) defines exactly **7 columns** on this table:

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, REFERENCES `auth.users(id)` ON DELETE CASCADE |
| `tenant_id` | `uuid` | NOT NULL, REFERENCES `tenants(id)` ON DELETE CASCADE |
| `email` | `text` | NOT NULL |
| `display_name` | `text` | nullable |
| `disabled_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | NOT NULL DEFAULT now() |
| `updated_at` | `timestamptz` | NOT NULL DEFAULT now() |

Plus: index `users_tenant_id_idx (tenant_id)`, RLS enabled, policy `users_tenant_isolation` (FOR ALL), trigger `users_set_updated_at`.

**Implications for Part B.** Production's `public.users` missing `updated_at` is one observed delta. The audit must determine: (a) which OTHER columns from the repo's 7 are present/absent, (b) whether ANY columns exist on prod's `public.users` that are NOT in the repo's 0001 — which would indicate a different ancestry entirely (e.g. a hand-rolled users table or one inherited from an earlier non-repo migration). The expectation diff is binary per column.

### A.5 Migration tracking mechanism — what the repo uses

**The repo has NO migration-tracking ledger of its own.** Findings:

- **No `drizzle/meta/_journal.json`** — the repo does not use Drizzle ORM's migration mechanism.
- **No `supabase/config.toml`** — no Supabase CLI project configuration. The `supabase/` directory contains `migrations/` and `seed.sql` only.
- **No `.supabase/` directory** — no local Supabase CLI state.
- **No bespoke `schema_migrations` table** in any of the 23 migrations (verified by full-tree grep).
- **CI / local test DB apply mechanism:** `scripts/setup-test-db.sh` (read in full) applies migrations via a raw `psql` loop: `for migration in "$REPO_ROOT"/supabase/migrations/[0-9]*.sql; do psql -v ON_ERROR_STOP=1 -f "$migration"; done`. No state recorded; idempotent only on a fresh DB.

**Implication for production tracking.** Production migrations have historically been applied via Love pasting each migration into the Supabase SQL editor. Supabase's hosted platform auto-populates `supabase_migrations.schema_migrations` ONLY when migrations are applied via the Supabase CLI (`supabase db push`) or the Studio UI's migrations panel — not on raw-SQL-editor paste. If past migrations were applied through any of those paths, the ledger may exist on production. If raw paste was always used, the ledger is empty or absent.

Part B treats the presence-vs-absence and content of `supabase_migrations.schema_migrations` as **itself a finding** — it tells us how migrations were historically applied.

---

## Part B — Production audit query block (read-only)

**Instructions for Love.** Part B has two parts:

1. **The MAIN BLOCK** — Q1–Q15 below (with Q12 deliberately omitted; see in-block note). Paste the entire main block into the Supabase SQL editor for project `qdotjmwqbyzldfuxphei` as a single execution. Every statement in the main block is guaranteed not to error on a schema where the expected tables/columns may be absent — they all use `pg_catalog` / `information_schema` or join candidate-table lists against `pg_class` so missing objects are silently skipped rather than thrown.
2. **The FOLLOW-UP QUERIES** — Q6-followup, Q12a, Q12b — appear in a separate section AFTER the main block. **Do not paste those with the main block.** Each runs as its own SQL-editor execution, only after the main-block result has confirmed the referenced object/column exists. The Supabase SQL editor wraps any multi-statement paste in a single transaction; if a query mid-paste throws, every statement after it is aborted and you lose the tail of the audit. The follow-up queries are the ones that could throw, so they are isolated.

Every statement in both parts is read-only (SELECT / `information_schema` / `pg_catalog`). No DDL, no writes. The output of each numbered query maps back to a specific question Part A raised.

**Before running anything:** confirm the SQL-editor URL shows project ref `qdotjmwqbyzldfuxphei`. See Q1's annotation for why this matters — `current_database()` returns the same value for every Supabase project and cannot establish project identity.

```sql
-- =============================================================================
-- Day-27 production schema audit — READ-ONLY
-- Target: Supabase project qdotjmwqbyzldfuxphei
-- DO NOT run any DDL/DML below this header. Every statement is a SELECT.
-- =============================================================================


-- Q1 — Connection context capture.
--
-- IMPORTANT — this query does NOT establish "is this the pilot DB?".
-- current_database() returns 'postgres' on every Supabase hosted project, so
-- the value is the same regardless of which project you're connected to and
-- cannot distinguish qdotjmwqbyzldfuxphei from any other project.
--
-- The actual identity check is OUT-OF-BAND, in the Supabase dashboard /
-- SQL-editor URL: before running anything else in this block, confirm the
-- editor URL shows project ref `qdotjmwqbyzldfuxphei` (the URL path will
-- contain that ref). Only proceed if it does.
--
-- What Q1 does capture: connected role, Postgres server version, and the
-- query timestamp — useful for the audit record but not for project ID.
SELECT current_database() AS db_name,    -- expected: 'postgres' (does not identify the project)
       current_user      AS connected_role,
       version()         AS pg_version,
       now()             AS query_time;


-- Q2 — Full table + view inventory of the public schema.
-- Establishes which relations exist. Compare against the 21-table + 1-view
-- expectation in Part A.2. Anything in repo but absent here = missing.
-- Anything here but not in repo = unexpected (different ancestry?).
SELECT n.nspname              AS schema,
       c.relname              AS relation_name,
       c.relkind              AS relkind, -- r=table, v=view, m=mat-view, p=partition, f=foreign, S=sequence
       pg_size_pretty(pg_relation_size(c.oid)) AS size,
       c.reltuples::bigint    AS approx_row_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','v','m','p','f')
ORDER BY c.relkind, c.relname;


-- Q3 — Existence and column inventory of the five identity tables.
-- Diffs against Part A.4 (users specifically) and A.2 (the four absent tables).
-- If a table is absent, it returns zero rows for that table_name. If present,
-- every column with its type, nullability, and default is returned.
SELECT table_name,
       column_name,
       data_type,
       is_nullable,
       column_default,
       character_maximum_length,
       ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tenants','users','roles','role_assignments','api_keys')
ORDER BY table_name, ordinal_position;


-- Q4 — Existence of set_updated_at() and any other functions with that name.
-- A.3 establishes 0001 as the canonical definition site. Production was
-- reported as missing this function. Confirm here, and also surface any
-- accidental same-name variants in other schemas.
SELECT n.nspname        AS schema,
       p.proname        AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS return_type,
       l.lanname        AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l  ON l.oid = p.prolang
WHERE p.proname = 'set_updated_at';


-- Q5 — Every trigger in the public schema, with the function each calls.
-- Establishes which set_updated_at attachments exist on prod and which are
-- missing. Compare row-by-row against A.3's 12-trigger table. Also surfaces
-- the 4 tenant-match trigger functions and any other triggers.
SELECT n.nspname                  AS schema,
       c.relname                  AS table_name,
       t.tgname                   AS trigger_name,
       pg_get_triggerdef(t.oid)   AS trigger_definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
ORDER BY c.relname, t.tgname;


-- Q6 — Supabase CLI migration ledger: does the ledger relation exist?
-- A.5 explains why this is itself a finding. If the table is absent,
-- production migrations were not applied via supabase CLI / Studio panel;
-- raw SQL-editor paste was the path. If present, the follow-up query
-- (Q6-followup, in the separate section below this block) reads its
-- contents to surface which migration versions production's own ledger
-- thinks have been applied. THIS query is catalog-only and safe; it cannot
-- error on a schema where the ledger is absent.
SELECT n.nspname AS schema,
       c.relname AS table_name,
       c.relkind AS relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('supabase_migrations')
   OR (n.nspname = 'public' AND c.relname IN ('schema_migrations','_migrations'));


-- Q7 — Existence of the planner_app database role (created by 0003).
-- A.5 + 0003 inventory: the application connects to production as planner_app.
-- If the role is absent, the entire 0003 migration was not applied. If present
-- but without LOGIN, the role exists but cannot connect (LOGIN is granted
-- out-of-band per the migration header).
SELECT rolname,
       rolsuper,
       rolinherit,
       rolcreaterole,
       rolcreatedb,
       rolcanlogin,
       rolreplication,
       rolbypassrls,
       rolconnlimit,
       rolvaliduntil
FROM pg_roles
WHERE rolname IN ('planner_app','postgres','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin')
ORDER BY rolname;


-- Q8 — RLS enablement state on every public table.
-- A.1 + A.2 establish that every multi-tenant table has RLS enabled at
-- migration time. If a table exists on prod but RLS is disabled, that's a
-- divergence finding (possibly partial migration application).
SELECT n.nspname  AS schema,
       c.relname  AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;


-- Q9 — Every RLS policy on every public relation.
-- A.1 establishes the policy footprint. Useful as a cross-check for "table
-- exists but has no policies" cases — possible signature of partial apply.
SELECT n.nspname         AS schema,
       c.relname         AS table_name,
       p.polname         AS policy_name,
       p.polcmd          AS for_command,  -- r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL
       p.polpermissive   AS permissive
FROM pg_policy p
JOIN pg_class c     ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, p.polname;


-- Q10 — Row counts on every public table that currently exists.
-- Addresses the "is this the pilot DB / was it wiped" question. If the
-- identity tables are absent but app tables (consignees, tasks, subscriptions)
-- carry pilot data, the partial-wipe / different-ancestry hypothesis sharpens.
-- If app tables are also empty/absent, the "different DB" hypothesis is more
-- plausible.
SELECT n.nspname              AS schema,
       c.relname              AS table_name,
       c.reltuples::bigint    AS approx_row_count_from_statistics,
       pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.reltuples DESC, c.relname;


-- Q11 — Exact row counts on the public tables that matter most for the
-- "is this the pilot DB" question. pg_class.reltuples in Q10 is an estimate;
-- this confirms ground truth on the relations that are most signal-dense.
-- Resilient form: only counts tables that ACTUALLY EXIST on production by
-- joining against pg_class. Non-existent tables in the candidate list are
-- silently omitted — their absence is already established by Q2/Q3. No DDL,
-- no writes — query_to_xml is a read-only catalog function that wraps the
-- dynamic count in an inline subquery.
WITH wanted(table_name) AS (
  VALUES ('users'),('consignees'),('subscriptions'),('tasks'),
         ('audit_events'),('webhook_events'),('addresses'),
         ('task_generation_runs'),('roles'),('role_assignments'),
         ('api_keys'),('tenants')
)
SELECT format('public.%I', w.table_name) AS table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM public.%I', w.table_name),
                           true, true, '')))[1]::text::bigint
         AS exact_row_count
FROM wanted w
JOIN pg_class c ON c.relname = w.table_name
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r'
ORDER BY w.table_name;


-- Q12 — MOVED to the FOLLOW-UP QUERIES section below the main block.
-- Q12a (created_at range on public.users) and Q12b (tenant_id distribution)
-- both reference columns that may not exist on production's public.users
-- (Q3 surfaces the actual column list). Running them inside the main block
-- would risk aborting the whole transaction. They are deliberately kept
-- OUT of the main block; run them individually after the main block
-- completes, only if Q3 confirmed the referenced columns are present.


-- Q13 — Supabase Vault extension availability (already-known blocker from
-- the credentials lane pre-merge gate).
-- Lane-adjacent: not strictly part of the absent-identity-schema audit, but
-- since Vault is required for migration 0024 once we get there, capture the
-- state in the same audit pass so the reconciliation plan has full context.
SELECT extname, extversion, n.nspname AS schema
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE extname IN ('supabase_vault','pgsodium','pgcrypto','uuid-ossp')
ORDER BY extname;


-- Q14 — Existence of every named CONSTRAINT mentioned by 0001 on the five
-- identity tables. If the tables exist but the constraints don't, that's a
-- partial-application signature.
SELECT n.nspname  AS schema,
       c.relname  AS table_name,
       con.conname AS constraint_name,
       con.contype AS type  -- c=check, f=foreign-key, p=primary-key, u=unique, x=exclude
FROM pg_constraint con
JOIN pg_class c     ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('tenants','users','roles','role_assignments','api_keys')
ORDER BY c.relname, con.contype, con.conname;


-- Q15 — Existence of every named RULE on public relations.
-- 0002 creates audit_events_no_update + audit_events_no_delete. Their
-- presence/absence diagnoses 0002 application state.
SELECT n.nspname AS schema,
       c.relname AS table_name,
       r.rulename AS rule_name,
       CASE r.ev_type
            WHEN '1' THEN 'SELECT'
            WHEN '2' THEN 'UPDATE'
            WHEN '3' THEN 'INSERT'
            WHEN '4' THEN 'DELETE'
       END AS rule_event
FROM pg_rewrite r
JOIN pg_class c     ON c.oid = r.ev_class
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND r.rulename != '_RETURN'   -- _RETURN is the implicit view-rewrite rule on every view
ORDER BY c.relname, r.rulename;


-- =============================================================================
-- End of MAIN audit query block.
--
-- Expected reading order for the main block: Q1 (connection context, not
-- project ID) → Q2 (relation inventory vs 21) → Q3 (identity columns) →
-- Q4 (set_updated_at function) → Q5 (triggers) → Q6 (ledger existence) →
-- Q7 (planner_app role) → Q8 (RLS) → Q9 (policies) → Q10 + Q11 (row
-- counts) → Q13 (vault) → Q14 (identity constraints) → Q15 (rules).
-- Q12 lives in the follow-up section below — not in the main block.
--
-- Every query above is safe to run as one paste: each statement either uses
-- pg_catalog / information_schema (which never errors on missing relations)
-- or, in Q11's case, joins the candidate-table list against pg_class so
-- non-existent tables are silently omitted. The block as a whole completes
-- regardless of how much of the expected schema is absent.
-- =============================================================================
```

### FOLLOW-UP QUERIES — run each INDIVIDUALLY, one at a time

The three queries below are NOT in the main block. The Supabase SQL editor wraps a pasted multi-statement block in a single transaction; one error aborts every subsequent statement. These three reference relations / columns that may be absent on production — running them inside the main block would have risked losing the tail of the audit. They're broken out so an error in one cannot affect anything else.

**Discipline for running these.** Run each in its own SQL-editor execution (don't paste this whole section as one block). For each, the main-block results will already have told you whether the referenced object exists; only run the follow-up if the corresponding main-block query confirmed presence. If you run one anyway and it errors, the error establishes the absence — but no other query is affected.

#### Q6-followup — read the Supabase CLI migration ledger contents

Run ONLY if Q6 returned a row (i.e. the ledger relation exists). If Q6 returned zero rows, do not run this — the absence is already the finding.

```sql
SELECT *
FROM supabase_migrations.schema_migrations
ORDER BY version;
```

#### Q12a — `public.users` created_at range and total row count

Run ONLY if Q3 confirmed `public.users.created_at` exists. The result tells us approximately when this users table started being written to, which helps date the pilot timeline against the (absent) identity schema.

```sql
SELECT 'public.users' AS table_name,
       min(created_at) AS earliest_created_at,
       max(created_at) AS latest_created_at,
       count(*)        AS total_rows
FROM public.users;
```

#### Q12b — distinct tenant_id values in `public.users` and per-tenant row count

Run ONLY if Q3 confirmed `public.users.tenant_id` exists. The set of distinct values + counts reveals how many tenants prod's users rows reference, even though the tenants table itself is absent. Likely a key clue for the "which DB / partial wipe" question.

```sql
SELECT tenant_id, count(*) AS row_count
FROM public.users
GROUP BY tenant_id
ORDER BY row_count DESC;
```

---

## Reading discipline for the reviewer

This document is audit input, not reconciliation. It explicitly does not:
- propose a fix order
- draft any CREATE/ALTER/DROP SQL
- pick between the "different DB" / "0001 never applied" / "partial wipe" explanations
- assume what Love will find when running Part B

The reconciliation plan-PR is the next T3 lane, opened AFTER Love runs Part B and reports back. Per the hard constraint: no reconciliation SQL is improvised live in the SQL editor.

---

**End of Day-27 production schema audit input.**
