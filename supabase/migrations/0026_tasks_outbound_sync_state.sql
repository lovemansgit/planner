-- =============================================================================
-- 0026_tasks_outbound_sync_state.sql
-- Day-29 §D(2) skip→SF outbound bug fix (Phase 1 code-PR per plan-PR #302)
-- =============================================================================
--
-- Adds tasks.outbound_sync_state as the per-task pending-confirm signal
-- for operator-initiated outbound mutations to SuiteFleet (Phase 1
-- wires the SKIP path; broader operator-cancel / future reschedule
-- usage extends in later code-PRs).
--
-- Column semantics (§3.6 OQ-7 ruling: Option A — single enum column):
--
--   'synced'             — task is in sync with SF; no pending outbound
--                          operation, no unresolved DLQ failure. Default.
--   'pending_cancel'     — operator skip committed locally; outbound SF
--                          cancel enqueued (or expected to be enqueued
--                          post-commit). Clears to 'synced' when the SF
--                          webhook ack arrives (TASK_STATUS_UPDATED_TO_
--                          CANCELED) per the §6.2 webhook applier guard.
--                          Flips to 'failed' if QStash exhausts retries
--                          via /api/queue/cancel-task-failed.
--   'pending_reschedule' — placeholder for Phase 2 (variant 3 move-to-
--                          date reschedule). Not written by Phase 1 code;
--                          included in the CHECK enum so the column's
--                          shape doesn't need to grow when Phase 2 lands.
--   'failed'             — QStash retries exhausted; outbound_push_
--                          failures row exists for ops triage. Cleared
--                          to 'synced' on subsequent webhook ack (any
--                          successful SF status convergence implies the
--                          merchant + SF reached a consistent view).
--
-- Why NOT reuse pushed_to_external_at: that column is a one-shot
-- timestamp set on first successful createTask push (see
-- src/modules/task-push/repository.ts markTaskPushed). Tasks affected
-- by the §D(2) bug already have pushed_to_external_at set — that is WHY
-- we need to call SF. Overloading it would break cron's unpushed-task
-- filter (src/modules/task-materialization/cte-builder.ts).
--
-- Backfill posture (§3.6 OQ-8 ruling): mark known-bug-affected SKIPPED
-- tasks (internal_status='SKIPPED' AND pushed_to_external_at IS NOT
-- NULL) as 'failed'. Ops surfaces them via SQL and decides whether to
-- manually replay (Phase 2 admin UI is out of scope per plan §13). Do
-- NOT auto-replay at migration time (auto-replay was rejected for blast
-- risk; the 2 known production bug-vector tasks DMB-24406181 +
-- DMB-52660780 are non-demo-blocking per OQ-10).
--
-- =============================================================================

ALTER TABLE tasks
  ADD COLUMN outbound_sync_state text NOT NULL DEFAULT 'synced'
    CHECK (outbound_sync_state IN (
      'synced',
      'pending_cancel',
      'pending_reschedule',
      'failed'
    ));

-- One-time backfill for the bug-affected population. SKIPPED tasks
-- that were ever pushed to SF (pushed_to_external_at IS NOT NULL) have
-- live "Ordered" rows on SF that Planner-side skip never canceled.
-- Marking them 'failed' surfaces them to ops via the same enum the
-- DLQ path uses. Tasks that are SKIPPED but never reached SF
-- (pushed_to_external_at IS NULL — sub-case 13a, skip-past-horizon)
-- stay 'synced' because nothing on SF needs reconciling.
UPDATE tasks
  SET outbound_sync_state = 'failed'
  WHERE internal_status = 'SKIPPED'
    AND pushed_to_external_at IS NOT NULL;

-- Partial index for the ops-triage read path: list tasks with an
-- unresolved outbound sync state. Most tasks are 'synced' (>99% post-
-- backfill); partial index keeps the storage cost flat.
CREATE INDEX tasks_outbound_sync_state_pending_idx
  ON tasks (tenant_id, outbound_sync_state)
  WHERE outbound_sync_state <> 'synced';
