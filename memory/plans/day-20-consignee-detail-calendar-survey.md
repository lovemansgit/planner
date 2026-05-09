# Plan · Day-20 §3.3.3 consignee detail calendar — Phase 1 survey

**Status:** Survey-only. Phase 1 of T3 (survey → §3.6 → code-PR sequence).
**Date:** 10 May 2026 (Day 20).
**Branch:** `day20/consignee-detail-calendar-section-3-3-3`
**Author:** Session B
**Brief reference:** [`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) §3.3.3 lines 473-510.
**BRD reference:** docs/Subscription_Planner_BRD_v1.docx §6.2 + §6.2.1 (year heat-map).
**Visual reference:** subplanner.vercel.app/consignee/c_001 (pre-sprint prototype).

---

## §0 — Executive summary

Week-view skeleton already in place from Day-17 PR #177 (`CalendarWeekView` + `DayActionPopover`). Service-layer fetch (`getConsigneeTasksForDateRange`) + repository-layer query (`listTasksByConsigneeAndDateRange`) ALREADY EXIST and are wired through the page. POD primitives + logistics icon set + StatusIcon dispatcher all reusable from PR #206 + #217.

**Gap surface for code-PR:**
- Month + Year view components (net-new; viewport-only Week today)
- Year heat-map needs aggregate-count fn (net-new; current per-row fetch insufficient)
- Driver name display (NET-NEW data field — not yet on `tasks` row)
- Consignee rating display (NET-NEW data field — not yet on `consignees` row)
- 7 of 8 popover action handlers (only Skip-default wired today; 7 missing)
- Address indicator (Home/Office) at day-cell level — data model exists at `subscription_addresses.label`, render component net-new
- Status legend conflates task statuses + subscription exception flags — needs unified projection or design clarification
- Net-new permission catalogue entries (4-5 perms) for the missing action handlers

**Decisions needed before code-PR:**
- DECISION-1: Year-view perf approach — lazy-load-by-month vs aggregate-only-with-drilldown
- DECISION-2: Status legend semantic projection — task-status-only OR include subscription-exception kinds
- DECISION-3: Driver name + rating data fields — wire via webhook payload extension (depends on what Aqib payloads carry) OR defer to phase 2
- DECISION-4: FINDING-3 button-sizing target — badge bumps to button size, button shrinks to badge size, or pick a third common dimension
- DECISION-5: Action-handler scope — ship all 7 missing or subset for May-15 demo (some are subscription:override_skip_rules + subscription:change_address_forward etc, with downstream cascade implications)

---

## §1 — Q1: Current placeholder state at /consignees/[id] Calendar tab

**ConsigneeDetailPage:** [`src/app/(app)/consignees/[id]/page.tsx`](../../src/app/(app)/consignees/[id]/page.tsx) (currently 297 lines).

**Tab navigation component:** Inline `Tabs` function at [`page.tsx:193-219`](../../src/app/(app)/consignees/[id]/page.tsx#L193-L219). Four tabs hard-coded:

```ts
const items: ReadonlyArray<{ tab: TabName; label: string }> = [
  { tab: "overview", label: "Overview" },
  { tab: "subscription", label: "Subscription" },
  { tab: "calendar", label: "Calendar" },
  { tab: "history", label: "History" },
];
```

**Active tab dispatch** at [`page.tsx:175-187`](../../src/app/(app)/consignees/[id]/page.tsx#L175-L187):

```tsx
<section className="mt-8">
  {activeTab === "overview" ? <OverviewTab consignee={consignee} /> : null}
  {activeTab === "history" ? <HistoryTab events={history} /> : null}
  {activeTab === "subscription" ? <PlaceholderTab label="Subscription" /> : null}
  {activeTab === "calendar" ? (
    <CalendarWeekView
      consigneeId={consignee.id}
      weekStart={weekStart}
      tasks={calendarTasks}
      canSkip={canSkip}
    />
  ) : null}
</section>
```

**Calendar tab** is NOT a placeholder — it renders [`CalendarWeekView`](../../src/app/(app)/consignees/[id]/_components/CalendarWeekView.tsx) (213 lines, shipped Day 17 PR #177). The visible "WEEK OF 2026-05-04 + 7 day cells" on Vercel preview IS this component fully rendered with real task data.

**What's actually missing per brief §3.3.3:**
- Week / Month / Year toggle (top-right) — only Week renders
- Year heat-map view component
- Month-grid view component
- Status legend — implicit via day-cell pills, no separate legend block
- Address indicator (Home/Office) per day-cell — net-new
- Driver name + rating + SF-acknowledged indicator inside popover — net-new
- 7 of 8 action handlers in popover (only Skip-default wired)

---

## §2 — Q2: Reusable calendar primitives in codebase

**`/calendar` consolidated merchant calendar (brief §3.3.4):** DOES NOT EXIST. Negative grep on `src/app/(app)/calendar` + month/year-view component search returned zero results. /calendar is post-§3.3.3 work.

**Existing calendar primitives in [`CalendarWeekView.tsx`](../../src/app/(app)/consignees/[id]/_components/CalendarWeekView.tsx):**

- `computeWeekStart(date: Date): string` — ISO-Monday anchoring (lines 33-41)
- `addDays(isoDate: string, days: number): string` — date arithmetic (lines 43-48)
- `formatDayHeader(isoDate: string)` — weekday short + dayNum (lines 56-61)
- `STATUS_VISUALS` Record map for the 7 task statuses (lines 71-79) — Calendar-specific labels diverge from `TASK_STATUS_FILTERS` (e.g., CREATED → "Scheduled" here vs "Created" in /tasks)

**Reusable status primitives:**

- [`src/app/(app)/tasks/status.ts:21-29`](../../src/app/(app)/tasks/status.ts#L21-L29) — `TASK_STATUS_FILTERS` with `{value, label, pillClass}`. Used for /tasks operator pill rendering.
- [`src/app/(app)/tasks/_components/StatusIcon.tsx`](../../src/app/(app)/tasks/_components/StatusIcon.tsx) — TaskInternalStatus → glyph dispatcher (PR #217 Lane 4). Reusable for status legend prefix glyphs.
- [`src/app/(app)/tasks/_components/{TruckIcon,VanIcon,CautionIcon,PackageIcon,PodIcon}`](../../src/app/(app)/tasks/_components/) — 4 logistics icons + reused PodIcon. Reusable for status legend + day-cell prefix.
- [`src/app/(app)/tasks/_components/PodLightboxModal.tsx`](../../src/app/(app)/tasks/_components/PodLightboxModal.tsx) — POD photo lightbox with prev/next nav. Reusable inside popover.
- [`src/app/(app)/consignees/[id]/_components/CalendarPodCard.tsx`](../../src/app/(app)/consignees/[id]/_components/CalendarPodCard.tsx) — inline POD card rendered when DELIVERED + populated photos (PR #206 §6.2 interpretation ii). Already wired in CalendarWeekView at line 179-186.

**Net-new for code-PR:** Month-grid component, Year-heatmap component, View-toggle pill component, status legend block component.

---

## §3 — Q3: Service-layer fns for tasks-by-date-range

**EXISTS — NO GAP for Week + Month views:**

- Service: [`src/modules/tasks/service.ts:573-590`](../../src/modules/tasks/service.ts#L573-L590) — `getConsigneeTasksForDateRange(ctx, consigneeId, startDate, endDate): Promise<readonly Task[]>`. Auth: `task:read` + `assertTenantScoped`. Uses `withTenant` (RLS).
- Repository: [`src/modules/tasks/repository.ts:508-534`](../../src/modules/tasks/repository.ts#L508-L534) — `listTasksByConsigneeAndDateRange`. Returns full Task DTOs (with packages JSON-aggregated). Tenant filter explicit + RLS.

Currently invoked at [`page.tsx:107-112`](../../src/app/(app)/consignees/[id]/page.tsx#L107-L112) when activeTab === "calendar":

```tsx
const weekEnd = addDays(weekStart, 6);
calendarTasks = await getConsigneeTasksForDateRange(
  ctx, id as Uuid, weekStart, weekEnd,
);
```

For Month view: same fn, just pass 28-31 day range. Returns full Task[] — fine for ~30 cells × ~1 task/cell.

**GAP — Year view aggregate counts (~365 cells × 1 task/day = ~365 Task DTOs):**

No `countTasksByConsigneeAndDayBucket` aggregator exists. `countTasksByTenant` ([`repository.ts:704`](../../src/modules/tasks/repository.ts#L704)) counts tenant-wide; doesn't bucket by day. Year heat-map at full-Task-DTO fetch: ~365 rows × ~1 KB/row = ~365 KB payload + N+1 risk on packages. Not catastrophic but wasteful.

**Two options surfaced for DECISION-1 (year-view perf):**

- **Option (a) — lazy-load-by-month:** Year view shows 12 month-cells; click a cell to drill-down to month view. No aggregate needed; reuse `getConsigneeTasksForDateRange` with month start/end. Year cells render daily-density heat-map via lazy-fetched aggregates (cell hover shows "X deliveries this month").
- **Option (b) — aggregate-only-with-drilldown:** New repository fn `countTasksByConsigneeAndDayBucket(consigneeId, startDate, endDate): Promise<readonly { date: string; status: TaskInternalStatus; count: number }[]>`. Year cells render direct from aggregate. Click drills to month/week view.

(b) is the brief §3.3.3 line 510 hint ("aggregate-only summary in year view with month drill-down"). Recommend (b) but reviewer ruling needed.

---

## §4 — Q4: Day-popover infrastructure

**Component:** [`src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx`](../../src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx) (279 lines, PR #177 Day 17).

**Currently wired (1 of 8 brief actions):**

- **Skip-default** (`subscription:skip` perm) — `PopoverForm` [lines 72-131](../../src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx#L72-L131); wired to `skipDeliveryAction` from [`_calendar-actions.ts`](../../src/app/(app)/consignees/[id]/_calendar-actions.ts).

**Status eligibility:** [lines 66-70](../../src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx#L66-L70) — `SKIP_ELIGIBLE_STATUSES = ['CREATED', 'ASSIGNED', 'ON_HOLD']`. Terminal/past statuses (DELIVERED, FAILED, CANCELED, IN_TRANSIT) not skippable.

**Permission gating helper:** Inline `canSkip` boolean threaded from page. Pattern: `permissions.has("subscription:skip")` at the page level (line 95 of `page.tsx`). Same pattern reusable for the 7 net-new perms.

**Missing per brief §3.3.3 lines 500-508 (8 actions × matched perm):**

| Action | Permission | Status |
|---|---|---|
| Skip this delivery (default rules) | `subscription:skip` | ✓ wired |
| Skip with override (move to date / skip without append) | `subscription:override_skip_rules` | ✗ perm missing; action handler missing |
| Pause from this date | `subscription:pause` | ✗ perm missing on calendar surface (subscription:pause exists for header pause but not from per-day calendar action); action handler missing |
| Change address for this delivery only | `subscription:change_address_one_off` | ✗ perm missing; action handler missing |
| Change address from this delivery onwards | `subscription:change_address_forward` | ✗ perm missing; action handler missing |
| Cancel delivery (no append, reduces count) | `subscription:override_skip_rules` (re-uses existing) | ✗ action handler missing |
| Add note to driver | (perm TBD per brief — relevant permission unspecified) | ✗ perm + action both missing |
| View full task detail (timeline drawer) | `task:view_timeline` | ✗ perm missing; drawer net-new |

**Net-new permission catalogue entries:** 4-5 (override_skip_rules, change_address_one_off, change_address_forward, view_timeline, possibly note_to_driver). Adds to [`src/modules/identity/permissions.ts`](../../src/modules/identity/permissions.ts) catalogue + role assignments.

**Net-new action handlers:** 7 server actions in `_calendar-actions.ts`-style co-located file.

---

## §5 — Q5: Address indicator (Home/Office per rotation)

**Brief §3.3.3 line 487 specifies:** "Each day cell shows delivery card with status color, time, **address indicator** (Home/Office per rotation)."

**Data model EXISTS:**

- [`src/modules/subscription-addresses/types.ts:90`](../../src/modules/subscription-addresses/types.ts#L90) — `label: "home" | "office" | "other"` on the `AddressOwnershipRow` projection. Same field on full `SubscriptionAddress` row.
- Database: `subscription_addresses.label` column (per migration 0014+ rotation).

**Render component:** DOES NOT EXIST. Negative grep on `_components/*` for address|rotation|home|office.

**Gap:** Net-new tiny inline component, e.g.,

```tsx
function AddressIndicator({ label }: { label: "home" | "office" | "other" }) {
  const visual = {
    home: { glyph: "🏠" /* OR custom HomeIcon */, text: "Home" },
    office: { glyph: "🏢" /* OR custom OfficeIcon */, text: "Office" },
    other: { glyph: "📍" /* OR custom PinIcon */, text: "Other" },
  }[label];
  return <span className="text-[10px] text-stone-600">{visual.text}</span>;
}
```

**Wiring gap:** Tasks currently carry `addressId: Uuid | null` ([`tasks/types.ts:145`](../../src/modules/tasks/types.ts#L145)) but NOT the address `label` directly. The CalendarWeekView consumer needs either:

- (a) A new repository projection that JOINs `subscription_addresses.label` into the calendar fetch (preferred — single round-trip),
- (b) A second per-task fetch (N+1 — rejected),
- (c) A new service-layer fn that hydrates addresses alongside tasks (cleanest API surface).

Recommend (a): extend `listTasksByConsigneeAndDateRange` to LEFT JOIN `subscription_addresses ON tasks.address_id = subscription_addresses.id` and project `label` into a new `Task.addressLabel: 'home' | 'office' | 'other' | null` field.

---

## §6 — Q6: POD photo + SuiteFleet-acknowledged indicator

**POD primitives REUSABLE (PR #206):**

- [`PodIcon.tsx`](../../src/app/(app)/tasks/_components/PodIcon.tsx) — bag glyph, two-tone navy + green
- [`PodLightboxModal.tsx`](../../src/app/(app)/tasks/_components/PodLightboxModal.tsx) — multi-photo lightbox (post-PR-B with `border-t-green` rail, no shadows)
- [`CalendarPodCard.tsx`](../../src/app/(app)/consignees/[id]/_components/CalendarPodCard.tsx) — inline POD card already wired in CalendarWeekView at lines 179-186

**Wiring gap for popover:** When popover renders for DELIVERED status, embed PodLightboxModal trigger (or thumbnail click → lightbox). Currently CalendarWeekView shows EITHER the popover trigger OR the inline POD card (per §6.2 interpretation ii) — they're mutually exclusive. The brief §3.3.3 popover shows POD ALONGSIDE other status detail. Two interpretations:

- (i) Keep current "trigger swap" — if DELIVERED + populated photos, render CalendarPodCard (no popover). All other states get popover. POD content lives in CalendarPodCard's lightbox.
- (ii) Add POD content to popover as a section ABOVE/BELOW status detail. Popover is universal; CalendarPodCard is no longer needed.

DECISION needed (or maintain ii). Recommend (ii) per brief §3.3.3 popover content list. CalendarPodCard component retires (or stays as the at-a-glance card style).

**SuiteFleet-acknowledged indicator (brief §3.3.3 line 499):**

- Brief specifies "Pushed to SuiteFleet at HH:MM ✓"
- Data field: `tasks.pushed_to_external_at` ([`repository.ts:109`](../../src/modules/tasks/repository.ts#L109)) → `Task.pushedToExternalAt: IsoTimestamp | null` ([`tasks/types.ts:135`](../../src/modules/tasks/types.ts#L135))
- ALREADY ON THE TASK READ SHAPE. No data gap.

Render gap: net-new tiny component in popover. Format ISO timestamp → HH:MM Asia/Dubai. Reuse the existing `formatDayHeader` time-formatter pattern from CalendarWeekView, OR create a small `PushedAtIndicator` component.

---

## §7 — Q7: Year view performance — DECISION NEEDED

**Brief §3.3.3 line 510:** "Lazy-load by month or aggregate-only summary in year view with month drill-down. Decided in Day-14 design spec."

Day-14 design spec NOT located in the codebase or memos. Survey grep for "year view" / "year heat-map" / "Day-14 design spec" returned no concrete spec doc. Possibly reviewer-mental-model not yet doc'd.

**Per §3 above, two options surfaced:**

- (a) Lazy-load-by-month: year view = 12 month-cells; per-cell aggregate via `getConsigneeTasksForDateRange` + count. Drill-down via click.
- (b) Aggregate-only-with-drilldown: new repository fn for per-day status counts; year cells render heat-map directly. Drill-down via click.

**Trade-off:**

| | Option (a) | Option (b) |
|---|---|---|
| Initial paint | 12 fetches × ~30 rows each | 1 fetch × ~365 day-buckets |
| DB cost | 12 queries × idx scan | 1 query × idx scan + GROUP BY |
| Cell-level density | per-month aggregate (less granular) | per-day aggregate (more granular for heat-map) |
| Implementation cost | reuse existing fn | net-new aggregator fn + service + tests |
| Brief alignment | "lazy-load by month" framing | "aggregate-only summary" framing |

**DECISION-1:** Recommend **(b)** — net-new `countTasksByConsigneeAndDayBucket` repository fn. Brief §3.3.3 line 510 closes with "aggregate-only summary in year view with month drill-down" — implies (b). Reviewer rules.

**Effort delta:** (b) adds ~2-3 hr (repo fn + service fn + unit-test pin + heat-map render). (a) saves that but loses per-day density (less compelling visual).

---

## §8 — Q8: FINDING-3 button-sizing fix target

**ACTIVE status pill (`CrmStateBadge size="lg"`):**

[`src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx:78-83`](../../src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx#L78-L83) (post PR-B FIX-UP 7):

```tsx
const sizeClasses =
  size === "lg"
    ? "min-w-[120px] px-3 py-1 text-xs"
    : "min-w-[100px] px-2 py-0.5 text-[11px]";
