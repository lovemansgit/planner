---
name: task_generation_runs.completed_at written ~6-8ms BEFORE started_at — deterministic across all 4 cron-eligible tenants on first 12:00 UTC tick under PR #153 cron-decoupling handler; cosmetic (not a verification blocker) but signals timestamp-source mismatch in writeRunRowPhase4
description: Day-16 EOD §4.4 verification of the first 12:00 UTC tick under the new PR #153 6-phase materialization handler showed all 4 cron-eligible tenants with `completed_at` consistently ~6-8ms BEFORE `started_at`. Pattern was DETERMINISTIC across all 4 rows (not random clock drift). Likely root cause: writeRunRowPhase4 (src/modules/task-materialization/run-row.ts) sets completed_at from a value computed BEFORE the per-tenant tx opens (probably handler-entry Date.now() snapshot or windowStart-derived value), while started_at uses NOW() at INSERT time inside the tx. Cosmetic — does NOT affect cron correctness, durability, or operator-visible state. All 4 tenants completed cleanly with target_date=2026-05-20 + status='completed'. Plan-sync candidate for Day-17 morning bundle (item 13 of 13).
type: project
---

# task_generation_runs `completed_at` < `started_at` cosmetic drift

**Surfaced:** Day-16 EOD §4.4 verification — first 12:00 UTC cron tick under PR #153 cron-decoupling handler, run on production at ~16:00 +0400 Dubai 2026-05-06 (12:00 UTC).

## §1 The drift — observed timestamps

Query against production `task_generation_runs` for the 12:00 UTC tick window:

| tenant_id (truncated) | started_at (UTC) | completed_at (UTC) | duration_seconds |
|---|---|---|---|
| 84013d14… | 12:00:35.977 | 12:00:35.970 | -0.006453 |
| 0dabde8a… | 12:00:35.712 | 12:00:35.706 | -0.005826 |
| 4d53221c… | 12:00:35.421 | 12:00:35.414 | -0.006329 |
| 8bfc84b0… | 12:00:35.275 | 12:00:35.267 | -0.007544 |

All 4 rows show `completed_at` ~6-8ms BEFORE `started_at`. The negative duration is **deterministic** (not random clock drift):

- Pattern is consistent: `completed_at = started_at - (6 to 8 ms)` for every tenant
- All 4 rows share the same `window_start='2026-05-06T12:00:34.924Z'` — confirms a single cron invocation walked the 4 tenants sequentially
- `started_at` values differ per tenant by ~150-560ms (sequential per-tenant tx open times); the per-tenant `completed_at` lags `started_at` by the same ~6-8ms gap each time

## §2 Likely root cause — timestamp-source mismatch

`task_generation_runs` schema per migration 0012:160:

```sql
status                   text NOT NULL DEFAULT 'running',
...
started_at               timestamptz NOT NULL DEFAULT now(),
...
completed_at             timestamptz,
```

`started_at` defaults to `NOW()` evaluated at INSERT time — a clock read inside the per-tenant tx.

`completed_at` is set explicitly by `writeRunRowPhase4` ([src/modules/task-materialization/run-row.ts](../src/modules/task-materialization/run-row.ts)) per the §4.4 6-branch state machine. The actual value source is what creates the inconsistency:

- **Hypothesis A (most likely):** `completed_at` is set to a `Date.now()` snapshot taken BEFORE the per-tenant tx began — e.g., at handler entry (before the per-tenant loop) or at the start of the per-tenant iteration but before `withServiceRole(...).execute(INSERT)` actually fires. The snapshot value is captured first, the INSERT runs slightly later, and Postgres' `NOW()` at INSERT time is ~6-8ms later than the captured snapshot. The exact timing matches the per-tenant tx setup overhead (postgres-js connection acquisition + `BEGIN` + `SELECT current_setting`/`SET` for tenant scope).
- **Hypothesis B:** `completed_at` is set to `windowStart` or some windowStart-derived value computed at handler entry. This would explain why all 4 rows have similar gaps — they all reference the same handler-entry timestamp.

