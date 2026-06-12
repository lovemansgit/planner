---
name: Big-number unification (4b) deferred to the <HeroCount> extraction (Tier-2 #5)
description: Love's overnight ruling — the lone hero-numeral divergence (subscriptions text-7xl vs the canonical text-5xl) does NOT get a standalone fix; it rides the future shared <HeroCount> component extraction (audit Tier-2 #5, "once IA settles"). Records the pinned one-line fix and closes #437.
type: reference
---

# Big-number unification (4b) → rides the <HeroCount> extraction

**Love's ruling (verbatim, overnight 2026-06-11):**

> #437: defer to the <HeroCount> extraction — record and close.

## What this settles

The Tier-2 "big-number unification" (audit items 4b + H1) has **no in-lane
Session-B code change**: `/tasks` and `/consignees` hero counts already use the
canonical `font-serif text-5xl font-light tabular-nums leading-none`, as do ~8
admin pages. The **sole divergence (4b)** is the subscriptions list-page hero,
which uses `text-7xl`.

Per Love's ruling, that one outlier is **not** fixed as a standalone one-liner.
Instead it **rides the `<HeroCount>` component extraction** — the audit's
**Tier-2 #5** ("a shared `<Badge>` / `<Button>` / `<HeroCount>` … worth doing
once the IA settles"). When `<HeroCount>` is built and rolled out, every hero
count — including the subscriptions outlier — adopts the one canonical
treatment in a single pass, instead of chasing per-page size fixes now.

## The pinned fix (for whoever builds <HeroCount>)

The divergence to absorb during the extraction:

```diff
# src/app/(app)/subscriptions/page.tsx:101
- <p className="mt-4 font-serif text-7xl font-light tabular-nums leading-none">
+ <p className="mt-4 font-serif text-5xl font-light tabular-nums leading-none">
```

When `<HeroCount>` lands, this page (Session A's lane) swaps its inline hero for
`<HeroCount>` and the size normalises automatically — no separate 4b PR.

## Status

- **#437** (the cross-lane routing handoff) is **closed** against this record.
- `<HeroCount>` extraction (Tier-2 #5) remains an open Tier-2 item, **gated on
  "IA settles"** — not scheduled in the current pre-UAT wave.

## Cross-references
- `memory/handoff_tier2_bignumber_unification.md` — the original routing detail
  (rode #437).
- `memory/uiux_audit_day53.md` — 4b (line ~136), Tier-2 #5 component extraction
  (line ~172).
- `memory/decision_d53_tier2_pre_uat_ruling.md` — the Tier-2 build ruling.
