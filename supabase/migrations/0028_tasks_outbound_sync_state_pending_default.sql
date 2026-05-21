-- =============================================================================
-- 0028_tasks_outbound_sync_state_pending_default.sql
-- Day-33 PR-C — outbound push pipeline structural defects, F-3
-- per plan-PR #317 §3.3 + §6 OQ-2 ruling (b) + OQ-2.1 ruling at SHA f0ef560.
-- =============================================================================
--
-- Two coordinated changes to tasks.outbound_sync_state (introduced in 0026):
--
--   1. Extend the CHECK enum from 4 to 5 values: admit 'pending' as the
--      pre-push state for newly-minted tasks. Pre-0028, the column had no
--      truthful pre-push value — it defaulted to 'synced' before any push
--      attempt, which lied for the seconds-to-hours window between row
--      INSERT and cron's first push tick (and indefinitely on AWB-blank
--      rows where the push never succeeded).
--
--   2. Change the column DEFAULT from 'synced' to 'pending' so that the
--      three INSERT INTO tasks paths (cron materialization, operator
--      ad-hoc, subscription create) read truthfully at INSERT time. None
--      of those INSERT statements specifies outbound_sync_state
--      explicitly — they all rely on the column DEFAULT, so the change
--      lands automatically across all three paths.
--
-- Lifecycle after 0028 (peer-reviewed at plan §3.3):
--
--   INSERT (cron / ad-hoc / subscription) → 'pending'
--   pushSingleTask success → markTaskPushed flips to 'synced'  (PR-C / F-3 (a))
--   pushSingleTask failure → recordFailedPushAttempt flips to 'failed'
--                            in the same withServiceRole tx as the
--                            failed_pushes write                (PR-C / F-3 (b))
--   operator skip on pushed task → markTaskSkipped CASE flips
--                            to 'pending_cancel'                (Day-29, unchanged)
--   cancel-task success → flips to 'synced'                     (Day-29, unchanged)
--   cancel-task DLQ → flips to 'failed'                         (Day-29, unchanged)
--
-- Backfill posture (§6 OQ-2.1 ruling at SHA f0ef560 + §8 R-3 CASE
-- expression): one deterministic UPDATE classifies every existing row
-- via the three-branch CASE:
--
--   external_id IS NOT NULL                              → 'synced'
--   unresolved failed_pushes row exists for the task     → 'failed'
--   else (never-pushed, no unresolved DLQ row)           → 'pending'
--
-- Branch precedence per the §8 R-3 spec — external_id wins because a
-- task with an SF AWB IS synced regardless of any historical failed_pushes
-- row (those failed_pushes rows are stale-but-not-yet-resolved markers
-- that the success-path markFailedPushResolved cleans up at next push).
--
-- The Day-29 0026 backfill marked SKIPPED+pushed bug-affected rows as
-- 'failed'; those rows have external_id NOT NULL and will be reclassified
-- to 'synced' by this backfill's branch-1. Per Day-32 plan §3.6 OQ-2.1
-- ruling, the locked CASE is the canonical post-0028 state — those
-- two historical production rows (DMB-24406181, DMB-52660780, non-demo-
-- blocking per the 0026 OQ-10 ruling) silently resolve to 'synced'.
--
-- Migration ordering (per §10 ruling hard requirement #3):
--   0027 (PR-A) — failed_pushes failure_reason CHECK extension for 'past_dated'.
--   0028 (PR-C) — this migration. PR-B carried no migrations.
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
      'pending'
    ));

ALTER TABLE tasks
  ALTER COLUMN outbound_sync_state SET DEFAULT 'pending';

-- Backfill — one deterministic UPDATE per §8 R-3 / OQ-2.1 ruling.
UPDATE tasks
SET outbound_sync_state = CASE
  WHEN external_id IS NOT NULL THEN 'synced'
  WHEN EXISTS (
    SELECT 1 FROM failed_pushes
    WHERE task_id = tasks.id
      AND resolved_at IS NULL
  ) THEN 'failed'
  ELSE 'pending'
END;
