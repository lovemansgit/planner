---
name: Live SF refresh button on popover for IN_TRANSIT tasks — Phase 2
description: MVP architectural commitment is "cache from webhook, never live-fetch" (PLANNER_PRODUCT_BRIEF.md §3.3.8). Phase 2 adds an opt-in live-fetch escape hatch for IN_TRANSIT tasks via a "Refresh" button.
type: project
---

# Live SF refresh button on popover for IN_TRANSIT tasks

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.3.8
**Phase 2 trigger:** Post-pilot

## What

For tasks in `IN_TRANSIT` state, a "Refresh" button on the click-into-day popover that triggers a server-side live fetch from SF (via `task-resource:getTimeline`) to pull the latest status / driver location. MVP renders cached webhook data only.

## Why deferred

MVP architectural commitment per §3.3.8: "All popover and timeline data cached from SF webhooks at receipt time, read from local DB. SF API latency unpredictable; auth refresh hiccups; rate limits; live-fetch creates SF dependency on every popover render."

Live-fetch as an escape hatch is post-MVP. Brief §3.3.8 explicitly calls out the Phase 2 surface.

## When unlocked

Post-pilot, when an operator surfaces "I clicked the popover and want to know if the driver moved in the last 30 seconds." Likely a small T2 PR.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.3.8
- SF API `task-resource:getTimeline` per brief §3.1.11
