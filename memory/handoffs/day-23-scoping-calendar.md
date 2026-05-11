---
name: Day-23 /calendar consolidated view scoping memo
description: T1 scoping memo for the Day-23 lane shipping the `/calendar` consolidated cross-consignee merchant calendar per brief §3.3.4. Inventories existing infrastructure vs net-new scope, estimates effort, suggests sub-PR sequencing, and surfaces open questions for reviewer.
type: project
---

# Day-23 /calendar consolidated view — scoping memo

**Branch:** `day23/scoping-calendar-memo` from `main` HEAD `97e647d`
**Filed:** Day 22 PM (read-only diagnostic + memo; no feature code)
**Lane:** `/calendar` cross-consignee aggregate calendar per brief §3.3.4

---

## §1 Brief §3.3.4 spec verbatim

Reproduced verbatim from `memory/PLANNER_PRODUCT_BRIEF.md:512-528`:

> #### 3.3.4 Consolidated merchant calendar (`/calendar`)
>
> Per BRD §6.4. Cross-consignee aggregate view for Operations Manager workflow.
>
> **Header:**
> - Merchant name + today's date
> - Five metric cards: Active consignees, Today's deliveries, Delivered (today), Out for delivery, Failed/at-risk
> - Filter bar: search by consignee name/phone, CRM state dropdown, area/district dropdown, time window dropdown, task status dropdown
>
> **Calendar grid:**
> - Week view default; Month and Day views available
> - Each day cell shows aggregate counts (e.g., "127 deliveries scheduled")
> - Click day → list of all tasks that day, grouped or filterable
> - Drill-down from any task → consignee detail calendar
> - High-risk deliveries highlighted (failed attempts, high-risk consignees, missing addresses per BRD §6.4)
>
> **Export to CSV** — Phase 2.

---

## §2 Existing infrastructure inventory

### §2.1 Aggregate-task service surface — PARTIAL

