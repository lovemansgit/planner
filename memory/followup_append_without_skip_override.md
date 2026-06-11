---
name: Append-without-skip override (operator-initiated goodwill) — Phase 2
description: BRD §6.3.3 includes operator-initiated tail-end addition (no skip needed) for goodwill / complaint resolution. Brief carries the API contract but UI is Phase 2.
type: project
---

# Append-without-skip override

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.1.4 (`appendWithoutSkip` service); BRD §6.3.3
**Phase 2 trigger:** Post-pilot

## What

Operator-initiated tail-end addition to a subscription WITHOUT a corresponding skipped delivery. Example: customer complained about a sub-par delivery; merchant offers a goodwill extra delivery; CS Agent (with `subscription:override_skip_rules` permission) appends one extra slot to the subscription.

MVP backend ships the service (`appendWithoutSkip` per brief §3.1.4) + API route. UI surface (button on subscription detail page) is Phase 2.

## Why deferred

Operator UI surface scope. Backend hooks exist (per brief §3.1.4); UI build comes when an operator surfaces the workflow as needed. Probably a small T2 PR.

## When unlocked

Post-pilot, when an operator surfaces a goodwill workflow. The backend is ready.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.1.4 (`appendWithoutSkip` service exists)
- BRD §6.3.3
