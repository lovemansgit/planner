---
name: Operations Manager / Customer Service Agent role differentiation in UI — Phase 2
description: BRD §5.1 + brief §3.1.3 distinguish three merchant-side roles (Tenant Admin, Operations Manager, Customer Service Agent). Demo runs everyone as Tenant Admin; UI differentiation between Ops Manager and CS Agent (visibility + permission gates) is Phase 2.
type: project
---

# Operator role differentiation in UI (Ops Manager vs CS Agent)

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.1.3; BRD §5.1
**Phase 2 trigger:** Post-pilot

## What

The permission catalogue distinguishes three merchant-side roles:
- `tenant_admin` — full merchant-side permissions including override skip rules
- `operations_manager` — same as tenant_admin minus user/role management
- `customer_service_agent` — `subscription:skip` (default) but NOT override; pause/resume; address changes; no schedule rule changes; no integration access

MVP demo logs everyone in as `tenant_admin` for narrative simplicity. The UI permission rendering rules (PLANNER_PRODUCT_BRIEF.md §3.3.10) are implemented for `tenant_admin`; the visible-but-disabled state for CS-Agent-blocked actions is not exercised in demo.

## Why deferred

Permission catalogue exists; UI differentiation is the gap. Building all three role flows + sample data + test fixtures adds scope without changing demo narrative. Demo Q&A explicitly addresses this: "The role catalogue distinguishes Tenant Admin, Operations Manager, and Customer Service Agent per the BRD; the demo uses Tenant Admin for narrative simplicity. Production rollout differentiates."

## When unlocked

Post-pilot, on first merchant operationalisation when CS Agent role gets a real operator assigned. Likely a small batch of UI flag-rendering changes per `§3.3.10` rules.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.1.3 + §3.3.10
- BRD §5.1
- `src/modules/identity/roles.ts` — three roles already defined in catalogue
