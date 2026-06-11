---
name: Consignee timeline performance optimization (denormalize from view to table) — Phase 2
description: MVP consignee_timeline_events ships as a database VIEW (read-time computation). If demo or pilot scale surfaces performance issues, denormalize to a table — Phase 2 if needed.
type: project
---

# Consignee timeline performance optimization

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral (if needed)
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.3.7 + §8 Open Questions
**Phase 2 trigger:** Post-pilot **if** performance demands

## What

`consignee_timeline_events` (per brief §3.1.1 + §3.3.7) ships as a Postgres VIEW that aggregates rows on read across:
- `consignee_crm_events`
- `subscription_events`
- `subscription_exceptions`
- `tasks` state changes
- `audit_log` entries scoped to the consignee

If pilot scale OR specific consignees with rich histories surface read-time slowness on the timeline view, denormalize to a physical table populated by triggers / async writes from each underlying source.

## Why deferred

VIEW is the simpler MVP shape — no write-path complexity, no consistency questions, no maintenance overhead. Premature denormalisation is wasted scope. Brief §3.3.7 and §8 explicitly document this as Phase-2-IF-needed.

## When unlocked

**Conditional.** Trigger is empirical: if the consignee timeline surface measurably slows operator workflow, denormalize. Otherwise stay on the view forever.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.3.7 + §8 Open Questions
