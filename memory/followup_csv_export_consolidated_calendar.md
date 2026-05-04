---
name: CSV export from consolidated merchant calendar — Phase 2
description: BRD §6.4 calls for CSV export of consolidated merchant calendar view. MVP `/calendar` ships read + filter only; CSV export deferred.
type: project
---

# CSV export from consolidated merchant calendar

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.3.4; BRD §6.4
**Phase 2 trigger:** Post-pilot

## What

Operator-clickable "Export to CSV" button on the consolidated merchant calendar (`/calendar`) that downloads filtered task list as CSV. MVP ships the calendar with full read + filter capabilities but no export.

## Why deferred

CSV-shape standardisation + escape-handling + locale considerations (numbers, dates, Arabic) add scope without operational urgency. Operators can copy/paste from the table view if needed.

## When unlocked

Post-pilot, when an operator surfaces a downstream tool (Excel report, email digest) that needs the data. Light T2 PR — single endpoint streaming CSV from existing query.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.3.4
- BRD §6.4
