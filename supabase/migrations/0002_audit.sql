-- =============================================================================
-- supabase/migrations/0002_audit.sql
-- =============================================================================
-- Resolutions R-4: audit_events table — full column list, controlled-vocabulary
--                  event_type column, three indexes, append-only enforcement
--                  via RULE ON UPDATE/DELETE DO INSTEAD NOTHING, FOR SELECT-only
--                  RLS policy.
-- Plan §11.3 non-negotiable: forward-only — never edit this file once applied.
--
-- Append-only is enforced TWICE:
--   1. DB layer — RULE ON UPDATE/DELETE DO INSTEAD NOTHING (this file).
--   2. App layer — only `withServiceRole`-wrapped inserts. The audit module
--      (Day 2) is the sole writer; the recursion-skip contract from R-4
--      lives in `setServiceRoleObserver` (src/shared/db.ts L66) so audit
--      emits do not trigger db.service_role.use audit emits in turn.
--
-- Insert path: `withServiceRole` is required because the RLS policy below is
-- FOR SELECT only. INSERTs from `withTenant` would fall through to the
-- "no policy permits this command" deny branch. This is by design per R-4 —
-- tenants cannot inject audit rows from their own session.
--
-- Same defensive RLS policy form as 0001_identity.sql — see deviation note
-- there for full reasoning.
-- =============================================================================

CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- Who
  -- CHECK on actor_kind is a small additional defense beyond R-4's literal
  -- spec (which used a comment for the vocabulary). Rejects typos at the
  -- DB layer; the application-level types in src/shared/tenant-context.ts
  -- already constrain this set, so the CHECK is belt-and-braces.
  actor_kind    text NOT NULL
                  CHECK (actor_kind IN ('user', 'system', 'api_key')),
  -- text not uuid — covers user uuids, SystemActor name strings (e.g.
  -- 'cron:generate_tasks'), and api_key uuids interchangeably.
  -- NOT NULL: an audit event with no actor is meaningless. Edge cases
  -- (recursion-skip, unknown system) write explicit string literals like
  -- 'audit' or 'unknown', never NULL.
  actor_id      text NOT NULL,
  -- Nullable per R-4 for cross-tenant system events
  -- (e.g., db.service_role.use without tenant scope, batch.* aggregate events).
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,

  -- What — controlled vocabulary defined at src/modules/audit/event-types.ts
  -- (Day 2). New event types added by PR — never invented inline (R-4).
  event_type    text NOT NULL,
  resource_type text,
  resource_id   text,

  -- Detail
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id    text,
  ip_address    inet,
  user_agent    text
);

-- RLS: tenants see their own events. Cross-tenant system events (tenant_id IS
-- NULL) are invisible to tenant readers by design — admin tooling reads via
-- `withServiceRole` (which bypasses RLS once the Day-2 db.ts fix lands; see
-- open follow-up "Day-2 RLS BYPASSRLS hole" in project memory).
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_tenant_read ON audit_events
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- Indexes per R-4 (three).
-- -----------------------------------------------------------------------------
-- Per-tenant time-ordered scan (audit log viewer, deferred per §13.1).
CREATE INDEX audit_tenant_time   ON audit_events (tenant_id, occurred_at DESC);
-- Resource lookup (e.g., "show every audit event for this subscription").
-- Partial index because resource_id is nullable.
CREATE INDEX audit_resource      ON audit_events (resource_type, resource_id)
                                  WHERE resource_id IS NOT NULL;
-- Event-type time-ordered scan (operational queries, e.g. "all push.failed
-- in the last hour across the platform").
CREATE INDEX audit_event_type    ON audit_events (event_type, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- Append-only enforcement (R-4)
-- -----------------------------------------------------------------------------
-- DO INSTEAD NOTHING silently swallows UPDATE/DELETE with zero rows affected.
-- This is by design — append-only means append-only. Application layer never
-- attempts these; the rules are defense against accidental or malicious writes.
CREATE RULE audit_events_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
