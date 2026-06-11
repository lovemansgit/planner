-- 0031_tasks_pod_photo_captures.sql
-- =============================================================================
-- Day-53 EVE — durable POD photo capture (plan
-- memory/plans/day-53-durable-pod-photo-storage.md §4.2, cleared #413 on
-- Love's free-tier ruling; lane dispatch: THE MIGRATION PARKS and waits
-- for Love's NAMED authorization — never firing-cleared, never
-- builder-applied without it).
--
-- Two coordinated changes:
--
--   1. tasks.pod_photo_captures — nullable jsonb array of capture
--      entries `{ path, bytes, content_type }`, index-aligned with
--      tasks.pod_photos (the SF pre-signed URLs, which stay untouched
--      as the vendor-side forensic record). NULL = nothing captured
--      yet. Written once by the capture consumer
--      (/api/queue/capture-pod); read by the POD proxy route, which
--      prefers the captured object over the 7-day-TTL vendor URL.
--      `bytes` per entry feeds the free-tier guardrail SUM
--      (log-and-alert as usage approaches the 1 GB cap — never a
--      silent drop).
--
--   2. outbound_push_failures.operation CHECK gains 'pod_capture' so
--      the QStash failure twin (/api/queue/capture-pod-failed) can
--      record capture failures in the existing DLQ surface. Pure CHECK
--      extension, same shape as 0025's 'reschedule' addition.
--
-- Sequencing: this file MUST be applied to production BEFORE the
-- capture code path first runs there (the consumer writes the new
-- column; the failure twin writes the new operation value). Additive
-- and inert until then — applying it early is safe.
-- =============================================================================

ALTER TABLE tasks
  ADD COLUMN pod_photo_captures jsonb;

COMMENT ON COLUMN tasks.pod_photo_captures IS
  'Durable POD capture entries [{path, bytes, content_type}], index-aligned with pod_photos. Paths live in the private pod-photos storage bucket. NULL = not captured. Day-53 #413 lane.';

ALTER TABLE outbound_push_failures
  DROP CONSTRAINT outbound_push_failures_operation_check;

ALTER TABLE outbound_push_failures
  ADD CONSTRAINT outbound_push_failures_operation_check
    CHECK (operation IN ('update', 'cancel', 'bulk_cancel', 'reschedule', 'pod_capture'));
