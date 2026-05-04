---
name: Reconciliation job between Planner and SuiteFleet — Phase 2
description: MVP relies on webhook delivery + DLQ surface for SF state convergence. Active reconciliation job (BRD §10.2) is Phase 2.
type: project
---

# Reconciliation job between Planner and SuiteFleet

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §5.4 Q&A; BRD §10.2
**Phase 2 trigger:** Post-pilot

## What

A scheduled reconciliation job that periodically queries SuiteFleet's task index for tasks the Planner believes exist, compares state, and surfaces drift. MVP does NOT run this job; convergence relies on:
- SuiteFleet webhook delivery (with retry)
- Webhook deduplication via UNIQUE constraint
- Dead-letter queue at `/admin/failed-pushes` for unrecoverable events

## Why deferred

The webhook + DLQ pattern is sufficient for pilot scale + duration. Active reconciliation surfaces silent drift (rare in pilot, valuable at scale post-pilot).

## When unlocked

Post-pilot, when scale or operational complaints justify the polling cost. Could also land earlier if SF webhook reliability proves shaky.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §5.4 Q&A
- BRD §10.2
- Existing webhook receiver + DLQ at `/admin/failed-pushes`
