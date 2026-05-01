-- =============================================================================
-- supabase/migrations/0012_task_generation_runs.sql
-- =============================================================================
-- Day 7 / C-2: task_generation_runs table — per-(tenant, window) audit-style
-- record of every nightly cron invocation that walks subscriptions and
-- generates next-day tasks. Plus a partial UNIQUE on
-- tasks(subscription_id, delivery_date) WHERE subscription_id IS NOT NULL
-- to enforce per-task idempotency on cron re-runs.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007/0008/0009/0011. See deviation
-- note in 0001 header.
--
-- -----------------------------------------------------------------------------
-- Why a runs-tracking table at all
-- -----------------------------------------------------------------------------
-- Three concerns the cron handler cannot satisfy without a durable record:
--
--   1. Idempotency on Vercel-cron retry. Vercel may re-invoke a cron handler
--      after a network blip; without a (tenant, window) row to consult, the
--      second invocation cannot tell whether the first generated tasks or not.
--      The UNIQUE (tenant_id, window_start, window_end) constraint converts
--      "did we already run for this window?" into a single SELECT — and the
--      task-level idempotency below is the second belt for the case where
--      two invocations both win the row-creation race (unlikely but cheap to
--      defend against).
--
--   2. The 7K cap. memory/decision_daily_cutoff_and_throughput.md locks a
--      hard structural limit of 7,000 tasks per tenant per generation run.
--      "Hard" means: if the projection (subscriptions × matching weekdays)
--      exceeds 7K, the run aborts and audits — it does NOT generate a
--      partial set, because half-generated days create a silent operational
--      half-state where some subscriptions have tomorrow's task and others
--      don't (decision confirmed pre-C-2). The cap_threshold column records
--      the limit IN EFFECT at run-time so historical capped runs remain
--      interpretable if the cap value is ever raised or lowered.
--
--   3. Forensic audit trail. The audit_events table records that a run
--      happened (task.bulk_generated meta-event), but a forensic
--      reconstruction needs the projection, the actual counts, the status,
--      and whatever error_text surfaced if the run failed. audit_events
--      keeps the lifecycle event; this table keeps the full operational
--      record.
--
-- -----------------------------------------------------------------------------
-- Why tenant_id is NOT denormalised from a parent FK
-- -----------------------------------------------------------------------------
-- Unlike task_packages (0007), failed_pushes (0008), and asset_tracking_cache
-- (0011) — all of which carry a denormalised tenant_id alongside a child FK
-- to a tenant-bearing parent (tasks) — task_generation_runs has NO parent FK.
-- Each row is a primary tenant-scoped fact: "cron ran for tenant T over
-- window W." The tenant_id is the row's own identity, not denormalised.
--
-- That means the BYPASSRLS leak vector that the *_assert_tenant_match
-- triggers protect against does NOT apply here. There is no parent row whose
-- tenant_id this row could disagree with — the row IS the tenant fact.
-- Service-layer callers are responsible for passing the right tenant_id;
-- there is no schema-layer parent to compare against.
--
-- The RLS policy alone is sufficient at the schema layer. BYPASSRLS callers
-- (withServiceRole — the cron is one) bypass the policy by design and write
-- the row with the tenant_id the service layer chose to walk.
--
-- -----------------------------------------------------------------------------
-- Status enum — four terminal states, one in-flight state
-- -----------------------------------------------------------------------------
--   running              — row created at run start; not yet completed.
--                          A row stuck in 'running' indicates the handler
--                          crashed mid-flight (cron timeout, process kill).
--                          Operations distinguishes "stuck running" from
--                          "completed/capped" by completed_at IS NULL.
--   completed            — generation finished; tasks_created and
--                          tasks_skipped_existing are both non-null.
--   capped               — projection (projected_count) exceeded
--                          cap_threshold; aborted before any tasks were
--                          generated. cap_threshold records the limit in
--                          effect at run-time.
--   skipped_already_run  — a prior row exists for the same
--                          (tenant_id, window_start, window_end). The
--                          UNIQUE constraint surfaces this as a SQLSTATE
--                          23505; the cron handler catches and writes
--                          this state to a NEW row (or, in the
--                          ON CONFLICT DO NOTHING path, no second row at
--                          all — see implementation note in service.ts).
--                          Captured here for the rare case where the race
--                          loses to the unique-constraint check and the
--                          handler chooses to record the attempt.
--   failed               — an unrecoverable error occurred BEFORE any
--                          task INSERTs landed (e.g., subscription query
--                          failed, cap projection failed). error_text
--                          captures the message. Zero tasks generated.
--
-- A `failed_partial` value was considered for the case where a run aborts
-- AFTER some task INSERTs already committed, but is not in this enum:
-- under the current single-tx project+generate+finalise design, an error
-- inside that block rolls back every INSERT, so partial-success is
-- structurally impossible. Reserving an enum value for a code path that
-- doesn't exist creates speculative scope; if a multi-tx emission design
-- ever lands, that commit adds the value back with a real caller.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. UNIQUE (tenant_id, window_start, window_end)
--        — the idempotency constraint. Cron handler attempts an INSERT;
--          a 23505 violation means "already ran for this window."
--   2. (tenant_id)
--        — list-by-tenant scans, the catch-all baseline.
--   3. (tenant_id, started_at DESC)
--        — admin UI's "show me recent runs" view. DESC matches natural
--          display order; Postgres can scan it in either direction but the
--          explicit DESC is self-documenting.
--   4. (tenant_id, status) WHERE status = 'running'
--        — operations' "stuck-running" query (rows with completed_at IS NULL).
--          Partial because the vast majority of historical rows are
--          terminal-state, and indexing them adds cost for queries that
--          filter them out.
--
-- -----------------------------------------------------------------------------
-- Per-task idempotency: partial UNIQUE on tasks(subscription_id, delivery_date)
-- -----------------------------------------------------------------------------
-- The run-level UNIQUE (tenant_id, window_start, window_end) above defends
-- against duplicate invocation of the cron handler for a window. The
-- task-level partial UNIQUE here defends against the cron actually generating
-- the same (subscription, day) twice — which could happen if:
--
--   (a) Two invocations both win the row-creation race for task_generation_runs
--       (unlikely under SERIALIZABLE; possible under READ COMMITTED with
--       overlapping transactions).
--   (b) Application code that does NOT go through generateTasksForWindow
--       (e.g., admin SQL, future migration-import flow) inserts a duplicate.
--
-- Partial WHERE subscription_id IS NOT NULL: non-subscription tasks
-- (created_via='manual_admin' | 'migration_import') have NULL subscription_id
-- per the composite CHECK in 0010, and indexing those nulls would bloat the
-- index without serving any lookup. The cron's idempotency check is exactly
-- "does this subscription already have a task for this date?" — partial on
-- non-NULL subscription_id is the precise scope.
--
-- This index also serves the cron's positive lookup ("for subscription S,
-- is there already a task for date D?") in the rare path where the service
-- prefers a SELECT before INSERT over an INSERT … ON CONFLICT DO NOTHING.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future
-- tables created by `postgres` automatically grant CRUD to `planner_app`.
-- The explicit GRANT below is belt-and-braces.
-- =============================================================================


