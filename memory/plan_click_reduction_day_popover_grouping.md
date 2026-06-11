---
name: Click-reduction plan — calendar day-popover 8-action grouping
description: PLAN (parked for Love's directional ruling). The consignee calendar's per-delivery popover lists 8 flat actions; this proposes grouping them into 3 always-visible sections to cut scan cost without adding a click. Touches Session C's lane at build time.
type: reference
---

# Click-reduction plan (a) — day-popover action grouping

**Status:** PLAN ONLY. Parked `needs-directional-ruling` for Love's one-liner.
No code in this PR. Build (when ruled) lands in Session C's lane
(`src/app/(app)/consignees/[id]/**`) — coordinate at build time.

## The problem in plain English

When an operator clicks a delivery on a consignee's calendar, a panel opens
showing Status / Window / Task ID and then **eight flat action buttons**:

1. View task timeline
2. Add note to driver
3. Change address (this delivery only)
4. Change address (from this delivery onwards)
5. Pause from this date
6. Skip this delivery
7. Skip with override
8. Add ad-hoc task

Eight equal-weight buttons is a scan-and-hunt every time — the operator reads
all eight to find the one they want. Nothing groups "look at it" vs "edit it"
vs "reschedule it."

## Proposed change

Keep all eight actions; group them under **three always-visible section
headers** (no collapsing, no submenus):

- **View** — View task timeline
- **Edit delivery** — Add note to driver · Change address (this delivery) ·
  Change address (forward)
- **Reschedule** — Pause from this date · Skip this delivery · Skip with
  override · Add ad-hoc task

Because the sections are always expanded, **no action gains a click** — the
operator's eye lands on the right group first, then the button. It's a scan
win, not a navigation cost.

## Run-sheet steps it touches + re-script note

Every action launched from this popover is a run-sheet step:
**C** (View task timeline), **E** (Add note), **F** (address one-off),
**G** (address forward), **H** (pause), **I** (skip), **J** (skip with
override). Each step's "→ [action]" line keeps the **same click count** under
the always-expanded variant; the only re-script is wording — "in the **Edit
delivery** group, click **Change address (this delivery only)**" instead of a
bare button name. No steps added or removed.

(If Love instead prefers *collapsed* groups — one click to open a group, one to
pick — then steps C/E/F/G/H/I/J each gain one click; the re-script would add
that intermediate click. Recommendation below avoids this.)

## Recommendation

**Always-visible grouped sections** (View / Edit delivery / Reschedule), not
collapsed menus. It cuts the eight-button scan to a three-group glance and
keeps every action one click away.

## Directional question for Love

1. Approve grouping the eight actions into **View / Edit delivery /
   Reschedule** as always-visible sections?
2. Or a different grouping / different labels?
3. Always-visible (recommended) or collapsed groups?

## Cross-references
- `memory/diagnostic_calendar_management_full_surface_enumeration.md` — the
  full day-popover action surface.
- `memory/uat_run_sheet_v1.md` — flows C, E, F, G, H, I, J launch from here.
