---
name: Per-merchant blackout date editor — Phase 2
description: MVP supports merchant-default blackout dates (read-only display in onboarding wizard). Per-merchant editing UI + per-consignee custom blackouts deferred to Phase 2 (BRD §6.3.4).
type: project
---

# Per-merchant blackout date editor

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.3.1 Step 4; BRD §6.3.4
**Phase 2 trigger:** Post-pilot

## What

MVP shows merchant-default blackout dates (e.g. UAE national holidays) as read-only context in the consignee onboarding wizard step 4. Operators cannot edit blackout sets; per-consignee custom blackouts (different consignees → different date exclusions) are also deferred.

## Why deferred

The blackout-set editor is a merchant-settings UI surface (Phase 2). Per-consignee custom blackouts add per-row complexity to the consignee detail page that operators haven't asked for at this stage.

## When unlocked

Post-pilot, alongside the merchant-settings configuration UI. Per-consignee custom layer follows when operators request it.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.3.1 Step 4
- BRD §6.3.4
