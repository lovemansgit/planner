-- =============================================================================
-- supabase/migrations/0015_subscription_exceptions_and_materialization.sql
-- =============================================================================
-- Day 13 / T3 part 1: subscription exception model + materialization
-- bookkeeping. Implements memory/plans/day-13-exception-model-part-1.md §1.1
-- + §1.2.
--
-- Two artifacts:
--
--   1. subscription_exceptions table — single-table model for all five
--      exception types (skip, pause_window, address_override_one_off,
--      address_override_forward, append_without_skip). Discriminator-plus-
--      conditional-columns shape; type-specific column constraints are
--      CHECK-enforced.
--   2. subscription_materialization table — one row per subscription
--      tracking how far the 14-day rolling horizon has materialized.
--      Schema only in part 1; the cron handler change to USE this table
--      is part 2 (and ALSO scope-shared with the Day-14 cron decoupling
--      T3 plan PR per memory/followups/cron_materialization_push_coupling.md).
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007/0008/0009/0011/0012/0014.
--
-- -----------------------------------------------------------------------------
-- Why one table for five exception types
-- -----------------------------------------------------------------------------
-- Brief §3.1.1 lists subscription_exceptions as a single table with a
-- `type` discriminator, not five sibling tables. The five types share most
-- of their columns (subscription_id, tenant_id, dates, actor, audit
-- correlation_id, idempotency_key) and differ only in which type-specific
-- column is non-null.
--
-- The plan-stage alternative — five tables, one per type — would have
-- multiplied the RLS setup, the FK fan-out, and the indexes by 5x for no
-- query-pattern win (every exception query at the service layer is "give
-- me exceptions for subscription S in date range D" — type is a filter,
-- not a partition).
--
-- Conditional CHECK constraints (named for review-grep) enforce per-type
-- column requirements:
--   - exc_address_override_requires_address_id: address overrides must
--     name an address.
--   - exc_pause_window_requires_end_date: pause windows must have a
--     resume date (no open-ended pauses in MVP — bounded pause per BRD).
--   - exc_skip_without_append_only_for_skip: the skip_without_append
--     flag is only meaningful for type='skip'.
--   - exc_compensating_date_only_for_skip: the compensating_date
--     column is populated only by the skip flow (when
--     skip_without_append=false AND target_date_override IS NULL).
--
-- -----------------------------------------------------------------------------
-- correlation_id contract
-- -----------------------------------------------------------------------------
-- Brief §7 — causally related audit events share correlation_id (uuid v7
-- per service-layer convention; the column type here is plain uuid, not
-- restricted to v7). The skip flow emits subscription.exception.created
-- AND subscription.end_date.extended in the same database transaction
-- with shared correlation_id. The pause flow emits subscription.paused
-- AND subscription.end_date.extended likewise. Service-layer enforcement
-- is part 2; this column lands the schema dependency.
--
-- NOT NULL because every exception type is paired with at least one audit
-- event (the originating subscription.exception.created emit). The
-- service-layer correlation generator is the single point that mints the
-- value; the column never has a "no audit event yet" state.
--
-- -----------------------------------------------------------------------------
-- idempotency_key UNIQUE
-- -----------------------------------------------------------------------------
-- Brief §7 — idempotency required on mutating operations. Skip API (part
-- 2) requires idempotency_key in the request body; UNIQUE on
-- (subscription_id, idempotency_key) catches duplicate retries at the DB
-- layer with SQLSTATE 23505. Service layer reads the conflict and returns
-- 409 with the existing exception_id (idempotent semantic).
--
-- -----------------------------------------------------------------------------
-- FK cascade rationale
-- -----------------------------------------------------------------------------
-- subscription_id ON DELETE CASCADE — exceptions are tightly coupled to
-- their subscription's lifecycle. Subscription delete (Phase 2 surface)
-- wipes the subscription's exceptions; an alternative posture (preserve
-- history) is filed as a Phase-2 consideration if needed.
--
-- tenant_id ON DELETE CASCADE — mirrors existing tables. Note:
-- audit-rule cascade conflict (memory/followup_audit_rule_cascade_conflict.md)
-- does NOT apply to this table (no audit-rule attached).
--
-- address_override_id ON DELETE RESTRICT — addresses referenced by an
-- exception (one-off or forward override) cannot be silently deleted;
-- forces explicit cleanup. Same posture as
-- subscription_address_rotations.address_id (0014).
--
-- -----------------------------------------------------------------------------
-- subscription_materialization table — single column besides identity
-- -----------------------------------------------------------------------------
-- The table tracks one fact: "how far in the future has this subscription
-- been materialized into tasks?" The 14-day rolling horizon (brief §3.1.5)
-- advances `materialized_through_date` nightly; the cron decides whether
-- to materialize new dates by comparing against `today + 14`.
--
-- subscription_id is the PK (one-row-per-subscription). On subscription
-- create, the row is created with materialized_through_date = today (or
-- start_date if future). On subscription delete, ON DELETE CASCADE drops
-- the row.
--
-- Why a separate table instead of a column on subscriptions:
--   - subscriptions has heavy mixed-write concurrency (CRM updates,
--     pause/resume, end_date extends); isolating the materialization
--     bookkeeping lets the cron's UPDATE not contend with operator-side
--     subscription writes.
--   - Service layer enforcement that "every active subscription has a
--     materialization row" is a constraint expressible only at the
--     application layer; a separate table makes that constraint legible.
--
-- Index strategy:
--   1. PK on subscription_id (built-in by PRIMARY KEY).
--   2. (tenant_id) — RLS predicate.
--   3. (materialized_through_date) — cron's "find subscriptions whose
--      horizon is behind today+14" query.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. subscription_exceptions
-- -----------------------------------------------------------------------------

