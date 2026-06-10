# Decision · R10 (year-view heatmap) — CLOSED, already-satisfied

**Status:** **CLOSED — already-satisfied.** Supersedes the Day-33 diagnostic R10 ruling *"(b) build the heatmap properly."* Verified Day-52 (2026-06-10) against main `c552946`: the heatmap was already fully built Day-21 (#230); the "empty grid" the diagnostic observed was **sparse data under the 21-day materialization horizon, not a renderer bug and not a fetch gap.**

## The superseded premise (Rule B)

Diagnostic [`diagnostic_calendar_management_full_surface_enumeration.md`](diagnostic_calendar_management_full_surface_enumeration.md) §R10, verbatim: *"Origin: operator screenshot Day-33 PM showed Year view as an empty 12-month grid — no density color-coding, no failure highlights, no skipped/appended marks. … Today Year view is a placeholder, not a feature. RULED: (b) build the heatmap properly."*

That framing came from an **operator screenshot**, not a code-path read. Reality-checking against the running product (the discipline in [`feedback_verify_framing_against_running_product.md`](feedback_verify_framing_against_running_product.md) Rule B) contradicts it: the renderer is not a placeholder — it is a complete, shipped feature.

## Verified facts

1. **The heatmap is built** — [`CalendarYearView.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/CalendarYearView.tsx), a server component: *"Renders a 12-month aggregate heat-map per BRD §6.2.1 + DECISION-1 (b) … Each cell = one day; density (delivery count) drives bg opacity from the brand green token. Skip exceptions … render the muted SKIPPED tint; append exceptions … render the green-bordered APPENDED tint. Clicking a month header drills to that month's CalendarMonthView."* So density color-coding, SKIPPED/APPENDED marks, and month-drill interaction all exist.
2. **Built Day-21 via #230** — `35a591a feat(d21-calendar): §3.3.3 calendar PR-A2 — month + year + view-toggle (T3) (#230)`, with the year-view rendering fixes `8986f20` ("visible cells, three channels") + `726698f` (4×3 layout).
3. **The data fetch is correct (no fetch gap)** — [`consignees/[id]/page.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/page.tsx) fetches `getConsigneeTaskCountByDayBucket(consigneeId, yearStart, yearEnd)` over the **full ~365-day year** (`year: yearStart..yearEnd … aggregator-only fetch`). The repository aggregate query bounds on `delivery_date >= startDate AND delivery_date <= endDate` + GROUP BY — **no horizon clamp in the query**. It returns counts for whatever task rows exist in the year.

## Data-flow trace — why the grid looks empty (sparse, not broken)

`MATERIALIZATION_HORIZON_DAYS = 21` ([`task-materialization/dubai-date.ts:48`](../src/modules/task-materialization/dubai-date.ts)). Tasks are only **materialized** (inserted into `tasks`) up to `today + 21 days`; the nightly cron rolls the horizon forward. So the year-aggregate query — correct and unclamped — returns rows only for **past deliveries + the next ~21 days**. Weeks 4–52 of the displayed year have **no task rows yet** (unmaterialized), so those cells are legitimately empty.

Chain: `CalendarYearView` renders density from `DayBucketCount[]` (verified) ← `getConsigneeTaskCountByDayBucket` over the full year (verified, no clamp) ← `tasks` rows, which exist only within the 21-day materialization horizon (verified). Therefore an empty/sparse grid ⟹ few materialized rows ⟹ **sparse data**, NOT a renderer placeholder or a fetch gap. R10's premise is a misdiagnosis; the feature is shipped. **R10 closed.**

## Latent UX observation — deferred Phase-2/3 candidate, NOT an open R-item

A legitimately-sparse year (mostly empty because tasks aren't materialized that far out) **reads to an operator as "broken."** The year view does not visually distinguish *"no data because not materialized yet"* from *"no deliveries."* This is a real UX gap but it is **not** R10 (closed) and **not** a renderer/fetch bug — it is a **deferred Phase-2/3 candidate** (e.g., a visual cue for the unmaterialized horizon boundary, or an empty-state caption like "deliveries beyond ~3 weeks are scheduled but not yet generated"). Filed here as an observation only; **not** added as a new R-item.

## Meta

Filed Day-52 (2026-06-10) as a T1 docs closure, grounded against main `c552946`. Closes R10 from the calendar-management lane. The Day-33 diagnostic R10 ruling (`build the heatmap properly`) stands in the historical record; this memo is the superseding closure per the append-only / supersede-in-newer-record discipline.
