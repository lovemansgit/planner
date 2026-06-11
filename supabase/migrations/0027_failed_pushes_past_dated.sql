-- =============================================================================
-- 0027_failed_pushes_past_dated.sql
-- Day-32 PR-A — outbound push pipeline structural defects, F-5 past-dated guard
-- per plan-PR #317 §3.5 + §6 OQ-3 ruling (a) at SHA f0ef560.
-- =============================================================================
--
-- Extends the failed_pushes.failure_reason CHECK constraint (from 0008)
-- to admit the value 'past_dated'. Pure CHECK extension; no behaviour
-- change, no backfill (no existing rows carry this value), no index
-- touch. Mirrors the 0025 pattern (outbound_push_failures.operation
-- 'reschedule' admission).
--
-- The 'past_dated' value is written by the new pushSingleTask guard
-- (per plan #317 §3.5 Surface 1) when task.delivery_date < CURRENT_DATE
-- at push-time (evaluated via Postgres clock per OQ-3 ruling (a) +
-- §8 R-4). Distinguishes planner-side guard-rejected rows from
-- SF-side 4xx-rejected rows so ops triage at /admin/failed-pushes
-- can separate the two populations.
--
-- =============================================================================

ALTER TABLE failed_pushes
  DROP CONSTRAINT failed_pushes_failure_reason_check;

ALTER TABLE failed_pushes
  ADD CONSTRAINT failed_pushes_failure_reason_check
    CHECK (failure_reason IN (
      'network',
      'server_5xx',
      'client_4xx',
      'timeout',
      'unknown',
      'past_dated'
    ));
