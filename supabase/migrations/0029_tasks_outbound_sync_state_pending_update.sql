-- =============================================================================
-- 0029_tasks_outbound_sync_state_pending_update.sql
-- Day-52 — calendar-management lane Phase 1, PR-4/PR-5 (R4 + R5)
-- per plan-PR #335 §3 optional migration + §5 OQ-1 ruling (a).
-- =============================================================================
--
-- Extends the tasks.outbound_sync_state CHECK enum from 5 to 6 values:
-- admit 'pending_update' as the in-flight state for operator-initiated
-- UPDATE-style outbound pushes (address overrides per R4/R5; the same
-- state is available to future update-shape pushes).
--
--   'pending_update' — operator-initiated task mutation committed
--                      locally; outbound SF update enqueued (or expected
--                      to be enqueued post-commit). Set by the R4/R5
--                      address-override repository writes on rows with a
--                      live SF AWB (external_tracking_number IS NOT
--                      NULL). Cleared to 'synced' by the
--                      /api/queue/update-task consumer on SF 2xx
--                      (mirrors the cancel-task convergence write).
--                      Flips to 'failed' when QStash exhausts retries
--                      via /api/queue/update-task-failed (mirrors
--                      cancel-task-failed).
--
-- Lifecycle delta vs 0028 (all other transitions unchanged):
--
--   operator address override on pushed task → 'pending_update'   (R4/R5)
--   update-task success                      → 'synced'
--   update-task DLQ                          → 'failed'
--
-- Why a 6th value instead of reusing 'pending': 'pending' means
-- "newly-minted, awaiting FIRST push" (pre-AWB; cron's createTask path)
-- and deliberately renders NO badge (0028 + plan-PR #317 OQ-2 ruling
-- (b)). 'pending_update' means "already live on SF; an operator change
-- is in flight" and DOES render the operator-facing badge ("Sending to
-- SuiteFleet"). Collapsing them would either badge every new task
-- (noise) or hide in-flight operator updates (the R4/R5 visibility gap
-- OQ-1 exists to close).
--
-- No backfill: no production row can legitimately hold this state
-- before the R4/R5 code paths that write it are promoted. The 0026
-- partial index (tenant_id, outbound_sync_state) WHERE <> 'synced'
-- covers the new value with no index change.
--
-- Apply path (Day-2 convention + Shape-3 carve-out): this file PARKS
-- for Love and is applied via the Supabase SQL editor on Love's
-- explicit named authorization BEFORE the dependent R4/R5 code-PRs
-- promote. The dependent code writes 'pending_update'; promoting it
-- against a database without this constraint extension would fail
-- every address-override write with a CHECK violation.
--
-- =============================================================================

ALTER TABLE tasks
  DROP CONSTRAINT tasks_outbound_sync_state_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_outbound_sync_state_check
    CHECK (outbound_sync_state IN (
      'synced',
      'pending_cancel',
      'pending_reschedule',
      'failed',
      'pending',
      'pending_update'
    ));
