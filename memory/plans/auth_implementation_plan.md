---
name: Auth implementation plan — Day 10 P1 (T3, hard-stop-twice)
description: Approved Day-9 EOD auth scoping plan for Day-10 implementation. Pivot driver — MVP definition sharpened to "3 test merchants × 1000 tasks × 1 operator each by Day 14" makes auth + onboarding + operator UI the critical path. Supabase Auth + email/password + @supabase/ssr + per-tenant RBAC via existing role_assignments table. Posture A (graceful migration with ALLOW_DEMO_AUTH coexistence) for the auth PR; Posture B (hard cutover) as T1 follow-up after ~48h soak. Test-merchant onboarding CLI bundled in the auth PR. Two watch-list additions locked at approval time: @supabase/ssr cookie handling across RSC/Route-Handler/Server-Action contexts, and password-MUST-NOT-appear in user.login_failed audit metadata.
type: project
---

# Auth implementation plan — Day 10 P1

**Tier:** T3 (auth surface) — hard-stop-twice protocol
**Approved:** Day 9 EOD (3 May 2026)
**Implementation start:** Day 10 morning (after the third batched promotion lands clean)
**Driver:** MVP definition sharpened to "3 test merchants × 1000 tasks × 1 operator each by Day 14" — auth + onboarding + operator UI become the critical path; P4b Tier-2 creds + D8-10 cascade-cancel drop off Day-10 P1.

---

## §0 Critical state inventory

### What's already in place (Day-1 design pays out)

The existing schema was designed for Supabase Auth from day 1 — nothing schema-level needs to change.

| Component | State |
|---|---|
| `supabase/migrations/0001_identity.sql` | `users.id REFERENCES auth.users(id) ON DELETE CASCADE` — tied to Supabase Auth's `auth.users` table |
| `users.tenant_id REFERENCES tenants(id)` | one tenant per user (single-tenant pilot model) |
| `role_assignments(user_id, role_id, tenant_id)` | RBAC ready; permissions composable from role memberships |
| RLS pattern | `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` everywhere — only the SOURCE of `app.current_tenant_id` changes |
| `Actor` discriminated union | `kind: "user"` already specified at `src/shared/tenant-context.ts` |
| `@supabase/supabase-js` 2.104.1 | already installed |

### Scale of swap

`grep -rn "buildDemoContext" src/` returns **16 production call sites** + 0 test fixture references:

- 4 page components: `/admin/failed-pushes`, `/admin/webhook-config`, `/consignees`, `/subscriptions`
- 7 API routes: `/api/tasks` (4 routes), `/api/consignees`, `/api/subscriptions`, `/api/tasks/labels`, `/api/tasks/[id]/asset-tracking`

Every one carries a comment like *"When real auth lands, only buildDemoContext is replaced; this..."* — designed for swap-in replacement.

### Pre-Day-10-morning operator state

