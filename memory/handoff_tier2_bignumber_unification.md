---
name: Tier-2 big-number unification (H1 / 4b) — cross-lane handoff
description: The Tier-2 big-number (hero-metric) unification has no in-lane code change for Session B — the /tasks and /consignees heroes already use the canonical recipe. The sole 4b divergence is subscriptions/page.tsx (Session A's lane). Routes the exact one-line fix and parks for Love's routing call rather than touching another session's module.
type: reference
---

# Tier-2 big-number unification — cross-lane handoff (parks)

**Status:** parked `needs-directional-ruling`. Filed instead of a code PR
because, on inspection, **there is no in-lane code change for Session B.**

## What "big-number unification" actually resolves to

The held Tier-2 sequence named "big-number unification" = audit items **4b**
(hero-numeral size divergence) + **H1** (hero-metric treatment). On grounding
against the live tree:

- The canonical hero-count recipe — `font-serif text-5xl font-light
  tabular-nums leading-none` — is **already used consistently** by:
  `/tasks` (`tasks/page.tsx:139`, Session B), `/consignees`
  (`consignees/page.tsx:98`), and ~8 admin pages
  (`admin/tasks`, `admin/regions`, `admin/consignees`, `admin/merchants`,
  `admin/failed-pushes` + `/resolved`, `admin/webhook-config`).
- **The sole divergence (4b)** is `subscriptions/page.tsx:101`, which uses
  **`text-7xl`** instead of `text-5xl` — the lone outlier.
- The consolidated `/calendar` page has **no** hero-count strip at all (it's a
  calendar grid), so H1's "cards vs strip" framing has no in-Session-B surface.

**Conclusion:** Session B's own surfaces already conform. The one concrete fix
is a single className change in `subscriptions/page.tsx` — which is **Session
A's lane** ("subscriptions" territory). The broader `<HeroCount>` component
extraction is the audit's **separate Tier-2 #5** item, explicitly marked
"worth doing once the IA settles" — i.e. deferred, not this.

## The exact fix (for whoever owns the edit)

In `src/app/(app)/subscriptions/page.tsx:101`:

```diff
- <p className="mt-4 font-serif text-7xl font-light tabular-nums leading-none">
+ <p className="mt-4 font-serif text-5xl font-light tabular-nums leading-none">
```

One line, cosmetic, no behaviour change, no data path. It is **not** the
subscriptions "resume path" (the named Session-A do-not-touch) — it's the
list-page hero numeral. But it is in Session A's module, so per lane
discipline Session B did not make it.

## Why this parks instead of Session B doing it

Touching another session's lane autonomously is exactly what the three-pair
do-not-touch rule + the worktree-isolation discipline exist to prevent (merge
conflict = build risk = Love-trigger #1). "Fewer-clean beats all-rushed":
better to route a pinned one-liner than to reach across a lane for a cosmetic.

## Directional question for Love (one-liner)

Route the 4b one-liner:
1. **Hand to Session A** (recommended) — it rides their next subscriptions
   touch / their EOD picks it up; or
2. **Authorize a Session-B cross-lane exception** for this single cosmetic line
   (I'll open the one-line PR); or
3. **Defer** to the Tier-2 #5 `<HeroCount>` component extraction (do it once,
   everywhere, when the IA settles).

## Cross-references
- `memory/uiux_audit_day53.md` — 4b (line ~136), H1 (line ~143/169), Tier-2 #5
  component extraction (line ~172).
- `memory/decision_d53_tier2_pre_uat_ruling.md` — the Tier-2 build ruling.
- Companion this wave: H4 token refactor + /tasks polish parked at PR #435.
