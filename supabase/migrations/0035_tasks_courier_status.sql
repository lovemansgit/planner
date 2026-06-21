-- 0035_tasks_courier_status.sql
-- =============================================================================
-- Day-56 Phase 8 / Lane 1 — fine SuiteFleet courier status (brief §3.1.10,
-- v1.31; plan memory/plans/day-56-phase-8-status-distinct-render.md §7).
--
-- A2 mandate: every SF courier state renders DISTINCTLY (no collapsing).
-- The distinction is carried by a NEW nullable `courier_status` column,
-- kept SEPARATE from the unchanged 8-value coarse `internal_status` that
-- all business logic reads (Option B; OQ-1 ruled). The SF webhook applier
-- (Lane 2) writes BOTH columns; render (Lanes 3-5) reads `courier_status`
-- and falls back to the coarse status map when it is NULL.
--
--   courier_status  the 14 fine SF courier states, OR NULL. NULL =
--                   no SF courier detail yet / a Planner-only state
--                   (SKIPPED, manual cancel) / a pre-backfill row. The
--                   `ARRIVED_AT_DC` value folds the SF `ARRIVED_ON_DC`
--                   (action) / `ARRIVED_IN_DC` (status-field value)
--                   spellings into one state. Mirrors COURIER_STATUS_VALUES
--                   in src/modules/integration/types.ts (the shared
--                   contract the mapper + render layers import).
--
-- `internal_status` and its CHECK (`tasks_internal_status_check`, the
-- 8-value 0019 set) are UNCHANGED — this migration only ADDs a column +
-- its own CHECK; it does not touch the coarse lifecycle.
--
-- Backfill: FORWARD-ONLY (OQ-5 ruled). Existing rows keep
-- courier_status = NULL (the column is nullable, so they pass immediately
-- with no rewrite); render falls back to the coarse `internal_status`
-- map. New webhooks populate the fine state from this point. The 3 lossy
-- coarse families (IN_TRANSIT×5, FAILED×3, ON_HOLD×2) cannot be
-- disambiguated for historical rows, so NO backfill is attempted — an
-- invented sub-state would be a lie.
--
-- Migrations in this repo are FORWARD-ONLY (no executable down section).
-- Rollback, if ever needed, is the inverse, applied as its own forward
-- migration:
--     ALTER TABLE tasks DROP CONSTRAINT tasks_courier_status_check;
--     ALTER TABLE tasks DROP COLUMN courier_status;
--
-- SQL-TO-APPLY: PARKED for Love's NAMED authorization (Day-5 convention,
-- builder-applied at PR prep per memory/followup_migration_drift_check.md).
-- NOT applied to the live Supabase by this PR. CI's ephemeral integration
-- DB (scripts/setup-test-db.sh) applies it automatically for the
-- migration-shape + repository tests.
-- =============================================================================

ALTER TABLE tasks
  ADD COLUMN courier_status text NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_courier_status_check
    CHECK (courier_status IS NULL OR courier_status IN (
      'ORDERED',
      'ASSIGNED',
      'PICKED_UP',
      'ARRIVED_AT_DC',
      'IN_TRANSIT',
      'HUB_TRANSFER',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'FAILED',
      'PROCESS_FOR_RETURN',
      'RETURNED_TO_SHIPPER',
      'CANCELED',
      'RESCHEDULED',
      'REATTEMPT'
    ));
