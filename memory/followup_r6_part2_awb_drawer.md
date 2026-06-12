---
name: R6-part-2 — AWB→TaskTimelineDrawer entry point + R6.3 partial-state banner
description: Split out of R6 (Love-ruled Day-53, Ruling 3). The /tasks AWB-cell → TaskTimelineDrawer cross-surface entry point and the R6.3 null-AWB partial-state banner are BLOCKED on Session C's shared relocation of the drawer + getTaskTimelineAction out of consignees/[id]/** (Session C's lane). R6-part-1 (data layer + table) ships without them.
type: reference
---

# R6-part-2 — AWB→drawer entry point + R6.3 banner (blocked on Session C)

**Filed:** Day-53 (2026-06-11) per Love's Ruling 3 — "drawer relocation belongs
to Session C's lane … the AWB→drawer entry point + R6.3 partial-state banner
SPLIT OUT as R6-part-2, blocked on C's shared relocation."

## What R6-part-2 is

From the Day-33 R6 spec + the Day-53 column amendment:
- **AWB→drawer entry point:** the `/tasks` AWB cell becomes a click target that
  opens the **same** TaskTimelineDrawer the consignee calendar uses (Action 8) —
  a second entry point to the canonical task state-transition history. Populated
  and null-AWB tasks both open it.
- **R6.3 partial-state banner:** for a null-AWB task, the drawer renders a banner
  at the top — verbatim ruled copy: *"Task not yet pushed to SuiteFleet — AWB
  will be assigned once dispatch completes."* — and SF-dependent fields (driver,
  dispatched-at, POD, …) render as not-yet-available.

## Why it's blocked

Both the drawer and its server action live in **Session C's lane**:
- `src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx`
- `src/app/(app)/consignees/[id]/_calendar-actions.ts` → `getTaskTimelineAction`

Reusing the drawer cleanly from `/tasks` needs the action (and ideally the
drawer) **relocated to a shared location** (server actions are framework-portable;
the relative import `../_calendar-actions` couples it to `consignees/[id]/`).
Adding the R6.3 banner is a **modification of the drawer** itself. Both touch
`src/app/(app)/consignees/[id]/**`, which Session B must not touch (Session C's
in-flight lane). Per Love's Ruling 3, the relocation is **Session C's** to do.

## Unblock condition

When Session C relocates `getTaskTimelineAction` (and, if it chooses, the drawer)
to a shared location, R6-part-2 becomes a `/tasks`-side build (Session B's lane):
wire the AWB cell to open the shared drawer, and add the R6.3 banner via the
shared drawer's partial-state path. No migration. No new SF wire.

## Cross-references

- `memory/diagnostic_calendar_management_full_surface_enumeration.md` — R6 spec
  (R6.3 banner copy) + the Day-53 column amendment + part-1/part-2 split.
- R6-part-1 (this dispatch): data layer + table, parks for Love.
- Session C lane: `src/app/(app)/consignees/[id]/**` (the drawer + action).

## UNBLOCKED — relocation shipped (Day-53 EVE, Session C) and MERGED (Day-54 overnight)

PR **#421** relocates the drawer + both server actions to `src/components/task-timeline/` (`TaskTimelineDrawer.tsx` + `actions.ts` — `getTaskTimelineAction`, `getTaskHistoryAction`, result types; verbatim move, zero behavior change, reviewer APPROVE r1). **MERGED `2f1d712` on Love's recorded clearance (Day-54 overnight dispatch).** R6-part-2 is now buildable: import from `@/components/task-timeline/*`, entirely in Session B's lane — no remaining blocker.
