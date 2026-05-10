-- =============================================================================
-- 0023_outbound_push_failures.sql — Day 21 / Phase 1 SF outbound DLQ
-- =============================================================================
--
-- Provider-bound outbound update / cancel / bulk-cancel failures land
-- here after QStash exhausts native retry on the corresponding queue
-- routes (`/api/queue/cancel-task-failed`, `/api/queue/update-task-failed`).
--
-- Distinct from `failed_pushes` (0008) on purpose:
--
--   - failed_pushes covers the createTask outbound path (Day-5 cron). Its
--     task_payload column is the raw createTask body (consignee snapshot
--     incl. name + phone + address) — those rows are read-bound by RLS
--     and reviewed by ops via /admin/failed-pushes.
--
--   - outbound_push_failures covers the *update* and *cancel* paths. The
--     failure_payload here is the SuiteFleet PATCH response on 4xx /
--     transient gateway, which carries echoed task entity fields that
--     include consignee.name, consignee.phone, consignee.email,
--     deliveryInformation.address.*, and free-text notes.
--
--     Per Day-21 plan-PR §3.6 CONCERN B (memory/plans/day-19-phase-1-merchant-crud.md),
--     PII is stripped at *write time* — the PII strip helper at
--     src/modules/outbound-push-failures/pii-strip.ts runs in app-code
--     BEFORE the INSERT statement. Schema-level redaction (impossible-by-
--     construction PII leak) rather than RLS-gating at read time. RLS on
--     this table is still ENABLED for tenant isolation as defence-in-
--     depth, but the load-bearing safety is the upstream strip.
--
--   - The two DLQ surfaces stay separate so ops can triage the two
--     classes of failure without confusion. /admin/dlq/outbound-push-
--     failures (UI Phase 2 per brief §G.5) reads from this table only.
--
-- =============================================================================
-- Column definitions
-- =============================================================================
--   tenant_id uuid:
--     RLS predicate column; FK to tenants(id) with ON DELETE CASCADE.
--
--   task_id uuid:
--     The local task that failed to push outbound. ON DELETE CASCADE
--     because a deleted task makes the failure record meaningless.
--
--   operation text CHECK:
--     The outbound action that failed. Closed enum; CHECK enforces.
--       'update'      — PATCH /api/tasks/awb/{awb} merge-patch update
--       'cancel'      — PATCH /api/tasks/awb/{awb} status-flip cancel
--       'bulk_cancel' — PATCH /api/tasks/bulk/{numeric_ids_csv}
--
--   correlation_id uuid:
--     Planner-side traceability. NEVER on the wire (SF ignores
--     Idempotency-Key per Day-4 createTask probe). Threaded through
--     QStash message body → adapter call → audit log → this row.
--
--   failure_reason text CHECK:
--     Categorised set; mirrors failed_pushes.failure_reason and adds the
--     bulk-specific category.
--       'network'                — adapter throw on fetch network error
--       'server_5xx'             — provider 5xx
--       'client_4xx'             — provider 4xx (incl. 401)
--       'timeout'                — QStash retry exhausted on 408 / 504
--       'bulk_partial_failure'   — bulk endpoint executedCount <
--                                  expectedCount (response does not say
--                                  WHICH tasks failed; whole batch DLQ'd)
--       'unknown'                — fallback / pre-categorisation
--
--   failure_payload jsonb (NULLABLE):
--     PII-STRIPPED snapshot of the SF response payload + adapter
--     call context (correlation_id, request method/url, http_status).
--     The strip helper redacts consignee.name / .phone / .email,
--     deliveryInformation.address.* (full address subtree),
--     consignee.location.* (address + contactPhone), free-text notes,
--     and any bare strings under a `*name` / `*phone` / `*email` key
--     family. See pii-strip.ts file header for the full predicate set.
--
--   retry_count integer NOT NULL DEFAULT 0:
--     QStash retry count at exhaustion. Operator visibility into
--     "did this fail-fast or fail-after-3-attempts?".
--
--   created_at / resolved_at timestamptz:
--     created_at is set once at INSERT. resolved_at is updated when
--     ops marks the row resolved via the (Phase 2) admin UI; v1 keeps
--     it nullable for forward compatibility.
--
-- =============================================================================
-- Index strategy
-- =============================================================================
--   1. (tenant_id) — baseline tenant scan / RLS predicate path.
--   2. (tenant_id, created_at DESC) WHERE resolved_at IS NULL — the
--      operator UI's "show unresolved DLQ" query and the chronological
--      "what's new" view. Partial because resolved rows are O(majority)
--      post-MVP and indexing them adds cost for queries that filter them.
--   3. (task_id) — operator triage "is this task in the DLQ already?"
--      lookup for a known task; not partial because the join is task-
--      scoped (resolved or not, both relevant).
-- =============================================================================


CREATE TABLE outbound_push_failures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  operation       text NOT NULL
                    CHECK (operation IN ('update', 'cancel', 'bulk_cancel')),
  correlation_id  uuid NOT NULL,
  failure_reason  text NOT NULL
                    CHECK (failure_reason IN (
                      'network',
                      'server_5xx',
                      'client_4xx',
                      'timeout',
                      'bulk_partial_failure',
                      'unknown'
                    )),
  failure_payload jsonb,
  retry_count     integer NOT NULL DEFAULT 0
                    CHECK (retry_count >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX outbound_push_failures_tenant_id_idx
  ON outbound_push_failures (tenant_id);

CREATE INDEX outbound_push_failures_unresolved_idx
  ON outbound_push_failures (tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX outbound_push_failures_task_id_idx
  ON outbound_push_failures (task_id);


-- -----------------------------------------------------------------------------
-- RLS — tenant isolation defence-in-depth
-- -----------------------------------------------------------------------------
-- The PII strip happens at write time (CONCERN B); RLS is the
-- second-layer guardrail per brief §3.4 RBAC. Same `current_setting`
-- predicate form as 0014 / 0015 / failed_pushes.
ALTER TABLE outbound_push_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbound_push_failures_tenant_isolation ON outbound_push_failures
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


-- -----------------------------------------------------------------------------
-- Schema-layer tenant_id consistency invariant
-- -----------------------------------------------------------------------------
-- Asserts outbound_push_failures.tenant_id = parent tasks.tenant_id on
-- every INSERT or UPDATE. Same pattern as failed_pushes_assert_tenant_match
-- (0008) — fires under BYPASSRLS callers too. The CONCERN B PII strip is
-- application-layer; this trigger is database-layer integrity.
CREATE OR REPLACE FUNCTION outbound_push_failures_assert_tenant_match()
RETURNS trigger AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM tasks WHERE id = NEW.task_id;
  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'outbound_push_failures.task_id % does not exist', NEW.task_id;
  END IF;
  IF parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'outbound_push_failures.tenant_id % does not match parent task tenant_id %',
      NEW.tenant_id, parent_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbound_push_failures_tenant_match
  BEFORE INSERT OR UPDATE ON outbound_push_failures
  FOR EACH ROW
  EXECUTE FUNCTION outbound_push_failures_assert_tenant_match();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
-- 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future tables
-- created by `postgres` automatically grant CRUD to `planner_app`. The
-- explicit GRANT below is belt-and-braces.
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_push_failures TO planner_app;
