---
name: Historical-correction workflow (skip on past date) — Phase 2
description: PLANNER_PRODUCT_BRIEF.md §3.1.6 Edge case G — MVP rejects skip on past dates. Historical correction (with Ops Manager approval) deferred to Phase 2.
type: project
---

# Historical-correction workflow (skip on past date)

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.1.6 Edge case G
**Phase 2 trigger:** Post-pilot

## What

Operator workflow to retroactively mark a past delivery as skipped (e.g. customer called and said "I didn't receive Wednesday's box"). Requires Ops Manager approval + audit trail tied to the historical-correction event.

MVP `addSubscriptionException` validates that `date` is in future relative to cut-off (per brief §3.1.4 step 3). Past dates are rejected.

## Why deferred

Historical correction has compliance implications (audit + reconciliation with SF state) that warrant Ops Manager approval workflow + dual-control pattern. Brief §3.1.6 Edge case G explicitly defers.

## When unlocked

Post-pilot, when reconciliation patterns are operationalised. Likely lands as a separate T2 plan with explicit dual-control + escalation logic.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.1.6 Edge case G
