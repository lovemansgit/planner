# Decision · Merchant-facing task editability cuts off at "assigned"

> **SUPERSEDED — 2026-05-18 (Day-30, B2 code-PR for plan-PR #308 §3.6 cleared).** The "lock at TASK_HAS_BEEN_ASSIGNED" rule below is NOT enforced in code at any point post-Day-13. Brief §3.1.8 (post-dates this memo) commits to a time-based 18:00-Dubai-day-before cutoff, enforced at 10 service-layer sites via `isCutOffElapsedForDate`. The popover's `MUTATION_ELIGIBLE_STATUSES` ([DayActionPopover.tsx:101-105](../src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx#L101-L105)) explicitly includes `'ASSIGNED'` as mutation-eligible. B2 plan-PR #308 §4 ratifies the time-based rule as canonical and logs the "task ASSIGNED before time-cutoff → merchant could cancel a dispatched task" edge as a KNOWN pre-existing post-demo hardening item — see [`followup_assigned_before_cutoff_dispatch_race.md`](followup_assigned_before_cutoff_dispatch_race.md). Brief v1.16 records the supersede at the source-of-truth. **Read the memo below for historical context only; do NOT cite it as a current rule.**

**Status:** Decided. Confirms existing operational rule. Captured from `aqib.a` review of `subscription-planner-onboarding_v1.1` page 16.
**Decision date:** 28 April 2026 (Day 3 EOD review).
**Decided by:** Love (engineering-owner). This is Transcorp's global operational rule, not a Planner-specific design choice.

## Source comment

> "You can update task before pickup"

## Decision

The Planner's UX rule is: **once a task is assigned to a driver (signalled
by SuiteFleet's `TASK_HAS_BEEN_ASSIGNED` webhook), it is locked from the
merchant's view.** Any change after that point goes through the
cancelTask + create-replacement path, never an in-place update.

## Why not "before pickup"

- "Before pickup" is technically the SuiteFleet API limit, but the
  operational window between push (cutoff time) and assignment is narrow —
  typically 25 minutes some nights, sometimes less.
- "Before pickup" can be 12+ hours after assignment. During that window,
  the driver has the task on their route plan. A merchant editing the
  address mid-day would silently re-route the driver, which is
  operationally unacceptable.
- Transcorp has run this "lock at assignment" rule globally for years across
  all merchants. The Planner inherits it; we don't get a different cutoff
  just because the UI is new.

## Webhook signal

`TASK_HAS_BEEN_ASSIGNED` (from SuiteFleet's 15-event vocabulary) is the
trigger. On receipt:

- The internal task moves from `CREATED` → `ASSIGNED` in the
  `InternalTaskStatus` enum (already mapped in S-6, Day 4).
- The Planner UI hides the in-place edit path for that task and offers
  cancelTask + replacement instead.

## What the doc still gets right

The onboarding doc's existing language ("Tasks for tomorrow are already
pushed to SuiteFleet — they're real, on a driver's route plan. Changes to
those days are still allowed but go through a different path: the system
calls SuiteFleet's cancelTask and creates a replacement.") is exactly the
desired behaviour. It conflates "pushed" with "locked," but in practice the
two are very close in time, and the operational outcome is the same.

## Action

- Communicate the cutoff back to Aqib explicitly so there is no future
  ambiguity ("we use assignment, not pickup, as the lock point — same as
  every other Transcorp product").
- No engineering change required; the design already routes through
  cancelTask + replacement for this case.
- The S-6 status mapping (Day 4) already collapses
  `TASK_HAS_BEEN_ASSIGNED` → `ASSIGNED`. This is the signal the UI listens
  for to flip the affordance.
