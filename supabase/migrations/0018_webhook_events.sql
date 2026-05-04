-- =============================================================================
-- supabase/migrations/0018_webhook_events.sql
-- =============================================================================
-- Day 13 / T3 part 1: webhook_events table — append-only preservation of
-- raw SuiteFleet webhook payloads with deduplication. Implements
-- memory/plans/day-13-exception-model-part-1.md §1.8.
--
-- §0.2 Q3 prod verification confirmed the table does NOT exist in
-- production — net-new table including the raw_payload column. Webhook
-- events today flow only through audit_events (per
-- src/modules/webhooks/queries.ts) — that audit-event flow stays;
-- webhook_events is the parallel raw-payload preservation surface so
-- future-backfill is possible if the parsed extraction ever needs to
-- recover fields that were dropped at receipt time.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007/0008/0009/0011/0012/0014/
-- 0015/0016.
--
-- -----------------------------------------------------------------------------
-- Append-only posture
-- -----------------------------------------------------------------------------
-- Mirrors the audit_events policy: GRANT INSERT + SELECT only — no UPDATE,
-- no DELETE. Webhook payloads are evidence; mutating them after the fact
-- would defeat the forensic purpose. If a payload is malformed and needs
-- a corrected resend, the dedup UNIQUE makes the corrected resend safe
-- (it lands as a new row only if the (suitefleet_task_id, action,
-- event_timestamp) tuple differs).
--
-- -----------------------------------------------------------------------------
-- Webhook deduplication via UNIQUE (per brief §3.1.10)
-- -----------------------------------------------------------------------------
-- Brief §3.1.10: "Webhook deduplication: (suitefleet_task_id, action,
-- timestamp) UNIQUE on webhook_events." A SuiteFleet webhook retry on a
-- non-2xx response from our receiver lands the same payload again; the
-- UNIQUE collapses the retry to a single stored row (the first attempt's
-- raw_payload wins; the retry hits SQLSTATE 23505 and the receiver
-- treats it as already-seen).
--
-- Why these three columns:
--   - suitefleet_task_id: the SF task being eventized
--   - action: the webhook event code (e.g., TASK_HAS_BEEN_ORDERED — see
--     brief §3.1.10 canonical SF codes list)
--   - event_timestamp: the SF-side timestamp of the event (NOT received_at,
--     which is OUR timestamp on receipt — two retries from SF carry the
--     same event_timestamp but different received_at)
--
-- -----------------------------------------------------------------------------
-- raw_payload jsonb NOT NULL
-- -----------------------------------------------------------------------------
-- The point of the table is the raw payload. NULL would mean "we received
-- a webhook but lost the body" — operationally meaningless to record.
-- jsonb (not json) for query-side flexibility (jsonb supports operators,
-- indexes, in-place GIN) and on-disk efficiency.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. webhook_events_dedup_idx UNIQUE (suitefleet_task_id, action,
--      event_timestamp) — the deduplication anchor; brief §3.1.10.
--   2. webhook_events_tenant_idx (tenant_id) — RLS predicate path.
--   3. webhook_events_task_idx (suitefleet_task_id) — operator drill-down
--      "show me all webhook activity for SF task X."
-- =============================================================================


CREATE TABLE webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  suitefleet_task_id  text NOT NULL,
  action              text NOT NULL,
  event_timestamp     timestamptz NOT NULL,
  raw_payload         jsonb NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now()
);

-- Webhook deduplication anchor per brief §3.1.10.
CREATE UNIQUE INDEX webhook_events_dedup_idx
  ON webhook_events (suitefleet_task_id, action, event_timestamp);

CREATE INDEX webhook_events_tenant_idx
  ON webhook_events (tenant_id);

CREATE INDEX webhook_events_task_idx
  ON webhook_events (suitefleet_task_id);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_events_tenant_isolation ON webhook_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Append-only: SELECT + INSERT, no UPDATE / DELETE. Mirrors audit_events
-- (0002) posture.
GRANT SELECT, INSERT ON webhook_events TO planner_app;
