---
name: Admin route middleware (brief §3.4 first-layer permission gating) — Phase 2 hardening, ship as uniform middleware across all authenticated routes
description: Day-16 Block 4-F pre-flight verification surfaced that the codebase ships brief §3.4 layers 2 (service-layer requirePermission) + 3 (Postgres RLS) but NOT layer 1 (middleware-based permission gating at API route entry). Block 4-F admin merchant routes follow the existing convention (Option A, service-layer-only) per reviewer ruling. Phase 2 hardening: build a UNIFORM permission-checking middleware across all authenticated routes, not just admin — avoids two-pattern split. Defense remains adequate via 3 compensating vectors documented in §3.
type: project
---

# Admin route middleware — Phase 2 hardening

**Surfaced:** Day-16 Block 4-F pre-flight verification.

## §1 The gap

Brief §3.4 specifies a 3-layer RBAC defense-in-depth model:

1. **Middleware at API route entry** — Every API route declares required permission. Middleware checks JWT claim, returns 403 before reaching handler.
2. **Service layer reassertion** — Each service method re-checks permission. Prevents privilege escalation from misconfigured route or bypass.
3. **Postgres RLS as backstop** — Tenant isolation enforced at the database via RLS on every tenant-scoped table.

**The codebase ships layers 2 + 3 only.** Layer 1 (middleware-based permission gating) does not exist:

- No `src/middleware.ts` (only the Next.js root `/middleware.ts` which does x-pathname injection — narrow Day-12 footprint, unrelated to permission gating)
- No `/api/admin/middleware.ts` route-group middleware
- No permission-checking interception at any API route entry
- Existing routes go: `request → buildRequestContext → service fn → service.requirePermission → 403 ForbiddenError → errorResponse → 403 HTTP`

The 403 outcome is the same as middleware would produce; the missing layer is structural defense-in-depth, not a security hole.

## §2 Block 4-F decision: ship Option A (service-layer-only), file this memo for Phase 2

Per reviewer §A ruling on the Block 4-F pre-flight verification turn:

- 4 admin merchant routes follow the existing convention (no new middleware infrastructure for Block 4-F).
- Phase 2 hardening: build a UNIFORM permission-checking middleware across ALL authenticated routes (admin + tenant-scoped), not just admin. Avoids a two-pattern split where admin routes have middleware but tenant routes don't.
- This memo documents the gap + the Phase 2 plan + the compensating defense vectors that make the current 2-layer posture adequate.

## §3 Compensating defense vectors (current 2-layer posture)

Three independent defenses keep the admin merchant routes secure even without middleware-layer enforcement:

### §3.1 transcorp-sysadmin role exclusivity on `merchant:*` permissions

`src/modules/identity/roles.ts:183-190` declares the `transcorp-sysadmin` role with `permissions: new Set<PermissionId>(ALL)` — the only role with the `merchant:*` permission family.

`src/modules/identity/permissions.ts:526-560` declares all 4 `merchant:*` permissions with `systemOnly: true`. The `systemOnlyPermissionsAreNotInTenantRoles` test (per `permissions.ts:583-593` SYSTEM_ONLY_PERMISSIONS export) statically enforces that no tenant-scoped role accidentally picks them up.

Result: only a `transcorp-sysadmin`-roled JWT actor can satisfy the service-layer `requirePermission(ctx, 'merchant:*')` check. Tenant Admins, Operations Managers, and Customer Service Agents fail at layer 2.

### §3.2 API_KEY_FORBIDDEN_PERMISSIONS

`src/modules/identity/permissions.ts:608-619` declares the API_KEY_FORBIDDEN_PERMISSIONS frozen set, which explicitly blocks API keys from carrying `merchant:create`, `merchant:read_all`, `merchant:activate`, `merchant:deactivate` (plus the migration permissions). API keys are scoped service credentials per resolutions §2.5; an exfiltrated key cannot be used to create/mint merchant tenants.

### §3.3 `tenants.status='active'` filter in `buildRequestContext`

Commit `d7fd9e9` (Day-16 §10.5 fix) added the `tenants.status='active'` filter to `buildRequestContext`'s `resolveUserContext` SELECT. A user on a `provisioning`/`suspended`/`inactive` tenant resolves to `null` → `UnauthorizedError` → 401. This guards against a deactivated `transcorp-sysadmin` tenant continuing to authenticate against admin routes.

### §3.4 Why the layering is adequate for MVP

Layer 1 (middleware) is a duplicate of layer 2 (service) for the permission check itself — they make the same call against the same actor's permission set. The structural difference is ordering: middleware fails fast before route handler runs; service-layer fails after handler imports + calls service. For demo posture (May 12), the latency difference is zero; for security posture, the layer-2 enforcement is functionally equivalent.

The structural value of layer 1 (middleware) emerges at scale:
- Hot-path permission denials don't bind DB connections (middleware fails before `withTenant` opens a tx).
- Easier audit-trail at network ingress.
- Composability with WAF / rate-limit / IP-allowlist layers.

These are Phase 2 concerns, not MVP-demo concerns.

## §4 Phase 2 picker requirements

Whoever picks up the Phase 2 hardening must:

1. **Build uniform permission middleware.** A single permission-checking middleware that gates every authenticated route by a route-declared permission requirement. Likely shape:
   - Route handlers declare their permission requirement via a route-config export (e.g., `export const requiredPermission = "merchant:create"`)
   - Middleware reads the actor from JWT, checks `actor.permissions.has(requiredPermission)`, returns 403 on fail before the handler runs
   - Service-layer `requirePermission` STAYS as defense-in-depth — never remove the layer 2 check
2. **Compose with the existing x-pathname middleware.** Next.js middleware is a single function per route; both header-injection + permission-gating need to chain. Either:
   - Refactor the existing x-pathname middleware to also do permission-gating (single middleware, two responsibilities)
   - Use Next.js middleware composition pattern (manual chain)
3. **Test infrastructure.** Build `createMockRequest` helper or similar; existing routes inline `new NextRequest(new URL(...))` per Block 4-F precedent — that's fine for handler-level tests but brittle for middleware-composition tests.
4. **NOT scope creep into "redo all routes."** The middleware addition is additive; existing routes don't change shape. Only the route-config export per route is new.

## §5 Cross-references

- **`memory/PLANNER_PRODUCT_BRIEF.md`** v1.3 §3.4 — three-layer RBAC model (middleware → service → RLS); aspirational layer 1 spec
- **`src/modules/identity/permissions.ts:526-560`** — `merchant:*` permissions registered as `systemOnly: true`
- **`src/modules/identity/permissions.ts:608-619`** — API_KEY_FORBIDDEN_PERMISSIONS frozen set
- **`src/modules/identity/roles.ts:183-190`** — `transcorp-sysadmin` role with ALL permissions including `merchant:*`
- **`src/shared/request-context.ts`** (commit d7fd9e9) — `tenants.status='active'` filter in `resolveUserContext`
- **`/middleware.ts`** (Next.js root) — current x-pathname injection middleware; Phase 2 work composes here
- **Reviewer Block 4-F §A ruling** (Day-16 turn closing pre-flight verification) — Option A locked; this memo filed