| Surface | State | Citation |
|---|---|---|
| `getConsigneeTaskCountByDayBucket(ctx, consigneeId, startDate, endDate)` | ✓ exists | [src/modules/tasks/service.ts:649](../../src/modules/tasks/service.ts#L649) — single-consignee day-bucket aggregator, gated on `task:read`. Used by `CalendarYearView` per Day-21 PR #230. |
| `listAllTasks` (cross-tenant) | ✓ exists, systemOnly | [src/modules/tasks/service.ts:590](../../src/modules/tasks/service.ts#L590) — Day-19 / Phase 1.5 cross-tenant admin read; requires `task:read_all` (systemOnly). NOT for tenant-operator `/calendar`. |
| `listTasks(ctx, opts)` — tenant-scoped paginated list | ✓ exists | Used by `/tasks` list page. Filters: status. Day-23 needs additional filters (date range, consignee subset). |
| `countTasks(ctx, opts)` | ✓ exists | [service.ts:673](../../src/modules/tasks/service.ts#L673) — total-count for `/tasks` pagination. |
| Cross-consignee day-bucket aggregator (`countTasksByDayAcrossConsignees(ctx, startDate, endDate)`) | ✗ **DOES NOT EXIST** | No tenant-scoped fn that returns `Map<isoDate, count>` across all consignees in the tenant. |
| Today's metrics by status (`getTodayMetrics(ctx)` → `{deliveredToday, outForDelivery, failedAtRisk, todayTotal, activeConsignees}`) | ✗ **DOES NOT EXIST** | No fn that returns the 5-card metric snapshot in one round-trip. |

### §2.2 Metric-card UI components — NONE

`grep -rn "MetricCard\|StatCard\|KpiCard\|CountCard\|HeroNumeral\|StatRow" src/` returns **zero matches**. The only metric-row precedent is the consignee detail header's "Delivered / Scheduled / Skipped / Appended / Failed" summary stat row (brief §3.3.3 line 481), rendered inline in [src/app/(app)/consignees/[id]/page.tsx](../../src/app/(app)/consignees/[id]/page.tsx) — not extracted into a reusable component.

**Implication:** Day-23 needs a net-new `MetricCard` primitive (or inline 5 cards directly in `/calendar/page.tsx` — TBD per §4 effort discussion).

### §2.3 Filter-bar pattern — URL-state precedent exists; search field NET-NEW

The `/tasks` list page uses **URL state for filters**:

> [src/app/(app)/tasks/page.tsx:8-9](../../src/app/(app)/tasks/page.tsx#L8-L9):
> *"Filter status + page index are URL state (`?status=…&page=…`) so the operator can share / bookmark a specific filtered view; pagination + filter mutations re-render the server component."*

Current filters on main HEAD `97e647d`: `status` only. The filter UI is a horizontal `<StatusFilterBar>` of `<Link href="?status=…">` pills.

**PR #238 (OPEN, not yet merged)** adds `?q=` search-by-consignee-name/phone — directly applicable to brief §3.3.4 filter-bar requirement. Day-23 should:
- Wait for #238 merge OR rebase onto #238 for shared filter pattern
- Mirror the URL-state convention (`?week=YYYY-MM-DD&q=…&crm=…&district=…&window=…&status=…`)
- Extract a shared filter component if 4+ filters render the same way (debatable — see §6)

### §2.4 CrmStateBadge + state-set surface — REUSABLE

[src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx](../../src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx) exports `CrmStateBadge` + `CRM_STATE_LABELS`. State set per `ConsigneeCrmState` ([consignees/types.ts:29-35](../../src/modules/consignees/types.ts#L29-L35)):

```
ACTIVE | ON_HOLD | HIGH_RISK | INACTIVE | CHURNED | SUBSCRIPTION_ENDED
```

`HIGH_RISK` carries red border/bg/text per brand state-semantic palette. Day-23 row-level "High-risk delivery highlight" (per brief §3.3.4 line 526) can:
- Reuse `CrmStateBadge` for consignee row badge surface
- Apply parallel row-tinting via `bg-red/[0.04]` (existing precedent at [consignees/[id]/page.tsx:211](../../src/app/(app)/consignees/[id]/page.tsx#L211) — HIGH_RISK header bg)
- NO new badge primitive needed

### §2.5 Cron-materialized task data — CONFIRMED 14-day horizon

`materializeTenant` (daily cron at [src/app/api/cron/generate-tasks/route.ts](../../src/app/api/cron/generate-tasks/route.ts)) materializes tasks across a **rolling 14-day horizon** per [task-materialization/cte-builder.ts:65](../../src/modules/task-materialization/cte-builder.ts#L65). Tasks for today + the next ~14 days are already in the `tasks` table by the time `/calendar` reads them — **no live-compute needed**. Day-23 reads the pre-materialized rows; no architectural new surface for materialization.

### §2.6 CRM state filter surface — EXISTS via existing `consignees.crm_state` column

Listing consignees by `crm_state` is supported in the existing repository (used by consignees list page). For `/calendar`'s CRM-state filter dropdown, the surface is:
- Filter task rows by their consignee's CRM state via a JOIN (`tasks.consignee_id = consignees.id` + `consignees.crm_state IN (…)`)
- New repo fn likely needed: `listTasksByCrmStateFilter` OR extend `listTasksByTenant` with optional `crmStateIn` filter
- Per §3.3.10 UI rule 1, the CRM-state filter dropdown only renders if the actor has `consignee:read` (required to know which consignees match the state) — `task:read` alone is insufficient

### §2.7 Permission gates — NO NEW PERMS NEEDED

- `task:read` ✓ — held by Tenant Admin (TENANT_SCOPED), Ops Manager (`permsFor("task")`), CS Agent (explicit list at [roles.ts:138](../../src/modules/identity/roles.ts#L138))
- `consignee:read` ✓ — held by all three tenant-side roles (filter dropdown needs this for CRM-state + district lookup)
- `task:read_all` (cross-tenant) — NOT used here; `/calendar` is tenant-scoped

**No new perm catalogue additions.** Brief §3.3.4 explicitly frames the surface as "Cross-consignee aggregate view for Operations Manager workflow" — Ops Manager already holds the necessary perms.

### §2.8 Drill-down precedents — REUSABLE

- "Click day → list of all tasks that day" — pattern matches existing `/tasks?status=…` URL-state filter. Day-23's day-click can route to `/tasks?date=YYYY-MM-DD&...` if `/tasks` accepts a date filter (it does NOT today; minor extension needed).
- "Drill-down from any task → consignee detail calendar" — existing route `/consignees/[id]?tab=calendar&week=…` works as-is. Day-23 task rows link to that route.

---

## §3 Net-new scope

### §3.1 Service-layer additions (~M)

- `countTasksByDayAcrossConsignees(ctx, startDate, endDate, filters?) → Map<isoDate, number>` — cross-consignee day-bucket aggregator. Roughly mirrors `getConsigneeTaskCountByDayBucket` SQL shape but drops the `consignee_id = ?` predicate.
- `getCalendarMetrics(ctx, asOf: isoDate) → CalendarMetrics` — returns the 5-card snapshot in one round-trip:
  - `activeConsignees: number` (count consignees WHERE crm_state IN ('ACTIVE'))
  - `todayDeliveriesScheduled: number` (count tasks WHERE delivery_date = asOf)
  - `deliveredToday: number` (count WHERE delivery_date = asOf AND internal_status = 'DELIVERED')
  - `outForDelivery: number` (count WHERE delivery_date = asOf AND internal_status IN ('OUT_FOR_DELIVERY', 'IN_TRANSIT', 'PICKED_UP'))
  - `failedAtRisk: number` (count WHERE internal_status = 'FAILED' OR consignee.crm_state = 'HIGH_RISK')
- Optional: `listTasksByCalendarFilters(ctx, filters)` — extended list fn for the day-click drill-down (accepts date + CRM state + district + time window + status + q filters in one shape)

### §3.2 Route + page composition (~M)

- `src/app/(app)/calendar/page.tsx` — server component
- `src/app/(app)/calendar/_components/MetricCard.tsx` — small reusable primitive (label + numeral + optional context line)
- `src/app/(app)/calendar/_components/CalendarFilterBar.tsx` — multi-filter row (5 filters per brief)
- `src/app/(app)/calendar/_components/ConsolidatedWeekView.tsx` — week-grid with aggregate counts per cell
- `src/app/(app)/calendar/_components/ConsolidatedMonthView.tsx` — same shape, month grid
- `src/app/(app)/calendar/_components/ConsolidatedDayView.tsx` — day-detail list (drill-down target)
- `src/app/(app)/calendar/_components/CalendarViewToggle.tsx` — week/month/day pill nav (mirrors existing CalendarViewToggle from PR-A2)

### §3.3 Repo additions (~S)

- `countTasksByTenantAndDayBucket` repo fn (consumed by `countTasksByDayAcrossConsignees`)
- `getCalendarMetricsRow` repo fn (consumed by `getCalendarMetrics`)
- Possibly extend `listTasksByTenant` with optional `crmStateIn` / `districtIn` / `dateEquals` filters

### §3.4 Tests (~M)

- Service-layer: `countTasksByDayAcrossConsignees` happy + perm-deny + tenant-scope
- Service-layer: `getCalendarMetrics` happy + perm-deny + edge-cases (zero-consignee tenant; all-failed day)
- UI: filter URL-state round-trip; metric card render; week-grid aggregate display; high-risk row highlight
- Permission catalogue: NO new perm tests (no new perms)

### §3.5 Brand-canon UI surface

Match PR #230 (PR-A2 calendar) + PR #237 (PR-B popover) precedent:
- Hairline 0.5px Stone 200 borders; never shadows; sentence case
- 120ms ease-out transitions on hover/focus
- Brand tokens at [src/styles/brand-tokens.css](../../src/styles/brand-tokens.css) — no inline hex / no inline rem
- Metric-card composition: eyebrow label (caps + 0.14em tracking) above large hero numeral (font-display, ~36px)
- High-risk row highlight: `bg-red/[0.04]` background tint (existing precedent at consignees detail page header)

---

## §4 Effort estimate per surface

| Surface | Effort | Notes |
|---|---|---|
| §3.1 service-layer (2 net-new fns + optional 3rd) | M — ~4-5 hr | Each fn ~1-1.5 hr including tests; metrics fn is largest (5 sub-queries or 1 unified UNION) |
| §3.2 page + 6 components (MetricCard + FilterBar + WeekView + MonthView + DayView + ViewToggle) | L — ~10-12 hr | Server component shell + week/month/day view dispatch + day-click drill-down + filter URL-state |
| §3.3 repo additions | S — ~2 hr | 2-3 SQL queries with tenant + filter predicates |
| §3.4 tests | M — ~4-5 hr | Service-layer + UI smoke + permission round-trip |
| Brand-canon polish + UX walk fixups | S-M — ~2-3 hr | Reviewer §3.6 + Love UX walk likely surface 1-2 fix-up cycles |
| **Aggregate** | **L-XL — ~22-27 hr** | ~2 calendar days at 12-14 hr/day |

**Comparable:** PR #230 (PR-A2 calendar — month + year + view-toggle + UXF5 v2) was ~14 hr. PR #237 (PR-B popover — 7 actions + drawer) was ~5-7 hr. Day-23 is bigger than either because it ships **all three views + all five filters + metric cards** in one surface.

---

## §5 Suggested sub-PR sequencing

### Option A — Single PR (recommended if Love is awake for a long Day-23 session)

One PR-C lands the full surface: service-layer + repo + page + 6 components + tests + brand pass. ~22-27 hr; T3 tier. Clean rollback boundary.

### Option B — Three sub-PRs by surface layer

- **PR-C1 (~6 hr):** Service-layer + repo + tests. Lands the backend; UI deferred. T2-T3.
- **PR-C2 (~12 hr):** Page + 5 components (MetricCard, FilterBar, WeekView, ViewToggle, MonthView). Consumes PR-C1 service fns. T3.
- **PR-C3 (~5 hr):** DayView drill-down + high-risk row highlight + UX-walk fix-ups. T2.

### Option C — Two sub-PRs by view depth

- **PR-C1 (~14 hr):** Service-layer + Week view + 5 metric cards + filter bar. Demo-essentials. T3.
- **PR-C2 (~10 hr):** Month + Day views + drill-down. Phase-2-adjacent but pre-pilot. T2-T3.

**Recommendation:** Option C if Day-23 lane is shared with Session A (then Session A takes one PR-C# and Session B takes the other). Otherwise Option A for a single-owner single-rollback-boundary lane.

---

## §6 Risks / open questions for reviewer

### §6.1 Open questions for Day-23 morning ruling

1. **Sub-PR scope** — single PR-C (Option A) vs two-PR split (Option C) vs three-PR layer split (Option B)? Recommendation: **Option C** (week-first + month-day-followup) if shared with Session A, else **Option A**.
2. **Day-23 PR ownership** — Session A vs Session B? (Session B owns the calendar lane Day-21 + 22; natural continuation. Session A may have other Day-23 scope per Day-22 PM bootstrap brief.)
3. **Filter-bar primitive extraction** — extract a shared `<CalendarFilterBar>` reusable across `/tasks` (when PR #238 lands its search field) AND `/calendar`? Or keep them parallel for now (DRY-by-precedent later)?
4. **Day-click drill-down target** — route to `/tasks?date=YYYY-MM-DD&…` (requires extending `/tasks` to accept a date filter) OR keep an in-page drawer? Brief §3.3.4 says "list of all tasks that day, grouped or filterable" — points to drawer-or-route ambiguity.
5. **Metric `failedAtRisk` composition** — brief says "Failed/at-risk" as one card. Should it count FAILED tasks (today) + HIGH_RISK consignees as a union, or be more nuanced (FAILED today + high-risk consignees with deliveries today)?
6. **Metric cards mobile/responsive shape** — 5 cards in a row works on desktop; mobile stacks vertically (5 tall cards = ~70vh). Acceptable for pilot operators on desktop; flag if Love wants tighter mobile composition.
7. **Year view absence** — brief §3.3.4 specifies "Week / Month / Day views available." Notably **no Year view** (Year is consignee-detail-only per brief §3.3.3 line 489 heat-map). Confirm Year view stays out of `/calendar` scope.

### §6.2 Architectural risks

- **Metric query performance** — 5 metric cards = potentially 5 round-trips OR 1 unified UNION. Latter is faster but harder to read. Recommendation: ship as 5 separate queries first; optimize to UNION post-pilot if measurable latency hit.
- **HIGH_RISK row highlight** — current consignee.crm_state column is the source of truth, but "failed attempts" + "missing addresses" per BRD §6.4 are task-state-driven. Joining all three signals at calendar-cell granularity needs careful predicate composition. Flag for §3.6 body-read.
- **Filter cardinality** — district dropdown could have 20-50 options for an active merchant; needs scrollable + searchable surface. Time-window dropdown is a fixed enum (Morning / Afternoon / Evening per brief §3.1 timing). Status dropdown is the TaskInternalStatus enum. CRM-state dropdown is the 6-state set.
- **Drill-down hydration cost** — opening a day-detail drawer with 50+ tasks could be heavy. May need pagination inside the drawer.

### §6.3 Coordination with PR #238 (in flight)

PR #238 ships `?q=` consignee name/phone search on `/tasks`. Day-23 should:
- Rebase the calendar branch onto post-#238 main (so the search primitive is available)
- Either extract a shared `<SearchField>` primitive OR mirror the pattern inline
- Reviewer ruling on shared-primitive extraction (see §6.1 OQ 3)

### §6.4 Demo-narrative alignment

Brief §5 demo-storyline cites `/calendar` as the **Operations Manager landing surface** for the May-15 CAIO demo. Demo-blocking criteria:
- All 5 metric cards render with non-zero numerals (data-prep flag — Sarah Khouri 2026 demo data must populate all five card categories)
- Week view default loads instantly (no spinner) — relies on cron-materialized data per §2.5
- High-risk row highlight visible for at least 1 consignee in demo dataset
- Day-click drill-down works end-to-end (week-grid → day-detail → task → consignee detail calendar)

### §6.5 What this memo does NOT cover

- /calendar export-to-CSV is Phase 2 per brief — out of scope.
- Mobile-first detailed responsive composition — defer to UX walk feedback.
- Per-week column-header polish (today highlight already established in PR-A2 precedent).
- Service-layer tier ruling — likely T3 per perm + service-layer + audit surface; Love rules at lane open.

---

**End of memo. Diagnostic-only; no feature code touched.** Day-23 lane open requires Love's morning rulings on §6.1 OQs 1-7 before substantive code work begins.
