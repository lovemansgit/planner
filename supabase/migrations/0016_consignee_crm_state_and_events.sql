-- =============================================================================
-- supabase/migrations/0016_consignee_crm_state_and_events.sql
-- =============================================================================
-- Day 13 / T3 part 1: consignee CRM state machine + transition audit table
-- + chronological timeline view. Implements
-- memory/plans/day-13-exception-model-part-1.md §1.5 + §1.6.
--
-- Three artifacts in one migration (atomic — the view depends on the events
-- table which itself depends on the column-add):
--
--   1. consignees.crm_state column-add — six-state enum from brief
--      §3.1.1 line 153 (verbatim): ACTIVE, ON_HOLD, HIGH_RISK, INACTIVE,
--      CHURNED, SUBSCRIPTION_ENDED. Default 'ACTIVE' on insert. Drives the
--      operator-visible CRM badge per brief §3.3.2.
--   2. consignee_crm_events table — append-style audit log of CRM state
--      transitions. Service-layer (part 2) inserts a row on every
--      changeConsigneeCrmState call alongside the audit_events emit.
--   3. consignee_timeline_events VIEW — chronological aggregator over
--      consignee_crm_events + subscription_exceptions + tasks status
--      changes. MVP-acceptable as a view per brief §3.1.1; denormalize to
--      a table in Phase 2 if performance demands.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007/0008/0009/0011/0012/0014/0015.
--
-- -----------------------------------------------------------------------------
-- crm_state CHECK enum (uppercase) — distinct from tenants.status (lowercase)
-- -----------------------------------------------------------------------------
-- Two state machines, two separate enums, two casing conventions:
--   - tenants.status (lowercase): provisioning / active / suspended / inactive.
--     Adopted from prod canon per plan §1.7.1.
--   - consignees.crm_state (UPPERCASE): ACTIVE / ON_HOLD / HIGH_RISK /
--     INACTIVE / CHURNED / SUBSCRIPTION_ENDED. Brief canon (§3.1.1 line 153).
--
-- The casing-mismatch is brief-driven, not a typo. tenants.status existed
-- in prod with lowercase before this plan; consignees.crm_state is net-new
-- and the brief specifies uppercase. The mismatch is documented for
-- reviewers — both casing conventions stay as written for their respective
-- enums.
--
-- -----------------------------------------------------------------------------
-- consignee_crm_events.from_state nullable
-- -----------------------------------------------------------------------------
-- Initial-create rows have no from_state (the consignee was just created;
-- there's no prior state to record). Subsequent transitions populate
-- from_state with the value being replaced. The plan §1.5 explicitly
-- allows nullable from_state for this case.
--
-- to_state CHECK mirrors the consignees.crm_state CHECK exactly so a
-- transition can never land an invalid value even via direct DB insert.
--
-- -----------------------------------------------------------------------------
-- consignee_crm_events FK cascades
-- -----------------------------------------------------------------------------
-- consignee_id ON DELETE CASCADE — deleting a consignee wipes the
-- transition history. Consignee delete (Phase 2 surface) is operator-rare
-- and pairs with deactivation per existing posture.
--
-- tenant_id ON DELETE CASCADE — mirrors existing pattern. Audit-rule
-- cascade conflict (memory/followup_audit_rule_cascade_conflict.md) does
-- NOT apply (no audit-rule attached to this table).
--
-- -----------------------------------------------------------------------------
-- consignee_timeline_events VIEW — RLS via underlying tables
-- -----------------------------------------------------------------------------
-- The view does not have its own RLS policy. Postgres views run with the
-- invoker's permissions by default (SECURITY INVOKER, the default), so
-- the underlying tables' RLS policies apply when a non-BYPASSRLS session
-- queries the view. A test in tests/integration/rls-tenant-isolation.spec.ts
-- (or a new file) verifies cross-tenant probes against the view return
-- zero rows.
--
-- Three UNION ALL branches:
--   1. consignee_crm_events  — CRM state transitions
--   2. subscription_exceptions JOIN subscriptions  — exceptions scoped to
--      the consignee via the subscription FK
--   3. tasks (terminal status only)  — DELIVERED / FAILED / SKIPPED /
--      CANCELED. CREATED / ASSIGNED / IN_TRANSIT / ON_HOLD are operationally
--      noisy and not what the timeline view should surface (those flow via
--      per-task drawer per brief §3.3.6).
--
-- Subscription create/pause/resume events flow via:
--   - subscription_exceptions.type='pause_window' (the pause record itself)
--   - audit_events (the lifecycle events log; not joined to the view in
--     part 1 — adds another join, deferred to Phase 2 if the timeline UI
--     demands it)
--
-- payload column is jsonb — service-layer reads pick the relevant fields
-- per event_kind. Each branch builds its payload via jsonb_build_object
-- so a reader doesn't need to know the source table to interpret the row.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
-- consignees.crm_state:
--   1. consignees_tenant_crm_state_idx (tenant_id, crm_state) — operator
--      filter on consignee list view (e.g., "show HIGH_RISK consignees" per
--      brief §3.3.2).
--
-- consignee_crm_events:
--   1. consignee_crm_events_consignee_idx (consignee_id, occurred_at DESC)
--      — per-consignee transition history, newest first.
--   2. consignee_crm_events_tenant_idx (tenant_id) — RLS predicate path.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. consignees.crm_state column-add
-- -----------------------------------------------------------------------------

ALTER TABLE consignees
  ADD COLUMN crm_state text NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE consignees
  ADD CONSTRAINT consignees_crm_state_check
    CHECK (crm_state IN (
      'ACTIVE',
      'ON_HOLD',
      'HIGH_RISK',
      'INACTIVE',
      'CHURNED',
      'SUBSCRIPTION_ENDED'
    ));

CREATE INDEX consignees_tenant_crm_state_idx
  ON consignees (tenant_id, crm_state);


-- -----------------------------------------------------------------------------
-- 2. consignee_crm_events
-- -----------------------------------------------------------------------------

CREATE TABLE consignee_crm_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignee_id  uuid NOT NULL REFERENCES consignees(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_state    text,
  to_state      text NOT NULL,
  reason        text,
  actor         uuid NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consignee_crm_events_to_state_check
    CHECK (to_state IN (
      'ACTIVE',
      'ON_HOLD',
      'HIGH_RISK',
      'INACTIVE',
      'CHURNED',
      'SUBSCRIPTION_ENDED'
    )),

  CONSTRAINT consignee_crm_events_from_state_check
    CHECK (
      from_state IS NULL
      OR from_state IN (
        'ACTIVE',
        'ON_HOLD',
        'HIGH_RISK',
        'INACTIVE',
        'CHURNED',
        'SUBSCRIPTION_ENDED'
      )
    )
);

CREATE INDEX consignee_crm_events_consignee_idx
  ON consignee_crm_events (consignee_id, occurred_at DESC);

CREATE INDEX consignee_crm_events_tenant_idx
  ON consignee_crm_events (tenant_id);

ALTER TABLE consignee_crm_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY consignee_crm_events_tenant_isolation ON consignee_crm_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON consignee_crm_events TO planner_app;


-- -----------------------------------------------------------------------------
-- 3. consignee_timeline_events VIEW
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER (the default) means RLS on the underlying tables
-- applies when a tenant-scoped session queries the view. BYPASSRLS callers
-- (withServiceRole) see all rows.

CREATE VIEW consignee_timeline_events AS
SELECT
  e.consignee_id,
  e.tenant_id,
  e.occurred_at,
  'crm_state'::text AS event_kind,
  jsonb_build_object(
    'from_state', e.from_state,
    'to_state',   e.to_state,
    'reason',     e.reason
  ) AS payload,
  e.actor AS actor_id
FROM consignee_crm_events e

UNION ALL

SELECT
  s.consignee_id,
  e.tenant_id,
  e.created_at AS occurred_at,
  'subscription_exception'::text AS event_kind,
  jsonb_build_object(
    'type',              e.type,
    'subscription_id',   e.subscription_id,
    'start_date',        e.start_date,
    'end_date',          e.end_date,
    'compensating_date', e.compensating_date,
    'reason',            e.reason
  ) AS payload,
  e.created_by AS actor_id
FROM subscription_exceptions e
JOIN subscriptions s ON s.id = e.subscription_id

UNION ALL

SELECT
  t.consignee_id,
  t.tenant_id,
  t.updated_at AS occurred_at,
  'task_status'::text AS event_kind,
  jsonb_build_object(
    'task_id',         t.id,
    'internal_status', t.internal_status,
    'delivery_date',   t.delivery_date
  ) AS payload,
  NULL::uuid AS actor_id
FROM tasks t
WHERE t.internal_status IN ('DELIVERED', 'FAILED', 'SKIPPED', 'CANCELED');

GRANT SELECT ON consignee_timeline_events TO planner_app;