- Production HEAD: `c53fea6` (post-PR-#99 EOD batched promotion)
- Main HEAD: `3a0685a` (post-PR-#101 docs-pass batch) — third batched promotion is Day-10 morning's first action
- 3 production-only commits expected per finding-#5 precondition: `c53fea6`, `9283f19`, `15c55e4` — anything else means STOP

---

## §1 Auth provider — Supabase Auth ✅ + dep-add ✅

**Confirmed:** Supabase Auth per `memory/decision_planner_auth_independent.md`.

**Approved dep-add:** `@supabase/ssr` (Next.js 16 app-router standard for SSR/RSC cookie handling). Compatible with the installed `@supabase/supabase-js`.

**Rejected alternatives:** federated SuiteFleet auth (rejected per the planner-auth-independent decision); shared-password two-store sync (rejected, sync hell).

---

## §2 Session resolution architecture

### The replacement function

New file: `src/shared/request-context.ts`. Exports `buildRequestContext(path, requestId): Promise<RequestContext>`. Reads Supabase Auth session from cookies via `@supabase/ssr`, resolves user → tenant → permissions, returns the existing `RequestContext` shape unchanged.

```ts
export async function buildRequestContext(path: string, requestId: string): Promise<RequestContext> {
  const supabase = createServerClient(...);  // @supabase/ssr
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError("login required");

  // Resolve tenant + permissions via single withServiceRole query
  // joining users + role_assignments + roles. One round-trip, not three.
  const { tenantId, permissions } = await resolveUserContext(user.id);

  return {
    actor: { kind: "user", userId: user.id, tenantId, permissions, ipAddress, userAgent },
    tenantId,
    requestId,
    path,
  };
}
```

### Replacement strategy for the 16 call sites

Mechanical swap: `import { buildDemoContext } from "@/shared/demo-context"` → `import { buildRequestContext } from "@/shared/request-context"`, plus the function rename at the call site. Same arity, same return type.

### `ALLOW_DEMO_AUTH=true` coexistence — Posture A confirmed (graceful migration)

- `buildRequestContext` tries real auth first
- If no session AND `ALLOW_DEMO_AUTH=true` (Preview-only) → falls through to `buildDemoContext` legacy path
- If no session AND no `ALLOW_DEMO_AUTH` → throws `UnauthorizedError` → 401 redirect to login

**Posture B (hard cutover)** is a T1 follow-up after ~48h soak. Drops `buildDemoContext` entirely + retires `ALLOW_DEMO_AUTH` env var. NOT in this PR.

---

## §3 Login UI surface

### Email/password (confirmed)

- Most familiar to operators; Supabase provides `signInWithPassword`; works without external services
- New route: `/login` (server component + form server action)
- Email + password fields + submit button
- Error states: invalid credentials, rate-limited, generic 500
- On success: redirect to `/` (or `?redirect=` URL if present)
- Brand: matches `/admin/failed-pushes` precedent (Mulish + Sanchez + warm off-white + hairline borders)

### Logout

- Server action: `signOut` clears cookies via `@supabase/ssr` + redirects to `/login`
- Surface: navbar button (deferred to a future commit if no navbar exists yet — for MVP the logout button can live on a `/profile` stub or even just a `/logout` route)

### Magic link / OAuth — OUT of scope

Magic link defers; OAuth explicitly rejected per the planner-auth-independent decision.

---

## §4 First-tenant-admin bootstrap — CLI script (bundled in auth PR ✅)

### `scripts/onboard-merchant.mjs`

Idempotent CLI. One-line invocation per merchant:

```bash
npm run onboard-merchant -- \
  --slug=tabchilli \
  --name="Tabchilli" \
  --suitefleet-customer-code=TBC \
  --admin-email=ops@tabchilli.com \
  --admin-password=<one-time>
```

Steps in order (all under `withServiceRole`):
1. Upsert `tenants` row (slug PK or returns existing)
2. Create Supabase Auth user via `supabase.auth.admin.createUser` with the given email + password
3. Insert `users` row linking `auth.users.id` to the tenant
4. Insert `role_assignments` row → Tenant Admin role for the merchant tenant
5. Output the merchant's webhook URL + admin login credentials for operator hand-off

**Sandbox Day-10:** Love runs for `tabchilli`, `<merchant-2>`, `<merchant-3>` after auth merges + Preview validation.

**Production:** same script, same invocations. Sysadmin runs them. Operators receive credentials out-of-band (email or 1Password share).

**Self-service signup:** OUT of scope. 3 named operators in the pilot.

---

## §5 Logout + session expiry — defaults are fine

- JWT TTL: 1 hour (Supabase default)
- Refresh token: 1 week (Supabase default — refreshes JWT silently)
- Idle timeout: not enforced
- Logout: explicit `signOut` clears cookies + invalidates refresh token

**One verification at impl-time:** refresh-token-cookie httpOnly + Secure + SameSite=Lax. `@supabase/ssr` defaults handle this; explicit confirm during implementation.

---

## §6 RLS interaction — pattern unchanged ✅

**Existing pattern preserved.** RLS continues to filter on `app.current_tenant_id` via `current_setting`. Today: `withTenant(tenantId, ...)` sets `app.current_tenant_id` from the demo-synthetic value. Post-auth: `withTenant(ctx.tenantId, ...)` sets it from the session-resolved value. **No RLS migration needed.**

### Critical security invariant

The session-resolved `tenantId` MUST be the only source. Reject any code path that tries to pass a non-session-derived tenantId to `withTenant`:
- URL params claiming tenant_id → ignored
- Request body `tenant_id` field → ignored
- Header-supplied tenant_id → ignored

**Defence-in-depth:** even if auth resolution had a bug, RLS's `app.current_tenant_id` filter and the existing `*_assert_tenant_match` triggers prevent cross-tenant data leak. R-3 regression test (`tests/integration/rls-tenant-isolation.spec.ts`) confirms.

---

## §7 Test plan (~25-30 unit + 3-5 integration)

### Unit

- `src/shared/tests/request-context.spec.ts` — session-present (returns valid ctx); session-absent + ALLOW_DEMO_AUTH (falls through); session-absent + no demo (throws Unauthorized); session valid but user has no tenant_id (throws); session valid but no role_assignments (returns empty permissions set); permission composition from multi-role user
- `src/app/login/tests/page.spec.tsx` — form renders; invalid credentials path; rate-limit path; redirect on success
- `src/app/logout/tests/route.spec.ts` — clears cookies; redirects to /login

### Integration

- `tests/integration/auth-end-to-end.spec.ts` (new):
  - login → /api/tasks (200, scoped to user's tenant)
  - cross-tenant: user A → /api/tasks → returns user A's tenant only (RLS confirms)
  - cross-tenant injection: user A → /api/tasks?tenant=B → still returns user A's tenant (URL ignored)
  - revoked role: user A's `role_assignments` deleted → /api/tasks → 401 or empty
  - logout → /api/tasks → 401
  - **Per Watch-list addition #1:** at least one test exercises each of the three Next.js contexts — Server Action (`/login`), Route Handler (`/api/tasks` GET), RSC (`/admin/webhook-config` server-component render). Pin the cookie-handling contract.

### Smoke (Playwright deferred per project convention; Vercel Preview + manual covers)

---

## §8 Scope boundary

### IN

- `@supabase/ssr` dep add
- `src/shared/request-context.ts` — new session-resolution helper
- 16 call site migrations (mechanical)
- `/login` page + server action
- `/logout` route + server action
- `scripts/onboard-merchant.mjs` — first-admin bootstrap CLI
- Posture A graceful migration (ALLOW_DEMO_AUTH fallback preserved)
- Test plan above
- Audit emit on login success / login failure (closes the auth-path slice of `followup_audit_failed_attempts.md`)
- New audit event `user.login_failed` registered (systemOnly: false; metadata per Watch-list addition #2)

### OUT (deferred)

- Self-service signup
- Password reset email flow (post-MVP if time permits)
- MFA
- OAuth providers
- Account-management UI (change password, delete account, profile)
- Email verification (trust seeded users for MVP)
- ALLOW_DEMO_AUTH retirement (Posture B follow-up T1 after ~48h soak)
- Per-role login redirect (just send everyone to `/`)
- Session-idle UX polish

---

## §9 Test-merchant onboarding script — SAME commit as auth wiring ✅

Bundling rationale: the script is required for Preview testing the auth path itself. Without it, Day-10/11 testing is blocked because there are no real auth users in any environment. Splitting it into a follow-up creates a chicken-and-egg.

The CLI script touches Supabase Auth's admin API (which requires the service-role key, not the anon key) → uses `SUPABASE_SERVICE_ROLE_KEY`. Add to `.env.example` + Vercel Production + Preview scopes (operator-executed env-add).

---

## §10 Watch-list for reviewer

1. **Cross-tenant access via session manipulation** (security-load-bearing) — pinned in integration test §7. URL-spoofing, body-spoofing, header-spoofing all rejected. RLS confirms.
2. **RLS still gates as source of truth** — defence-in-depth preserved. R-3 regression test continues to pass; new auth-integration test layers on top.
3. **`buildDemoContext` call sites migrated** — `grep -r "buildDemoContext" src/` post-merge should hit ZERO production code paths. Reviewer runs the grep as a closure check.
4. **`ALLOW_DEMO_AUTH=true` Preview pathway** — graceful coexistence per Posture A. NOT retired in this commit; tracked as follow-up.
5. **Sentry capture on auth failures** — closes the auth-path slice of `memory/followup_audit_failed_attempts.md`. Audit event vocab gains `user.login_failed` (systemOnly: false).
6. **`@supabase/ssr` dep add surface** — single line in `package.json`; reviewer confirms.
7. **`SUPABASE_SERVICE_ROLE_KEY` env var** — needed by the onboarding script. Server-only (Production + Preview, not Development per convention). NEVER exposed to client.
8. **Preview env-var requirements:** Vercel Preview needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the SSR client. Confirm against Vercel env state.

### 🆕 Watch-list addition #1 (locked at approval) — `@supabase/ssr` cookie handling across contexts

`createServerClient`'s cookie semantics differ between RSC / Route Handler / Server Action in Next.js 16. The `buildRequestContext` helper must handle all three correctly. Surface inline at PR open.

Integration test (per §7) must exercise at least one of each context to pin the contract:
- **Server Action context:** `/login` form submission
- **Route Handler context:** `/api/tasks` GET
- **RSC context:** `/admin/webhook-config` server-component render

If any of the three fails to read/write cookies correctly, the auth wiring is not complete.

### 🆕 Watch-list addition #2 (locked at approval) — `user.login_failed` audit metadata hygiene

Metadata = `{ email, reason, ip_address }` only.

**Password MUST NOT appear in metadata under any encoding.** Not hashed. Not prefixed. Not first-N-chars. Not as a Boolean ("password was supplied"). Nothing password-derived.

`reason` is a structured enum:
- `invalid_credentials` — email exists but password wrong
- `rate_limited` — Supabase rate-limit hit
- `account_disabled` — `users.disabled_at IS NOT NULL` or equivalent
- `unknown` — catch-all for unrecognised failure modes

`email` is the email submitted (NOT necessarily a real user — log it as-typed for forensic value, but only the email address itself, no PII beyond what was already public via the form).

`ip_address` is the request's resolved IP (via Vercel headers).

Closes the auth-path slice of `followup_audit_failed_attempts.md`. The wider denied-event vocabulary across all service methods stays open as a separate follow-up.

---

## §11 Day-10 sequencing (locked Day-9 EOD)

1. **Pre-execution check on third promotion per finding #5:** `git log origin/main..origin/production` must return ONLY:
   ```
   c53fea6 promote: 2026-05-03 EOD — P4a + D8-4b + Day-9 memos (#99)
   9283f19 promote: 2026-05-03 — D8-8 + Days 2-8 backlog (#91)
   15c55e4 chore(deploy): trigger Production build after Vercel branch reconfig
   ```
   If output matches exactly, `-X theirs` is safe. If anything else appears, STOP and surface to Love.

2. **Third batched promotion** via amended runbook (PR #102, T2). Hard-stop at PR open. Validates the amended runbook on fresh head.

3. **If the third promotion surfaces a structural issue (finding #6):** pause auth work, reassess, surface to Love. Don't push procedural surprises into auth.

4. **If clean:** kick off auth implementation per this plan. T3 protocol — implementation begins, hard-stop AGAIN at auth PR open (second hard-stop), counter-review, merge.

5. **After auth merges and validates in Preview:** Love runs the onboarding CLI for 3 test merchants. Output collected.

6. **Hard-stop after auth + onboarding.** P2 (operator nav + landing page) starts on a clean foundation.

---

## §12 Three confirms (locked at approval)

1. ✅ `@supabase/ssr` dep add
2. ✅ Posture A (graceful migration with ALLOW_DEMO_AUTH coexistence) for the auth PR; Posture B (hard cutover) as T1 follow-up after ~48h soak
3. ✅ Test-merchant onboarding CLI bundled in the auth PR

---

## Cross-references

- `memory/decision_planner_auth_independent.md` — the Day-3 decision establishing Supabase Auth + no-sync-with-SuiteFleet
- `memory/followup_audit_failed_attempts.md` — Day-4 gap; auth-path slice closes via the `user.login_failed` audit event in this commit
- `memory/handoffs/day-9-eod.md` §6 — Day-10 priority order pre-pivot (P2 P4b drops; P3 D8-10 cascade-cancel drops; auth becomes the new P1)
- `memory/feedback_vercel_env_scope_convention.md` — Production + Preview only for the new `SUPABASE_SERVICE_ROLE_KEY` env var
- `src/shared/tenant-context.ts` — the existing `Actor` + `RequestContext` shapes the new helper returns
- `src/shared/demo-context.ts` — the to-be-coexisting demo-context legacy path
- `supabase/migrations/0001_identity.sql` — the auth-ready schema (users.id REFERENCES auth.users(id))
- `tests/integration/rls-tenant-isolation.spec.ts` — R-3 regression test that confirms RLS gates as defence-in-depth
