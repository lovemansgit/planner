---
name: decision_d54_component_library_closeout
description: Tier-2 #5 component-library rollout is COMPLETE — primitives + per-lane adoptions all shipped; two recorded deferrals; lane idles pending assembly
metadata:
  type: project
---

# Tier-2 #5 — component-library rollout CLOSE-OUT (Day-54)

The shared-component-library rollout (UI/UX audit Tier-2 #5, findings 2/3/H1)
is **complete and on main**. This memo records what shipped, the deferrals, and
that nothing is pending. The lane now idles pending final assembly.

## Primitives shipped (one source of truth each)
- **`<HeroCount>`** — the list-page big-count strip (#455, `8994066`).
- **`<Badge>`** pill shell + **`<OutlineButton>`** small inline button (#458,
  `63dbd46`); `<Badge>` later gained a `size` variant with the recipe locked in
  node-tested `badge-recipe.ts` (#462, `a5a34d5`).
- **`<Button>`** prominent page-action button (outline md/sm × strong/default +
  filled-navy primary), recipe locked in node-tested `button-recipe.ts` (#473,
  `f8e7296`).

## Adoptions shipped (per lane, zero-change unless noted)
- `/tasks` + `/consignees` hero → `<HeroCount>` (#455).
- `/tasks` status pill + Cancel/Edit → `<Badge>` / `<OutlineButton>` (#458).
- `/tasks` failed-push badge → `<Badge>` — **visible tidy** (off-recipe
  `text-[10px]` → standard `text-xs`), finding 3 (#465, `74510f3`).
- **subscriptions** hero → `<HeroCount>` — **structural** unification, H1/4b;
  Love-cleared as a product call (#466, `083511d`).
- failed-pushes admin heroes (unresolved + resolved) → `<HeroCount>` (#467,
  `a0ace07`).
- DayActionPopover **dialog** badges → `<Badge size="sm">`, zero-change (#462).
- failed-pushes DLQ buttons (5) → `<Button>`, zero-change (#473).

## Recorded deferrals (accepted — NOT pending work)
1. **subscriptions `StatusBadge` — kept as-is.** It's a distinct *dot + coloured
   text* status **indicator**, not a drifted pill badge; converting to a pill
   fails the zero-change bar and shifts the page's visual language for no gain.
   Love accepted the deferral with the #466 clearance.
2. **DayActionPopover trigger-side `text-[8px]` micro-badges → Session C's R-A.**
   The calendar-cell trigger surface is R-A's redesign territory; the rebase note
   is on **#464**. Session B built nothing there.

## Open candidate (not started, no owner assigned)
- A shared **CTA-Link** primitive for the filled "New subscription" / "Onboard"
  anchors (they're `<a>`/Link, a separate primitive from `<Button>`). Cross-lane
  (Session A + consignees). Flagged only; not in this rollout's scope.

## State
- **Nothing pending** in the component-library lane.
- Lane **idles pending assembly** — no new scope.
- See [[feedback_reviewer_subagent_must_be_isolated]] for the firing-1 incident
  lesson (reviewers now always `isolation: worktree`).

## Cross-references
- `memory/uiux_audit_day53.md` — Tier-2 #5 + findings 2/3/H1.
- `memory/handoffs/day-54-session-b-firing2-eod.md` — firing-2 EOD detail.
