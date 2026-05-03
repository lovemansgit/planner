---
name: Server-component error-handling pattern (designed pages vs. generic 500)
description: Audit every server-rendered page for which AppError subclasses get a designed page vs. fall through to Next's default 500. C-7 surfaced this as an unprincipled default; harden before more pages land.
type: project
originSessionId: fa2223f9-8aa2-4dbf-b07b-c846e80677e5
---
C-7 (`src/app/consignees/page.tsx`) catches **only** `NoTenantConfiguredError` and renders a designed `<SystemNotInitialised />` page. Every other thrown error — production-gate plain `Error`, `ForbiddenError`, `ValidationError`, DB connection drops, anything — falls through to Next.js's default 500 page via `throw err`.

That's correct *for this page* (read-only demo with full Tenant Admin perms; the structurally-reachable error surface is small) but it's not a *pattern* — it's the absence of one. Future server-rendered pages must make a deliberate choice for each AppError subclass.

**The pattern future pages must follow:**

Before merge, decide for each AppError subclass: **designed page or generic 500?** Document the decision in the page-file header. Default-deny: every subclass that *could* surface from this page's code path should be enumerated.

| AppError | Typical handling for a server-rendered page |
|----------|---------------------------------------------|
| `ForbiddenError` | designed "you don't have access" page (403-ish) — never silent 500 |
| `NotFoundError` | Next's `notFound()` (404 page) — for record-by-id pages |
| `ValidationError` | shouldn't reach a server-rendered list/detail page — if it does, treat as 500 |
| `ConflictError` | rare on read paths; treat as 500 unless the page exposes a write trigger |
| `CredentialError` | designed "upstream service degraded" page — better than a generic 500 for ops triage |
| `NoTenantConfiguredError` | designed "system not initialised" page (the C-7 precedent) |

**Why this matters:** a generic 500 leaks no useful information to the operator and produces no actionable path forward. Designed denial / not-found pages give the user something to do, and they keep observability layers (Sentry once §10.2 lands) focused on genuine bugs rather than expected denials.

**Surfaced:** PR #26 (C-7) review, 2026-04-28.

---

## Day 3 specific note: ForbiddenError currently structurally unreachable on /consignees

The C-7 demo page uses full Tenant Admin permissions via `buildDemoContext` (which seeds the actor with `ROLES["tenant-admin"].permissions`), so `requirePermission(ctx, "consignee:read")` inside `listConsignees` always passes. `ForbiddenError` cannot fire on this page today.

**When real auth wiring replaces demo-context, this changes.** Every server-rendered page must audit which permissions its real context carries and design denial paths for the gaps:

  - The new auth context might not carry every permission the page touches (e.g. a CS-Agent-scoped session reading a page that calls a service requiring `consignee:bulk_create`).
  - The audit must happen *before* the auth-wiring PR ships, not after — generic 500s on permission denials are a far worse UX than a designed "you don't have access" page, and once auth is live the bug surfaces silently in production rather than during review.

**How to apply:** the auth-wiring PR is the forcing function. As part of that PR's review checklist, walk every `src/app/**/page.tsx` and confirm:

  1. Which permissions does each service call inside this page require?
  2. Which roles in the new auth model carry those permissions?
  3. For roles that *don't* carry the full set, is the rendered fallback designed or 500?

If any answer is "500," that's a blocker for the auth-wiring PR.
