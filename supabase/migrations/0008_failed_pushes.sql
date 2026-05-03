-- =============================================================================
-- supabase/migrations/0008_failed_pushes.sql
-- =============================================================================
-- Day 5 / T-6: failed_pushes table — DLQ foundation for the Day-7 cron's
-- retry-with-audit-trail flow. The cron's `createTask` adapter call is
-- single-attempt (per the S-8 finding: SuiteFleet doesn't dedupe by
-- customerOrderNumber and ignores Idempotency-Key); when a push exhausts
-- its application-layer retries, the cron writes a row here. The
-- service layer (T-7) wraps this table; the operator UI is post-MVP.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007. See deviation note in
-- 0001 header.
--
-- -----------------------------------------------------------------------------
-- Why partial UNIQUE on (task_id) WHERE resolved_at IS NULL
-- -----------------------------------------------------------------------------
-- failed_pushes doubles as operational queue AND historical record:
--   - Unresolved rows (resolved_at IS NULL) are "what's currently
--     broken" — the cron's retry queue.
--   - Resolved rows (resolved_at IS NOT NULL) are "what previously
--     broke and got fixed" — operator trend analysis, support
--     forensics.
--
-- A task can fail, get resolved, then fail again — the partial UNIQUE
-- allows multiple historical rows per task while enforcing "at most
-- one active failure per task at any given time." The cron's retry
-- path INCREMENTS attempt_count on the unresolved row via UPDATE; a
-- second concurrent INSERT for the same task_id would conflict and
-- the second writer would have to detect the existing row and update
-- it instead.
--
-- Without the partial UNIQUE, a buggy retry path could create
-- duplicate unresolved rows for the same task and the operator UI
-- would show the same task multiple times in the unresolved queue.
--
-- -----------------------------------------------------------------------------
-- Schema-layer tenant_id consistency invariant (extending T-1's precedent)
-- -----------------------------------------------------------------------------
-- failed_pushes denormalises tenant_id alongside task_id — same shape
-- as task_packages (0007). The same BYPASSRLS leak vector applies: a
-- buggy `withServiceRole` caller could otherwise insert a row whose
-- tenant_id doesn't match the parent task's tenant_id, because RLS
-- WITH CHECK doesn't fire under BYPASSRLS callers.
--
-- A BEFORE INSERT OR UPDATE trigger
-- (failed_pushes_assert_tenant_match) verifies failed_pushes.tenant_id
-- equals the parent tasks.tenant_id on every write. Mirrors the
-- task_packages_assert_tenant_match pattern from 0007. The trigger
-- function is defined inline here rather than reused from 0007
-- because PL/pgSQL functions are tightly coupled to the column names
-- they reference (NEW.task_id specifically); a shared function would
-- need parametric column names which PL/pgSQL doesn't elegantly
-- support. Two near-identical 15-line functions is the lesser evil.
--
-- -----------------------------------------------------------------------------
-- Column-level decisions
-- -----------------------------------------------------------------------------
--   task_id ON DELETE CASCADE:
--     Failed-push rows are dependent on their parent task. Deleting a
--     task (via the migration-import rollback path or admin SQL)
--     reaps its failed_pushes rows.
--
--   tenant_id ON DELETE CASCADE:
--     Defence-in-depth alongside task_id's CASCADE.
--
--   resolved_by ON DELETE SET NULL:
--     If the user who resolved a failure later leaves the system and
--     is deleted, we want to KEEP the resolution audit trail
--     (resolved_at, resolution_notes) but cannot keep the FK pointer.
--     SET NULL preserves the row's history. Nullable also for
--     system-resolved entries (the cron retrying successfully sets
--     resolved_at without a user actor).
--
--   task_payload jsonb:
--     The full request body sent to SuiteFleet at the moment of
--     failure. Used by the operator UI for "what did we send?" and
--     by the cron retry to re-issue the request idempotently. No
--     size limit at the schema level; pilot-scope tasks have small
--     payloads (a few KB each).
--
--   failure_reason CHECK:
--     Categorised set per Day-5 brief §9. CHECK constraint enforces
--     the closed value domain (matches the internal_status / task_kind
--     / package_status pattern). Application layer maps from
--     adapter-layer errors to these categories.
--
--   failure_detail text:
--     Free-form debug info — stack trace excerpt, response body,
--     anything operationally useful for support. The application
--     layer is responsible for not writing credentials or PII into
--     this field; the schema cannot enforce that.
--
--   http_status integer (nullable):
--     Null for network / timeout failures (no HTTP response received).
--     Populated for server_5xx / client_4xx categories.
--
--   first_failed_at vs last_attempted_at:
--     first_failed_at is set once at row creation and never updated
--     (the historical "when did this start failing?"). last_attempted_at
--     is updated on every retry attempt. Two columns rather than one
--     because both signals matter for support investigation.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. (tenant_id) — baseline tenant scan, every list query through
--                    `withTenant`.
--   2. (tenant_id, resolved_at) WHERE resolved_at IS NULL
--                  — the cron's "what do I retry next?" query and the
--                    operator UI's "show unresolved failures" view.
--                    Partial because resolved rows are O(majority of
--                    history) post-MVP and indexing them adds cost
--                    for queries that filter them out.
--   3. (tenant_id, last_attempted_at DESC)
--                  — chronological view: "show me recent failures."
--                    DESC matches the natural display order; a
--                    descending index serves both ASC and DESC scans
--                    in Postgres but the explicit DESC is
--                    self-documenting.
--
-- The UNIQUE INDEX on (task_id) WHERE resolved_at IS NULL also
-- functions as an index — Postgres uses it for task_id lookups on
-- the hot unresolved-row path.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future
-- tables created by `postgres` automatically grant CRUD to `planner_app`.
-- The explicit GRANT below is belt-and-braces.
-- =============================================================================


CREATE TABLE failed_pushes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id           uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_count     integer NOT NULL DEFAULT 1
                      CHECK (attempt_count >= 1),
  task_payload      jsonb NOT NULL,
  failure_reason    text NOT NULL
                      CHECK (failure_reason IN (
                        'network',
                        'server_5xx',
                        'client_4xx',
                        'timeout',
                        'unknown'
                      )),
  failure_detail    text,
  http_status       integer,
  first_failed_at   timestamptz NOT NULL DEFAULT now(),
  last_attempted_at timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX failed_pushes_tenant_id_idx ON failed_pushes (tenant_id);

CREATE INDEX failed_pushes_unresolved_idx
  ON failed_pushes (tenant_id, resolved_at)
  WHERE resolved_at IS NULL;

CREATE INDEX failed_pushes_chronological_idx
  ON failed_pushes (tenant_id, last_attempted_at DESC);

-- Partial UNIQUE — at most one active (unresolved) failure per task.
-- Resolved rows are unconstrained, so the same task can stack up
-- historical rows over time.
CREATE UNIQUE INDEX failed_pushes_active_unique_idx
  ON failed_pushes (task_id)
  WHERE resolved_at IS NULL;

ALTER TABLE failed_pushes ENABLE ROW LEVEL SECURITY;

CREATE POLICY failed_pushes_tenant_isolation ON failed_pushes
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER failed_pushes_set_updated_at
  BEFORE UPDATE ON failed_pushes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Schema-layer tenant_id consistency invariant
-- -----------------------------------------------------------------------------
-- Asserts failed_pushes.tenant_id = parent tasks.tenant_id on every
-- INSERT or UPDATE. Fires under BYPASSRLS callers too (triggers run
-- regardless of RLS), so this catches the leak vector that the RLS
-- WITH CHECK on failed_pushes cannot — a withServiceRole caller could
-- otherwise insert a mismatched row because BYPASSRLS skips policy
-- evaluation entirely.
--
-- Mirrors the task_packages_assert_tenant_match pattern from 0007.
-- Function is defined inline rather than parametrically reused
-- because PL/pgSQL functions are tightly coupled to the column names
-- they reference.
--
-- The exception type is plain `RAISE EXCEPTION` — Postgres surfaces
-- it as a SQLSTATE P0001 (raise_exception). The application layer
-- treats this as an integrity violation (5xx); should never happen
-- under well-behaved callers.
CREATE OR REPLACE FUNCTION failed_pushes_assert_tenant_match()
RETURNS trigger AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM tasks WHERE id = NEW.task_id;
  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'failed_pushes.task_id % does not exist', NEW.task_id;
  END IF;
  IF parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'failed_pushes.tenant_id % does not match parent task tenant_id %',
      NEW.tenant_id, parent_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER failed_pushes_tenant_match
  BEFORE INSERT OR UPDATE ON failed_pushes
  FOR EACH ROW
  EXECUTE FUNCTION failed_pushes_assert_tenant_match();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON failed_pushes TO planner_app;
