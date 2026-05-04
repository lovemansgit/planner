---
name: Body-injection probe coverage gap on POST routes (T2, pre-MVP audit)
description: Day-10 P2 cross-tenant probe step 4 returned 405 because /api/tasks is GET-only by design (no user-facing task creation in pilot). The body-injection vector was therefore not exercised against a real POST endpoint. Architecture (RequestContext as single tenantId source) makes this safe-by-construction, but full coverage would probe one POST route (/api/consignees or /api/subscriptions) before Day-14 production cutover.
type: project
---

# Body-injection probe coverage gap on POST routes

**Surfaced:** 3 May 2026 (Day 10 P2 cross-tenant probe step 4)
**Tier:** T2 (verification gap; not architectural)
**Target:** pre-Day-14 production cutover security audit
**Watch-item, not an active task** — captured here so the gap is visible at audit time.

---

## What the probe surfaced

Step 4 of the cross-tenant probe (body injection) attempted:

```
POST /api/tasks  (with probe-merchant-a's session cookie)
Content-Type: application/json
{
  "tenant_id": "<probe-merchant-b's UUID>",
  "taskKind": "DELIVERY"
}
```

Response: **405 Method Not Allowed**.

Reason: `/api/tasks` is GET-only by design. Per [memory/decision_task_module_no_user_create_delete.md](memory/decision_task_module_no_user_create_delete.md), tasks are created by the cron and the migration-import flow only — there is no user-facing POST endpoint. The router didn't dispatch to any handler; the body never reached buildRequestContext.

**The body-injection vector was therefore not exercised end-to-end against a route that actually accepts a POST body and constructs a tenant-scoped query from it.**

## Why architecture makes this safe-by-construction anyway

Every route's flow is the same:

```
1. buildRequestContext(path, requestId)  ← resolves tenantId from session cookie ONLY
2. permission check via requirePermission(ctx, ...)
3. service-layer query via withTenant(ctx.tenantId, ...)  ← tenantId is from ctx, NOT from request body
```

The session-derived `ctx.tenantId` is the only source passed to `withTenant`. Routes that accept a POST body (e.g. `/api/consignees` for `createConsignee`, `/api/subscriptions` for `createSubscription`) parse the body via Zod schemas that DO NOT include a `tenant_id` field. The body's `tenant_id` would either be silently ignored (Zod strips unknown fields by default) or rejected by Zod's strict mode if enabled.

Even if a body's `tenant_id` somehow flowed through to a service call, the service layer takes `ctx` as its first parameter and uses `ctx.tenantId` — not a body field. RLS at the database layer enforces the same boundary: every multi-tenant table's policy filters on `app.current_tenant_id`, set by `withTenant(ctx.tenantId, ...)` at the transaction start.

So a body containing `tenant_id: <other-tenant>` would fail in three layers of defense:

1. **Zod schema rejection** — `tenant_id` is not in any create schema
2. **Service contract** — service functions take `ctx`, not body-tenant_id
3. **RLS** — the transaction's `app.current_tenant_id` is set from `ctx.tenantId`; any cross-tenant write attempt fails the WITH CHECK clause

## Why this still matters for full audit coverage

Defense-in-depth claims need empirical coverage even when architecture forbids the failure mode. A future code change could:

- Add a body schema that DOES accept `tenant_id` (well-meaning generalisation for an admin endpoint)
- Refactor a service to accept `tenant_id` as a parameter (regression of the ctx-only contract)
- Drop a Zod strict-mode flag

Empirical body-injection coverage on at least one POST route catches such regressions at probe time rather than in production. Suggested coverage:

```
POST /api/consignees   ← takes a real body, creates a real row
  body: { name: "Probe Body Injection", phone: "+971...", tenant_id: "<other-tenant>" }
  expected: 201 created, response.tenantId = probe-a's tenantId (NOT body's tenant_id)
  verify: SELECT FROM consignees WHERE tenant_id = <other-tenant> shows zero new rows
```

Or `/api/subscriptions` if consignee creation has prerequisite consignee data; the architectural claim is identical.

## When to run

Pre-Day-14 production cutover security audit. Bundle into a comprehensive auth-validation script (the eventual `scripts/security-audit.mjs` if we write one) that exercises every cross-tenant injection vector against every POST/PATCH/DELETE route. For MVP, manual probe of one POST route is sufficient.

## Sequencing

T2, watch-item. Not blocking the auth merge or P3/P4 work. Re-surface during the Day-13 / Day-14 production-cutover security audit.

## Cross-references

- Day-10 P2 cross-tenant probe (3 May 2026) — surfacing event
- [memory/decision_task_module_no_user_create_delete.md](memory/decision_task_module_no_user_create_delete.md) — explains why /api/tasks is GET-only
- [src/app/api/consignees/route.ts](src/app/api/consignees/route.ts) — POST endpoint candidate for full-coverage probe
- [src/app/api/subscriptions/route.ts](src/app/api/subscriptions/route.ts) — alternate POST endpoint candidate
- [src/shared/request-context.ts](src/shared/request-context.ts) — the single source of `ctx.tenantId` that makes the architecture safe-by-construction