CREATE TABLE task_generation_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  window_start             timestamptz NOT NULL,
  window_end               timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'running',
  -- Cap in effect at run time. Recorded so historical capped runs stay
  -- interpretable if the cap value is later raised or lowered. NOT NULL
  -- because every run has a well-defined limit; the service layer passes
  -- the canonical value from memory/decision_daily_cutoff_and_throughput.md.
  cap_threshold            integer NOT NULL CHECK (cap_threshold > 0),
  -- Projected task count (subscriptions × matching weekdays). Recorded
  -- BEFORE any INSERTs land so a 'capped' row carries the projection that
  -- triggered the abort. NULL until the projection is computed.
  projected_count          integer CHECK (projected_count IS NULL OR projected_count >= 0),
  subscriptions_walked     integer CHECK (subscriptions_walked IS NULL OR subscriptions_walked >= 0),
  tasks_created            integer CHECK (tasks_created IS NULL OR tasks_created >= 0),
  tasks_skipped_existing   integer CHECK (tasks_skipped_existing IS NULL OR tasks_skipped_existing >= 0),
  error_text               text,
  started_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT task_generation_runs_status_check
    CHECK (status IN (
      'running',
      'completed',
      'capped',
      'skipped_already_run',
      'failed'
    )),

  CONSTRAINT task_generation_runs_window_strict
    CHECK (window_start < window_end),

  -- Idempotency anchor: at most one run per (tenant, window). A re-invocation
  -- of the cron for the same window hits SQLSTATE 23505 on this constraint;
  -- the service layer catches it and either re-reads the existing row or
  -- aborts gracefully.
  CONSTRAINT task_generation_runs_window_unique
    UNIQUE (tenant_id, window_start, window_end)
);

CREATE INDEX task_generation_runs_tenant_id_idx
  ON task_generation_runs (tenant_id);

CREATE INDEX task_generation_runs_tenant_started_idx
  ON task_generation_runs (tenant_id, started_at DESC);

-- Partial: only running rows are operationally interesting for the
-- "stuck-run" query. Terminal-state rows are the majority of history.
CREATE INDEX task_generation_runs_tenant_running_idx
  ON task_generation_runs (tenant_id, status)
  WHERE status = 'running';

ALTER TABLE task_generation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_generation_runs_tenant_isolation ON task_generation_runs
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER task_generation_runs_set_updated_at
  BEFORE UPDATE ON task_generation_runs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Per-task idempotency: partial UNIQUE on tasks(subscription_id, delivery_date)
-- -----------------------------------------------------------------------------
-- See header. Partial because non-subscription tasks have NULL subscription_id
-- by the composite CHECK `tasks_creation_source_invariant` (0010); indexing
-- those rows is wasted space.
CREATE UNIQUE INDEX tasks_subscription_delivery_date_unique_idx
  ON tasks (subscription_id, delivery_date)
  WHERE subscription_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON task_generation_runs TO planner_app;
