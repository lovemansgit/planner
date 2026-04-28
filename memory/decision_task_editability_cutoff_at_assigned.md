# Decision · Merchant-facing task editability cuts off at "assigned"

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
