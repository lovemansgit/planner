---
name: Transcorp-staff Phase 2 features — Phase 2
description: MVP Transcorp-staff surface ships create + activate + deactivate merchant. Deactivation cleanup, brand assignment per merchant, cross-merchant metrics deferred to Phase 2.
type: project
---

# Transcorp-staff Phase 2 features

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §2.3
**Phase 2 trigger:** Post-pilot

## What

MVP Transcorp-staff surface (`/admin/merchants`) ships:
- Create merchant (name, slug, pickup address)
- Activate / deactivate merchant
- List all merchants with status

NOT shipped:
- **Deactivation cleanup workflow** — graceful data archival on tenant deactivation (today: status flip only, data preserved)
- **Per-merchant brand assignment** — operator-uploadable merchant logo/palette overrides shown on operator surfaces (currently all merchants share Transcorp brand)
- **Cross-merchant metrics dashboard** — Transcorp-staff aggregate view (merchant count, deliveries per merchant, revenue contribution, etc.)

## Why deferred

Each is a Phase 2 productivity gain for Transcorp ops. None blocks pilot demo. Brand assignment in particular requires merchant-config patterns we haven't built.

## When unlocked

Post-pilot, when Transcorp's ops team operationalises Planner support and needs self-service for these flows.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §2.3
