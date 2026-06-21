---
name: followup_admin_pod_proxy_cross_tenant
description: PR-B (plan #532 §Phase-4) scope-literal stop — the existing POD proxy is single-tenant (assertTenantScoped + withTenant); the /admin/tasks surface is cross-tenant (task:read_all + withServiceRole). Routing AdminPodCell through the existing proxy does NOT work for other merchants' POD. A cross-tenant-gated admin proxy variant is required (matches the POD memo's deferred follow-on item 2) and was NOT named by the plan — needs authorization.
metadata:
  type: followup
---

# PR-B blocked: admin POD needs a cross-tenant proxy variant, not the existing one

**Filed:** 2026-06-21 (Day-56), during Wave 1 PR-B implementation. **Anchored:** main `f181845`.

## What the plan said vs what the code shows
Plan #532 §Phase-4 scoped PR-B as a one-liner: "route the admin cell through `podProxyPhotoPaths`... The proxy already enforces tenant scope via `buildRequestContext`; no new route." **That is wrong for the cross-tenant admin surface.**

Three probes @ f181845:
1. The POD proxy source read `getPodPhotoSourceUrl` ([tasks/service.ts:2051-2073](../src/modules/tasks/service.ts#L2051-L2073)) does `requirePermission(ctx,"task:read")` + **`assertTenantScoped(ctx,"task:read")`** + **`withTenant(ctx.tenantId)`** — strictly SINGLE-TENANT, RLS-scoped to the caller's own tenant.
2. The admin task source `listAllTasks` ([tasks/service.ts:858](../src/modules/tasks/service.ts#L858)) does `requirePermission(ctx,"task:read_all")` + **`withServiceRole`** — CROSS-TENANT, RLS-bypass. This is how `/admin/tasks` shows all merchants.
3. `podProxyPhotoPaths` ([tasks/pod-proxy.ts:26-32](../src/modules/tasks/pod-proxy.ts#L26)) only emits `/api/tasks/${id}/pod/${index}` — the single-tenant route. The only POD route is `/api/tasks/[id]/pod/[index]`. No admin/cross-tenant POD source exists.

**Consequence:** a transcorp_staff admin viewing another merchant's DELIVERED task POD via the existing proxy hits `assertTenantScoped`/`withTenant` → the task isn't in the admin's own tenant → `NotFoundError`/throw. Routing `AdminPodCell` to `podProxyPhotoPaths` would replace a broken-image with a 404/500 — not a fix, and does NOT satisfy Love's standing ruling "POD must render on BOTH Transcorp (admin) AND merchant surfaces."

This is exactly the POD memo's deferred follow-on **item 2**: "Admin POD cell routing through a **cross-tenant-gated variant of the proxy**" ([followup_pod_broken_image_pre_existing.md](followup_pod_broken_image_pre_existing.md) Day-53 PM resolution). The memo always knew a cross-tenant variant was needed; plan §Phase-4's "no new route" claim contradicted it.

## Required fix shape (net-new scope — needs authorization)
A cross-tenant-gated admin POD proxy variant:
- New route `src/app/api/admin/tasks/[id]/pod/[index]/route.ts` (mirrors the operator route's captured-first + H3 placeholder + 502 logic) gated on **`task:read_all`** with a **`withServiceRole`** POD-source read (a new `getPodPhotoSourceUrlCrossTenant`/`...ForAdmin` reading `task.podPhotos` without `assertTenantScoped`).
- A `podProxyPhotoPaths` admin variant (or a param) emitting `/api/admin/tasks/${id}/pod/${index}`, wired into `AdminPodCell`.
- Security review: this streams another tenant's POD bytes — the `task:read_all` gate is the boundary (same gate `listAllTasks` already trusts for cross-tenant task data). Tests must cover: admin with `task:read_all` succeeds cross-tenant; a tenant operator (no `task:read_all`) is denied.

## Why STOPPED, not built
This is a NEW cross-tenant byte-streaming route — a security boundary — and the plan did NOT name it (it claimed no new route). Per [[feedback_authorization_scope_literal]] (named scope absent/different → STOP-and-surface, never re-scope), building it silently would be unauthorized scope expansion on a security surface. Surface → ruling → build.

## Recommendation
Authorize the cross-tenant admin POD proxy variant as the real PR-B (small but a new route + gate + helper + tests, NOT a one-liner), OR move PR-B to Wave 2 behind that ruling. PR-A (#533) is unaffected and shipped.

## Resolution (Day-56)
Love authorized "build cross-tenant variant now." Implemented in PR-B:
- `getPodPhotoSourceUrlForAdmin` ([tasks/service.ts]) + `getCapturedPodPhotoForAdmin` ([pod-capture/service.ts]) — gated on `task:read_all`, read under `withServiceRole` (no `assertTenantScoped`); cross-tenant pod-state read via new `readTaskPodStateCrossTenant`.
- New route `src/app/api/admin/tasks/[id]/pod/[index]/route.ts` mirroring the operator route (captured-first → vendor-fetch → H3 placeholder → 502).
- `adminPodProxyPhotoPaths` helper emitting `/api/admin/tasks/{id}/pod/{n}`; `AdminPodCell` wired to it.
- Tests: operator-without-read_all denied; admin cross-tenant succeeds; bounds/null/storage-drift. tsc + eslint clean; full unit suite green.
