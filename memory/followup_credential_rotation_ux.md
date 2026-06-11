---
name: Credential rotation UX — Phase 2
description: MVP has no operator-facing credential rotation surface. Plan.docx §10 Day 12 scope deferred.
type: project
---

# Credential rotation UX

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; plan.docx §10 Day 12
**Phase 2 trigger:** Post-pilot, gated on AWS Secrets Manager swap

## What

Operator UI to rotate a tenant's SuiteFleet credentials (Tier-2 webhook secret + the API access keys once Secrets Manager is wired). Workflow: operator enters new values → server validates connection → atomic swap → audit emit.

## Why deferred

Pre-conditions:
1. AWS Secrets Manager swap (separate Phase 2 item per `followup_secrets_manager_swap_critical_path.md`)
2. Per-tenant credential isolation (also Phase 2)

Until those land, "rotate credentials" is a no-op for the MVP shared-credential posture. The shared sandbox SF cred is rotated by Transcorp infra team out-of-band.

## When unlocked

Post-pilot. Lands in same hardening pass as Secrets Manager swap.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- `memory/followup_secrets_manager_swap_critical_path.md`
- `memory/decision_mvp_shared_suitefleet_credentials.md`
- `docs/plan.docx` §10 Day 12