The handler entry computes `now = new Date()` + `windowStart = now.toISOString()` once per cron invocation (route.ts:122-125). If `writeRunRowPhase4` reuses one of these values for `completed_at`, then completed_at is fixed at the handler-entry instant while started_at is the per-tenant tx instant — which is always later. This matches the observed pattern.

## §3 Why this is cosmetic, not a verification blocker

- All 4 tenants reached `status='completed'`. No failures, no caps, no stuck-running rows.
- `target_date='2026-05-20'` matches today + 14 days (correct horizon).
- `tasks_created=0` across all (expected — production subs already materialized through their respective horizons).
- The cron correctness contract is preserved: the run-row indicates the run completed, the materialization tx committed durably, Phase 5 enqueue fired post-commit.
- The negative `duration_seconds` only affects observability queries that compute "how long did the run take". Operations dashboards may render negative durations confusingly, but no operational decision is gated on this value.

The drift affects the OBSERVATIONAL semantics of the row (`completed_at - started_at` no longer reads as a meaningful duration) but NOT the OPERATIONAL semantics (status + tasks_created + target_date all valid).

## §4 Resolution path (post-demo / Phase 2)

Investigation order:

1. Open `src/modules/task-materialization/run-row.ts` and locate `writeRunRowPhase4`. Identify the value passed to `completed_at` in the INSERT statement.
2. Decide alignment:
   - **Option A (preferred):** Both timestamps derive from the same in-tx `NOW()` call. INSERT `... completed_at = NOW(), started_at = NOW() ...` (or use the column DEFAULT for `started_at` and explicit `NOW()` for `completed_at`). Both reflect the per-tenant tx commit time. Duration = 0 (or near-zero microseconds).
   - **Option B:** Both timestamps derive from the same handler-entry snapshot. INSERT `... completed_at = $1, started_at = $1 ...` with `$1 = handlerEntryTimestamp`. Duration = 0 (literal). Operationally less useful (loses per-tenant timing info) but consistent.
   - **Option C:** `started_at` from in-tx `NOW()` (current behavior), `completed_at` from a LATER snapshot taken AFTER the materialization SQL returns (so `completed_at >= started_at` always). Duration = real per-tenant work time. Most useful operationally.

Option C matches the schema's intent (`completed_at` is supposed to mean "when the run finished" — should be ≥ `started_at`). Option C is the recommended fix.

3. Update the writeRunRowPhase4 logic; add a unit test that asserts `completed_at >= started_at` for the success path.
4. Backfill: not strictly needed — historical rows with negative duration stay as-is. Operationally noise; no rewrite. Future rows from the fix-onward go positive.

## §5 Why deferred

- Demo posture (May 12): cron correctness is what matters; cosmetic-only timestamp drift doesn't affect any demo-day flow.
- Investigation requires reading run-row.ts in detail and writing a fix + unit test — out of scope for Day-16 EOD doc filing.
- Plan-sync candidate: bundles cleanly into Day-17 morning's 13-item plan-sync PR (becomes item 13 of 13).
- No production caller depends on a positive `duration_seconds`; ops dashboards that display this value will render negative durations until the fix lands, which is the operationally-correct cue ("this duration is wrong; investigate").

## §6 Cross-references

- **`src/modules/task-materialization/run-row.ts`** — `writeRunRowPhase4` lives here; the timestamp-setter for `completed_at`. Fix lands here.
- **`src/app/api/cron/generate-tasks/route.ts:122-125`** — handler entry computes `now`, `windowStart`, `windowEnd`; possible value sources for `completed_at` if Hypothesis B holds.
- **`supabase/migrations/0012_task_generation_runs.sql:160,175`** — schema declares `started_at timestamptz NOT NULL DEFAULT now()`, `completed_at timestamptz` (nullable; set explicitly by phase 4 writer).
- **`memory/plans/day-14-cron-decoupling.md`** §4.4 — 6-branch state machine for run-row writes; includes the success-path completed_at semantics.
- **`memory/handoffs/day-15-eod.md`** §4.6 — the deferred verification gate that this followup memo's verification cleared today.
- **`memory/handoffs/day-16-eod.md`** §4.4 — the verification turn that surfaced this drift; cites this followup memo for plan-sync candidate.
- **Day-17 morning plan-sync bundle** — this memo bundles as item 13 of 13.
