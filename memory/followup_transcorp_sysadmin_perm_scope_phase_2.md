---
name: Transcorp-sysadmin permission scope — Phase 2 architectural posture
description: Captures the deferred architectural question of whether transcorp-sysadmin should retain ALL permissions (current Posture 1, locked Day-19 PR #213) or move to a cross-tenant-only role (Posture 2 / 3). Phase 1.5 PR #213 demo-readiness fix is the `/` redirect to `/admin/merchants`; the deeper "should they have operator perms at all" question is a separate post-pilot decision.
type: project
---

# Transcorp-sysadmin permission scope — Phase 2 architectural posture

**Filed:** Day 19 (9 May 2026), with the Phase 1.5 admin code-PR #213
**Trigger date:** post-pilot OR first audit-trail anomaly from a transcorp-sysadmin acting on a non-transcorp tenant
**Tier when triggered:** see per-posture sketch

## §1 Trigger condition

Production observation that ALL-permission scope on the `transcorp-sysadmin` role causes one or more of:
- **Operator-surface confusion** — Transcorp staff lands on a merchant tenant's `/tasks` or `/consignees` page (via URL or back-button) and confuses tenant-scoped data for cross-tenant
- **Unintended writes via cross-tenant clicking-through** — Transcorp staff applies a CRM-state change or skip-delivery action while operating in their `'transcorp'` tenant context (which has no real consignees), but the action targets the wrong tenant via stale URL state or an unexpected RLS bypass
- **Audit-trail noise** — `audit_events` table accumulates entries from transcorp-sysadmin acting in operator surfaces; staff actions on tenant data become indistinguishable from tenant-operator actions in retrospective queries

Phase 1.5 PR #213 (Day 19) ruled Posture 1 + the `/` redirect. The redirect prevents the most-likely demo-time confusion path (post-login dashboard) but does NOT prevent direct URL navigation to `/tasks` etc. The deeper architectural fix is deferred.

## §2 Three options

### Posture 1 — current (locked Day-19 PR #213)

`transcorp-sysadmin` has `new Set<PermissionId>(ALL)` at [src/modules/identity/roles.ts:202](../src/modules/identity/roles.ts#L202). Carries every permission in the catalogue including operator-side `task:read` / `subscription:read` / `consignee:read` / `failed_pushes:retry` / `webhook_config:read` PLUS the systemOnly cross-tenant `merchant:*` / `task:read_all` / `consignee:read_all` / `subscription:read_all`.

Mitigation in this PR: `(app)/page.tsx` redirects to `/admin/merchants` when `actor.permissions.has("merchant:read_all")`. Permission-gated, not role-name-based — extensible to future Transcorp-staff roles.

**Pros:**
- Minimal change (5-line redirect)
- Sysadmin can "drop into" the `'transcorp'` tenant operator view if needed for forensic/debugging
- No churn on existing operator service fns (which require `task:read` etc.)

**Cons:**
- Visiting `/tasks`, `/subscriptions`, `/consignees` directly still shows operator chrome with empty data (`'transcorp'` tenant has no consignees/subscriptions/tasks)
- Sysadmin actions on operator surfaces (if they URL-click) emit `actor.kind='user'` audit events that look identical to tenant-operator actions — no marker distinguishes "staff acting" from "operator acting in own tenant"

### Posture 2 — strip operator perms

`transcorp-sysadmin` keeps only systemOnly cross-tenant perms (`merchant:*` + the 3 new `<resource>:read_all`). Drops `task:read`, `subscription:read`, `consignee:read`, `failed_pushes:retry`, `webhook_config:read`, etc.

**Pros:**
- Architecturally clean — Transcorp-staff is a cross-tenant oversight role, not an operator
- Visiting `/tasks` etc. raises ForbiddenError → redirect to `/`; `/` redirects to `/admin/merchants` per the Posture-1 mitigation
- Audit-trail cleanly distinguishes staff actions (only on `/admin/*`) from operator actions

**Cons:**
- Every operator surface that requires `task:read` etc. now 403s for transcorp-sysadmin — including any forensic/debugging "drop into a merchant operator view" workflow
- Each affected page needs either graceful 403 handling OR an alternative `read_all`-based fallback at the service layer
- Larger change; touches every `requirePermission(ctx, "<tenant-scoped-perm>")` call site

### Posture 3 — discrete `transcorp-staff` role slug

Introduce a separate `transcorp-staff` role slug (parallel to existing `transcorp-sysadmin`). The `transcorp-sysadmin` role keeps `new Set<PermissionId>(ALL)` as a superuser role for engineering/migrations/incidents. The new `transcorp-staff` role gets only the cross-tenant `read_all` perms — that's the day-to-day operational role for non-engineering Transcorp staff.

**Pros:**
- Best of both — superuser path stays for engineering forensics; day-to-day staff get a scoped role
- Audit-trail can disambiguate: `actor.role='transcorp-staff'` for staff actions, `actor.role='transcorp-sysadmin'` for engineering
- Doesn't break existing forensic workflows

**Cons:**
- New role registration + role-assignment provisioning workflow (separate onboarding script or admin UI)
- Doubles the cross-tenant role surface area
- See `memory/followup_admin_middleware_phase2.md` for the deferred discrete-role-slug context — that memo bundles with this work

## §3 Cross-references

- Phase 1.5 PR #213 ([feat(admin-d19): Phase 1.5 cross-tenant Transcorp-staff admin](https://github.com/lovemansgit/planner/pull/213)) — Posture 1 lock + `/` redirect mitigation
- `merchant:read_all` permission registration at [src/modules/identity/permissions.ts:535](../src/modules/identity/permissions.ts#L535) — established cross-tenant discriminator pattern
- [memory/followup_admin_middleware_phase2.md](followup_admin_middleware_phase2.md) — deferred discrete-role-slug context; bundles with Posture 3 if pursued
- [memory/PLANNER_PRODUCT_BRIEF.md](PLANNER_PRODUCT_BRIEF.md) §2.3 (single Transcorp-staff workflow framing in v1.9)

## §4 Recommended trigger to revisit

Whichever happens first:
- **Post-pilot operator feedback** that the Transcorp Admin surface confuses cross-tenant + tenant-scoped contexts (qualitative)
- **First audit-log noise event** — an audit query distinguishing tenant-operator actions from cross-tenant-staff actions returns ambiguous results because both surface as `actor.kind='user'` without a distinguishing marker (quantitative — surfaceable via SQL)
- **External Transcorp staff onboarding** beyond the engineering team — at the point a non-engineer needs an account, Posture 3 becomes more attractive (the role boundary aligns with org structure)

If none of the three triggers fire within the first 60 days post-pilot, the Posture 1 + redirect status quo is fine to leave in place indefinitely.
