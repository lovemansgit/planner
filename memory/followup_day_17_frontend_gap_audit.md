---
name: Day-17 frontend gap audit — calendar view absent + tasks page enhancements
description: Surfaced by Love at ~1 PM Dubai Day 17 during hotfix waiting period. Three substantive items: per-consignee calendar view (brief §3.3.3, demo-load-bearing, absent), tasks page page-size dropdown (operator UX), tasks page select-all-across-pages (demo-significant for label workflow). Filed for scope sequencing across remaining Day 17–18 runway.
type: project
---

# Day-17 frontend gap audit

**Surfaced:** Day 17, ~1 PM Dubai, by Love during hotfix counter-review pause.

## §1 Item 1 — per-consignee calendar view (CRITICAL, MVP, absent)

**Brief reference:** §3.3.3 Consignee detail page with calendar
**Status:** completely absent
**Demo significance:** Section 4 of demo narrative arc (5 minutes) — calendar workflow is the headline operator surface
**Reference UX:** subplanner.vercel.app/consignee/c_001

Required surface (per brief §3.3.3):
- Header card (consignee identity, primary phone, addresses, plan summary, CRM state badge)
- Week / Month / Year calendar toggle
- Click-into-day popover with action buttons:
  - Skip with default rules
  - Skip with target_date_override
  - Skip without append
  - Pause subscription
  - Address change (one-off / forward)
  - Cancel delivery
- All popover actions permission-gated per brief §3.3.10
- Year view: density heat-map style for long subscriptions

**Today's CRM PR (#163 plan, impl pending) scope clarification:**
- Builds detail page scaffolding (header card + tabs: Overview + History)
- Ships CRM state badge + transition workflow on Overview tab
- Does NOT ship the calendar view (separate workstream)

**Implication:** calendar view is its own T2 PR. Probably 2-3 hrs implementation given existing service-layer fns are operational from PR #160 (skip / pause / resume / address-rotation / address-override all live).

**Sequencing options for remaining Day 17–18 runway:**
- (a) Ship calendar view as Day-17 substantive #2 (after CRM impl, before address change workflows)
- (b) Ship calendar view as Day-18 morning first work (highest-priority demo-load-bearing surface)
- (c) Ship calendar view minimally (week view + skip/pause action buttons only) on Day 17, expand to month/year + full popover Day 18

Reviewer to rule on sequencing after CRM impl + smoke retest land.

## §2 Item 2 — tasks page page-size dropdown

**Surface:** /tasks operator page
**Current behavior:** 50 tasks per page; 400 total tasks → 8 pages
**Operator pain:** scrolling 8 pages to review today's deliveries is friction
**Requested behavior:** dropdown with options: 100, 300, 500 tasks per page

**Implementation surface estimate:** small (1-2 hrs)
- URL query param ?perPage= alongside existing ?page= and ?status=
- Page size validation at route handler (clamp to allowed values)
- Dropdown UI in tasks page header next to existing filters
- Default stays 50 to avoid breaking existing operator muscle memory

**Demo significance:** medium. Operator confidence; helps with "I can review my full day at a glance" framing.

## §3 Item 3 — tasks page select-all-across-pages

**Current behavior:** select-all checkbox at top of tasks table only selects rows on the currently-rendered page
**Operator pain:** to print labels for all 400 tasks, operator must page through 8 pages, select-all on each, click Print Labels each time → 8 round-trips
**Requested behavior:** select-all-across-pages option

**Critical complication — `PRINT_LABELS_MAX_TASKS_PER_REQUEST = 100` cap:**

Per `src/app/api/tasks/labels/route.ts:54-55`, current cap is 100 task IDs per label request. Select-all across 400 → 400 IDs would exceed cap.

Three resolution paths:
- (a) Raise cap to 500 (matches Item 2's max page size). Requires probing SF label endpoint to confirm SF accepts CSV with 500 task IDs in single GET. URL length is the practical constraint — 500 UUIDs in CSV is ~18,500 chars; well under typical URL limits but should be tested.
- (b) UI batches 400-task selection into 4 × 100 round-trips behind the scenes; presents to operator as one Print Labels click, returns merged PDF (server-side concat of 4 SF responses).
- (c) UI surfaces cap warning when selection exceeds 100: "Selected 400 tasks; max 100 per print job. Print first 100?" — cleanest, lowest implementation cost, acknowledges SF constraint.

**Reviewer recommendation:** investigate (a) first; if SF accepts 500-CSV cleanly, raise cap to 500 and Items 2+3 unblock cleanly. If SF rejects/throttles 500-CSV, fall back to (b) or (c). Decision deferred to implementation pre-flight.

**Demo significance:** HIGH. The label-print workflow is the L4 demo moment. Constrained 50/100 max cap reads as MVP-rough on demo day. Select-all-across-pages with appropriate cap-handling reads enterprise-grade.

## §4 Sequencing impact on Day 17–18 plan

Adds three workstreams to the runway:

| Item | T2 estimate | Where |
|---|---|---|
| Calendar view | 2-3 hrs | Day 17 PM or Day 18 AM |
| Tasks page dropdown | 1-2 hrs | Day 17 PM or Day 18 AM |
| Select-all-across-pages + cap resolution | 1-2 hrs | Day 17 PM or Day 18 AM |

Currently planned remaining Day 17 work:
- Hotfix PR (in flight)
- L4 plan PR
- L4 implementation PR
- CRM state change implementation PR
- EOD batched promotion + EOD doc

Currently planned Day 18:
- Address change workflows
- Consignee timeline view
- Per-task delivery status timeline
- Brand pass on per-page surfaces
- Demo data prep + demo-preflight.sh

**With three new items added:** Day 17 PM is overcommitted. Day 18 absorbs the overflow.

Reviewer recommendation pending after hotfix retest:
- Calendar view → Day 18 AM headline (highest demo-criticality)
- Page-size dropdown + select-all → Day 18 AM second slot, behind calendar view
- Day 17 PM stays at hotfix → L4 → CRM → EOD as currently planned

## §5 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §3.3.3 (consignee calendar)
- `memory/PLANNER_PRODUCT_BRIEF.md` §5.1 (demo narrative arc Section 4)
- `memory/plans/day-17-crm-state-ui.md` (Option A detail page scaffolding)
- `src/app/api/tasks/labels/route.ts` (`PRINT_LABELS_MAX_TASKS_PER_REQUEST = 100`)
- `src/modules/integration/providers/suitefleet/label-client.ts` (SF label endpoint surface)
- subplanner.vercel.app/consignee/c_001 (reference UX from Day-1)
