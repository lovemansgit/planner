-- 0032_asset_scan_log.sql
-- =============================================================================
-- Day-54 P1 — append-only asset scan log (bag-tracking reports, plan
-- PR #502 §4 Love-cleared; PARKS SQL-TO-APPLY for Love's NAMED
-- authorization — never firing-cleared, never builder-applied to
-- production without it).
--
-- One row per OBSERVED (tracking_id, state) — first sighting and every
-- transition, written by the same code paths that write
-- asset_tracking_cache (read-through refresh + 30-minute poll today;
-- webhook ingestion reserved). NEVER updated, NEVER deleted: the Asset
-- Log surface renders these lines verbatim and Love's spec says prior
-- statuses are never overwritten.
--
-- Timestamp columns (Love's ruling + Aqib's vendor answer 2026-06-12):
--   vendor_scanned_at  SF's own scan time. NULL today — the API does
--                      not ship scan timestamps yet (vendor roadmap;
--                      memory/followup_vendor_scanned_at_activation.md).
--                      Populated the moment the wire carries it — no
--                      further migration needed at activation.
--   received_at        when Planner observed the state. NOT NULL.
--                      Display rule: vendor_scanned_at when present,
--                      else received_at labeled "recorded in Planner".
--
-- Append-only enforcement: BEFORE UPDATE OR DELETE trigger that RAISEs
-- — NOT the 0002 `DO INSTEAD NOTHING` rule pattern, which is
-- documented to break ON DELETE CASCADE from tenants
-- (memory/followup_audit_rule_cascade_conflict.md) by silently
-- no-opping the cascade and failing the parent delete's FK check.
-- Deliberate consequence of the trigger variant: deleting a tenant (or
-- a task) that has scan history RAISEs instead of cascading — scan
-- history is forensic data; merchant teardown must consciously clear
-- it first via the documented GUC escape hatch:
--   SET app.allow_scan_log_delete = 'on';  -- session-local, service role only
-- (scripts/teardown-merchant.mjs is the only sanctioned setter.)
--
-- FKs use ON DELETE RESTRICT to make the posture explicit in the
-- schema rather than discovered at trigger time.

CREATE TABLE asset_scan_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  task_id            uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  tracking_id        text NOT NULL,
  awb                text NOT NULL,
  state              text NOT NULL,
  vendor_scanned_at  timestamptz,
  received_at        timestamptz NOT NULL,
  scanned_by         jsonb,
  source             text NOT NULL,
  sf_payload         jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),

  -- Vendor-CONFIRMED complete 5-state enum (Aqib, 2026-06-12 — the
  -- 0033 companion extends asset_tracking_cache to the same five).
  CONSTRAINT asset_scan_log_state_check
    CHECK (state IN ('COLLECTED', 'EN_ROUTE', 'RECEIVED', 'RETURNED', 'SORTED')),
  CONSTRAINT asset_scan_log_source_check
    CHECK (source IN ('read_through', 'poll', 'webhook')),
  CONSTRAINT asset_scan_log_tracking_id_format
    CHECK (tracking_id ~ '^.+-[^-]+$')
);

-- Report aggregation reads by AWB and by time window; the log surface
-- reads (tenant, awb) and (tenant, tracking_id) ordered by time.
CREATE INDEX asset_scan_log_tenant_awb_idx
  ON asset_scan_log (tenant_id, awb);
CREATE INDEX asset_scan_log_tenant_tracking_received_idx
  ON asset_scan_log (tenant_id, tracking_id, received_at);
CREATE INDEX asset_scan_log_tenant_received_idx
  ON asset_scan_log (tenant_id, received_at);

ALTER TABLE asset_scan_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_scan_log_tenant_isolation ON asset_scan_log
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- Append-only invariant
-- -----------------------------------------------------------------------------
-- RAISEs on UPDATE always. RAISEs on DELETE unless the session has
-- consciously set the teardown GUC (merchant teardown is the ONLY
-- sanctioned path; routine application code never sets it). Trigger
-- fires under BYPASSRLS callers too — this guards the service-role
-- writer against itself, the same defence-in-depth posture as the
-- 0011 tenant-match trigger.
CREATE OR REPLACE FUNCTION asset_scan_log_append_only()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'asset_scan_log is append-only: UPDATE forbidden (id %)', OLD.id;
  END IF;
  IF COALESCE(current_setting('app.allow_scan_log_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION
      'asset_scan_log is append-only: DELETE forbidden outside merchant teardown (id %)',
      OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_scan_log_append_only
  BEFORE UPDATE OR DELETE ON asset_scan_log
  FOR EACH ROW
  EXECUTE FUNCTION asset_scan_log_append_only();

-- -----------------------------------------------------------------------------
-- Schema-layer tenant_id consistency invariant (0011 precedent)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION asset_scan_log_assert_tenant_match()
RETURNS trigger AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM tasks WHERE id = NEW.task_id;
  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'asset_scan_log.task_id % does not exist', NEW.task_id;
  END IF;
  IF parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'asset_scan_log.tenant_id % does not match parent task tenant_id %',
      NEW.tenant_id, parent_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_scan_log_tenant_match
  BEFORE INSERT ON asset_scan_log
  FOR EACH ROW
  EXECUTE FUNCTION asset_scan_log_assert_tenant_match();

-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
-- SELECT + INSERT only — no UPDATE/DELETE grants. The trigger is the
-- invariant; the missing grants are belt-and-braces.
GRANT SELECT, INSERT ON asset_scan_log TO planner_app;
