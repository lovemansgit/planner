---
name: Audit log viewer UI — Phase 2
description: MVP captures all audit events (R-4 emit pattern) but provides no UI viewer. Plan.docx §10.3 explicitly defers viewer to week-3-or-post-MVP.
type: project
---

# Audit log viewer UI

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; plan.docx §10.3
**Phase 2 trigger:** Post-pilot

## What

UI page (likely `/admin/audit` or merchant-portal `/audit`) that lists `audit_events` rows with filters: by actor, by event type, by date range, by tenant (Transcorp-staff cross-tenant), by resource type/id. Currently events are captured but only inspectable via Supabase SQL editor.

## Why deferred

Plan.docx §10.3 explicitly omits this from the 14-day sprint: "A full audit log viewer UI (capture goes live day 1; the viewer is week 3 work)." Day-12 EOD doc rolls this into Phase 2.

## When unlocked

Post-pilot. May ship as a small T2 once Phase 2 merchant-config UI patterns are established (audit-viewer can reuse the same table/filter chrome).

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- `docs/plan.docx` §10.3
- `src/modules/audit/` — capture path (operational since Day 2)
