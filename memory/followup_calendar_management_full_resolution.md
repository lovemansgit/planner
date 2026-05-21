---
name: Calendar management full resolution (Day-32+ lane, separate from #317)
description: Day-32 production smoke surfaced two operator-action gaps on the calendar (skip-tail-end reinsertion is cron-deferred + invisible until next tick; move-to-date is Phase-2 placeholder with UI copy that lies). Future lane scopes pending-tail visualization, full move-to-date implementation (Aqib-coordinated), and a smoke-test framework for operator surfaces.
type: followup
---

# Origin

Day-32 (2026-05-20) production smoke testing of `dpl_H7uovYd48i5Di5jzdfAaP5hD1ptz` (source `d41da88`, post-PR #319 promote) surfaced two operator-action surfaces on the consignee calendar with material UX-vs-behavior gaps. Both reside in [src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx](../src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx) and dispatch via server actions in [src/app/(app)/consignees/[id]/_calendar-actions.ts](../src/app/(app)/consignees/%5Bid%5D/_calendar-actions.ts).

## (1) Skip-with-tail-end-reinsertion — silent cron-deferred tail materialization

**Surface:** "Apply default skip rules with tail-end reinsertion." button.

**What happens synchronously** (inside `addSubscriptionException` at [src/modules/subscription-exceptions/service.ts:482-538](../src/modules/subscription-exceptions/service.ts)):
- Original-date task → cancelled via `markTaskSkipped`.
- `subscriptions.end_date` → extended to the algorithm-computed `compensatingDate`.
- SF outbound cancel of the original task → enqueued (variant 1 + variant 2 emit outbound).
- `subscription.exception.created` audit event emitted with `compensating_date` populated.

**What does NOT happen synchronously:** **no new task is inserted at the tail-end `compensatingDate`.** The materialization of the tail task is intentionally deferred to the next `/api/cron/generate-tasks` tick — the cron walks forward from `subscription.start_date` to the new (extended) `end_date` and materializes any missing rows. This is the Day-14 Phase 5 cron-decoupling architecture; see comment at [service.ts:487-490](../src/modules/subscription-exceptions/service.ts).

**Cron cadence** ([vercel.json](../vercel.json)): `"path": "/api/cron/generate-tasks", "schedule": "0 12 * * *"` — **once per day at 12:00 UTC (16:00 Dubai).**

**Operator-visible consequence:** the cancellation is visible immediately on the next page render (via `revalidatePath`). The new tail delivery is **invisible on the calendar until the next 16:00 Dubai cron tick** — could be 30 seconds away or 23 hours and 59 minutes away depending on when the operator skips. No on-calendar signal acknowledges that a pending tail materialization exists.

**Verdict from diagnostic:** code does what the brief specifies. Not a bug at the service or action layer. **It is a UX gap** — the calendar gives no visual signal that "this skip already extended end_date by N days; tail task will appear on next cron tick at 16:00 Dubai."

## (2) Move-to-specific-date override — Phase-2 placeholder masquerading as a working button

**Surface:** "Apply Override" button after selecting radio option "Move this delivery to a specific date." + target-date input.

**Server action:** [skipWithOverrideAction at _calendar-actions.ts:189-242](../src/app/(app)/consignees/%5Bid%5D/_calendar-actions.ts) — correctly wired, form binds via `useActionState`, submits with `override_kind=move_to_date` + `target_date_override=<YYYY-MM-DD>`.

**What happens synchronously** (inside `addSubscriptionException` at [service.ts:493-505](../src/modules/subscription-exceptions/service.ts)):
- `subscription_exceptions` row INSERTED with `target_date_override=<target>`, `type='skip'`, `compensating_date=<target>`.
- Original-date task → cancelled via `markTaskSkipped`.
- `subscriptions.end_date` → extended **only if** `target > current end_date`. If target is inside the existing window, end_date is unchanged.
- Audit event emitted: `subscription.exception.created` with `target_date_override` populated.

**What does NOT happen** (load-bearing gaps):
- **No new task is created at the target date.** Grep `src/` for `rescheduleTask` returns only comment-references; no implementation exists. The cron's forward-walk only materializes tasks bounded by the *days-of-week schedule + end_date* — it has **no awareness of the exception's `target_date_override` field as a hint to create a one-off task at a non-scheduled date**.
- **No SF outbound push.** Comment at [service.ts:580-585](../src/modules/subscription-exceptions/service.ts): *"Variant 3 (move-to-date) omits outbound_emission entirely until Phase 2 lands rescheduleTask."* And at [service.ts:667-671](../src/modules/subscription-exceptions/service.ts): *"Variant 3 (move-to-date) is Aqib-gated on the SF rescheduleTask wire contract and lives in the Phase 2 code-PR — Phase 1 emits no outbound for variant 3."*
- **Audit metadata gap is intentional:** see [src/modules/audit/event-types.ts:733](../src/modules/audit/event-types.ts) — `subscription.exception.created` metadata docstring locks this as a Phase-2 deferred field.

**Operator-visible consequence:** click APPLY OVERRIDE → popover closes silently (the `useEffect` on `actionResult.kind === "success"` fires `onSuccess()` which closes the popover before the `ResultBanner` can be read; there is no global toast surface). Original date now shows cancelled on the re-rendered calendar. **Target date stays empty.** Net perception: "I clicked APPLY OVERRIDE and nothing happened." Underneath: action succeeded, an exception row was written, but the row is a memo — no functional rescheduling occurs.

**Verdict from diagnostic:** **the UI copy materially misrepresents behavior.** The button label "Apply override" + the radio text "Move this delivery to a specific date." promise reschedule. Code documents this as a Phase-2 placeholder pending Aqib's SF `rescheduleTask` wire contract.

# Product stance (Love directive — Day-32)

Calendar management is the most important surface in Planner. Operator actions must reflect truth on the calendar — no invisible state changes, no UI elements that lie about behavior.

**Explicit anti-pattern to AVOID:** "ship-honesty" fixes that disable, hide, or relabel misleading UI elements as a way to close the gap. The lane scope is to **build these surfaces properly so they deliver what they promise**, not to dampen the UI down to what Phase 1 already does.

# Lane shape (proposed — pending reviewer confirmation)

- **Tier:** T3 plan-PR lane (multiple code-PRs likely sequenced under one plan-PR).
- **Separate from:**
  - Plan #317 (T3 structural-defects on outbound push, currently OPEN at `f0ef560`, PR-A shipped via #318 + #319's adjacent fix; PR-B/C/D queued).
  - Outbound-symmetry follow-on (Planner→SF EDIT propagation) — committed in Day-31 PM fold of #306 §5.
- **Sequenced AFTER** Plan #317 lane completes (PR-B + PR-C + PR-D ship through to production).
- **Likely scope:**
  1. **Diagnosis pass — enumerate ALL operator-action surfaces.** Skip variants (default / skip-without-append / move-to-date), pause/auto-resume, address overrides (one-off / forward), append-without-skip, add-note-to-driver, view-task-timeline, anything else in `DayActionPopover.tsx` and `/tasks` page edit flows. Classify each: works end-to-end / cron-deferred-invisible / Phase-2-placeholder / unimplemented. Output is a status matrix that drives the rest of the lane.
  2. **Pending-tail-task visualization.** The skip-tail-end gap is solved by either:
     - **(a)** Eager INSERT of a `pending_materialization` task row inside the skip transaction (collides with the Day-14 cron-decoupling decision — needs architecture conversation about reversal vs adjustment), OR
     - **(b)** Read-only UI compute from `subscription.end_date` vs `tasks` table: render the gap days between the last materialized task and the (extended) `end_date` as on-calendar shimmer / "pending tail" badges. No schema change, but the calendar query needs an extra subquery / join.
     - Product call required on which path. The cron-decoupling decision has load-bearing reasons (idempotency, transactional simplicity) — reversing it is non-trivial.
  3. **Move-to-date full implementation.** Two halves:
     - **Planner-side:** create a task at the target date inside the exception transaction, link it to the exception row via a back-reference column (`tasks.created_by_exception_id` or similar), so the cron's forward-walk knows not to double-create.
     - **SF side:** Aqib-coordinated. Requires a confirmed `rescheduleTask` wire contract from SF (does SF have a "move this AWB's delivery date" endpoint? If not, the Planner side ships as a Planner-only feature and the SF side stays cancel+create-new-AWB which is operationally messy). The Aqib coordination is the load-bearing dependency.
  4. **Operator-action smoke-test framework.** So the next time we add a variant or button, it's verified end-to-end (UI click → DB → outbound push → SF response → calendar reflects truth) before ship. Likely a Playwright + DB-introspection harness running against a sandboxed tenant. Adjacent to #317's F-6 work (CI smoke check) but broader.

# Standing

- **Filed:** Day-32 (2026-05-20).
- **Not blocked on anything** — but **sequenced** behind Plan #317 lane completion (PR-B + PR-C + PR-D).
- **Aqib coordination required** for the SF rescheduleTask half of (3). Pre-lane work: probe SF API for an existing reschedule endpoint OR confirm the cancel+recreate pattern is the only path.
- **No production hot-patch warranted** today: the gaps are UX-visible but not data-corrupting. Skip-tail-end works correctly (just cron-deferred). Move-to-date writes the audit-of-record memo (no data loss, just no follow-through).

# Non-goals (explicitly NOT in this lane)

- **Outbound push structural defects** — Plan #317 (F-1..F-6 + CLEANUP-1).
- **Outbound-symmetry follow-on** (Planner→SF EDIT propagation) — separate lane committed in Day-31 PM fold of #306 §5.
- **The QStash deduplicationId colon fix** — already shipped today as PR #319 (`d41da88` on main, live in production).
- **The HEM 403 single-tenant credential issue** — tracked separately, needs Aqib coordination, unrelated to calendar management.

# Cross-references

- Production smoke testing transcript / diagnostic report: Session-B Day-32 conversation log.
- Service layer Phase-2 placeholder comments: [src/modules/subscription-exceptions/service.ts:580-585](../src/modules/subscription-exceptions/service.ts) + [src/modules/subscription-exceptions/service.ts:667-695](../src/modules/subscription-exceptions/service.ts).
- Audit event metadata docstring: [src/modules/audit/event-types.ts:733](../src/modules/audit/event-types.ts).
- Cron schedule: [vercel.json](../vercel.json) `"0 12 * * *"`.
- Tasks types pending_reschedule placeholder: [src/modules/tasks/types.ts:70](../src/modules/tasks/types.ts).
