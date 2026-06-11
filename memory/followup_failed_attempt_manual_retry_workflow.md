---
name: Failed-attempt manual retry workflow (delivery-level) — Phase 2
description: MVP supports failed-push DLQ retry (webhook-level). Delivery-attempt-level manual retry (BRD §6.2.3) is Phase 2.
type: project
---

# Failed-attempt manual retry workflow

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; BRD §6.2.3
**Phase 2 trigger:** Post-pilot

## What

Two distinct retry surfaces:
- **Webhook-level retry** (`/admin/failed-pushes`) — already in MVP. Retries failed task pushes from Planner → SF.
- **Delivery-attempt-level retry** (Phase 2) — operator UI to "retry this delivery" on a task whose driver failed delivery (e.g. consignee absent). The operator triggers a re-attempt request that updates the SF task status from FAILED back to a re-attempt state.

This memo is about the SECOND surface.

## Why deferred

SF re-attempt API exists per `task-resource:reattempt` mapping in PLANNER_PRODUCT_BRIEF.md §3.1.11. The operator UI for triggering this from a task-detail popover hasn't been scoped for MVP.

## When unlocked

Post-pilot, when failed-delivery operational patterns surface in pilot data. Could be a quick T2 PR if just one button on the task popover.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- BRD §6.2.3
- SF API `task-resource:reattempt` per brief §3.1.11
- Existing `/admin/failed-pushes` (different surface — webhook-level retry)
