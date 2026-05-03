---
name: 7-state InternalTaskStatus model collapses two distinct failure outcomes
description: FAILED bucket merges "failed for this attempt, may retry" with "permanently failed, returned to shipper." Merchants may want the distinction for cost accounting and customer comms. Defer until pilot feedback confirms it matters.
type: project
---

The `InternalTaskStatus` union in `src/modules/integration/types.ts` has seven values: `CREATED / ASSIGNED / IN_TRANSIT / DELIVERED / FAILED / CANCELED / ON_HOLD`. The S-6 mapper (`src/modules/integration/providers/suitefleet/status-mapper.ts`) collapses three SuiteFleet actions into `FAILED`:

- `TASK_STATUS_UPDATED_TO_FAILED` — delivery attempt failed (transient; could retry)
- `TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN` — package being prepared to return to shipper
- `TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER` — package physically back at origin (terminal)

The internal model can't distinguish "this attempt failed, retry coming" from "permanently failed, package returned." Both look like `FAILED` to downstream consumers (audit, dashboards, notifications, the planner UI).

**Why it's not fixed today:**

- Adding an 8th internal state (e.g. `RETURN_IN_PROGRESS` or `RETURNED`) is expensive once shipped — it propagates to every component that switches on `InternalTaskStatus`: the API error envelope, the route-handler logic in S-8, the eventual UI badge / colour mapping, the audit event vocabulary, and the FSM transition rules. The change isn't local.
- Pilot feedback hasn't yet shown whether merchants actually need the distinction. The pilot is three merchants over 14 days; if cost-accounting reports start asking "how many of these FAILEDs were one-attempt fails vs. terminal returns?", the gap surfaces and we add the state. If reports are happy with one bucket, the collapse stands.
- Day-4 budget is the constraint — adding a state needs to land alongside its consumers, which means at least three additional commits across modules. Not justified pre-pilot.

**How to apply (post-pilot decision):**

If pilot feedback confirms the merchant cares:

1. Add the new state to `InternalTaskStatus` in `src/modules/integration/types.ts`.
2. Update the S-6 mapper to send `PROCESS_FOR_RETURN` and `RETURNED_TO_SHIPPER` to the new state instead of `FAILED`.
3. Audit every `switch (status)` / `case "FAILED"` site for whether the new state should also be handled there (likely yes for "is this a terminal failure?" predicates, no for "should this be retried?" predicates).
4. Update the audit event vocabulary if there's a `task.failed` event tied to `FAILED` status — the new state probably wants its own audit event.
5. Backfill: existing tasks in `FAILED` status from before the migration stay `FAILED`. Don't try to retroactively reclassify; the original SuiteFleet event was already mapped under the old model.

**Surfaced:** Day 4 / S-6 PR review (29 April 2026). Documented at the moment of the design decision so the trade-off is on record.
