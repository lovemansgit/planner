---
name: Integrations page (SF credential entry/test in merchant portal) — Phase 2
description: Plan.docx §10 Day 5 scoped a merchant-facing Integrations page where Tenant Admin enters/tests SF credentials. /admin/webhook-config ships URL display + Tier-2 status only; credential entry deferred.
type: project
---

# Integrations page (SF credential entry/test in merchant portal)

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4; plan.docx §10 Day 5; v1.1 delta §6.2.1.9
**Phase 2 trigger:** Post-pilot, gated on Secrets Manager swap + per-tenant credential isolation

## What

Plan.docx §10 Day 5 originally scoped a merchant-portal Integrations page where the Tenant Admin enters their SuiteFleet credentials (URL, client ID, secret), runs a real-time validation, and clicks a "Test connection" button. `/admin/webhook-config` partially fulfils this — shows the receiver URL + Tier-2 status — but does NOT support credential entry.

Inline UI copy reads: "Coming soon: credential management. Contact operations to enable Tier-2 verification today."

## Why deferred

The page assumes per-tenant SF credentials, which require Secrets Manager swap (post-MVP). MVP runs all tenants on the shared sandbox cred per `decision_mvp_shared_suitefleet_credentials.md`. Until per-tenant creds exist, this page would be a no-op.

## When unlocked

Post-pilot, alongside Secrets Manager swap + per-tenant credential isolation. Could be bundled with credential-rotation UX.

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4
- `memory/decision_mvp_shared_suitefleet_credentials.md`
- `memory/followup_secrets_manager_swap_critical_path.md`
- `memory/followup_credential_rotation_ux.md`
- `docs/plan.docx` §10 Day 5; v1.1 delta §6.2.1.9
- Existing partial: `src/app/(app)/admin/webhook-config/page.tsx`
