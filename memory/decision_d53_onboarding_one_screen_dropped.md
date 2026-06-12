---
name: One-screen onboarding plan dropped — brief v1.12 decoupling stands
description: Love's overnight ruling — the one-screen subscriber onboarding plan (#432) is dropped because it reversed brief v1.12 (which decoupled consignee creation from subscription creation). v1.12 stands. Revisit post-UAT only if onboarding still feels heavy.
type: reference
---

# One-screen onboarding plan (#432) — DROPPED, v1.12 stands

**Love's ruling (verbatim, overnight 2026-06-11):**

> Drop #432 — v1.12 stands.

## What this settles

The click-reduction plan #432 proposed collapsing new-subscriber onboarding
from two routes (`/consignees/new` → `/subscriptions/new`) into one combined
screen. The reviewer caught that this **reverses brief amendment v1.12**, which
deliberately **decoupled** consignee creation from subscription creation
(removed the old wizard in favour of a flat consignee form + a separate "New
subscription" CTA on the Overview page).

Love's ruling: **v1.12 stands** — the decoupling is the intended design. The
one-screen onboarding plan is **dropped**; no build, no brief change.

## Revisit condition

Post-UAT only: if the first Ops UAT shows onboarding still **feels heavy**
(operators stumble on the two-step create flow), the one-screen idea can be
reconsidered then — as a fresh proposal measured against real UAT friction, not
a pre-UAT reversal of a settled decision.

## Status

- **#432** is **closed** against this record (dropped, not parked).
- Brief **v1.12** (consignee/subscription decoupling) remains in force.
- The other two click-reduction plans are **approved** and proceed:
  #431 (`/tasks` filter-row collapse, with a brief §9 amendment) and #430
  (day-popover grouping).

## Cross-references
- `memory/plan_click_reduction_onboarding_one_screen.md` — the dropped plan.
- Brief v1.12 amendment — the consignee/subscription decoupling that stands.
