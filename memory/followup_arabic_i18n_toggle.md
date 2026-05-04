---
name: Arabic / i18n UI toggle — Phase 2
description: MVP ships English-only. Arabic RTL support stubbed at architecture level (text directionality, translations ready). Language switcher deferred to Phase 2 per plan.docx §10.3.
type: project
---

# Arabic / i18n UI toggle

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; plan.docx §10.3
**Phase 2 trigger:** Post-pilot

## What

Operator-clickable language switcher (English ↔ Arabic) with full RTL layout support. Translation strings, RTL-aware components, locale-aware date/number formatting. MVP architecture stubs the directionality (`NEXT_PUBLIC_ENABLE_ARABIC` exists in `.env.example` but is `false` in pilot per feature flag), but the switcher UI + translations are not built.

## Why deferred

Plan.docx §10.3: "Internationalisation UI toggle — we ship English-only for pilot; Arabic RTL support is stubbed (text directionality, translations ready) but the language switcher lands in week 3 if time permits, week 4 otherwise."

Pilot merchants operate in English-comfortable UAE business context.

## When unlocked

Post-pilot, when a non-English-comfortable merchant joins OR when sales targets a non-Anglophone Gulf market.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- `docs/plan.docx` §10.3
- `.env.example` — `NEXT_PUBLIC_ENABLE_ARABIC=false` flag
