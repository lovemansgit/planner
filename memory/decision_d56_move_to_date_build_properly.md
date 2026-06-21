# Decision — D56 move-to-date: build it properly (cancel original + materialize one-off at target)

**Filed:** 2026-06-21 (Day-56). Builder session, fresh, bootstrapped from main. Supersedes the parked `#535` (cancel-only) and the parked Aqib-gated `rescheduleTask` deferral.

---

## Love's ruling (verbatim anchors)

1. **Build it properly:** *"build them properly, do not paper over it."* Move-to-date must **cancel the original on SuiteFleet AND materialize a real one-off task at the chosen date** — so SF holds exactly ONE delivery at the moved date, not zero (the pre-#535 net-loss bug) and not two (the bug #535-alone would have shipped). This **supersedes** the parked Phase-2 `rescheduleTask` adapter (Aqib-gated wire contract) — we cancel + re-create with primitives we already own.

2. **Within-schedule move-to-date is REJECTED at validation** (this session's ruling, in answer to the handoff's surfaced open question). Verbatim: *"that date already has a delivery — use Skip-without-append to cancel it, or pick a date beyond the schedule."* Move-to-date means strictly **"move to a date that isn't already delivering."** Enforce at the **service/validation layer**, not just the UI. Covers two cases:
   - **bounded** subscription: target `<= end_date` → reject (that day already delivers).
   - **open-ended** subscription (`end_date IS NULL`): EVERY eligible day already delivers forever → **any** move-to-date is rejected.

3. **Scope discipline (Love):** fix the **CREATION gap only**. Cron daily-frequency latency (a correctly-created task pushes on the next daily tick) is tolerable and OUT OF SCOPE. Do NOT touch cron scheduling. The bug was *the task was never created*.

4. **OQ-6 stays REVERSED:** pre-#521 stranded-task backfill is DROPPED ("future correctness only"). Not re-opened by this work.

---

## What shipped

PR: **fresh superseding PR** off `main` (branch `fix/d56-move-to-date-create-side`). `#535` is **superseded** (its cancel-only half is incorporated and corrected; its misleading "the compensating task pushes on the next cron tick" comments are removed — that task was never created). `#535` should be **closed as superseded** (not merged).

**Mechanism (move-to-date = a `skip` exception with `target_date_override`, valid only BEYOND `end_date`):**
1. **No end_date extension** — `newEndDate = null`, `endDateExtended = false` always. This kills the nightly-cron fan-out (extending end_date past the target would have materialized every intermediate eligible day).
2. **In-tx materialization** — new `materializeSubscriptionOneOffDate(tx, {subscriptionId, date, requestId})` in `task-materialization/service.ts`. Candidate CTE of the SINGLE literal date (`buildOneOffCandidateDatesCte` — **no generate_series, no end_date cap**), composed with the SHARED `buildEligibleDatesCte` (skip/pause exclusion) + `buildResolvedAddressesCte` (4-layer address resolution) + the same INSERT projection (`created_via='subscription'`, `SUB-…` order#) as every materialized task. `INSERT … ON CONFLICT (subscription_id, delivery_date) DO NOTHING RETURNING id`. Runs inside the SAME `withTenant` tx as the skip (RLS `tasks_tenant_isolation` is `FOR ALL` `WITH CHECK (tenant_id = current_tenant_id)`; the inserted tenant_id is the sub's own tenant → passes). **Atomic** with the skip: a NULL-address resolution (consignee data gap) throws `ValidationError` → the whole op rolls back, so we never cancel the original on SF without a replacement.
3. **Post-commit cancel** — `enqueueCancelTask(original)` now fires for ALL skip variants (the `!isMoveToDate` guard is dropped — #535's sound half). Cancels the original on SF iff it carried a live AWB.
4. **Post-commit push** — `enqueueTaskPushBatch({tenantId, taskIds:[movedTaskId], requestId})` for the new task, via the standard batch pipeline (NOT special-cased). SF receives the moved delivery to pair with the cancel.

**Edges (tested):** within-schedule (bounded + open-ended) → reject; beyond-end_date → single task, no fan-out, no end_date extension; unpushed original → no cancel but moved task still created + pushed; address-gap at target → atomic rollback (no cancel, no push).

**Audit:** `subscription.exception.created.outbound_emission` now covers ALL skip variants (incl. move-to-date) — `kind='cancel'` for a pushed original, else `'none'`. The moved task's push goes through the standard pipeline and is not recorded in `outbound_emission`. `event-types.ts` description updated in lock-step (§3.6 binding constraint). **No new audit event, no schema/migration.**

**Tests:** RED-first. Unit: `materializeSubscriptionOneOffDate` return-mapping (3); service move-to-date sweep (6) + cancel sweep (2). Integration (CI-run, real Postgres): one-off inserts BEYOND end_date where the range materializer inserts 0; idempotent ON CONFLICT; address-gap; non-eligible weekday. Full unit suite green (2240); typecheck + lint clean. CTE snapshot updated (whitespace-only — `buildEligibleDatesCte` extraction, params identical).

---

## Timeline move-link (same v1.30 lane, extends PR #537)

Operators see the old↔new relationship both directions in the task timeline drawer (brief §3.3.6).

**Persistence shape (architectural decision): audit events, NO schema change.** Two new typed per-task events carry the link:
- `task.moved_in` — on the NEW task (resourceId = new task id). Metadata: `moved_from_task_id` (internal, stripped), `moved_from_awb` (the original's AWB — **known in-tx**, null if the original was unpushed), `moved_from_delivery_date`, `correlation_id` (stripped). Renders **"Moved from [old date] / replaces AWB [old AWB]"**.
- `task.moved_out` — on the ORIGINAL/cancelled task (resourceId = original task id). Metadata: `moved_to_task_id` (internal, stripped), `moved_to_delivery_date`, `correlation_id` (stripped). Renders **"Moved to [new date] / see AWB [new AWB]"**.

Both emitted post-commit alongside `subscription.exception.created` (shared `correlation_id`), gated on a created moved task. No tasks-table column, **no migration** — `audit_events.event_type` is plain text and `emit()` validates against the TS catalogue, so new typed events are code-only. The drawer renders via the existing `getTaskHistory` resourceId path; render logic is a pure helper (`src/components/task-timeline/move-link.ts`, unit-tested — no React harness in repo).

**Corrects the prompt's "both AWBs known in-tx":** only the OLD AWB is known at move time. The new task's AWB is assigned by SuiteFleet after the asynchronous push, so it is NOT stored on `task.moved_out`; `getTaskHistory` resolves it at read time from the new task row (`moved_to_task_id` → `external_tracking_number`) and injects the allow-listed `moved_to_awb`. Before SF assigns it, the cancelled-task sub-line shows "AWB pending — not yet sent to SuiteFleet".

**Cancelled-task render caveat (point 4) — resolved, no scope expansion:** the drawer's History section renders unconditionally (not gated on task status), so the SKIPPED/cancelled original shows its `task.moved_out` entry at the same weight as the active task.

Allow-list (`history-metadata.ts`) gains `moved_from_awb` / `moved_from_delivery_date` / `moved_to_awb` / `moved_to_delivery_date`; counterpart task_ids + correlation_id stay stripped (internal). Drawer gate unchanged (`task:view_timeline`); no new permission.

RED-first: move-link helper (5), service emits both directions incl. unpushed-original null AWB (3), getTaskHistory read-time AWB resolution + allow-list survival (3, +2 characterizing pending/inline).

## Brief

§3.1.6 `target_date_override` bullet amended (move-to-date = cancel original on SF + materialize one-off at target; within-schedule rejected; not a reschedule, not a tail-end fan-out; + timeline move-link both directions). §9 **v1.30** (bumped from v1.29 for the create-side; timeline move-link added additively to the same v1.30 row — no new version).

See [[handoff_d56_move_to_date_rework]] (the executable design this implements).
