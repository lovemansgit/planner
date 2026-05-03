-- =============================================================================
-- supabase/migrations/0007_task_package.sql
-- =============================================================================
-- Day 5 / T-1: task_packages table — second half of the task module schema.
-- One task → many packages, mapping SuiteFleet's `shipmentPackages` array
-- onto a join table that the application owns end-to-end.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006. See deviation note in 0001 header.
--
-- -----------------------------------------------------------------------------
-- Why denormalised tenant_id on task_packages
-- -----------------------------------------------------------------------------
-- Every other tenant-scoped table in the schema (consignees, tasks, audit_events,
-- role_assignments, etc.) carries `tenant_id` directly and the RLS predicate
-- reads `tenant_id = current_tenant`. If task_packages omitted the column we
-- would be forced into a JOIN-based RLS predicate against the parent `tasks`
-- table, e.g.
--
--   USING (EXISTS (SELECT 1 FROM tasks
--                  WHERE tasks.id = task_packages.task_id
--                    AND tasks.tenant_id = NULLIF(current_setting(...), '')::uuid))
--
-- That works in Postgres but is materially worse for two reasons:
--   1. The policy reaches across tables, coupling task_packages's policy to
--      the existence and shape of `tasks`. Future refactors of `tasks` could
--      silently break the policy without touching this file.
--   2. JOIN-based policies cost more at planning time and per-row evaluation
--      time, especially on inserts where the parent row may not be fully
--      visible yet under uncommitted-read scenarios.
--
-- Denormalising is cheap (a single uuid column) and keeps the predicate form
-- uniform across every table. The application layer enforces consistency by
-- always inserting task_packages.tenant_id = parent task's tenant_id; the
-- service layer's bulk-create path (T-4) inserts them in the same transaction
-- and reads tenant_id from the same RequestContext.
--
-- Schema-layer enforcement of consistency. A BEFORE INSERT OR UPDATE trigger
-- (task_packages_assert_tenant_match) verifies task_packages.tenant_id equals
-- the parent tasks.tenant_id on every write. The trigger fires under
-- BYPASSRLS callers (e.g., withServiceRole), closing the leak vector where a
-- buggy service-role caller could insert a task_packages row whose tenant_id
-- doesn't match its parent task's tenant_id. This is the schema-layer belt
-- matching the application-layer braces — precedent: 0002's
-- audit_events_no_delete RULE.
--
-- -----------------------------------------------------------------------------
-- Column-level decisions
-- -----------------------------------------------------------------------------
--   task_id ON DELETE CASCADE:
--     Packages are dependent on their parent task — there is no business
--     concept of an orphan package. Deleting a task automatically reaps its
--     packages.
--
--   tenant_id ON DELETE CASCADE:
--     Defence-in-depth alongside task_id's CASCADE. If a tenant is torn down
--     directly (rare — tenants table CASCADE chain through tasks would catch
--     this anyway), the packages go with it.
--
--   external_package_id / tracking_id:
--     Both nullable until the parent task is pushed to SuiteFleet. Same
--     lifecycle reasoning as tasks.external_id — the upstream identifiers
--     don't exist locally until after the push round-trip.
--
--   package_status:
--     6-value enum, distinct from tasks.internal_status (7 values). A package
--     follows its own lifecycle which can diverge from the parent task: a
--     task can be IN_TRANSIT while one package is DELIVERED and another is
--     RETURNED. The DEFAULT 'ORDERED' matches the SuiteFleet starting state
--     visible in the S-5 webhook payload sample.
--
--   position INTEGER NOT NULL with UNIQUE (task_id, position):
--     Stable ordering within a task. SuiteFleet returns the
--     `shipmentPackages` array in a specific order in the webhook payload;
--     the position column preserves that ordering across reads. UNIQUE
--     prevents duplicate positions which would make ordering ambiguous.
--     0-based or 1-based is application-policy (the service layer sets this);
--     the schema only enforces uniqueness within a task.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. (tenant_id, task_id) — task-detail loads ("give me this task and all
--                              its packages"). The two-column form supports
--                              both the per-tenant scan AND the parent-task
--                              join in one index.
--
-- The PRIMARY KEY on id covers single-row lookups; the FK constraint creates
-- the implicit secondary index supporting CASCADE/RESTRICT enforcement; and
-- the UNIQUE (task_id, position) covers position lookups within a task.
-- No other indexes needed at the pilot scale (one tenant generates O(1000)
-- packages per day; a sequential scan of an O(100k) row table is acceptable
-- for the rare cross-task queries we do).
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future tables
-- created by `postgres` automatically grant CRUD to `planner_app`. The
-- explicit GRANT below is belt-and-braces.
-- =============================================================================


CREATE TABLE task_packages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_package_id text,
  tracking_id         text,
  package_status      text NOT NULL DEFAULT 'ORDERED'
                        CHECK (package_status IN (
                          'ORDERED',
                          'PICKED_UP',
                          'IN_TRANSIT',
                          'DELIVERED',
                          'FAILED',
                          'RETURNED'
                        )),
  position            integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_packages_position_unique UNIQUE (task_id, position)
);

CREATE INDEX task_packages_tenant_task_idx ON task_packages (tenant_id, task_id);

ALTER TABLE task_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_packages_tenant_isolation ON task_packages
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER task_packages_set_updated_at
  BEFORE UPDATE ON task_packages
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Schema-layer tenant_id consistency invariant
-- -----------------------------------------------------------------------------
-- Asserts task_packages.tenant_id = parent tasks.tenant_id on every INSERT
-- or UPDATE. Fires under BYPASSRLS callers too (triggers run regardless of
-- RLS), so this catches the leak vector that the RLS WITH CHECK on
-- task_packages cannot — a withServiceRole caller could otherwise insert a
-- mismatched row because BYPASSRLS skips policy evaluation entirely.
--
-- Lookup of the parent's tenant_id reads through the table-owner chain and
-- bypasses RLS by design, so the trigger works correctly regardless of the
-- caller's session tenant.
--
-- The exception type is plain `RAISE EXCEPTION` — Postgres surfaces it as
-- a SQLSTATE P0001 (raise_exception). The application layer treats this
-- as an integrity violation and surfaces it as a 5xx (not a 4xx); this
-- should never happen during routine flow because the application also
-- enforces the invariant at the repository layer.
CREATE OR REPLACE FUNCTION task_packages_assert_tenant_match()
RETURNS trigger AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM tasks WHERE id = NEW.task_id;
  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'task_packages.task_id % does not exist', NEW.task_id;
  END IF;
  IF parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'task_packages.tenant_id % does not match parent task tenant_id %',
      NEW.tenant_id, parent_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_packages_tenant_match
  BEFORE INSERT OR UPDATE ON task_packages
  FOR EACH ROW
  EXECUTE FUNCTION task_packages_assert_tenant_match();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON task_packages TO planner_app;