CREATE TABLE subscription_exceptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id          uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type                     text NOT NULL,
  start_date               date NOT NULL,
  end_date                 date,
  target_date_override     date,
  skip_without_append      boolean NOT NULL DEFAULT false,
  reason                   text,
  address_override_id      uuid REFERENCES addresses(id) ON DELETE RESTRICT,
  compensating_date        date,
  correlation_id           uuid NOT NULL,
  idempotency_key          uuid NOT NULL,
  created_by               uuid NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT subscription_exceptions_type_check
    CHECK (type IN (
      'skip',
      'pause_window',
      'address_override_one_off',
      'address_override_forward',
      'append_without_skip'
    )),

  CONSTRAINT exc_address_override_requires_address_id
    CHECK (
      type NOT IN ('address_override_one_off', 'address_override_forward')
      OR address_override_id IS NOT NULL
    ),

  CONSTRAINT exc_pause_window_requires_end_date
    CHECK (
      type <> 'pause_window'
      OR end_date IS NOT NULL
    ),

  CONSTRAINT exc_skip_without_append_only_for_skip
    CHECK (
      skip_without_append = false
      OR type = 'skip'
    ),

  CONSTRAINT exc_compensating_date_only_for_skip
    CHECK (
      compensating_date IS NULL
      OR type = 'skip'
    )
);

CREATE INDEX subscription_exceptions_sub_start_idx
  ON subscription_exceptions (subscription_id, start_date);

CREATE INDEX subscription_exceptions_tenant_idx
  ON subscription_exceptions (tenant_id);

-- Idempotency anchor per brief §7. Duplicate retries with the same
-- idempotency_key per subscription hit SQLSTATE 23505; the service layer
-- (part 2) catches it and returns 409 with the existing exception_id.
CREATE UNIQUE INDEX subscription_exceptions_idempotency_idx
  ON subscription_exceptions (subscription_id, idempotency_key);

ALTER TABLE subscription_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_exceptions_tenant_isolation ON subscription_exceptions
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_exceptions TO planner_app;


-- -----------------------------------------------------------------------------
-- 2. subscription_materialization
-- -----------------------------------------------------------------------------

CREATE TABLE subscription_materialization (
  subscription_id            uuid PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  materialized_through_date  date NOT NULL,
  last_materialized_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_materialization_tenant_idx
  ON subscription_materialization (tenant_id);

CREATE INDEX subscription_materialization_through_date_idx
  ON subscription_materialization (materialized_through_date);

ALTER TABLE subscription_materialization ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_materialization_tenant_isolation ON subscription_materialization
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_materialization TO planner_app;
