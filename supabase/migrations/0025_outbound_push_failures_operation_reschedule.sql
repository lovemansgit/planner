-- =============================================================================
-- 0025_outbound_push_failures_operation_reschedule.sql
-- Day-29 §D(2) skip→SF outbound bug fix (Phase 1 code-PR per plan-PR #302)
-- =============================================================================
--
-- Extends the outbound_push_failures.operation CHECK constraint (from
-- 0023) to admit the value 'reschedule'. Pure CHECK extension; no
-- behaviour change, no backfill, no index touch.
--
-- Phase 1 does NOT yet emit operation='reschedule' rows — the
-- /api/queue/reschedule-task[-failed] route family is net-new and
-- lives in the Phase 2 code-PR (Aqib-gated on the SuiteFleet
-- task-resource:reschedule wire contract — see plan #302 §9 OQ-1,4).
-- Landing the CHECK extension now lets Phase 2 ship the failure-route
-- INSERT statement without a separate schema-only PR.
--
-- =============================================================================

ALTER TABLE outbound_push_failures
  DROP CONSTRAINT outbound_push_failures_operation_check;

ALTER TABLE outbound_push_failures
  ADD CONSTRAINT outbound_push_failures_operation_check
    CHECK (operation IN ('update', 'cancel', 'bulk_cancel', 'reschedule'));
