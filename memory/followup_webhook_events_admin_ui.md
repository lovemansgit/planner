---
name: Webhook events admin UI — Phase 2
description: MVP captures all webhook events to `webhook_events` table. Admin UI to browse/filter events (plan.docx §10 Day 12) is Phase 2.
type: project
---

# Webhook events admin UI

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; plan.docx §10 Day 12
**Phase 2 trigger:** Post-pilot

## What

Admin-tier page that lists ingested webhook events with filters: by tenant, by SF task ID, by event action, by date range, by processing status (parsed / dedup-skipped / failed). Currently events are captured to `webhook_events` table but only inspectable via Supabase SQL editor.

## Why deferred

Operationally useful but not customer-facing. Pilot debugging via SQL is acceptable. UI is a Phase 2 productivity gain for Transcorp staff.

## When unlocked

Post-pilot, when Transcorp's ops team operationalises Planner support and needs self-service webhook drift inspection.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- `docs/plan.docx` §10 Day 12
