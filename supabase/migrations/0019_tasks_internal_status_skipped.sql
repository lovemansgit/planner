-- =============================================================================
-- supabase/migrations/0019_tasks_internal_status_skipped.sql
-- =============================================================================
-- Day 13 / T3 part 1: extend tasks_internal_status_check to admit 'SKIPPED'.
-- Implements memory/plans/day-13-exception-model-part-1.md §1.9.
--
-- Single-statement migration: DROP the existing CHECK constraint and ADD
-- the extended one. Postgres does not support ALTER CONSTRAINT for CHECK,
-- so DROP+ADD is the canonical pattern.
--
-- §0.2 Q5 prod verification confirmed the existing 7-value enum:
--   CREATED, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED, CANCELED, ON_HOLD
-- The extended enum adds SKIPPED for an 8-value total.
--
-- -----------------------------------------------------------------------------
-- Semantic boundary (locked from brief §3.1.1)
-- -----------------------------------------------------------------------------
--   SKIPPED  = human-driven exception with compensating-date semantics.
--              Service layer (part 2) sets via addSubscriptionException
--              (type='skip') on already-materialized tasks.
--   CANCELED = terminal stop. Subscription ended, paused (via
--              pause_window exception), or task cancelled outright.
--
-- The two are NOT interchangeable. UI (calendar, popover, timeline)
-- distinguishes the two in iconography + copy per brief §3.3.3 status
-- legend.
--
-- -----------------------------------------------------------------------------
-- Status mapper (S-6) does not receive SKIPPED from SuiteFleet
-- -----------------------------------------------------------------------------
-- The S-6 status mapper at src/modules/integration/providers/suitefleet/
-- status-mapper.ts maps SF's 15-value space to our internal_status enum.
-- SKIPPED is Planner-only — SuiteFleet has no equivalent state. Part 2
-- adds 'SKIPPED' to the mapper's local-only branch (alongside any other
-- Planner-only states); the mapper's exhaustiveness check via TS narrowing
-- continues to enforce coverage at compile time.
--
-- -----------------------------------------------------------------------------
-- No data migration
-- -----------------------------------------------------------------------------
-- Adding a value to an enum CHECK is non-breaking — existing rows still
-- pass the constraint. No backfill, no data touch.
-- =============================================================================


ALTER TABLE tasks
  DROP CONSTRAINT tasks_internal_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_internal_status_check
    CHECK (internal_status IN (
      'CREATED',
      'ASSIGNED',
      'IN_TRANSIT',
      'DELIVERED',
      'FAILED',
      'CANCELED',
      'ON_HOLD',
      'SKIPPED'
    ));
