# Handoff — D56 move-to-date rework (#535) + Wave-1/2 state

**Filed:** 2026-06-21 (Day-56), T1 docs hand-off committed so a fresh session bootstrapping from main can pick up the rework. Anchored to main `6e10e9b`. This is a STATE memo, not an EOD.

---

## Current state (one line)
Wave 1 merged (#533 A1 note-bridge, #534 admin cross-tenant POD) → main **`6e10e9b`**, **UNPROMOTED**. A single promote is held until the #535 move-to-date rework AND Phase 8 (status expansion) land. Plan-PR #532 (8-phase consolidated UAT remediation) is approved and is the parent plan.

---

## THREE load-bearing facts for the next reviewer/builder

1. **#535's cancel-side is SOUND but is NOT the whole fix — the PARKED #535 MUST NOT be merged as-is.** It drops the `!isMoveToDate` guard so move-to-date cancels the original on SuiteFleet — correct as far as it goes — but the moved task is **never created** (see verified gap below). Merging #535 alone ships a **net-loss bug**: original cancelled on SF, no replacement delivery. #535 is parked `needs-directional-ruling`.

2. **#535's cancel-side was cleared by Love's MERGE DISPATCH in error, and the reviewer AGENT caught it at the merge gate.** The merge dispatch asserted "no Love-trigger, standard path" (it read the cancel half; the recreate half — which doesn't exist — was missed). The independent `reviewer` agent re-read at the pinned head and posted **REQUEST_CHANGES**, correctly flagging both the directional reversal and the missing-recreate. **The next reviewer MUST re-read the WHOLE move-to-date path (cancel AND recreate) and trust NO prior "approved #535" note.**

3. **OQ-6 REVERSED — pre-#521 stranded-task backfill is DROPPED ("future correctness only"). Do NOT re-open / build backfill / probe the rowset / write a backfill migration.** The cause (pre-#521 timing gap) is already fixed for all future tasks by #521 (live). ~100 JOY BOY-class rows stay visibly-stale but inert.

---

## #535 REWORK DESIGN — full executable hand-off

**Love's ruling:** BUILD IT PROPERLY — move-to-date must **cancel the original on SF (done in #535) AND materialize a real one-off task at `target_date_override`**, so SF holds exactly ONE delivery at the moved date. Cite Love: *"build them properly, do not paper over it."* This supersedes the parked Aqib-gated `rescheduleTask` deferral.

**Scope discipline (Love):** fix the **CREATION gap only**. Cron daily-frequency latency (a correctly-created task pushes on the next daily tick, ≤24h) is **tolerable and OUT OF SCOPE** — do NOT touch cron scheduling.

### Verified blockers (probed at main 6e10e9b)
- The materializer has **ZERO references** to `target_date_override` / `compensating_date`. `src/modules/subscription-exceptions/service.ts:507-528` (move-to-date branch) extends `end_date` when `target > end_date` (→ the nightly cron later fans out **every** intermediate eligible day) and otherwise relies on "cron's normal flow" (comment L516-521) — which **never creates the moved task**.
- `materializeSubscriptionForDateRange(tx, {subscriptionId, startDate, endDate})` (`src/modules/task-materialization/service.ts:579`) does the proper 4-layer address resolution (`buildResolvedAddressesCte`) + `ON CONFLICT (subscription_id, delivery_date) DO NOTHING` + `created_via='subscription'` + `'SUB-…'` order#, BUT its explicit-mode CTE caps the upper bound at `LEAST(endDate, s.end_date)` — so it **cannot** create a task beyond `s.end_date`. (`cte-builder.ts:206-211`, `buildUpperBound`.)
- Net: the common "instead of tail-end" case (target **beyond** end_date) cannot be served by extending end_date (fan-out) nor by the existing range materializer (capped). It needs a new **no-cap single-date insert**.

### The build
1. **Stop extending end_date** in the move-to-date branch (`subscription-exceptions/service.ts:507-528`): set `newEndDate = null` always for move-to-date (remove the `target > end_date → newEndDate=target; endDateExtended=true`). This kills the cron fan-out path.
2. **Add `materializeSubscriptionOneOffDate(tx, {subscriptionId, date, requestId})`** to `task-materialization/service.ts`: a candidate CTE of the **SINGLE literal date** for the subscription (no `generate_series`, **no end_date cap**), filtered to eligible-weekday (already validated upstream) AND not skip/pause-excepted, composed with `buildResolvedAddressesCte`, then `INSERT … ON CONFLICT (subscription_id, delivery_date) DO NOTHING RETURNING id`. Reuses the proven address resolution + customer_order_number + created_via. Returns the inserted id (or empty on conflict).
3. **Call it after `markTaskSkipped`** in the move-to-date path (inside the withServiceRole/tx, or post-commit). `ON CONFLICT` handles the within-schedule collision (target already has a task → no-op, no duplicate).
4. **Post-commit:** `enqueueTaskPushBatch({ tenantId, taskIds: [movedTaskId], requestId })` for the new task **+ keep the existing `enqueueCancelTask(original)`** (the #535 cancel-enqueue stands). Standard push pipeline — do NOT special-case.

### Edges (both must be handled + tested)
- **Target WITHIN schedule** (≤ end_date): no end_date extension; `ON CONFLICT DO NOTHING` → no duplicate (the existing/normal task at target IS the delivery). No net change in delivery count.
- **Target BEYOND end_date**: the no-cap insert creates exactly ONE task at target; end_date NOT extended → **no fan-out** of intermediate days.

### Open question (settle before/with the build)
**Is a within-schedule move-to-date even a valid operator action?** If target is already an eligible delivery day, it already delivers there — "moving" X onto it is ambiguous (the UI may only offer tail-end-like / beyond-end_date dates). Confirm the intended semantics; if within-schedule is invalid, reject it at validation rather than silently no-op'ing.

### RED-first test list
- move-to-date on a pushed original → creates **exactly ONE** task at `target_date_override` AND enqueues cancel for the original AWB.
- within-schedule target (task already exists) → `ON CONFLICT` no-op → no duplicate, no extra delivery.
- beyond-end_date target → single task created, `end_date` NOT extended, no fan-out of intermediate eligible days.
- unpushed original (no AWB) → no cancel enqueue, but the moved task is still created.

### Decision memo to file (fresh session)
`memory/decision_d56_move_to_date_build_properly.md` — record: Love ruled build-it-properly (cancel original + materialize one-off at target, no fan-out), superseding the parked Aqib-gated `rescheduleTask` deferral; cite *"build them properly, do not paper over it."* Brief **§3.1.6 amendment + §9 version bump**: move-to-date cancels the original on SF AND creates a one-off task at the chosen date (not reschedule, not tail-end fan-out).

### PR posture
The #535 cancel-side commit STANDS; the rework ADDS the create-side. Fresh session either extends #535 or opens a replacement PR. HARD STOP at PR-open; reviewer body-reads the WHOLE path (cancel AND recreate).

---

## Pointers
- Plan: PR #532 `memory/plans/day-56-consolidated-uat-remediation.md` (§Phase-5 + OQ-5; note §Phase-5 under-scoped the recreate — this handoff supersedes it).
- Diagnosis: PR #531 `memory/diagnostic_uat_issues_2_0.md`.
- #535 PR thread carries the builder-ACK comment with the verified materialization-gap evidence.
- Remaining Wave-2/plan items: Ph2 (F4 toggle discoverability), Ph4a (`/tasks` POD visibility — #414 conflict), **Ph8 (status expansion — heavy lane)**. All gated on their #532 OQs.
