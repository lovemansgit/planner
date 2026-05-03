---
name: Route-layer test-coverage gap
description: /api/* routes have no integration or route-handler tests across the whole repo. Service-unit tests cover business logic; route Zod parsing, status-code mapping, error-envelope contracts have no regression pin
type: followup
---

The repo has zero route-handler tests. Every `/api/*` route in
`src/app/api/**/route.ts` is exercised only indirectly — through the
service-layer unit tests it eventually calls into. The route shell
itself (Zod parse → service call → `errorResponse` mapping → JSON
envelope) is mechanical glue that has no automated regression coverage.

The gap was surfaced during S-5 review (Day 6, 1 May 2026) and
deliberately left open for that commit. This note tracks why we left
it open and what would trigger us to close it.

## What is NOT covered

- **Boundary Zod validation.** A regression that drops `.strict()`
  from `UpdateSubscriptionBodySchema`, or removes a required-field
  check from `CreateSubscriptionBodySchema`, has no route-level test.
  The schema-regression specs in
  `src/modules/{subscriptions,tasks}/tests/schemas.spec.ts` exercise
  the schema directly but do not prove the route imports the right
  schema or applies it before reaching the service.
- **Error-mapping precedence.** `errorResponse` (in
  [`src/app/api/_lib/error-response.ts`](../src/app/api/_lib/error-response.ts))
  switches on `KnownAppError.code` and maps to status codes. A future
  refactor that re-throws a `ConflictError` as a generic `Error`
  inside a route's try-block would render a 500 instead of 409, with
  no test to catch it.
- **Status-code correctness.** Currently relies on convention:
  POST → 201 on creation, GET / PATCH / lifecycle POSTs → 200,
  DELETE → 204. None of these are pinned at the HTTP level. A copy-
  paste of `new NextResponse(null, { status: 204 })` into a route
  that should return JSON would land in a PR with no test failure.
- **Request/response shape contract.** Whether `GET /api/subscriptions`
  returns `{ subscriptions: [...] }` (current shape) or `[...]`
  directly is unverified at the route layer. A breaking change to
  this envelope would not be caught until a frontend or external
  consumer noticed.

## Why MVP doesn't address it

- **Existing precedent.** No `/api/*` route in the repo
  (`/api/consignees`, `/api/consignees/[id]`, `/api/tasks`,
  `/api/tasks/[id]`, `/api/identity/me/permissions`,
  `/api/webhooks/suitefleet/[tenantId]`) has a route-handler or
  integration test. Adding the pattern inside S-5 would diverge from
  the established discipline.
- **Service-unit coverage is real.** Permission gates, audit emits,
  business-rule validation, and tenant scoping all have unit-test
  coverage at the service layer. The gap is genuinely route-layer-
  specific: schema, error-mapping, envelope.
- **Scope discipline.** Introducing the pattern silently inside a
  service-and-routes commit (S-5) would be scope drift. Doing it as
  a project-wide concern is its own design call — picking the test
  framework (vitest + handler-invoke vs. Playwright vs. supertest-
  style HTTP), deciding whether to retroactively cover existing
  routes or only new ones, and where the test files live (alongside
  routes vs. top-level `tests/`).

## Trigger to revisit

Either of:

1. **First production bug that slips through service-layer tests due
   to a route-layer issue.** Examples that would qualify:
   - Schema accepts a payload it shouldn't (`.strict()` regression).
   - A typed error renders the wrong HTTP status (409 ConflictError
     served as 500 because the catch swallows it).
   - Response envelope changes silently and a client breaks.
   When a real bug surfaces in this gap, it justifies the framework-
   choice + retroactive-coverage design call.
2. **Post-pilot test-pyramid review.** Once we have ~3 months of
   production traffic, do a deliberate review of where bugs are
   landing vs. where coverage is. If route-layer is a hot spot, the
   investment pays. If everything's caught at the service layer
   anyway, the gap was correctly priced.

## Out of scope for the revisit

- **Rewriting existing service-unit tests as integration tests.** The
  service-unit tests exist for a reason (fast, mocked, isolate business
  logic). Replacing them with route-level integration tests trades
  precision for coverage — the wrong trade.
- **Adding integration tests for routes that have no service surface
  (`/api/identity/me/permissions`, webhook receivers).** Those are
  already integration-only by nature; the existing webhook receiver
  test in `tests/integration/` is the precedent.

The gap is **specifically the route shell** — Zod parse, error mapping,
HTTP envelope. Anything wider should be its own follow-up.
