---
name: Session B firing-2 EOD — Day-54 (rollout merged + Button extracted + rollout closed)
description: Closing state of Session B's second Day-54 firing. #462/#465/#467 merged; #473 (<Button> + DLQ swap) filed parked-t2; #466 held for a product call; remaining rollout items resolved in-lane (StatusBadge kept, no failed-pushes pill badges) or deferred to C's R-A. Feeds Session A's EOD.
type: reference
---

# Session B firing-2 EOD — Day-54 (component-library rollout closed)

Closing state of the second Day-54 firing (clearances + rollout completion).
Feeds Session A's EOD per the one-EOD-owner rule.

## Landed on main (admin route, Love's named clearances)
- **#462 — popover dialog badges → `<Badge size="sm">`** → **`a5a34d5`** (ordering-first).
- **#465 — /tasks failed-push badge → `<Badge>`** (visible tidy) → **`74510f3`**.
- **#467 — failed-pushes admin heroes → `<HeroCount>`** → **`a0ace07`**.
- Rebase note posted on **C's #464 (R-A plan)**: R-A rebases on #462's landed
  dialog-badge swap; trigger-side `text-[8px]` micro-badges left for R-A.

## Filed + PARKED
- **#473 — extract `<Button>` + swap failed-pushes DLQ buttons** — `parked-t2`.
  New prominent-action `<Button>` (outline md/sm × strong/default + filled-navy
  primary), recipe in node-tested `button-recipe.ts` (locks 4 combos). Five DLQ
  buttons swapped **zero-change**. Distinct from `<OutlineButton>` (small inline).
  Reviewer: _in flight at handoff time — see PR._
- **#466 — subscriptions hero → `<HeroCount>`** — still `parked-t2`, **HELD for a
  product call** (not cleared this firing). The one-question framing is in the
  firing-2 report; stays parked until Love's answer rides a future firing.

## Rollout remainder — resolved in-lane (dispatch step 3)
Design-system calls made with the reviewer; pure styling, no operator-visible
meaning change → no Love question raised:
- **subscriptions `StatusBadge` → KEEP.** It's a distinct *dot + coloured text*
  status **indicator**, not a drifted pill badge. Converting to the filled-pill
  `<Badge>` would fail the zero-change bar and change the page's visual language
  for no clear gain. Left as-is. (Future option: if the dot+text pattern proves
  duplicated across Session-A detail pages, extract a `StatusDot` primitive —
  not chased here.)
- **failed-pushes pill badges → none exist.** The only "badge" in the DLQ client
  (`ResultBadge`) is a `<p className="text-xs text-green|red">` result line, not
  a pill — nothing to unify.
- **popover trigger `text-[8px]` micro-badges → deferred to C's R-A** (noted on
  #464; built nothing there).

## Still open as rollout candidates (not started)
- Shared **CTA-Link** primitive for the filled "New subscription" / "Onboard"
  anchors (they're `<a>`/Link, not `<button>` — a separate primitive from
  `<Button>`). Cross-lane (Session A + consignees); flagged, not built.

## Environment / fences
- Reviewers all dispatched **isolated** (`isolation: worktree`) after the
  firing-1 in-tree-reviewer HEAD-detach incident ([[feedback_reviewer_subagent_must_be_isolated]]).
- Fences held: no migrations, no spend, no push/webhook **modules** (failed-pushes
  touched only as presentational hero band + button shells).

## Cross-references
- `memory/uiux_audit_day53.md` — findings 2 (button drift) / 3 (badge drift) / H1.
- `memory/PARKED-QUEUE.md` — regenerated.
