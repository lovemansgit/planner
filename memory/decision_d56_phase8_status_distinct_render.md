# Decision — D56 Phase 8: SF status renders distinctly (coarse + fine `courier_status`)

**Date:** 21 Jun 2026 (Day 56). **Type:** T3 plan-PR decision memo (parks for reviewer body-read + Love clearance). **SQL TO APPLY: no (plan only).**

## Ruling source (Love, on the enumeration)

The A2 mandate — **every SF status renders DISTINCTLY on Planner; no collapsing** — is a Love-ruled scope expansion. On the enumeration table Love ruled:

1. **Colour groups by FAMILY** (amber ramp = in-transit journey; red = failure family; Stone-600 = hold family; green = delivered; Ocean Blue = assigned; neutral = ordered/cancelled). Within a shared-colour family, **icon + label** make states distinct. **No new hex, no palette widening.** Distinctness = the **combination** of colour + icon + label.
2. **OUT_FOR_DELIVERY = brightest amber** (Signal Amber `#E8A33C`), highest-attention; mid-journey states demote down the ramp.
3. **Calendar mislabel FIXED** — in-transit and out-for-delivery are two different statuses, rendered as two; `DayDisplayStatus` stops folding/mislabeling.

## Decision

- **Carry the fine distinction in a new nullable `tasks.courier_status` column (14 values); leave `internal_status` at its current 8-value CHECK unchanged** (Option B). Render reads `courier_status`, falls back to coarse `internal_status` when NULL. This keeps the v1.17–v1.30 lifecycle machinery (editability, pause/resume fan-out, churn cascade, move-to-date, transition guards) reading the stable coarse spine. *(OQ-1 — recommend B; A named as the alternative.)*
- **`ARRIVED_ON_DC` (action) / `ARRIVED_IN_DC` (value) fold to one `ARRIVED_AT_DC`** — one state spelled two ways. Real distinct count = **14** courier states (the 15-action vocab minus the non-lifecycle `TASK_HAS_BEEN_UPDATED` edit; the prior "13" was an off-by-one — ARRIVED is already a single action). Memory's "8" = the status-field values observed on the wire.
- **Mappers stop the lossy collapse** via sibling fine maps + a `shouldAdvanceCourierStatus` guard with an in-transit ramp rank (so the 5 in-transit sub-states progress on the fine field while coarse stays `IN_TRANSIT`, and a lagging webhook can't regress OFD→Picked-up). Coarse maps + `shouldAdvanceStatus` unchanged.
- **Migration 0035 (named, NOT created):** adds `courier_status text NULL` + `tasks_courier_status_check`. Forward-only backfill recommended (existing rows NULL → render falls back to coarse); the 3 lossy families can't be disambiguated historically, so inventing sub-states would be dishonest.
- **#537 (move-to-date timeline drawer) is MERGED to `main` (`b1bef3a`)** → the timeline drawer is a normal coordinated render surface, not DO-NOT-TOUCH.

## Blast radius (plan-counted, not touched)

9 human-facing render surfaces + 3 shared maps (`tasks/status.ts`, `StatusIcon.tsx`, `DayDisplayStatus.ts`). 6 new icons (`PickupIcon`, `DcIcon`, `HubTransferIcon`, `OutForDeliveryIcon`, `ReturnIcon` outline+solid, `RescheduleIcon`, `RetryIcon`). `/tasks` filter stays coarse-7; rows render fine-14.

## Brief impact

§3.1.10 (courier fine model + render-distinctly mandate), §3.3.11 (status-render colour families + label/icon), §9 row **v1.31**, version markers. Additive-only, append-only §9.

## Related

[[followup_migration_drift_check]] (0035 applied at PR-prep) · [[followup_internal_task_status_lossiness]] (the FAILED-bucket lossiness this partially addresses) · plan: `memory/plans/day-56-phase-8-status-distinct-render.md`.

**Open questions:** 8, each with one recommendation — see plan §11. Love can answer "all recommendations."
