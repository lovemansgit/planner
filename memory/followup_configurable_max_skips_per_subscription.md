---
name: Configurable max_skips_per_subscription — Phase 2
description: MVP allows unlimited skips per subscription. Per-merchant max_skips configuration (BRD §6.3.4) is Phase 2.
type: project
---

# Configurable max_skips_per_subscription

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.1.6 (Edge case D); BRD §6.3.4
**Phase 2 trigger:** Post-pilot

## What

MVP applies no hard cap on the number of skips a subscription can accumulate. Each skip independently extends `end_date` and stacks transactionally. Per-merchant configurable max_skips (e.g. "no more than 5 skips per subscription") is deferred.

Note: Day-12 decision dropped `max_consecutive_skips` from scope entirely. Only the simple max-skips count remains as a Phase 2 candidate.

## Why deferred

No pilot merchant has surfaced this as a hard requirement. Without operator pressure the scope addition is speculative. Bounded-pause workflow is the better fit for long absences.

## When unlocked

Post-pilot, when a merchant explicitly requests skip limits (or when fraud/abuse patterns emerge).

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.1.6 Edge case D
- BRD §6.3.4
