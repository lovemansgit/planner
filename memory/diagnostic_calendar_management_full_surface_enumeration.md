---
name: Calendar management full-surface diagnostic enumeration (Day-33 read-only pass)
description: Complete inventory + classification of every operator-facing surface that touches the calendar in the Transcorp Subscription Planner. Two axes (views + actions), five classification buckets (works end-to-end / cron-deferred-invisible / Phase-2-placeholder / unimplemented / visual-gap). Surfaces several gaps NOT documented in the Day-32 followup memo (notably pauseSubscription has zero SF outbound push, address overrides do not affect already-materialized tasks, addNoteToDriver is local-only). Filed Day-33 as a T1 docs-only PR to drive the eventual calendar-management lane T3 plan-PR scoping. Read-only diagnostic; proposes nothing. Amended Day-33 PM with two additional ruling items surfaced by Love during PR-B production eyeball: R6 (Tasks page lacks consignee context + cross-surface navigation to TaskTimelineDrawer) and R7 (consignee detail default landing tab — Overview → Calendar).
type: diagnostic
---

# What this is

A read-only surface-and-behavior inventory of the calendar-management subsystem, intended as the input to a future T3 plan-PR that fixes the surfaces classified as broken. **This memo enumerates and classifies; it does NOT propose fixes, architectural changes, or sequencing**. Those are the plan-PR's job.

