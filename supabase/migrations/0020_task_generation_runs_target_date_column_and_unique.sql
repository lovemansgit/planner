-- =============================================================================
-- supabase/migrations/0020_task_generation_runs_target_date_column_and_unique.sql
-- =============================================================================
-- Day 14 / T3 Phase 4: adds (tenant_id, target_date) UNIQUE on
-- task_generation_runs to harden against the Run-A/Run-B race per
-- memory/plans/day-14-cron-decoupling.md §4.1 + §4.2 amendments.
--
-- Coupled-deploy unit per §4.2 amendment 4 + §11.2 row 3: this
-- migration AND the new materialization handler MUST land in the
-- same Vercel deploy. The NOT NULL on target_date breaks the
-- existing handler's INSERT path at task-generation/service.ts:223
-- (it writes runs without target_date). Migration-only deploy
-- without handler swap = production cron breaks at next tick.
--
-- 5-step transactional shape per §4.2 amendments D4-2 / D4-3 / D4-4:
--   (1) ALTER TABLE add target_date column, nullable initially
--   (2) backfill via AT TIME ZONE 'Asia/Dubai' per amendment 1
--   (3) dedup per §0.4 Q2 winning-row policy (MAX(completed_at)
--       preferred, else MAX(started_at)) — clears 20 r3-test-*
--       fixture tenants × 5 rows each on 2026-05-02 found by §0.4 Q2
--       prod probe
--   (4) ALTER TABLE set target_date NOT NULL after backfill populated
--   (5) ADD UNIQUE INDEX on (tenant_id, target_date) — pre-existing
--       UNIQUE on (tenant_id, window_start, window_end) from
--       0012:230-232 is RETAINED per §0.5 amendment D4-4
--
-- BEGIN/COMMIT wrapper makes all 5 steps atomic; partial failure
-- rolls everything back per §0.5 amendment D4-3.
-- =============================================================================

BEGIN;

-- (1) Add target_date column. Initially nullable to allow the
-- backfill step (2) to populate it; promoted to NOT NULL at step (4).
ALTER TABLE task_generation_runs
  ADD COLUMN target_date date;

-- (2) Backfill: existing rows have target_date implicit in
-- window_start's Dubai-local-day. The cron handler computes
-- targetDate as Dubai-tomorrow at handler entry; for historical
-- rows we re-derive via the timezone-aware form below per §4.3
-- amendment 1 (replaces the prior offset-arithmetic form
-- '(window_start + INTERVAL 4 hours)::date + 1' which was
-- numerically equivalent for the canonical 12:00 UTC tick but
-- obscured the timezone intent and broke under DST or off-hour
-- manual triggers).
UPDATE task_generation_runs
   SET target_date = ((window_start AT TIME ZONE 'Asia/Dubai')::date + 1)
 WHERE target_date IS NULL;

-- (3) Dedup per §0.4 Q2 winning-row policy.
--
-- ORDER BY semantics (read top-down — each key resolves a different
-- partition of the group):
--   1. (completed_at IS NULL) — boolean false (= 0) sorts before
--      true (= 1), so completed rows rank ahead of non-completed
--      rows within their (tenant_id, target_date) group.
--   2. completed_at DESC NULLS LAST — within the completed
--      sub-partition, the most-recent completed_at wins. NULLS LAST
--      is defensive (cannot fire here since key 1 already
--      partitioned NULLs to the bottom) but documents intent.
--   3. started_at DESC — within the non-completed sub-partition,
--      the most-recent started_at wins.
--
-- Layered semantic, not accidentally complex: the triple sort is
-- the most-recent-successful-run-of-record policy expressed in one
-- ORDER BY. Equivalent simplification
-- `(completed_at IS NULL ASC, COALESCE(completed_at, started_at)
-- DESC)` exists but trades clarity for terseness — keeping the
-- explicit triple to surface the partition-then-resolve intent.
DELETE FROM task_generation_runs
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
       ROW_NUMBER() OVER (
         PARTITION BY tenant_id, target_date
         ORDER BY
           (completed_at IS NULL),
           completed_at DESC NULLS LAST,
           started_at DESC
       ) AS rn
     FROM task_generation_runs
   ) ranked
   WHERE ranked.rn > 1
 );

-- (4) Promote target_date to NOT NULL — every row now has it from
-- step (2).
ALTER TABLE task_generation_runs
  ALTER COLUMN target_date SET NOT NULL;

-- (5) Add the new UNIQUE on (tenant_id, target_date). The
-- pre-existing UNIQUE on (tenant_id, window_start, window_end) —
-- from migration 0012:230-232 — is RETAINED per §0.5 amendment
-- D4-4. It provides finer-grained idempotency for within-day
-- re-runs (e.g., manual cron triggers at different UTC instants on
-- the same target_date) even though the new (tenant_id,
-- target_date) UNIQUE conceptually subsumes it. Both co-exist; the
-- new one fires first on cron-tick re-runs, the old one remains as
-- belt-and-braces.
CREATE UNIQUE INDEX task_generation_runs_tenant_target_date_unique_idx
  ON task_generation_runs (tenant_id, target_date);

COMMIT;
