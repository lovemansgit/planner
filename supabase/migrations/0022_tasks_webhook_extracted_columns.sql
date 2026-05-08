-- =============================================================================
-- supabase/migrations/0022_tasks_webhook_extracted_columns.sql
-- =============================================================================
-- Day 18 / A2 — adds 10 nullable columns to `tasks` for webhook-extracted
-- fields per memory/plans/day-18-a2-webhook-handler-3-layer.md §4.1 + §4.5.
--
-- Layer 3 of the A2 webhook handler 3-layer plan writes:
--   * pod_photos              — POD photo array, populated on
--                                TASK_STATUS_UPDATED_TO_DELIVERED.
--                                jsonb shape per §4.4 ruling at code-PR open.
--   * recipient_name + 8 fields — populated on TASK_HAS_BEEN_UPDATED edit
--                                events per §4.2 mapping. snake_case canon
--                                per §4.5 ruling.
--
-- Plan §11.3 non-negotiables:
--   - RLS already enabled on `tasks` (0006); no policy change.
--   - Migrations are forward-only — never edit this file once applied.
--
-- All columns nullable, no defaults:
--   * NULL on pod_photos          = no POD received yet (or non-DELIVERED).
--   * NULL on the 9 extracted     = no TASK_HAS_BEEN_UPDATED event has ever
--     columns                       delivered a value for that field on
--                                   this row.
--
-- Type rationale per plan §4.1:
--   * signature      text      — covers base64-blob and URL forms;
--                                Day-7 capture review settles which.
--   * consignee_rating          smallint  — 1-5 rating range; int2 comfortable.
--   * number_of_attempts        smallint  — attempt counts ≤ a few hundred.
--   * completion_latitude/longitude
--                    numeric   — no precision/scale specified to admit
--                                SF wire-side precision verbatim.
--
-- No indexes. None of these columns are load-bearing for queries today;
-- partial indexes can land later if reporting surfaces emerge.
--
-- GRANT already in place via 0003 ALTER DEFAULT PRIVILEGES.
--
-- Audit event vocabulary:
--   * task.status_changed_via_webhook   (Layer 2 emits)
--   * task.edit_applied_via_webhook     (Layer 3 emits — covers all
--                                        9 extracted columns + address
--                                        payload audit-only per §4.3)
--   * task.pod_received_via_webhook     (Layer 3 emits when pod_photos
--                                        transitions NULL → populated)
-- All registered in src/modules/audit/event-types.ts in this code-PR.
--
-- Migration discipline: forward-only, applied via Supabase SQL editor
-- post-merge per memory/feedback_claude_code_executes_default.md.
-- =============================================================================

ALTER TABLE tasks
  ADD COLUMN pod_photos                jsonb,
  ADD COLUMN recipient_name            text,
  ADD COLUMN signature                 text,
  ADD COLUMN consignee_rating          smallint,
  ADD COLUMN consignee_comment         text,
  ADD COLUMN driver_comment            text,
  ADD COLUMN number_of_attempts        smallint,
  ADD COLUMN failure_reason_comment    text,
  ADD COLUMN completion_latitude       numeric,
  ADD COLUMN completion_longitude      numeric;
