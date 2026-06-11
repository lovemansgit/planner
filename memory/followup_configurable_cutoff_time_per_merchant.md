---
name: Configurable cut-off time per merchant — Phase 2
description: MVP enforces hardcoded 18:00 local time as cut-off for skip/pause acceptance. Per-merchant configurable cut-off (BRD §6.3.4) is Phase 2.
type: project
---

# Configurable cut-off time per merchant

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.1.8; BRD §6.3.4
**Phase 2 trigger:** Post-pilot

## What

MVP enforces a hardcoded 18:00 local-time cut-off, the day before delivery. Skips/exceptions submitted after that hour are rejected. Per-merchant configurable cut-off (different merchants → different cut-off hours) is deferred.

## Why deferred

Cut-off hour is a merchant-config UI, which requires the merchant-settings surface (also Phase 2). MVP demo doesn't need to differentiate cut-off across merchants.

## When unlocked

Post-pilot, alongside the merchant-settings configuration UI surface.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.1.8
- BRD §6.3.4
