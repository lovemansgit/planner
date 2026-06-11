---
name: Day-52 rulings — calendar-management Phase 1 R4/R5 build (one-off + forward address override pushes)
description: Repo record of Love's Day-52 rulings authorizing the R4/R5 build — OQ-1 (a) 'pending_update' enum via migration 0029, OQ-3 inline confirm popup, ConsigneeSnapshot option B, OQ-5 brief amendment. Delivered via the Session-B overnight tasking; encoded here per the §9 "clearance is the verification" precedent.
type: decision
---

# Day-52 rulings — calendar-management lane Phase 1, PR-4 (R4) + PR-5 (R5)

**Filed:** Day-52 (2026-06-10), Session B overnight build.
**Authority:** Love's Day-52 rulings, delivered in the Session-B overnight build
tasking (the builder's standing instructions for this run). The repo held no
merged record of these rulings at build time — plan-PR #335 (the Day-36 Phase-1
plan, branch `plan/d36-calendar-management-phase-1`) is closed-unmerged, and the
R4/R5 rows in `memory/diagnostic_calendar_management_full_surface_enumeration.md`
record the product decisions but not the OQ-level engineering rulings. Per the
precedent in `memory/decision_workflow_autonomy_single_checkin.md` §9 ("Because
the repo held no record at encoding time, the PRs writing it down PARKED … and
were cleared only by Love's explicit named authorization — the clearance itself
is the verification"), this memo rides in the parked PR-4 branch and **Love's
named clearance of the R4/R5 PR stack is the verification of this record.**

## The locked rulings (build EXACTLY; do not re-litigate)

### R4 — one-off address override (task-level)

Operator overrides the address on a single in-horizon task: (i) UPDATE that
task's `address_id`; (ii) push the update to SF via `enqueueUpdateTask` (the
same outbound publisher as the proven R2/R3 paths). Other tasks untouched.
**No confirmation popup** — the scope (one delivery) is self-evident. Typed
audit event following the R2/R3 typed-event precedent
(`task.address_override_pushed`).

### R5 — forward address override (SUBSCRIPTION-scoped, NOT consignee)

(i) UPDATE `address_id` on every in-horizon task on that subscription
(`delivery_date >= start_date AND delivery_date < CURRENT_DATE + 14 days`);
(ii) `enqueueBulkUpdateTasks` fan-out SF push per task; (iii) the subscription's
stored address updates so future cron-materialized tasks pick it up via the
existing materializer CTE (the `address_override_forward` exception row IS that
stored address — the CTE's forward branch reads it; no new column).
**Confirmation popup REQUIRED, copy VERBATIM, do not paraphrase:**

> "Are you sure you want to update the address for all future tasks on this subscription?"

Other subscriptions for the same consignee untouched. Consignee-level change
across all subscriptions is explicitly OUT OF SCOPE.

### OQ-1 — RULED (a)

Add `'pending_update'` to the `outbound_sync_state` CHECK enum for in-flight
"sending to SuiteFleet" visibility (extend the existing badge that already
covers `pending_cancel`). Requires **migration 0029** extending the enum from
migration 0026/0028. The migration is a LIVE DB CHANGE → parks for Love with an
explicit SQL-TO-APPLY flag; it must be Love-applied via the Supabase SQL editor
BEFORE the dependent code-PRs promote.

### OQ-3 — RULED

The R5 confirmation popup is INLINE in `DayActionPopover` (modal-within-
popover), not full-screen.

### ConsigneeSnapshot gap — RULED (option B)

INLINE SERVER-SIDE snapshot construction inside the outbound wrapper — read the
new address row + consignee row server-side, build the `ConsigneeSnapshot`,
enqueue with the `consignee` field populated. Load-bearing: it is what makes the
SF address push actually fire (address-only patches previously skipped the
enqueue per `memory/followup_address_edit_sf_outbound_gap.md`). Retires the
deferred "next scheduled push pass" disclosure copy on this path.

### OQ-5 — RULED

Brief amendment: add the R4/R5 address-override pushes to the brief's outbound
surface listing (the ruling's "§3.1.4/§3.5" pointer maps to §3.1.4 + §3.3.3 in
the current brief numbering — the plan's "§3.5 task action model" label does not
match the brief's §3.5, which is label generation) + version bump v1.17 → v1.18.
Rides with the build (PR-5).

### Sequencing

PR-4 (R4) FIRST, then PR-5 (R5) — sequential per plan §6 (shared outbound
publisher; R5 reuses R4's update-shape). Two separate code PRs, both PARK for
Love with the opus reviewer's pre-review verdict. Migration 0029 parks
separately. Nothing merges; nothing promotes.

## Cross-references

- `memory/diagnostic_calendar_management_full_surface_enumeration.md` — R4/R5
  product rulings (Day-33 PM session) this build executes.
- Plan branch `plan/d36-calendar-management-phase-1` —
  `memory/plans/day-36-calendar-management-phase-1.md` §2.R4/§2.R5/§3/§5/§6
  (unmerged; engineering surfaces verified against the running code at build
  time per the verify-against-running-product discipline).
- `memory/followup_address_edit_sf_outbound_gap.md` — the option A/B/C menu the
  ConsigneeSnapshot ruling picks from.
- `memory/decision_workflow_autonomy_single_checkin.md` §9 — the
  clearance-is-the-verification precedent this memo relies on.
