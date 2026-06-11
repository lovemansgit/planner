---
name: Custom roles / impersonation / SSO — Phase 2
description: Plan.docx §7.9 + v1.1 delta §12.2.7-9. MVP ships frozen built-in role catalogue (transcorp_staff + tenant_admin + ops_manager + cs_agent). Custom-role creation, Transcorp-staff impersonation, SSO integration all deferred.
type: project
---

# Custom roles / impersonation / SSO

**Filed:** Day 12 evening (5 May 2026), Phase 2 deferral
**Source:** PLANNER_PRODUCT_BRIEF.md §4 + §3.1.3; plan.docx §7.9; v1.1 delta §12.2.7-9
**Phase 2 trigger:** Post-pilot

## What

Three related deferrals:
1. **Custom roles** — merchant-defined role with operator-selected permission subset. MVP ships only the four frozen roles; permission catalogue is code, not data.
2. **Tenant-staff impersonation** — `tenant:impersonate` permission for Transcorp-staff to view a merchant's surface as the merchant operator (debugging / support). Permission slot reserved in catalogue but not implemented.
3. **SSO integration** — SAML/OIDC provider (Okta / Azure AD / Google Workspace). MVP uses Supabase Auth email/password.

## Why deferred

All three are post-MVP per plan.docx §7.9 + §10.3. Custom roles especially require RBAC catalogue refactor from code-frozen to row-stored — significant infra change.

## When unlocked

Post-pilot. Likely landing order:
1. Impersonation first (Transcorp ops needs it for support)
2. SSO second (enterprise-merchant onboarding ask)
3. Custom roles last (merchant-config UI surface required)

## Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` §4 + §3.1.3
- `docs/plan.docx` §7.9
- v1.1 delta §12.2.7-9
- `src/modules/identity/roles.ts` — frozen catalogue
