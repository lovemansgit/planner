---
name: Plan tier as configurable selectable list per merchant — Phase 2
description: MVP captures `mealPlanName` as free-text on subscription. BRD §6.1 calls for merchant-configurable plan-tier list (Bronze/Silver/Gold-style); deferred.
type: project
---

# Plan tier as configurable selectable list per merchant

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.3.1 Step 3; BRD §6.1
**Phase 2 trigger:** Post-pilot

## What

In the consignee onboarding wizard Step 3 (subscription), `mealPlanName` is currently a free-text field. BRD §6.1 envisions a merchant-configurable plan-tier list — operator-defined plans (Bronze, Silver, Gold; Veggie, Premium, Family-pack; etc.) presented as a dropdown selector, with per-tier metadata (price, default delivery window, plan description).

## Why deferred

Free-text works fine for pilot — operators type whatever the merchant uses. Configurable plan-list requires a merchant-settings page (Phase 2) + plan-tier table + onboarding-wizard integration. Speculative without operator pull.

## When unlocked

Post-pilot, alongside merchant-settings UI. May ship as a small T2 once that UI surface exists.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.3.1 Step 3
- BRD §6.1
