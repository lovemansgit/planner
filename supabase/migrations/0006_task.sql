-- =============================================================================
-- supabase/migrations/0006_task.sql
-- =============================================================================
-- Day 5 / T-1: tasks table — first half of the task module schema. The
-- multi-package shape (1 task → N packages) lives in 0007_task_package.sql;
-- this file establishes the parent row.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005. See deviation note in 0001 header for
-- the full reasoning (fail-closed on unset/cleared session variable; no
-- `invalid_text_representation` cast errors against the empty string that
-- `withServiceRole` writes).
--
-- -----------------------------------------------------------------------------
-- Column-level decisions (load-bearing — explained where they aren't obvious)
-- -----------------------------------------------------------------------------
--   subscription_id:
--     Bare `uuid` column with no FK constraint. The `subscriptions` table
--     lands in Day 6's migration; adding the FK now would require the
--     referenced table to exist. A follow-up migration adds
--     `REFERENCES subscriptions(id) ON DELETE SET NULL` once the parent
--     table is in place. Nullable until then because direct-entry tasks
--     (out of pilot scope, but possible post-MVP) won't have one.
--
--   consignee_id ON DELETE RESTRICT (not CASCADE):
--     A consignee with active or historical tasks must not be silently
--     reaped. RESTRICT forces the operator to either cancel/archive the
--     consignee's tasks first or use a soft-delete path (which we don't
--     have yet — see the 0004 header note on hard-DELETE-with-audit). This
--     is the same defence-in-depth posture as 0001's
--     role_assignments → roles ON DELETE CASCADE: the schema enforces the
--     invariant the service layer would otherwise have to police.
--
--   internal_status:
--     7-value enum mapped from SuiteFleet's 15-value space by the S-6 status
--     mapper. CHECK constraint is the value-domain belt; the application
--     layer is the application-domain belt. See
--     src/modules/integration/providers/suitefleet/status-mapper.ts for the
--     canonical mapping table.
--
--   external_id / external_tracking_number / pushed_to_external_at:
--     All nullable. A task is created locally first (CREATED state), then
--     pushed to SuiteFleet by the Day-7 cron. Until the push succeeds, the
--     external identifiers don't exist. The nullability is the schema-level
--     statement of that lifecycle. The webhook receiver (Day 6) keys off
--     `external_id` to find the local task, which is why it has its own
--     partial index (see Index strategy below).
--
--   payment_method:
--     Nullable per the S-8 finding (memory: followup_paymentmethod_field_resolution.md).
--     SuiteFleet drops `deliveryInformation.paymentMethod` from the create-
--     response body, so we cannot guarantee a value at task-creation time.
--     The webhook payload schema includes the field; whether it surfaces
--     reliably is a Day-6+ verification concern. Storing it as nullable
--     avoids a NOT NULL violation when the upstream system silently omits it.
--
--   task_kind:
--     'DELIVERY' is the pilot default; 'PICKUP' is supported because
--     SuiteFleet's task type vocabulary distinguishes the two and the
--     adapter must round-trip both. CHECK enforces the closed value set.
--
--   delivery_date / delivery_start_time / delivery_end_time:
--     Date + two times rather than one timestamptz range. This matches
--     SuiteFleet's API surface (separate fields) and the operator mental
--     model from the onboarding doc (a task is "for Wednesday between
--     14:00 and 16:00", not "an interval from 2026-04-29T10:00Z to
--     2026-04-29T12:00Z"). Timezone is implicit Asia/Dubai per
--     memory: decision_daily_cutoff_and_throughput.md.
--
--   weight_kg numeric(8,3):
--     Three decimals because SuiteFleet's API accepts grams precision
--     for some merchant categories (pharma, jewelry). 8 total digits
--     handles 99,999.999 kg per package — comfortable.
--
--   declared_value / cod_amount numeric(10,2):
--     AED currency precision. 10 digits handles up to 99,999,999.99
--     AED — comfortable for the pilot's transaction range.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. (tenant_id)                   — list-by-tenant scans, the catch-all
--                                       baseline used by every list query
--                                       through `withTenant`.
--   2. (tenant_id, delivery_date)    — Day-7 cron picks "tomorrow's tasks
--                                       to push" via this index. Operator
--                                       dashboard's date-pivot view also
--                                       hits it.
--   3. (tenant_id, internal_status)  — operator dashboard queries by
--                                       status (e.g., "show me everything
--                                       in IN_TRANSIT").
--   4. (tenant_id, consignee_id)     — consignee-detail page lists
--                                       this consignee's tasks.
--   5. (external_id) WHERE external_id IS NOT NULL
--                                    — webhook receiver maps an inbound
--                                       SuiteFleet task id to the local
--                                       task. Partial because the column
--                                       is nullable until first push and
--                                       null rows would bloat the index
--                                       without serving any lookup.
--                                       Not tenant-prefixed because the
--                                       webhook receiver doesn't know
--                                       the tenant at lookup time — it
--                                       resolves the tenant FROM the row.
--                                       SuiteFleet task ids are
--                                       sufficiently unique across
--                                       tenants (UUID-shaped per their
--                                       sandbox) for this to be safe.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future
-- tables created by `postgres` automatically grant CRUD to `planner_app`.
-- The explicit GRANT below is belt-and-braces — the migration is self-
-- contained, so anyone reading the file can confirm RLS-enforced access
-- without having to trace back to 0003's defaults.
-- =============================================================================


CREATE TABLE tasks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consignee_id             uuid NOT NULL REFERENCES consignees(id) ON DELETE RESTRICT,
  subscription_id          uuid,
  customer_order_number    text NOT NULL,
  reference_number         text,
  internal_status          text NOT NULL DEFAULT 'CREATED'
                             CHECK (internal_status IN (
                               'CREATED',
                               'ASSIGNED',
                               'IN_TRANSIT',
                               'DELIVERED',
                               'FAILED',
                               'CANCELED',
                               'ON_HOLD'
                             )),
  external_id              text,
  external_tracking_number text,
  delivery_date            date NOT NULL,
  delivery_start_time      time NOT NULL,
  delivery_end_time        time NOT NULL,
  delivery_type            text NOT NULL DEFAULT 'STANDARD',
  task_kind                text NOT NULL DEFAULT 'DELIVERY'
                             CHECK (task_kind IN ('DELIVERY', 'PICKUP')),
  payment_method           text,
  cod_amount               numeric(10,2),
  declared_value           numeric(10,2),
  weight_kg                numeric(8,3),
  notes                    text,
  signature_required       boolean NOT NULL DEFAULT false,
  sms_notifications        boolean NOT NULL DEFAULT false,
  deliver_to_customer_only boolean NOT NULL DEFAULT false,
  pushed_to_external_at    timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_tenant_id_idx        ON tasks (tenant_id);
CREATE INDEX tasks_tenant_date_idx      ON tasks (tenant_id, delivery_date);
CREATE INDEX tasks_tenant_status_idx    ON tasks (tenant_id, internal_status);
CREATE INDEX tasks_tenant_consignee_idx ON tasks (tenant_id, consignee_id);
CREATE INDEX tasks_external_id_idx      ON tasks (external_id)
                                          WHERE external_id IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_tenant_isolation ON tasks
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO planner_app;