The diagnostic was performed on the worktree at main HEAD `5798a61` (post-PR #322 HEM 403 memo merge). Brief on main: v1.15. Plan #317 lane is OUT OF SCOPE for this diagnostic — that lane is queue-infrastructure-only.

# Why this exists

The Day-32 followup [`followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) documented two specific operator-action gaps surfaced during Day-32 PM production smoke: (1) skip-with-tail-end-reinsertion cron-deferred-invisible tail materialization, (2) move-to-date Phase-2 placeholder masquerading as a working button. That memo proposed a lane with item #1 in §"Lane shape": *"Diagnosis pass — enumerate ALL operator-action surfaces. Skip variants, pause/auto-resume, address overrides, anything else in DayActionPopover and similar surfaces. Output is a status matrix that drives the rest of the lane."*

**This memo is that diagnosis pass.** It expands the inventory beyond the two Day-32 surfaces to every calendar-context surface in the product. It surfaces gaps NOT present in the Day-32 memo — most notably that `pauseSubscription` has zero SF outbound push (locally cancels in-window tasks, never notifies SF) and that address-override actions do not update already-materialized tasks.

The Day-32 memo remains the **lane shape + Love directive + non-goals** document. This memo is the **surface inventory + classification** document. They sit side-by-side; neither supersedes the other.

# Classification taxonomy

Every enumerated surface is labelled with exactly one of:

1. **works end-to-end** — UI promises X, code does X, smoke-verifiable or trivially verifiable end-to-end on production.
2. **cron-deferred-invisible** — code does X correctly but the operator-visible effect lands only after the nightly `/api/cron/generate-tasks` tick at 12:00 UTC / 16:00 Dubai. Calendar gives no on-surface signal that the deferral exists.
3. **Phase-2-placeholder** — UI element exists, behavior is stub / no-op / memo-only / hardcoded. Audit row may write, but the load-bearing effect does not happen.
4. **unimplemented** — UI element absent or disabled; brief promises capability that has no surface yet.
5. **visual-gap** — UI element exists and works at the layer it claims to operate on, but the visual presentation creates the wrong mental model (e.g., button copy promises X, code does Y, where Y is intentional but not what X reads as).

A small number of surfaces sit at the boundary of two buckets; those are marked **needs-ruling** below and explained in §"Items needing operator/reviewer ruling."

# Methodology

- Two parallel read-only Explore-agent passes mapped Axis 1 (views) and Axis 2 (actions) by file path + line range + verbatim UI copy.
- Targeted reads of `subscription-exceptions/service.ts`, `subscriptions/service.ts`, `tasks/service.ts`, `tasks/repository.ts`, `task-materialization/cte-builder.ts`, `_calendar-actions.ts`, `DayActionPopover.tsx` confirmed each surface's classification.
- Targeted greps verified absence-of-code claims:
  - `enqueueCancel|enqueueBulkCancel|enqueueUpdate` in `src/modules/subscriptions/` → zero matches (pause SF-push absent).
  - `pending_cancel` in `src/app/api/cron/` + `src/modules/task-outbound-queue/` + `src/modules/subscriptions/` → zero matches (no pending-cancel sweeper exists).
  - `address_override|addressOverride` in `src/modules/tasks/` + `src/modules/integration/` → zero matches outside materialization CTE (overrides not consumed by SF push or by existing-task updaters).
- File paths cited use repo-root-relative format.

# Axis 1 — Views (where the operator LOOKS)

## A1.1 — Page-level calendar views

### Consolidated tenant calendar (`/calendar`)
- **File:** [`src/app/(app)/calendar/page.tsx`](../src/app/%28app%29/calendar/page.tsx)
- **Permission gate:** `task:read`. Transcorp-admin variant requires `task:read_all` and branches to fleet metrics instead.
- **URL state:** `view` (week/month/day), `week`/`month`/`date` anchors, `q`/`crm`/`district`/`status` filters.
- **Behavior:** server component, renders five metric cards + filter bar + view toggle + week/month/day view.
- **Classification:** **works end-to-end** for the day-to-day operator-facing view. Note: page-level docstring (line 5-6) claims "Month + day views render a placeholder (Day-23 follow-on scope)." That comment is **stale** — both `ConsolidatedMonthView` + `ConsolidatedDayView` are now fully implemented (verified at `_components/ConsolidatedMonthView.tsx` and `_components/ConsolidatedDayView.tsx`). The page docstring lies about the views; the views work.
- **Sub-classification on the docstring drift:** **visual-gap** (a code comment that misleads readers about feature state). Trivial to fix; not load-bearing.

### Consignee detail page calendar tab (`/consignees/[id]?tab=calendar`)
- **File:** [`src/app/(app)/consignees/[id]/page.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/page.tsx) lines 92-492
- **Permission gate:** consignee-detail base permissions + per-action permissions (skip, pause, address, note, timeline).
- **Behavior:** server component. Calendar is one of four tabs. View mode (`?view=week|month|year`) selects between CalendarWeekView / CalendarMonthView / CalendarYearView.
- **Classification:** **works end-to-end** for the read surface itself; per-action surfaces classified individually in Axis 2.

### Transcorp fleet calendar (`/admin/calendar`)
- **File:** [`src/app/(admin)/admin/calendar/page.tsx`](../src/app/%28admin%29/admin/calendar/page.tsx)
- **Permission gate:** `task:read_all` (transcorp-sysadmin only); `ForbiddenError` → redirect to `/`.
- **Behavior:** server component, five fleet metric cards + `TopMerchantsTodayPanel` + `PerMerchantBreakdownPanel`. No week/month/day views (fleet-only snapshot).
- **Classification:** **works end-to-end**.

## A1.2 — View-mode toggles

### Consolidated calendar view toggle (Week / Month / Day)
- **File:** [`src/app/(app)/calendar/_components/CalendarViewToggle.tsx`](../src/app/%28app%29/calendar/_components/CalendarViewToggle.tsx)
- **Behavior:** server component, three URL-driven segments. No client state. `hrefFor()` pure helper exported for tests.
- **Classification:** **works end-to-end**. (OQ-7: no Year segment by design on the consolidated view.)

### Consignee calendar view toggle (Week / Month / Year)
- **File:** [`src/app/(app)/consignees/[id]/_components/CalendarViewToggle.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarViewToggle.tsx)
- **Behavior:** server component, three URL-driven segments. Each view has its own anchor param.
- **Classification:** **works end-to-end**.

### Anchor navigation (Previous / Today / Next) per view
- **Files (consolidated):** [`src/app/(app)/calendar/page.tsx`](../src/app/%28app%29/calendar/page.tsx) lines 391-527 (`WeekAnchorNav`, `MonthAnchorNav`, `DayAnchorNav` inline).
- **Files (consignee):** `CalendarWeekView.tsx` lines 93-118; `CalendarMonthView.tsx` and `CalendarYearView.tsx` similar patterns.
- **Classification:** **works end-to-end**.

## A1.3 — Filtering surfaces

### Consolidated calendar filter bar (search, CRM state, district, task status)
- **File:** [`src/app/(app)/calendar/_components/CalendarFilterBar.tsx`](../src/app/%28app%29/calendar/_components/CalendarFilterBar.tsx)
- **Behavior:** client component. Four filters, URL-driven via `useRouter().push()`. Non-filter params preserved. `page` param dropped on filter write to reset pagination. `buildCalendarFiltersUrl()` pure helper exported for tests.
- **Classification:** **works end-to-end**.

### Consignee calendar — no operator-facing filters surface
- **Observation:** consignee-detail calendar has no dedicated filter bar. The view is naturally scoped to one consignee, and intra-consignee filtering (e.g., "show only failed tasks") is not in the current surface.
- **Classification:** N/A — no surface exists; brief does not promise this filter set on the consignee calendar.

## A1.4 — Drill-down behavior

### Consolidated week/month day-cell click → day view
- **Files:** `ConsolidatedWeekView.tsx` lines 80-110; `ConsolidatedMonthView.tsx` lines 68-80.
- **Behavior:** each day cell is a `<Link>` to `/calendar?view=day&date=<iso>` with preserved filters.
- **Classification:** **works end-to-end**.

### Consolidated day-view task row → consignee detail
- **File:** `ConsolidatedDayView.tsx` lines 27-80.
- **Behavior:** consignee name as `<Link>` to `/consignees/[id]?tab=calendar&week=<anchor>` (context preserved).
- **Classification:** **works end-to-end**.

### Consignee day-cell click → DayActionPopover OR POD modal
- **File:** [`src/app/(app)/consignees/[id]/_components/CalendarWeekView.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarWeekView.tsx) lines 170-224 (plus matching pattern in CalendarMonthView).
- **Behavior:** if task.internalStatus === DELIVERED + podPhotos non-empty → POD card with lightbox trigger; else → DayActionPopover trigger button.
- **Classification:** **works end-to-end**.

### Consignee year-view month-header click → month view
- **File:** `CalendarYearView.tsx` lines ~115-140.
- **Behavior:** month headers are `<Link>` to `?view=month&month=YYYY-MM-01`.
- **Classification:** **works end-to-end**.

## A1.5 — Visual indicators

### Task status pills / day-display status projection
- **Files:** [`src/app/(app)/consignees/[id]/_components/DayDisplayStatus.ts`](../src/app/%28app%29/consignees/%5Bid%5D/_components/DayDisplayStatus.ts) (helper, lines 99-142); CalendarStatusLegend.tsx (six-entry legend); inlined STATUS_VISUALS in `ConsolidatedDayView.tsx`.
- **Behavior:** projects (task | null) + exception → DayDisplayStatus union (DELIVERED / OUT_FOR_DELIVERY / SCHEDULED / SKIPPED / APPENDED / FAILED / CANCELED). Visual map applies Tailwind classes per status. Legend renders six (CANCELED hidden per Day-20 ruling).
- **Classification:** **works end-to-end**.

### HIGH_RISK marker on day header
- **Files:** consignee week/month — `CalendarWeekView.tsx` lines 120-160 region; consolidated — `ConsolidatedWeekView.tsx` lines 81-110 (`day.hasHighRisk` flag from `countTasksByDayAcrossConsignees()`).
- **Classification:** **works end-to-end** (text-only eyebrow; brief does not require an icon).

### CRM state badge (six states)
- **File:** [`src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CrmStateBadge.tsx).
- **Classification:** **works end-to-end**.

### Address indicator (Home / Office / Other)
- **File:** [`src/app/(app)/consignees/[id]/_components/AddressIndicator.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/AddressIndicator.tsx).
- **Behavior:** text-only label (no glyph). Fetched from `Task.addressLabel`.
- **Classification:** **works end-to-end**.

### POD photo thumbnail (CalendarPodCard)
- **File:** [`src/app/(app)/consignees/[id]/_components/CalendarPodCard.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarPodCard.tsx).
- **Behavior:** renders only when task.internalStatus === DELIVERED + podPhotos non-empty. Click opens shared `PodLightboxModal`.
- **Classification:** **works end-to-end** (Day-19 / A2 plan shipped).

### Failed-push badge
- **File:** `DayActionPopover.tsx` lines 88-98 (read at the popover trigger).
- **Behavior:** rendered when `failedPushTaskIds: Set<TaskId>` contains the task. Gated upstream on `failed_pushes:read` (silent when permission absent).
- **Classification:** **works end-to-end** (Day-30 / Fix-A2 / PR #310).

### Outbound sync state badge ('pending_cancel' / 'pending_reschedule' / 'failed')
- **File:** `DayActionPopover.tsx` lines 617-640.
- **Behavior:** badge renders when `outbound_sync_state !== 'synced'`. Surfaces in-flight SF state to operator. Pre-Day-29 the skip path silently optimistic-succeeded; Phase-1 added this badge so operators see SF lag.
- **Classification:** **works end-to-end** for the **skip** path that populates `outbound_sync_state='pending_cancel'`. **Does NOT cover pause** — see Axis 2 Action 3 below; the pause flow doesn't set `pending_cancel`, so the badge never lights up for paused tasks even though SF is genuinely out-of-sync. Sub-classification: the badge code itself works; the upstream gap means it misses the pause-paused-tasks case. **needs-ruling**: is this badge intended to cover pause-affected tasks?

### Metric cards (5 cards on /calendar header)
- **File:** [`src/app/(app)/calendar/_components/MetricCard.tsx`](../src/app/%28app%29/calendar/_components/MetricCard.tsx).
- **Behavior:** primitive component; five instantiations (Active consignees / Today's deliveries / Delivered today / Out for delivery / Failed-at-risk). `tone="risk"` variant.
- **Classification:** **works end-to-end**.

### Year-view heat-map (365 cells, density ramp)
- **File:** `CalendarYearView.tsx` lines ~70-80.
- **Behavior:** delivery density → green opacity ramp; failure density → red overlay; skip-on-empty → muted + line-through; append → green border. O(1) per-cell lookup via Map.
- **Classification:** **works end-to-end** (Day-21 visual gate fixed empty-cell-vs-page distinction).

### Per-merchant breakdown bar chart
- **File:** [`src/app/(app)/calendar/_components/PerMerchantBreakdownPanel.tsx`](../src/app/%28app%29/calendar/_components/PerMerchantBreakdownPanel.tsx).
- **Behavior:** stacked bar (delivered + in-transit + scheduled-remaining), 7-day failed count as red badge. Each row is a `<Link>` to `/admin/tasks?merchantSlug=<slug>`.
- **Classification:** **works end-to-end**.

## A1.6 — State surfaces (empty / loading / error)

### Empty states (9 variants enumerated across the calendar surface)
- Week / month / day empty cells: `ConsolidatedWeekView.tsx` line 45-52 ("No deliveries this week. Adjust filters or pick a different week."); `ConsolidatedDayView.tsx` similar pattern; consignee week — single em dash; year — always 365 cells, no separate empty panel.
- Top-merchants panel: `TopMerchantsTodayPanel.tsx` lines 36-39.
- Consignee detail overview: page.tsx lines 548-586 (Day-25 / brief v1.12 §3.3.3 onboarding CTAs).
- **Classification:** **works end-to-end**.

### Loading states — NONE
- **Observation:** all calendar views are server-rendered (`export const dynamic = "force-dynamic"`); no Suspense / skeleton / loading-boundary implementations. Client-side transitions are instantaneous `<Link>` navigation. Server-action submissions inside DayActionPopover render pending UI via `useActionState`.
- **Classification:** N/A — pattern is correct for server components. Brief does not require client-side skeletons here.

### Error states
- Unauthorized → redirect to `/login?next=...` (page.tsx lines 200-201, 334-335).
- Forbidden (admin route) → redirect to `/`.
- NoTenantConfiguredError → full-screen "System not yet initialised" panel.
- Permission-gated actions hide silently (brief §3.3.10 rule 1).
- ValidationError from service surfaces as inline text inside action panel.
- **Classification:** **works end-to-end**.

# Axis 2 — Actions (what the operator DOES)

The primary action surface is [`DayActionPopover.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/DayActionPopover.tsx) (lines 1-968), which exposes **8 actions** (1-7 mutating + 8 read-only). Each is enumerated and classified below.

## A2.1 — Action 1: "Skip this delivery" (skip default with tail-end reinsertion)

- **UI copy (verbatim, line 145-146):** *"Skip this delivery"* / *"Apply default skip rules with tail-end reinsertion."*
- **Server action:** [`skipDeliveryAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 77.
- **Service call:** `addSubscriptionException(ctx, subscriptionId, { type: "skip", date: deliveryDate, idempotencyKey })` at [`subscription-exceptions/service.ts:481-518`](../src/modules/subscription-exceptions/service.ts).
- **What the code does:**
  1. INSERT subscription_exceptions row (type='skip', `compensating_date` = algorithm-computed tail-end date).
  2. UPDATE subscriptions.end_date → extend to compensatingDate.
  3. UPDATE the task on `deliveryDate` → `internal_status='SKIPPED'` + `outbound_sync_state='pending_cancel'` (via `markTaskSkipped`).
  4. Enqueue SF cancel via `enqueueCancelTask` (line 686) IF the task has `external_tracking_number`.
  5. Emit `subscription.exception.created` + `subscription.end_date.extended` audit pair.
- **What does NOT happen synchronously:** no new task is INSERTed at `compensatingDate`. The new tail task materializes only on the next `/api/cron/generate-tasks` tick (daily 12:00 UTC / 16:00 Dubai per `vercel.json`). The cron walks forward from `subscription.start_date` to the extended `end_date` and materializes missing rows.
- **Operator-visible consequence:** original-date cancellation visible on next render. New tail delivery **invisible on the calendar until the next 16:00 Dubai cron tick** — could be 30 seconds or 23h59 away. No on-calendar signal acknowledges the pending tail.
- **Classification:** **cron-deferred-invisible** — code is correct per the Day-14 Phase 5 cron-decoupling architecture; the UX gap is the lack of a "pending tail" badge on the calendar.
- **Brief reference:** §3.1.6 skip-with-tail-reinsertion; cron schedule per `vercel.json` `0 12 * * *`.
- **Already documented in:** [`followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) §(1).

## A2.2 — Action 2: "Skip with override" (move-to-date OR skip-without-append)

- **UI copy (verbatim, line 151-152):** *"Skip with override"* / *"Move the skip to a specific date or skip without tail-end append."*
- **Form fields:**
  - Radio "Override" (lines 292-318) with two options: *"Move this delivery to a specific date."* (move_to_date) | *"Skip without tail-end append (reduces subscription count)."* (skip_without_append).
  - Conditional date input *"Target date"* (lines 320-332) for move_to_date.
- **Server action:** [`skipWithOverrideAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 189.
- **Service call:** `addSubscriptionException` with either `targetDateOverride` (move-to-date) or `skipWithoutAppend: true`.
- **Behavior — skip_without_append variant:** INSERT exception row (skip_without_append=true), UPDATE original task to SKIPPED + pending_cancel, enqueue SF cancel if pushed. NO end_date change, NO compensating tail task. **Classification: works end-to-end.**
- **Behavior — move_to_date variant:**
  1. INSERT exception row with `target_date_override = <operator date>`, `compensating_date = <operator date>`.
  2. UPDATE original task to SKIPPED + pending_cancel. Enqueue SF cancel if pushed.
  3. UPDATE end_date IF the target is beyond the current end_date.
  4. **No new task is INSERTed at target_date_override.** No SF push for the new delivery — see comment at `subscription-exceptions/service.ts:580-585` and `:667-671`: *"Variant 3 (move-to-date) is Aqib-gated on the SF rescheduleTask wire contract and lives in the Phase 2 code-PR — Phase 1 emits no outbound for variant 3."*
  5. The cron's forward-walk materializer at `cte-builder.ts:146` resolves address override, but it does NOT handle target_date_override as a "create a task at this non-scheduled date" hint. The cron only materializes tasks bounded by the days-of-week schedule + end_date; the target date may not be on the schedule.
- **Operator-visible consequence (move_to_date):** popover closes silently on success; original date now shows cancelled on next render; **target date stays empty**. Operator perception: *"I clicked Apply Override and nothing happened."* Underneath: exception row is a memo, original task cancelled, no functional reschedule occurs.
- **Classification (move_to_date):** **Phase-2-placeholder** + **visual-gap** — the radio text *"Move this delivery to a specific date."* and the "Apply override" submit button promise reschedule. Code documents this as Phase-2 pending Aqib's SF `rescheduleTask` wire contract.
- **Brief reference:** §3.1.6 skip variants.
- **Already documented in:** [`followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) §(2).

## A2.3 — Action 3: "Pause from this date" (bounded-window subscription pause)

- **UI copy (verbatim, line 157-158):** *"Pause from this date"* / *"Cancel deliveries in a window; subscription end date extends."*
- **Form fields:** "Pause until" date input (lines 384-395); "Reason (optional)" textarea (lines 396-406, maxLength 500).
- **Server action:** [`pauseFromDateAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 259.
- **Service call:** `pauseSubscription(ctx, subscriptionId, { pause_start, pause_end, idempotency_key, reason? })` at [`subscriptions/service.ts:672-875`](../src/modules/subscriptions/service.ts).
- **What the code does:**
  1. Validate pause_start ≤ pause_end, cut-off enforcement (18:00 Dubai day-before).
  2. INSERT subscription_exceptions row (type='pause_window', pause_start, pause_end, reason).
  3. **Bulk-cancel tasks in window via `markTasksCanceledInWindow`** at `tasks/repository.ts:1386-1406`:
     - `UPDATE tasks SET internal_status='CANCELED' WHERE … delivery_date BETWEEN pause_start AND pause_end AND internal_status NOT IN ('DELIVERED','FAILED','CANCELED')`.
     - **Critically:** this UPDATE does **NOT** set `outbound_sync_state='pending_cancel'`. Compare against `markTaskSkipped` (same file lines 1337-1365), which explicitly sets `outbound_sync_state='pending_cancel'` when `external_tracking_number IS NOT NULL`. The pause path omits this.
  4. UPDATE subscriptions.end_date (extend by eligible-delivery-day count) + status='paused'.
  5. Emit `subscription.paused` + optionally `subscription.end_date.extended` audit pair.
- **What does NOT happen — load-bearing gap:**
  - **No SF outbound push for any task cancelled inside the pause window.** Verified by grep of `enqueueCancel|enqueueBulkCancel|enqueueUpdate` across `src/modules/subscriptions/` returning zero matches.
  - No `pending_cancel` sweeper exists. Verified by grep of `pending_cancel` in `src/app/api/cron/` + `src/modules/task-outbound-queue/` returning zero matches.
- **Consequence:** local DB rows say CANCELED. SuiteFleet still thinks those tasks are scheduled. Drivers can attempt delivery on a paused date because SF dispatches them. Pause is operator-visible-cancelled on the Planner side and operator-invisible on the SF side; the divergence is silent.
- **Classification:** **Phase-2-placeholder for SF outbound** — the local-cancel half works end-to-end; the SF-cancel half is silently absent. This sub-shape is the same as Action 2's move-to-date: local state correct, SF push missing, no operator-visible signal of the divergence. The outbound_sync_state badge (Axis 1) never lights up because pause never sets `pending_cancel`.
- **Severity:** likely higher operational impact than the Day-32 move-to-date case. Move-to-date affects one delivery; pause affects an entire window of deliveries (potentially weeks).
- **Brief reference:** §3.1.7 bounded-window pause; §3.1.8 cut-off.
- **NOT documented in Day-32 followup.** This memo's filing is the first durable record.

## A2.4 — Action 4: "Change address (this delivery only)" (address_override_one_off)

- **UI copy (verbatim, line 163-164):** *"Change address (this delivery only)"* / *"Override the address for just this delivery."*
- **Form fields:** Radio fieldset "Address" with one option per `consignee.addresses`. Submit button copy: *"Override for this delivery"*.
- **Server action:** [`changeAddressOneOffAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 305.
- **Service call:** `addSubscriptionException(ctx, subscriptionId, { type: "address_override_one_off", date, addressOverrideId })`.
- **What the code does:**
  1. INSERT subscription_exceptions row (type='address_override_one_off', start_date=deliveryDate, address_override_id).
  2. Cross-consignee address-ownership check (lines 426-456) — prevents Consignee A's subscription receiving Consignee B's address.
  3. Emit `subscription.exception.created` + `subscription.address_override.applied` audit events.
- **What does NOT happen:**
  - **No UPDATE to the existing task's address.** The task on `deliveryDate` retains its original `address_id`. The materialization-time CTE at [`task-materialization/cte-builder.ts:146-175`](../src/modules/task-materialization/cte-builder.ts) DOES read address_override_one_off rows — but only at materialization time, not as a post-write update on already-materialized tasks. Tasks within the 14-day rolling horizon are already materialized (brief §3.1.5); the popover only opens on existing tasks (the operator clicks an existing task card). So the common case is: operator overrides the address → exception row written → existing task unchanged → driver attempts delivery at original address.
  - **No SF outbound push.** Even if the task were updated locally, no `enqueueUpdateTask` call is made. SF stays oblivious.
- **Classification:** **Phase-2-placeholder** + **visual-gap** for the in-horizon case. The popover only operates on existing tasks (verified at `DayActionPopover.tsx` action panel context), which are within the 14-day materialization horizon. For tasks the operator can actually see and click, this action is a no-op locally and an absent-push to SF.
- **needs-ruling:** is the override intended to update the existing task locally + push SF update? Or is it intended only to take effect on future re-materializations (which would require operator to override a >14-day-out date, which the popover doesn't enable)? The current behavior matches neither interpretation.
- **Brief reference:** §3.1 subscription exceptions; §3.3.10 permission gating (`subscription:change_address_one_off`).
- **NOT documented in Day-32 followup.**

## A2.5 — Action 5: "Change address (from this delivery onwards)" (address_override_forward)

- **UI copy (verbatim, line 169-170):** *"Change address (from this delivery onwards)"* / *"Override the address from this date forward."*
- **Form fields:** same as Action 4 but submit button copy: *"Override from this date forward"*.
- **Server action:** [`changeAddressForwardAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 349.
- **Service call:** `addSubscriptionException(ctx, subscriptionId, { type: "address_override_forward", date, addressOverrideId })`.
- **What the code does:** INSERT exception row, audit emit. The materialization-time CTE at `cte-builder.ts:163-178` reads forward overrides correctly: *"most-recent active address_override_forward whose start_date ≤ target."* So **future un-materialized tasks (>14 days out) will materialize at the new address.**
- **What does NOT happen:**
  - **No UPDATE to already-materialized tasks** in [start_date, +14 days]. The next ~14 days of deliveries keep their original address locally.
  - **No SF push to update those existing pushed tasks** to the new address.
- **Classification:** **Phase-2-placeholder for the in-horizon case; works end-to-end for the >14-day-out case** — but the popover can only target existing tasks (in-horizon), so the >14-day case isn't operator-reachable from this surface.
- **needs-ruling:** same shape as Action 4. The CTE resolution proves the materialization path is correct for new tasks; the gap is that existing materialized tasks aren't backfilled with the override, and SF isn't notified.
- **Brief reference:** §3.1 subscription exceptions; `subscription:change_address_forward` permission.
- **NOT documented in Day-32 followup.**

## A2.6 — Action 6: "Cancel delivery (no append)" (cancel without tail-end reinsertion)

- **UI copy (verbatim, line 175-176):** *"Cancel delivery (no append)"* / *"Cancel this delivery; subscription count reduces by one."*
- **Server action:** [`cancelNoAppendAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 397.
- **Service call:** `addSubscriptionException(ctx, subscriptionId, { type: "skip", date, skipWithoutAppend: true })` — semantically identical to Action 2's skip_without_append variant; D1 ruling surfaces it as a distinct button per brief §3.3.3 line 506.
- **What the code does:** identical to Action 2 skip_without_append — INSERT exception, UPDATE task → SKIPPED + pending_cancel, enqueue SF cancel if pushed, no end_date change, no compensating tail.
- **Classification:** **works end-to-end**.
- **Brief reference:** §3.1.6 skip-without-append variant; permission `subscription:override_skip_rules`.

## A2.7 — Action 7: "Add note to driver" (per-task driver-facing instruction)

- **UI copy (verbatim, line 181-182):** *"Add note to driver"* / *"Append a driver-facing instruction to this delivery."*
- **Form fields:** "Note for driver" textarea (lines 582-594, required, maxLength 1000); placeholder: *"e.g. gate code 4521; call on arrival"*.
- **Server action:** [`addNoteToDriverAction`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts) line 435.
- **Service call:** `addNoteToDriver(ctx, taskId, trimmedNote)` at [`tasks/service.ts:1404-1463`](../src/modules/tasks/service.ts).
- **What the code does:**
  1. Permission check (`task:add_note`), tenant scope, note non-empty + length ≤ 1000.
  2. Cut-off enforcement (18:00 Dubai day-before).
  3. UPDATE `tasks.notes = trimmedNote` (REPLACE semantics — v1 single instruction per delivery; brief §3.3.3).
  4. Emit `task.note_added` audit event with `previous_notes_length` + `new_notes_length` (note text NOT in audit metadata — PII).
- **What does NOT happen — load-bearing gap:**
  - **No SF outbound push.** The note text is updated only on the local `tasks.notes` column. SF (and therefore the driver app) never receives the note.
  - The SF integration client at [`integration/providers/suitefleet/task-client.ts:362`](../src/modules/integration/providers/suitefleet/task-client.ts) and `:434` DOES support the `notes` field on update / create requests — the wire contract is ready. The omission is service-layer-side: `addNoteToDriver` never calls into the task client.
- **Operator-visible consequence:** popover closes on success. Reading the consignee detail page back, the note is visible in the task row. Operator perception: *"I added the note; it's saved."* Underneath: the driver will never see this note.
- **Classification:** **Phase-2-placeholder** for SF outbound. The local-write half works end-to-end; the load-bearing customer-facing effect (driver actually sees the note) does not happen.
- **needs-ruling:** is local-note storage intended as the v1 surface, with driver-app delivery deferred? The cut-off comment at `tasks/service.ts:1386-1390` reads *"once SF has been notified of a task's delivery date, the driver may already be looking at the order"* — acknowledging SF has the task but providing no SF-push for the note. That implies the local-only behavior is intentional, but if so the UI copy *"Append a driver-facing instruction"* is misleading because no driver receives it.
- **Brief reference:** §3.3.3 line 506 (DayActionPopover action list); §3.3.10 permission gating.
- **NOT documented in Day-32 followup.**

## A2.8 — Action 8: "View task timeline" (read-only state transition history)

- **UI copy (verbatim, line 866, 868):** *"View task timeline"* / *"Full state-transition history sourced from cached webhooks."*
- **Drawer component:** [`TaskTimelineDrawer.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx).
- **Service call:** `getTaskTimeline(ctx, taskId)` at [`tasks/service.ts:1508-`](../src/modules/tasks/service.ts).
- **What the code does:** fetches task creation timestamp + all webhook events for the task's AWB (via `webhook_events` table). Maps SF action codes to human-readable labels. Read-only; no audit emit per R-4 read-not-audited convention.
- **Classification:** **works end-to-end**.
- **Brief reference:** §3.3.6 task timeline popover; §3.3.8 cached-webhook source-of-truth (no live SF fetch).

## A2.9 — Append-without-skip (operator-initiated tail addition) — **UI surface absent**

- **Service exists:** `appendWithoutSkip` at [`subscription-exceptions/service.ts:744-`](../src/modules/subscription-exceptions/service.ts). Inserts exception row (type='append_without_skip'), extends `subscription.end_date` by one eligible-day step, emits paired audit events.
- **No UI surface in DayActionPopover.** The Explore enumeration of the popover's 8 action buttons did not include "append without skip" — it is not surfaced as an operator button.
- **Classification:** **unimplemented** at the UI layer (service implemented, schema implemented, audit-event registered, no operator-facing button).
- **needs-ruling:** is this surface deliberately not exposed (e.g., system-only / Ops-Manager-only / future scope)? Brief §3.3.3 line 506 enumerates 7 mutation actions for the popover — append-without-skip is not among them. The service exists for a reason (likely either programmatic / migration-import use OR a planned future button). Reviewer call.

## A2.10 — Sibling modals + drawers (consignee-detail-page-level, not calendar-cell-level)

These are not opened from calendar cells but live on the same consignee detail page and influence calendar state.

### CRM state modal
- **File:** [`src/app/(app)/consignees/[id]/_components/CrmStateModal.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CrmStateModal.tsx) lines 1-331.
- **Server action:** `changeCrmStateAction` at `_actions.ts:75`.
- **Classification:** **works end-to-end**. Not calendar-cell-level but listed here for completeness.

### Ad-hoc task dialog
- **File:** [`src/app/(app)/consignees/[id]/_components/AdHocTaskDialog.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/AdHocTaskDialog.tsx) lines 1-297.
- **Server action:** `createAdHocTaskAction` at `_actions.ts:170`.
- **Classification:** **works end-to-end** — toast confirms *"Saved — pushing to SuiteFleet"* (line 223); SF push enqueued.

### Task timeline drawer
- See A2.8.

## A2.11 — Server actions enumerated (`_calendar-actions.ts`)

For completeness, the eight server actions exported from [`_calendar-actions.ts`](../src/app/%28app%29/consignees/%5Bid%5D/_calendar-actions.ts):

| Line | Function | Dispatched from | Classification (cross-ref) |
| --- | --- | --- | --- |
| 77 | `skipDeliveryAction` | Action 1 | cron-deferred-invisible (tail) |
| 189 | `skipWithOverrideAction` | Action 2 | works (skip_without_append) / Phase-2-placeholder (move_to_date) |
| 259 | `pauseFromDateAction` | Action 3 | Phase-2-placeholder for SF outbound |
| 305 | `changeAddressOneOffAction` | Action 4 | Phase-2-placeholder (in-horizon) |
| 349 | `changeAddressForwardAction` | Action 5 | Phase-2-placeholder (in-horizon) |
| 397 | `cancelNoAppendAction` | Action 6 | works end-to-end |
| 435 | `addNoteToDriverAction` | Action 7 | Phase-2-placeholder for SF outbound |
| 476 | `getTaskTimelineAction` | Action 8 | works end-to-end |

# Classification matrix

## works end-to-end

- All page-level calendar views (`/calendar`, `/consignees/[id]?tab=calendar`, `/admin/calendar`).
- View-mode toggles (consolidated + consignee).
- Anchor navigation (prev/today/next on every view).
- Consolidated filter bar.
- All drill-down handlers.
- All visual indicators (status pills, HIGH_RISK marker, CRM badge, address indicator, POD card, failed-push badge, metric cards, year heat-map, per-merchant bar chart, outbound sync state badge for the **skip path** only).
- All empty / error states.
- Action 6 (cancel-no-append).
- Action 8 (view task timeline).
- Action 2 sub-variant (skip without tail-end append).
- Sibling modals: CRM state, ad-hoc task.

## cron-deferred-invisible

- Action 1 (skip default with tail-end reinsertion) — tail task materializes on next 16:00 Dubai cron tick; no on-calendar signal of pending tail.

## Phase-2-placeholder

- Action 2 sub-variant (move-to-date) — original task cancelled + SF cancel pushed, no new task at target date, no SF reschedule push. Aqib-gated on SF `rescheduleTask` wire contract.
- Action 3 (pause-from-this-date) — local cancel + audit + end_date extension; **no SF push for in-window task cancellations**. Major gap NOT documented in Day-32 followup.
- Action 4 (change address — this delivery only) — exception row written; existing task local address not updated; no SF push. **In-horizon common case is a no-op.** NOT documented in Day-32 followup.
- Action 5 (change address — from this delivery onwards) — exception row written; existing in-horizon tasks not updated locally or pushed to SF; future >14-day-out tasks materialize correctly via cron CTE. NOT documented in Day-32 followup.
- Action 7 (add note to driver) — local `tasks.notes` updated + audit; **no SF push** despite SF wire contract supporting the field. Driver never sees the note. NOT documented in Day-32 followup.

## unimplemented

- Append-without-skip — service + schema + audit exist; no UI surface in DayActionPopover. Brief §3.3.3 line 506 popover enumeration does not include it.

## visual-gap

- Page-level docstring at `/calendar/page.tsx` lines 5-6 — claims month + day views are placeholders; both are now fully implemented. Stale comment only; not load-bearing.
- Outbound sync state badge — works correctly for the skip path that sets `pending_cancel`; misses the pause path which never sets that flag. The badge itself is correct; the gap is upstream.

# Items needing operator/reviewer ruling

Reviewer should rule on these before the lane plan-PR scopes fixes — guessing now would lock the wrong shape.

## R1 — Address override intent (Actions 4 + 5)

The current behavior is: cron materializer correctly resolves overrides for future un-materialized tasks; existing materialized tasks are not retroactively updated; no SF push for either case. The popover only operates on existing tasks (within the 14-day horizon = the common case = the broken case).

**Reviewer call needed on intent:**

- **Option A:** override is intended to update the existing task locally + push SF update. → fix is service-layer (UPDATE tasks SET address_id, enqueueUpdateTask) + SF integration alignment.
- **Option B:** override is intended only for future re-materializations; the popover surface is wrong for opening it on in-horizon tasks. → fix is UI-layer (disable the action for in-horizon dates, surface it differently for future-date overrides).
- **Option C:** something else.

The Day-32 directive in [`followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) §"Product stance" — *"build them properly so they deliver what they promise"* — suggests Option A, but the brief is the authoritative ruling source.

## R2 — Pause SF-outbound intent (Action 3)

The current behavior is: local cancellation + audit + end_date extension all work; SF is never notified of cancelled tasks. The Day-32 followup did NOT identify this. Reviewer needs to confirm whether this is:

- **Option A:** an oversight — pause was supposed to push SF cancels but didn't. → fix is the same shape as Day-29 §D(2) Phase-1: enqueue SF cancels for in-window pushed tasks; set `outbound_sync_state='pending_cancel'` in `markTasksCanceledInWindow`.
- **Option B:** intentional deferral pending some SF-side coordination (analogous to move-to-date's `rescheduleTask` dependency). → file as separate Aqib-coordinated lane.
- **Option C:** intentional design — pause is meant to be a Planner-side concept that doesn't propagate to SF, and operations triages cancelled-but-still-scheduled tasks manually. → confirm operationally; document the workflow.

Severity if Option A is correct: drivers may attempt delivery on paused dates because SF dispatches them despite the local Planner cancellation. Higher severity than the Day-32 surfaces.

## R3 — addNoteToDriver intent (Action 7)

The current behavior is: local `tasks.notes` updated + audit emitted; SF (and the driver app) never receives the note. SF wire contract supports the field. UI promises *"driver-facing instruction"*.

**Reviewer call:**

- **Option A:** note should push to SF (`updateTask` with `notes` field). → fix is single service-layer call addition.
- **Option B:** note is intentionally local-only as a v1 surface; the UI copy should be tightened to reflect that (e.g., *"Internal note for this delivery"*). → fix is UI-layer copy change.
- **Option C:** note is intended to push to SF eventually but blocked on some coordination. → file as deferred.

## R4 — Append-without-skip surfacing (A2.9)

Service + schema + audit registered; no operator-facing button. Reviewer call:

- **Option A:** add a popover button (which permission gate? Ops Manager only per brief §3.3.3?).
- **Option B:** surface it on a different page (e.g., subscription detail / Ops admin page).
- **Option C:** intentionally programmatic-only — service exists for migration imports / system actors only. → document in the service docstring; no UI work.

## R5 — Outbound sync state badge coverage

The badge correctly surfaces `outbound_sync_state='pending_cancel'` / `'pending_reschedule'` / `'failed'`. The skip path populates `pending_cancel`. The pause path does not. If R2 is resolved with Option A (pause should push SF cancels), the upstream `markTasksCanceledInWindow` change will populate `pending_cancel` and the badge will light up — no badge-side change needed. If R2 is resolved differently, the badge's coverage definition may need explicit scoping.

## R6 — Tasks page lacks consignee context + cross-surface navigation to TaskTimelineDrawer

**Origin:** Day-33 PM Love production eyeball during PR-B verification. Surface NOT enumerated in the original Day-33 AM diagnostic — that pass scoped to calendar surfaces (the consignee detail Calendar tab + the consolidated `/calendar` + the admin `/admin/calendar`). The `/tasks` page is the cross-merchant task-list surface (an operator's working list), and although Action 8 (view task timeline) is the existing entry to TaskTimelineDrawer, the drawer is reachable only from the consignee calendar today.

**Current behavior** (verified at `src/app/(app)/tasks/client.tsx` and `src/modules/tasks/repository.ts` at main HEAD `57e5d9b`):

- Tasks list table columns (client.tsx lines 266-275): checkbox · **Status** · **Order #** · **Delivery date** · **Window** · **AWB** · **Issues** · *(POD column, sr-only header)* · **Actions**. **No Consignee column.**
- AWB cell rendering (client.tsx lines 347-358): `<span>{task.externalTrackingNumber}</span>` plus a "✓ Pushed to SuiteFleet" eyebrow. **Text-only — no onClick, no Link, no drawer wiring.** Rows with `task.externalTrackingNumber === null` render an em-dash placeholder.
- Operator-visible consequence: from `/tasks`, the operator cannot (a) identify which consignee a task belongs to without clicking through the row's `Actions` column or running a separate consignee search, nor (b) reach the TaskTimelineDrawer that the diagnostic Action 8 documents as the canonical state-transition history surface.
- Search input on `/tasks` page placeholder (page.tsx lines 160-161): *"Search by AWB, consignee name or order #"* — meaning **consignee context EXISTS in the search query, but is omitted from the result row display**. Asymmetric.

**Data layer current state** (verified at `src/modules/tasks/repository.ts`):

- Task row has `consignee_id` FK (line 89) projected to `Task.consigneeId` in the DTO (line 217). So the FK is already on the row — no schema delta needed for the relation.
- `listTasksWithSearch` uses a **conditional** LEFT JOIN consignees (lines 610-611: `needsConsigneeJoin(searchTerm) ? sqlTag\`LEFT JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id\` : ...`). The join is added only when the search term needs it (for consignee-name-in-search matching). For the default Tasks list without a search term, **consignees is NOT joined** and `consignee_name` is not projected through.
- `Task` DTO does not currently expose `consigneeName` (grep `consigneeName|consignee_name` in tasks/types.ts returns zero matches).

**TaskTimelineDrawer current shape** (verified at `src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx`):

- Client component. Props: `consigneeId`, `taskId`, `deliveryDate`, `onClose` (lines 27-32). Straightforward to instantiate from any surface that has these four values.
- Action import (line 22-25): `import { getTaskTimelineAction } from "../_calendar-actions"` — **relative import**, only resolvable from a sibling under `src/app/(app)/consignees/[id]/`. Reusing the drawer from `/tasks` will require either moving the action to a shared location (preferred — server actions are framework-portable) OR rewriting the relative import to an absolute `@/`-prefixed one (mechanical).
- No mutation surface; permission gate is `task:view_timeline` (same as Action 8). No audit emit (R-4 read-not-audited).

**Proposed change** (Love directive — read-only docs-only filing; does not propose how to ship):

1. Add a Consignee column to the `/tasks` list table.
2. Consignee name → clickable Link to that consignee's calendar tab (`/consignees/<id>?tab=calendar`).
3. AWB cell → clickable; opens the existing TaskTimelineDrawer in place. Same drawer as Action 8 on the consignee calendar; this adds a second entry point.

**Scope shape:**

- UI-layer changes on `/tasks/client.tsx` + table column (+1).
- Data-layer change to `listTasksWithSearch` and the Tasks DTO: make the consignees LEFT JOIN unconditional and project `consigneeName` (and optionally `consigneePhone` / `consigneeEmirate` per R6.1 ruling below) into the row shape.
- Cross-surface refactor of `TaskTimelineDrawer` — either move + rename the action OR switch to absolute imports. The drawer itself needs no UI delta.
- No service-layer or schema delta beyond the unconditional join.

**Reviewer call options:**

- **R6.1 — Column position.** Three plausible placements:
  - Between Status and Order # (groups identity-of-delivery columns first).
  - Replacing or alongside Order # (consignee + order are both "what is this" columns).
  - As the leftmost data column after the checkbox (operator-mental-model-first).
  - *Builder note: brief said "TBD by frontend judgment"; this is a layout ruling, not a behavior one.*
- **R6.2 — Consignee display density.** UX tradeoff:
  - Name only (lowest density, may need consignee disambiguation by phone for high-volume tenants).
  - Name + phone (medium density; mirrors the search query semantics).
  - Name + emirate / district (medium density; useful for ops dispatching by area).
  - *Builder note: brief enumerated this as a tradeoff; reviewer call.*
- **R6.3 — AWB click behavior when `external_tracking_number IS NULL`.** Two plausible shapes:
  - **Option A:** disable the click — show plain em-dash as today; no drawer access until SF push completes.
  - **Option B:** click opens the drawer in a partial state (Created entry only; no webhook events available). Same behavior as the existing `getTaskTimeline` service for null-AWB tasks (which returns a single TASK_CREATED entry per tasks/service.ts:1531-1539).
  - *Builder note: Option B is closer to the documented service behavior; Option A reduces operator surprise. Reviewer call.*
- **R6.4 — Tasks page row click target conflict.** The Actions column already provides Edit / Cancel / etc. Adding consignee-name Link + AWB Drawer adds two new interactive targets per row. Whole-row click behavior (if any) needs to be confirmed; current row does not have an onClick (rows are not Links). No further ruling needed if the row stays passive — the new entry points are cell-scoped.

**Severity:** medium. Not data-corrupting. Operator friction (extra navigation hops per task triage). Surfacing as ruling item ensures this doesn't get folded into a different lane silently.

## R7 — Consignee detail page default landing tab (Overview → Calendar)

**Origin:** Day-33 PM Love production eyeball during PR-B verification. Surface IS enumerated in the original Day-33 AM diagnostic under Axis 1 ([`A1.1 — Page-level calendar views`](#consignee-detail-page-calendar-tab-consigneesidtabcalendar) — consignee detail page calendar tab), but the default-tab behavior was not called out as a gap. The diagnostic noted only "Calendar is one of four tabs" — left unsaid: which of the four is the default landing.

**Current behavior** (verified at `src/app/(app)/consignees/[id]/page.tsx` at main HEAD `57e5d9b`):

- Page header docstring (lines 9-15): *"Tab navigation is URL-based (`?tab=overview|history`) so the page stays server-rendered and operators can deep-link to a specific tab. **Default tab: overview.** Subscription + Calendar tabs are placeholders ('Coming in Day-17 surfaces'). Overview + History are the two tabs this PR ships."*
- The docstring is **stale** — same drift pattern as the `/calendar/page.tsx` lines 5-6 docstring already flagged in this memo's `visual-gap` classification. Subscription + Calendar are **not** placeholders today — both are fully wired (Calendar tab data fetch at page.tsx line 278-330; Subscription tab data fetch at line 251-265). The diagnostic's Axis 1 enumeration correctly captures the Calendar tab as functional.
- Valid tabs (line 92-93): `["overview", "subscription", "calendar", "history"]` — all four supported.
- Default fallback (lines 129-131): `activeTab: TabName = (VALID_TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as TabName) : "overview"`. When `?tab=` is absent or invalid, defaults to `overview`.
- Operator path-of-most-friction: clicking a consignee row from the consignees list goes to `/consignees/<id>` (no `?tab=` param), which lands on Overview. The operator must then click "Calendar" to reach the surface the diagnostic identifies as load-bearing for operator-action workflows.

**Calendar tab default view mode** (verified at page.tsx line 132-136):

- `activeView: CalendarViewName = (VALID_VIEWS as readonly string[]).includes(viewParam ?? "") ? (viewParam as CalendarViewName) : "week"`.
- **Default view is `week`, not `month`.** This contradicts the R7 brief's premise ("View mode default stays Month — no change to the existing month-view default"). The existing default is week, not month. Surfaced here as R7.2 below for explicit reviewer ruling.

**Proposed change** (Love directive):

- Default landing tab Overview → Calendar (when no `?tab=` URL param is present).
- All other tab behavior unchanged. Deep-links carrying explicit `?tab=overview` / `?tab=subscription` / `?tab=history` should continue to respect the explicit param (param-wins; expected behavior per the existing fallback logic shape).
- View mode default per the brief's directive: **stays Month**. NOTE: brief assumes existing default is month, but actual code default is week — see R7.2.

**Scope shape:**

- Single change to `consignees/[id]/page.tsx` fallback (line 131): swap default from `"overview"` to `"calendar"`.
- Stale docstring at page.tsx lines 9-15 updated in lock-step (Subscription + Calendar tabs are NOT placeholders — they ship today).
- Brief `§3.3.3` amendment — default-landing-tab behavior is part of the documented surface; eventual T3 plan-PR shipping R7 should bump brief to v1.16. This memo amendment does NOT touch the brief; brief bump lives with the eventual T3 plan-PR per [`feedback_brief_amendment_log_append_only.md`](feedback_brief_amendment_log_append_only.md).
- No service-layer, schema, or audit-event delta.

**Reviewer call options:**

- **R7.1 — Role scope of the default change.**
  - **Option A:** universal default — all roles (Tenant Admin / Ops Manager / CS Agent) land on Calendar.
  - **Option B:** role-conditional default — e.g., CS Agent lands on Calendar (operator-mental-model for handling skip/pause requests), Tenant Admin lands on Overview (which still surfaces the Day-25 onboarding CTAs for newly-created consignees with zero subscriptions and zero tasks).
  - *Builder note: Option A is simpler and matches Love's brief phrasing as written. Option B would require permission-aware default-tab logic — added complexity. Reviewer call.*
- **R7.2 — View mode default discrepancy.** Brief said "View mode default stays Month (no change to the existing month-view default)." But the current code defaults `activeView` to `week` (page.tsx line 136). Two possible interpretations:
  - **Option A:** brief misstates the current default; intent is for the default to become Month alongside the tab change. → R7 ships with both changes: tab default → calendar AND view default → month.
  - **Option B:** brief intent is "leave the view default unchanged" (i.e., stay on week, which is the actual current default). → R7 ships with only the tab default change; view default stays week.
  - **Option C:** brief intent is to set view default to month and that change was already supposed to have happened in a prior PR (which would mean there's a separate code-drift bug elsewhere).
  - *Builder note: cannot disambiguate without reviewer ruling. The discrepancy is verified — code says week. Reviewer should confirm intent before R7's T3 PR is scoped.*
- **R7.3 — Explicit deep-link param behavior.** Expected: explicit `?tab=` always wins over the default. The existing fallback logic at line 129-131 already implements this shape — explicit valid param → use it; absent/invalid → default. No code-shape ruling needed; just confirmation that this behavior is preserved.
- **R7.4 — Default tab when the consignee is newly-created with zero subscriptions + zero tasks (Day-25 onboarding empty-state).** The Overview tab currently surfaces the Day-25 onboarding CTAs (page.tsx lines 548-586: "Add work for this consignee" + Create subscription + Add ad-hoc task buttons). If default becomes Calendar, a newly-created consignee lands on an empty calendar with no obvious next-action. Either:
  - **Option A:** preserve Calendar as default; surface a calendar-side empty-state with the same CTAs (mirrors the Day-25 onboarding rationale onto a different tab).
  - **Option B:** conditional default — if `subscriptionCount === 0 && taskCount === 0`, default to Overview to surface the onboarding CTAs; otherwise default to Calendar. The empty-state detection at page.tsx lines 177-179 is already computed for the Overview empty-state — could be reused for the default-tab decision.
  - *Builder note: Option B preserves the Day-25 onboarding flow more faithfully but adds branching. Option A is simpler but punts onboarding to a different surface. Reviewer call.*

**Adjacent — stale docstring drift (already covered):** the lines 9-15 docstring claim that Subscription + Calendar tabs are placeholders is the same pattern as `/calendar/page.tsx` lines 5-6 already classified in this memo's `visual-gap` section. R7's T3 PR should fold the stale comment fix in lock-step with the default-tab change — same file, same minute, same author.

**Severity:** low operationally (no data corruption, no SF divergence). High UX (the default-landing-tab is the operator's first impression on every consignee click; Love has explicitly flagged the calendar as the most important surface). Surfacing as a ruling item ensures the role-scope + view-default discrepancy + onboarding-empty-state interaction don't get silently decided by the implementer.

# Out of scope for this enumeration

- Plan #317 outbound push pipeline structural defects (queue-infrastructure-only) — Session A's lane. None of the surfaces enumerated here are in #317 scope; none of #317's surfaces are in this lane.
- HEM 403 single-tenant credential failure — separate lane, filed Day-33 as [`followup_hem_403_credential_failure.md`](followup_hem_403_credential_failure.md) (PR #322 merged at main `5798a61`).
- Outbound-symmetry follow-on (Planner→SF EDIT propagation) — separate lane committed in Day-31 PM fold of #306 §5. Adjacent to R1's "should override push to SF?" question but separate scope.
- Resume from pause — auto-resume cron + manual resume both happen OUTSIDE the calendar context; not enumerated here. Note: manual resume has no calendar-cell-level surface (consistent with the brief §3.1.7 scope statement on bounded pause).

# Cross-references

- [`memory/followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) — Day-32 lane memo. Documents Actions 1 (skip-tail-end) + 2 (move-to-date) only. This memo expands the inventory to all 8 popover actions + 3 page-level views + visual indicators + state surfaces and surfaces R2/R3/R4/R5 as new gaps.
- [`memory/handoffs/day-31-32-eod-consolidated.md`](handoffs/day-31-32-eod-consolidated.md) §G — "Tomorrow's open thread" lists the diagnostic pass as a calendar-lane prerequisite. This memo discharges that recommendation.
- [`memory/MEMORY-followup-current.md`](MEMORY-followup-current.md) §T1-followon-2 — Plan #317 active-lane digest references the calendar-lane diagnosis as sequenced after #317 PR-B; this diagnostic is the pre-PR-B docs-only filing (does not block #317).
- [`memory/followup_hem_403_credential_failure.md`](followup_hem_403_credential_failure.md) — adjacent lane, separate scope.
- Brief: `memory/PLANNER_PRODUCT_BRIEF.md` v1.15 on main. Sections referenced: §3.1.4–§3.1.8 (subscription exceptions), §3.1.5 (14-day rolling materialization horizon), §3.3.3 (DayActionPopover), §3.3.4 (consolidated calendar), §3.3.6 (task timeline), §3.3.8 (cached webhook source-of-truth), §3.3.10 (permission gating), §3.3.11 (UI brand pass).

# Non-goals

This memo does NOT:

- Propose any fix for the surfaces classified as Phase-2-placeholder, unimplemented, cron-deferred-invisible, or visual-gap.
- Scope a code-PR. That is the eventual T3 plan-PR's job, sequenced after Plan #317 completes per the Day-32 lane shape proposal.
- Sequence the gaps. R1-R5 are listed for reviewer ruling; the lane plan-PR will sequence them.
- Re-open the Day-32 followup for editing. That memo retains its existing scope (Lane shape + Love directive + Non-goals). This memo cross-references it.
- Touch Plan #317 lane.
- Touch HEM 403 lane.

Its only job is to surface and classify every operator-facing calendar surface so the eventual lane plan-PR has a complete inventory to work from — and to surface the 5 reviewer-ruling items (R1-R5) where the current behavior diverges from one of multiple plausible interpretations of the brief.

# Meta

Filed Day-33 AM (2026-05-21) as a T1 docs-only PR off main HEAD `5798a61`. Single commit, single file. Diagnostic-only — the institutional record is the classification + the R1-R5 ruling items. Branch: `docs/d33-calendar-management-full-surface-diagnostic`. Merged via PR #324 at main `57e5d9b`.

**Day-33 PM amendment** — Love surfaced two additional ruling items (R6 + R7) during PR-B production eyeball. R6 covers the `/tasks` page surface (not enumerated in the original AM diagnostic — that pass scoped to calendar surfaces only) and is the first instance of the diagnostic touching a non-calendar surface; the rationale is that R6 proposes a new cross-surface entry point to TaskTimelineDrawer (the Action 8 drawer this memo already classifies as works end-to-end), so R6 belongs in this memo's ruling section rather than a fresh document. R7 covers the consignee detail page default landing tab — the diagnostic enumerated the Calendar tab under Axis 1 but did not call out the default-tab behavior as a gap. Both items append as new sub-sections under "Items needing operator/reviewer ruling" without re-classifying any existing axis surface. Frontmatter description amended in lock-step. Axis enumeration sections, classification matrix, R1-R5, Out of scope, Cross-references, Non-goals all unchanged. Filed Day-33 PM as a T1 docs-only amendment PR off main HEAD `57e5d9b`. Single commit. Branch: `docs/d33-calendar-diagnostic-r6-r7-amendment`.