return (
  <span
    className={`inline-flex items-center justify-center rounded-sm uppercase tracking-[0.1em] font-medium ${sizeClasses} ${visual.classes} ...`}
```

Lg variant: `min-w-[120px] px-3 py-1 text-xs` + `inline-flex items-center justify-center rounded-sm uppercase tracking-[0.1em] font-medium`.

**CHANGE STATE button (CrmStateModal trigger):**

[`src/app/(app)/consignees/[id]/_components/CrmStateModal.tsx:284-291`](../../src/app/(app)/consignees/[id]/_components/CrmStateModal.tsx#L284-L291):

```tsx
<button
  ref={triggerRef}
  type="button"
  onClick={openModal}
  className="inline-flex items-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
>
  Change state
</button>
```

Trigger: `inline-flex items-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.1em] text-navy ...`.

**Differences:**

| Property | Badge (lg) | Button | Delta |
|---|---|---|---|
| `min-w-` | `[120px]` | (none) | Badge has floor; button is content-sized |
| `py-` | `1` (4px) | `1.5` (6px) | Button is 4px taller total |
| `justify-` | `center` | (none / left-aligned) | Badge centers content in min-w span |
| Border | `1px` colored variant | `1px navy` | Different colors (semantic) |
| BG | variant tint | `bg-paper` | Different colors (semantic) |
| Text color | `text-{green|red|stone-600}` (variant) | `text-navy` | Different colors (semantic) |

**FINDING-3 fix:** "Same size, different colors." Reviewer-rule on shape (DECISION-4 below).

**Three options:**
- (a) Badge bumps to button dims: `min-w-[120px] px-3 py-1.5 text-xs` → both `py-1.5`. Badge gets slightly chunkier.
- (b) Button shrinks to badge dims: `min-w-[120px] px-3 py-1 text-xs justify-center` → both `py-1`. Button loses some "push" feel but reads as paired.
- (c) Both adopt a third common dim: `min-w-[120px] px-3 py-1.5 text-xs` (button stays) + badge bumps. Same as (a) practically.

Recommend (b) — button shrinks to badge dims. Editorial-minimal aesthetic prefers slimmer buttons; the "different colors, same size" framing pairs them as visual peers (badge = state read, button = state write).

**Ride-along discipline:** Single-file change to CrmStateModal.tsx line 288. ~5 LOC. Trivial.

---

## §9 — Status legend semantic projection — DECISION-2

**Brief §3.3.3 line 485:** "Status legend (Delivered / Out for delivery / Scheduled / Skipped / Appended / Failed)"

**Conflation:**
- Delivered → `TaskInternalStatus.DELIVERED` ✓
- Out for delivery → `IN_TRANSIT` (or maybe ASSIGNED?) ✓
- Scheduled → `CREATED` ✓
- **Skipped** → NOT in `TaskInternalStatus` enum. Closest is `subscription_exception.kind = 'skip'` (subscription-level, not task-level). OR an 8th `SKIPPED` status that the per [`followup_internal_task_status_lossiness.md`](../followup_internal_task_status_lossiness.md) Day-4 memo flagged as a possible addition.
- **Appended** → NOT in `TaskInternalStatus` enum. Closest is `subscription_exception.kind = 'append'`.
- Failed → `FAILED` ✓

**DECISION-2:** Reviewer rules on the legend semantic. Two interpretations:

- (i) Legend shows ONLY task statuses: collapse Skipped + Appended to a generic "Exception" badge or omit; legend becomes 4-status. Brief framing partially overrides itself.
- (ii) Legend is a UI-mental-model abstraction that mixes task-status with subscription-exception kinds: introduce a `DayDisplayStatus` projection (computed value from task internal_status JOIN subscription_exception kind) → 6-status legend per brief verbatim. Adds projection layer at service or render time.

Recommend (ii) per literal brief reading. Implementation: render-time projection in CalendarWeekView (no DB-layer change). Status pill on day-cell driven by:

```ts
function projectDayDisplayStatus(task: Task, exception: SubscriptionException | null): DayDisplayStatus {
  if (exception?.kind === "skip") return "SKIPPED";
  if (exception?.kind === "append") return "APPENDED";
  switch (task.internalStatus) {
    case "DELIVERED": return "DELIVERED";
    case "IN_TRANSIT": case "ASSIGNED": return "OUT_FOR_DELIVERY";
    case "CREATED": case "ON_HOLD": return "SCHEDULED";
    case "FAILED": return "FAILED";
    case "CANCELED": return "CANCELED"; // 7th legend entry? or hide?
  }
}
```

This means the calendar fetch needs subscription_exception data alongside tasks. Either:
- LEFT JOIN subscription_exceptions on (subscription_id, exception_date)
- Separate fetch + service-layer projection

**Effort delta:** ~3-4 hr (projection fn + service-layer extension + visual mapping + tests).

---

## §10 — Driver name + consignee rating — DECISION-3

**Brief §3.3.3 lines 495 + 498:** Popover shows "Driver name (cached from webhook)" + "Consignee rating (when available)".

**Data fields:**

- `tasks.driver_name`: NOT IN SCHEMA. Grep `driverName|driver_name` returned no hits in `tasks` types/repo.
- `consignees.rating`: NOT IN SCHEMA. Grep `rating|Rating` on `consignees/types.ts` returned no hits.

**Both NET-NEW data fields.** Both labeled "cached from webhook" / "when available" — implying source is SuiteFleet webhook payload extension.

**Webhook payload survey gap:** Does SF webhook payload carry `driverName` / `consigneeRating` today? Need to check `webhook-parser.ts` projections + sandbox webhook samples. DEFERRED to code-PR survey unless reviewer rules to defer entirely.

**DECISION-3:** Reviewer rules on phasing.

- (a) Wire NOW (code-PR adds 2 columns + webhook-parser projection + display) — adds ~3-4 hr to code-PR + cross-cuts webhook handler tests
- (b) Defer — popover renders "Driver: TBD" placeholder until webhook payload extension lands (separate Day-21 lane). Popover content shows the rest of brief §3.3.3 fields.

Recommend **(b)** — defer. Popover scope is rich enough already; driver+rating add cross-module surface that doesn't need to land for May-15 demo. Surface a TODO for Phase 2.

---

## §11 — Net-new vs reuse breakdown

**Reusable from existing codebase (NO net-new):**
- `CalendarWeekView` shell + week navigation + day-cell render
- `DayActionPopover` — extend with new action handlers, panel structure stays
- `getConsigneeTasksForDateRange` + `listTasksByConsigneeAndDateRange` (Week + Month)
- `PodIcon` + `PodLightboxModal` + `CalendarPodCard`
- `StatusIcon` dispatcher + 5 logistics icons (PR #217)
- `TASK_STATUS_FILTERS` for status pill class lookup
- `pushedToExternalAt` field for SF-acknowledged indicator

**Net-new components:**
1. `CalendarMonthView.tsx` — month-grid view (~30 cells)
2. `CalendarYearView.tsx` — year heat-map (~365 cells or ~12 month-aggregate cells per DECISION-1)
3. `CalendarViewToggle.tsx` — Week / Month / Year pill button group
4. `CalendarStatusLegend.tsx` — top-of-calendar 6-status legend block
5. `AddressIndicator.tsx` — Home/Office/Other inline indicator
6. `PushedAtIndicator.tsx` — "Pushed to SuiteFleet at HH:MM ✓" inline component
7. (Possibly) `OfficeIcon.tsx` + `HomeIcon.tsx` + `PinIcon.tsx` — line-art glyphs matching PodIcon + StatusIcon precedent (Lane 4 brand language)

**Net-new service-layer/repository fns (depends on DECISIONs):**
- DECISION-1 (b): `countTasksByConsigneeAndDayBucket(consigneeId, startDate, endDate): Promise<readonly { date: string; status: TaskInternalStatus; count: number }[]>` — service + repository + tests
- DECISION-2 (ii): subscription-exception JOIN in `listTasksByConsigneeAndDateRange` OR separate fetch + render-time projection
- §5 wiring: extend `listTasksByConsigneeAndDateRange` to JOIN `subscription_addresses.label` → new `Task.addressLabel` field

**Net-new permission catalogue:**
- `subscription:override_skip_rules`
- `subscription:change_address_one_off`
- `subscription:change_address_forward`
- `task:view_timeline`
- (possibly) `subscription:add_note_to_driver`

**Net-new server actions** (in `_calendar-actions.ts`):
- `skipWithOverrideAction` (and sub-variants for "move to date" vs "skip without append")
- `pauseFromDateAction`
- `changeAddressOneOffAction`
- `changeAddressForwardAction`
- `cancelDeliveryAction`
- `addNoteToDriverAction`
- `viewTaskTimelineAction` (or just navigate to a drawer URL)

---

## §12 — Effort estimate refinement

**Reviewer baseline:** ~16-22 hr.

**Per this survey:**

| Lane | Effort | Notes |
|---|---|---|
| Week-view polish (legend, address indicator wiring, projection fn for DECISION-2 if (ii)) | 4-5 hr | Includes status-legend block + AddressIndicator component + DayDisplayStatus projection |
| Month-view component + service-layer integration | 3-4 hr | Reuses existing fn; net-new render |
| Year-view component + DECISION-1 implementation | 4-6 hr | (b) adds ~2-3 hr aggregator fn + tests |
| View-toggle pill component | 1 hr | URL-state via `?view=week|month|year` like `?tab=` pattern |
| Popover action handlers (5-6 net-new) | 4-6 hr | Each handler ~30-60 min; perm catalogue updates + tests |
| FINDING-3 button-sizing ride-along | 0.25 hr | Single-file change |
| Driver+rating wiring (only if DECISION-3 = (a)) | 3-4 hr | Schema + parser + display + tests |
| Total (DECISION-3 = (b) recommended) | **16.25-22.25 hr** | Aligned with reviewer baseline |
| Total (DECISION-3 = (a)) | **19.25-26.25 hr** | Adds ~3-4 hr |

---

## §13 — Day-21 sequencing recommendation

If reviewer §3.6 rules pre-noon Day 20 (post-this-PR-merge):

- **Day-20 PM (~4 hr):** Lanes 1-2 (week-view polish + status legend + address indicator + projection fn). Ships first preview-able state for May-15 demo dry-run.
- **Day-21 AM (~6 hr):** Month + Year views + view-toggle. Demo-completable.
- **Day-21 PM (~6 hr):** 5-6 popover action handlers + perm catalogue updates. FINDING-3 ride-along.
- **Day-22 AM:** Test polish, smoke-walk, demo-readiness signoff.

**Risk:** 7 net-new server actions + 4-5 perm catalogue entries cross-cut subscription/task service modules. If any cascade-implications surface (e.g., `subscription:override_skip_rules` interacts with materialization-cron), schedule slips into Day-22 PM.

**Pre-emptive trigger for slip:** if cascade-implications surface during code-PR §3.6, ship in two sub-PRs (calendar-views first; popover-actions second) to keep merge cadence.

---

## §14 — Open questions for reviewer §3.6

| ID | Question | Recommendation |
|---|---|---|
| DECISION-1 | Year view perf approach | (b) aggregate-only-with-drilldown |
| DECISION-2 | Status legend semantic projection | (ii) include subscription-exception kinds via render-time projection |
| DECISION-3 | Driver name + rating data fields | (b) defer to Phase 2; placeholder in popover |
| DECISION-4 | FINDING-3 button-sizing target | (b) button shrinks to badge dims |
| DECISION-5 | Action-handler scope for May-15 demo | All 7 if Day-22 buffer holds; subset otherwise (skip-default + cancel + view-timeline minimum) |
| Q-LEGEND-OUT-FOR-DELIVERY | Does "Out for delivery" map to `IN_TRANSIT` only, or `IN_TRANSIT` + `ASSIGNED`? | Reviewer rules; recommend `IN_TRANSIT` only (ASSIGNED reads as "scheduled with driver", pre-pickup) |
| Q-CANCELED-IN-LEGEND | Brief legend has 6 entries (Delivered/OFD/Scheduled/Skipped/Appended/Failed); CANCELED not listed. Hide canceled day-cells, or render as a 7th legend entry? | Recommend hide (consistent with brief; canceled-with-replacement reads as appended on the new date). Reviewer rules. |
| Q-NOTE-TO-DRIVER-PERM | Brief §3.3.3 line 507 "Add note to driver — for relevant permission" — perm name unspecified | Recommend `subscription:add_note_to_driver` |

---

## §15 — Hard-stop signal

Survey-only PR. Phase 1 deliverable. NO code changes in this PR.

After reviewer §3.6 lands rulings on §14 DECISIONs + Qs:
- Open code-PR branch on top of this survey-PR-merged main
- Build per §13 sequencing
- §3.6 counter-review on each lane

Standing by for reviewer §3.6 on this survey memo.
