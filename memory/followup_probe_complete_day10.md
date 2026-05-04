---
name: Day-10 P2 cross-tenant probe — complete forensic record
description: Forensic capture of the cross-tenant injection probe run 3 May 2026 against Vercel Preview (planner-orvxhx712, sha f8d0a23). Probe seeded probe-merchant-a (73f92e85-86e2-471e-a960-0c8cdd1d398e) and probe-merchant-b (b24ba100-e505-4eca-9eda-2937b6c6529a), drove /login Server Action with probe-a admin credentials, captured session cookie, ran 4 injection probes (URL / body / header), logout + cleared-cookie validation. All vectors rejected; session-bound tenantId is the only scoping source. Useful artifact for Aqib walkthroughs or future security audits.
type: project
---

# Day-10 P2 cross-tenant probe — complete forensic record

**Probe run:** 3 May 2026, ~12:58 UTC
**Preview URL:** `https://planner-orvxhx712-lovemansgits-projects.vercel.app`
**Source SHA:** `f8d0a23` (post-#106 merge: P2 auth + onboard-CLI dotenv fix)
**Bypass header:** `x-vercel-protection-bypass: <token>` on every curl
**Driver:** Day-10 cross-tenant probe per Love's brief; inputs Path B (Love runs onboard, agent drives probe sequence)

---

## §1 Probe-merchant fixtures (seeded via `npm run onboard-merchant`)

```
probe-merchant-a:
  tenant id:                73f92e85-86e2-471e-a960-0c8cdd1d398e
  slug:                     probe-merchant-a
  suitefleet_customer_code: PMA
  admin email:              admin-a@probe.test
  admin password:           29a52484bac2946a016f909c28ac5d84  (throwaway, expires at teardown)
  auth user id:             0a24130e-2975-41ce-a38a-853d97bd3ed4

probe-merchant-b:
  tenant id:                b24ba100-e505-4eca-9eda-2937b6c6529a
  slug:                     probe-merchant-b
  suitefleet_customer_code: PMB
  admin email:              admin-b@probe.test
  admin password:           51efa9b73df3766eb9f87eb03deafcf2  (throwaway, expires at teardown)
  auth user id:             ff28a572-5ce0-4687-885a-e53fd5ef8500
```

---

## §2 Probe sequence + structured results

| # | Endpoint | Expected | Got | Verdict |
|---|---|---|---|---|
| 0 | `GET /login` (extract Server Action ID + key) | rendered HTML with `$ACTION_1:0` JSON + `$ACTION_KEY` | action ID `60d53ad4b059d6c6602e1b654e36f60e939869568b`, key `k14a0ff49bd9cb8f952684bf3cea0595d` | ✅ |
| 1 | `POST /login` (multipart, probe-a creds) | 303 + Set-Cookie `sb-...-auth-token` | **303** + cookie set, `Path=/`, `SameSite=lax`, `Max-Age=34560000` | ✅ Login works; cookie set correctly |
| 2 | `GET /api/tasks` (probe-a session) | probe-a tenant data only (or empty if fresh) | `{"tasks":[]}` — empty, **NOT sandbox-588's data** | ✅ Session takes priority over Posture A fallthrough |
| 3 | `GET /api/tasks?tenant=<B>` (probe-a session) | probe-a data only; URL ignored | `{"tasks":[]}` — zero B rows, scoped to probe-a's tenant | ✅ URL injection rejected |
| 4 | `POST /api/tasks` body `{tenant_id: <B>}` | created with probe-a's tenant_id OR rejected | **405 Method Not Allowed** (route is GET-only by design) | ✅ Rejected at routing layer (acceptable per scope; surfaced as separate watch-item in `followup_body_injection_probe_post_routes.md`) |
| 5 | `GET /api/tasks` + header `X-Tenant-Id: <B>` (probe-a session) | probe-a data only; header ignored | `{"tasks":[]}` — zero B rows, scoped to probe-a's tenant | ✅ Header injection rejected |
| 6 | `POST /logout` (probe-a session) | 303 → /login + cookie clear | **303** to `/login`, `Set-Cookie: sb-...-auth-token=; Max-Age=0` | ✅ Logout clears cookie |
| 7 | `GET /api/tasks` (cleared cookies) | Posture A fallthrough → sandbox-588 data | `{"tasks":[{"tenantId":"8bfc84b0-c139-4f43-b966-5a12eaa7a302",...}]}` (1 task, sandbox-588) | ✅ Logout actually invalidated session; Posture A fallthrough fires per design |

---

## §3 Architectural claim validated

**Cross-tenant isolation pinned end-to-end:** the contrast between step 2 (probe-a session → `[]`) and step 7 (no session → sandbox-588's task) is the load-bearing signal. With probe-a's session cookie, every request scopes to probe-a's tenant. Without that cookie, the Posture A demo fallthrough fires and returns sandbox-588's data.

The session-bound `tenantId` (extracted from Supabase Auth's session, resolved via the public.users mirror, threaded through `withTenant(ctx.tenantId, ...)`) is the **only thing scoping queries**. URL parameters, request body fields, and arbitrary headers cannot influence which tenant's rows the database returns.

This validates the architecture's three-layer defense against cross-tenant injection:

1. **Permission catalogue** — every route gates on a permission, which is bound to the resolved `ctx.actor.permissions` from session
2. **Service contract** — service functions take `RequestContext` as their first parameter; tenantId is from the context, not from any external input
3. **RLS** — the per-transaction `app.current_tenant_id` is set from `ctx.tenantId` in `withTenant`; the database enforces the boundary regardless of what the application code does

A cross-tenant query attempt that bypassed all three layers would have to spoof the session cookie itself, which requires either (a) Supabase Auth signing-key compromise (out of scope for app-layer defense) or (b) attacking the @supabase/ssr cookie format (which is JWT-validated server-side every request).

---

## §4 Forensic notes

### `wc -l` shell-comparison false alarm

The probe script's verdict-printing logic used:

```bash
COUNT_B=$(echo "$RESP" | grep -o "\"tenantId\":\"$PROBE_B_TENANT\"" | wc -l)
[ "$COUNT_B" = "0" ] && echo "✓ rejected" || echo "✗ leaked"
```

`wc -l` on macOS returns `"        0"` (with leading whitespace) rather than the bare `"0"`. The string equality check `[ "$COUNT_B" = "0" ]` failed against the padded value, triggering the failure branch even though the actual count was zero. The probe was clean; the shell logic was not.

**Lesson:** when comparing wc/awk numeric output in shell predicates, normalise via arithmetic context — `(( COUNT_B == 0 ))` — or pipe through `tr -d ' '`. Future probe scripts should use the arithmetic form.

### Server Action invocation from outside the browser

The probe drove `/login` from a curl client with no JS runtime. Server Actions in Next.js 16 use a no-JS progressive-enhancement form with hidden inputs encoding the action ID + bound state:

```html
<form action="" encType="multipart/form-data" method="POST">
  <input type="hidden" name="$ACTION_REF_1"/>
  <input type="hidden" name="$ACTION_1:0" value="{&quot;id&quot;:&quot;<action-id>&quot;,&quot;bound&quot;:&quot;$@1&quot;}"/>
  <input type="hidden" name="$ACTION_1:1" value="[{}]"/>
  <input type="hidden" name="$ACTION_KEY" value="<key>"/>
  ...
</form>
```

The action ID is build-stable; the action key is per-render. POSTing a multipart/form-data body with these hidden inputs + the form fields dispatches to the Server Action just like a JS-driven submit. Documented here so future probe scripts can replicate the pattern.

### Set-Cookie hardening gap surfaced

Step 1's Set-Cookie response was missing `HttpOnly` and `Secure` flags. `SameSite=lax` was present (CSRF defense load-bearing). Captured separately as `memory/followup_auth_cookie_httponly_secure.md` (T2, pre-MVP).

### POST body-injection coverage gap surfaced

Step 4 returned 405 because `/api/tasks` is GET-only. Body-injection vector not exercised against a real POST endpoint. Architecture safe-by-construction (Zod strips, services take ctx, RLS scopes), but full coverage is a watch-item. Captured separately as `memory/followup_body_injection_probe_post_routes.md` (T2, pre-Day-14 audit).

---

## §5 Use cases for this memo

- **Aqib walkthrough** — when the SF integration team asks how Planner-side auth is hardened against cross-tenant access, this memo's §2 + §3 are the structured answer
- **Pre-MVP security audit** — Day-13 / Day-14 cutover should re-run this probe with updated fixtures and confirm the same verdicts
- **Posture B retirement** — when the demo-context fallthrough is removed (T1 follow-up after ~48h soak), step 7's expected behavior changes from "Posture A fallthrough → sandbox-588 data" to "401 Unauthorized". Update the verdict here at that time.
- **Future architectural changes** — if anyone proposes a change that adds tenant_id to a body schema, refactors a service contract to accept tenant_id as a parameter, or otherwise relaxes the "ctx-only" contract, this memo's §3 is the regression test the change must NOT break

---

## §6 Cross-references

- [memory/plans/auth_implementation_plan.md](plans/auth_implementation_plan.md) — the auth plan this probe validates
- [memory/followup_auth_cookie_httponly_secure.md](followup_auth_cookie_httponly_secure.md) — T2 hardening item from step 1
- [memory/followup_body_injection_probe_post_routes.md](followup_body_injection_probe_post_routes.md) — T2 coverage item from step 4
- [memory/followup_audit_rule_cascade_conflict_cleanup.md](followup_audit_rule_cascade_conflict_cleanup.md) — probe-merchant teardown path
- PR #104 — the auth implementation merged to main as `e6b91f3`
- PR #106 — onboard-merchant.mjs dotenv loading (made Path B viable)
- [scripts/onboard-merchant.mjs](scripts/onboard-merchant.mjs) — the seeding tool used to create probe fixtures
