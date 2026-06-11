---
name: Click-reduction plan — /tasks filter-stack collapse
description: PLAN (parked for Love's directional ruling). The /tasks page stacks four filter blocks vertically, pushing the table below the fold; this proposes collapsing them into one compact filter row. Session B's lane, but gated behind R6-part-1 landing (same-file collisions in client.tsx/page.tsx).
type: reference
---

# Click-reduction plan (b) — /tasks filter-stack collapse

**Status:** PLAN ONLY. Parked `needs-directional-ruling` for Love's one-liner.
No code in this PR. Build (when ruled) is **Session B's lane**
(`src/app/(app)/tasks/page.tsx`), but **gated behind R6-part-1 (#427)
landing** — both touch the same page header, so building it now would collide.

## The problem in plain English

The `/tasks` page header stacks **four separate filter blocks**, top to bottom:

1. **Status pills** row (All · Created · Pushed · Delivered · …)
2. The **big count + page-size** band
3. The **date-range** filter (From / To)
4. The **search** box

Each is full-width and stacked, so the operator scrolls through a tall stack of
controls before the actual task table starts — on a laptop the table often opens
below the fold. The filters are fine individually; the cost is that they're
spread over four rows.

## Proposed change

Collapse the four blocks into **one compact filter bar** on a single row:

- **Search** (left, the most-used control)
- **Status** (as a compact dropdown or a tighter pill row)
- **Date range** (right)
- **Count** rendered inline (small), with the page-size control tucked beside it

Same filters, same behaviour, same URL state — just de-stacked so the table sits
near the top of the page. No filter is removed.

## Run-sheet steps it touches + re-script note

Only **flow D (POD photo view)** uses `/tasks` filters — "set the status filter
to **Delivered** and the date range to cover **May 2026**." The actions are
unchanged; they'd just point at the new compact bar. Re-script is a wording
refresh of step D's filter instructions — **no step added or removed**. No other
run-sheet flow touches `/tasks` filters (the rest are consignee-calendar).

## Recommendation

**Single compact filter row** — search left, status center, date-range right,
count + page-size inline. Keep all four filters (none are redundant for the POD
and ops-triage flows). The big number band can shrink to an inline count rather
than its own full-width section.

## Directional question for Love

1. Approve collapsing the four stacked filter blocks into **one compact row**?
2. Keep all four filters, or drop any (e.g. the page-size dropdown, or the big
   count band) to save vertical space?
3. Status as a **dropdown** or keep the **pill row** (just tightened)?

## Cross-references
- `src/app/(app)/tasks/page.tsx` — current stacked header (StatusFilterBar,
  count band, DateRangeFilter, SearchBar).
- `memory/uat_run_sheet_v1.md` — flow D is the only step touching these filters.
- Sequencing: builds **after** R6-part-1 (#427) merges (shared page header).
