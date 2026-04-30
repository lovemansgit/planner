-- =============================================================================
-- supabase/migrations/0009_subscription.sql
-- =============================================================================
-- Day 6 / S-1: subscriptions table — recurring delivery rule.
--
-- The pilot's central operational primitive. A subscription represents
-- "consignee X gets a delivery on days {Mon, Wed, Fri} between 14:00 and
-- 16:00, between 2026-05-01 and 2026-08-31." The Day-7 cron walks the
-- next-day window and turns matching subscriptions into tasks (one task
-- per consignee per scheduled day).
--
-- Mutable in place: a subscription is edited (skip Wednesday, change
-- delivery window, swap consignee address override) without versioning.
-- Historical task rows preserve the snapshot at task-creation time, so
-- editing a subscription does not retroactively rewrite past deliveries.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007/0008. See deviation note in
-- 0001 header for the full reasoning (fail-closed on unset/cleared session
-- variable; no `invalid_text_representation` cast errors against the empty
-- string that `withServiceRole` writes).
--
-- -----------------------------------------------------------------------------
-- Column-level decisions (load-bearing — explained where they aren't obvious)
-- -----------------------------------------------------------------------------
--   tenant_id ON DELETE CASCADE:
--     If a tenant is deleted (rare; pilot policy is suspend, not delete),
--     their subscriptions go with them. Same posture as 0001's
--     users → tenants and 0006's tasks → tenants.
--
--   consignee_id ON DELETE RESTRICT (not CASCADE):
--     A consignee with active subscriptions must not be silently reaped.
--     RESTRICT forces the operator to either end/pause the consignee's
--     subscriptions first or use a soft-delete path. Same defence-in-
--     depth posture as 0006_task.sql's consignee FK and 0004_consignee.sql's
--     header note on hard-DELETE-with-audit.
--
--   status ('active', 'paused', 'ended'):
--     Lifecycle FSM. 'paused' is reversible (resume → 'active'). 'ended'
--     is terminal — the cron stops generating tasks once a subscription
--     ends. Distinct from row deletion: ended subscriptions stay on the
--     table for forensic / reporting purposes. paused_at and ended_at
--     timestamps record when the transition happened (paired with status
--     transitions; never set together).
--
--   start_date / end_date:
--     `date`, not `timestamptz`. Subscriptions are operated in days,
--     not seconds. end_date NULL = open-ended (subscription runs until
--     explicitly ended).
--
--   days_of_week integer[] with ISO 1-7 (Mon=1, Sun=7):
--     Postgres array type — `@>` and `&&` operators index well, and
--     `WHERE 3 = ANY(days_of_week)` ("subscriptions running on Wednesday")
--     is a direct cron query. ISO 1-7 numbering avoids the US/EU
--     week-start ambiguity (POSIX 0-6 with Sun=0 vs ISO 1-7 with Mon=1
--     drift in cron windows that span timezones).
--
--   delivery_address_override jsonb:
--     Override is rare and full-shape (matches consignee.location in
--     webhook payloads). jsonb keeps the type stable as the address
--     shape evolves; future fields (geofence, addressCode) don't require
--     new migrations on this table.
--
--   meal_plan_name / external_ref / notes_internal:
--     Cosmetic / external-reference / operator-note fields. None are
--     load-bearing for the cron's task-generation logic — purely human
--     context.
--
-- -----------------------------------------------------------------------------
-- CHECK constraints — split per concern (deviation from brief §9 literal)
-- -----------------------------------------------------------------------------
-- The brief specified one combined CHECK with three AND-joined conditions.
-- Splitting into named-concern CHECKs is functionally equivalent but
-- gives better diagnostics — a constraint violation reports the specific
-- failing CHECK rather than the combined condition. Each constraint
-- documents a distinct invariant, so editing one in a future migration
-- doesn't risk the others.
--
-- Two specific CHECKs worth noting:
--
--   1. days_of_week non-empty + element-domain.
--
--      The brief used `array_length(days_of_week, 1) BETWEEN 1 AND 7`,
--      which silently allows empty arrays — `array_length(ARRAY[]::int[], 1)`
--      returns NULL, and `NULL BETWEEN 1 AND 7` evaluates to NULL, which
--      a CHECK constraint treats as PASS (CHECKs only fail on FALSE).
--      This file uses `cardinality(days_of_week) BETWEEN 1 AND 7` instead,
--      which returns 0 for empty arrays and so correctly rejects them.
--      The integration test `tests/integration/subscription-check-constraints.spec.ts`
--      pins this with an explicit empty-array case.
--
--      The element-domain CHECK `days_of_week <@ ARRAY[1,2,3,4,5,6,7]`
--      asserts every element is in 1-7 (ISO weekday range). This was
--      requested by the counter-reviewer; not in the brief's literal
--      schema. `<@` is the "is contained by" operator on arrays.
--
--   2. delivery_window_start < delivery_window_end.
--
--      Strict less-than (not <=). A zero-length window is operationally
--      meaningless and almost certainly an input mistake.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. (tenant_id)
--        — list-by-tenant scans, the catch-all baseline used by every
--          list query through `withTenant`.
--   2. (tenant_id, status)
--        — operator dashboard "show me active subscriptions" /
--          "show me paused subscriptions needing attention".
--   3. (tenant_id, consignee_id)
--        — consignee-detail page lists this consignee's subscriptions.
--   4. (tenant_id, start_date, end_date)
--        — Day-7+ cron's task-generation query: "subscriptions whose
--          window includes tomorrow". The compound shape supports
--          range scans on start_date plus filter on end_date IS NULL
--          OR end_date >= tomorrow.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future
-- tables created by `postgres` automatically grant CRUD to `planner_app`.
-- The explicit GRANT below is belt-and-braces — the migration is self-
-- contained, so anyone reading the file can confirm RLS-enforced access
-- without having to trace back to 0003's defaults.
-- =============================================================================


CREATE TABLE subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consignee_id              uuid NOT NULL REFERENCES consignees(id) ON DELETE RESTRICT,
  status                    text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'paused', 'ended')),
  start_date                date NOT NULL,
  end_date                  date,
  days_of_week              integer[] NOT NULL,
  delivery_window_start     time NOT NULL,
  delivery_window_end       time NOT NULL,
  delivery_address_override jsonb,
  meal_plan_name            text,
  external_ref              text,
  notes_internal            text,
  paused_at                 timestamptz,
  ended_at                  timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_end_date_after_start
    CHECK (end_date IS NULL OR end_date >= start_date),

  CONSTRAINT subscriptions_days_of_week_non_empty
    CHECK (cardinality(days_of_week) BETWEEN 1 AND 7),

  CONSTRAINT subscriptions_days_of_week_iso_domain
    CHECK (days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),

  CONSTRAINT subscriptions_delivery_window_strict
    CHECK (delivery_window_start < delivery_window_end)
);

CREATE INDEX subscriptions_tenant_id_idx        ON subscriptions (tenant_id);
CREATE INDEX subscriptions_tenant_status_idx    ON subscriptions (tenant_id, status);
CREATE INDEX subscriptions_tenant_consignee_idx ON subscriptions (tenant_id, consignee_id);
CREATE INDEX subscriptions_tenant_dates_idx     ON subscriptions (tenant_id, start_date, end_date);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_tenant_isolation ON subscriptions
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO planner_app;
