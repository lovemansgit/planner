---
name: ASSIGNED-before-cutoff merchant-cancel dispatch race (pre-existing, post-demo hardening)
description: Time-based cutoff allows merchant cancel/edit on tasks that SF has already assigned to a driver; the original Day-3 lock-at-assignment semantic is not enforced in code. Pre-existing on the popover surface; B2 surfaces the same paths on /tasks but does not introduce the edge.
type: followup
---

# Edge

A task whose `internal_status='ASSIGNED'` (driver bound by SuiteFleet; the task may already be on the driver's route plan) AND whose `delivery_date` is still BEFORE the 18:00-Dubai-day-before cut-off → an operator can cancel via the calendar popover today (and, post-Day-30 B2 plan-PR #308, via the /tasks page).

Per the SUPERSEDED Day-3 decision memo (`memory/decision_task_editability_cutoff_at_assigned.md`), Transcorp's global operational rule is "lock at assignment, route changes via cancelTask + replacement." The time-based cut-off enforced in code (`isCutOffElapsedForDate`, 10 service-layer sites; brief §3.1.8) does NOT match this rule for the ASSIGNED-before-time-cutoff window — typically the 25-minutes-to-12-hours operational gap between SF assignment and pickup.

# Why this is acceptable for the MVP demo

Demo flows are operator-driven on tasks NOT yet at the `ASSIGNED` state. The demo uses fresh subscription tasks created same-day, cancelled before SF dispatches them. The edge is theoretically reachable in production but not exercised by the demo timeline.

# Not introduced by B2

B2 plan-PR #308 §4 (`memory/plans/day-30-b2-tasks-page-cancel-edit.md` §4) explicitly confirms B2 does NOT introduce a new ASSIGNED-state risk. The popover already permits `ASSIGNED` mutation today via [`DayActionPopover.tsx:101-105`](../src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx#L101-L105) `MUTATION_ELIGIBLE_STATUSES = ['CREATED','ASSIGNED','ON_HOLD']`. B2 surfaces the same already-permitted paths on `/tasks`. No new guard added; behaviour is consistent across both surfaces.

# Fix candidates (post-demo)

- **(A)** Add `internal_status !== 'ASSIGNED'` guard at all 10 `isCutOffElapsedForDate` sites OR refactor to a single shared editability-check fn (`isTaskEditable(now, task)`) that combines the time-cutoff AND the ASSIGNED-state guard. ~2 hours.
- **(B)** Add a soft warning ("This task is already assigned to a driver. Cancelling will dispatch a SF cancel notification mid-route. Proceed?") instead of hard-block — preserves operator agency while making the dispatch-mid-route consequence visible. ~1 hour UI only.
- **(C)** Accept the time-based rule as the canonical contract permanently and remove the historical Day-3 framing wholesale. Documentation-only (brief v1.16 already records the supersede).

# Reviewer ruling (post-demo)

Reviewer's call. Until ruled, the edge is documented and visible to ops via the audit trail (`task.updated` for /tasks Path A cancel, `subscription.exception.created` for the popover/cancelNoAppend path).

# Cross-references

- Brief §3.1.8 — time-based cutoff (canonical post-Day-13).
- Brief v1.16 (Day-30) — records the Day-3 supersede.
- `memory/decision_task_editability_cutoff_at_assigned.md` — Day-3 memo with the supersede header per B2.
- `memory/plans/day-30-b2-tasks-page-cancel-edit.md` §4 + §6 OQ-6 — plan-level documentation.
- `src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx` — `MUTATION_ELIGIBLE_STATUSES` includes `ASSIGNED`.
- 10 code sites with the time-based cutoff:
  - `src/modules/tasks/service.ts:1057, 1065, 1295, 1431, 1731, 1859, 1869`
  - `src/modules/subscription-exceptions/service.ts:397, 721`
  - `src/modules/subscriptions/service.ts:698`
