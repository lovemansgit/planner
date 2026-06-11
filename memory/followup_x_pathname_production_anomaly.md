---
name: x-pathname middleware production anomaly — PR #127 fix not observed at runtime
description: PR #127 (middleware shim setting x-pathname header so /login?next= preserves the original path) shipped to production via the Day-12 EOD batched promotion (#132). Post-deploy validation observed unauthed GET /tasks (with Vercel bypass-token header) redirecting to /login?next=%2F — the same fallback behavior the fix was supposed to eliminate. Auth gate fires correctly (security working as designed); the next-param path-preservation is the part not active. UX nit, not a security gap. Most likely hypothesis is bypass-token + middleware interaction (the probe path differs from real-operator path); empirical disambiguation requires a real expired/cleared session probe without the bypass header. Open until that disambiguation lands; if hypothesis confirms, no fix needed (#127 works for the path that matters); if still anomalous, deeper diagnosis follows.
type: project
---

# x-pathname middleware production anomaly — PR #127 fix not observed at runtime

**Surfaced:** 5 May 2026 (Day-12 EOD post-promotion validation)
**Source PR (intended fix):** [#127](https://github.com/lovemansgit/planner/pull/127) — `fix(auth): T1-A — middleware shim sets x-pathname so /login?next= preserves the original path`
**Promotion that brought it to production:** [#132](https://github.com/lovemansgit/planner/pull/132) — sixth-since-R-0-prep
**Status:** open; awaits real-session disambiguation probe post-Day-14

---

## §1 What was observed

Post-Day-12-EOD-promotion validation against `https://planner-olive-sigma.vercel.app`:

```
GET /tasks (no Supabase session, with Vercel bypass-token header)
  → 307 Location: /login?next=%2F
    Total: 0.364s
```

Expected per PR #127's fix:

```
GET /tasks (no Supabase session)
  → 307 Location: /login?next=%2Ftasks   ← path-preservation active
```

Auth gate fires correctly; the redirect happens, the user is sent to `/login`. The piece NOT working: the `?next=` query param carries `%2F` (root) instead of `%2Ftasks` (the originally-attempted page).

PR #127 unit tests pass (6/6) — the middleware helper sets the right sentinel response headers given a NextRequest. The runtime behavior in production diverges from the test surface.

## §2 Severity

**UX nit. Not a security gap.**

- Auth gate works: unauthed users cannot reach `/tasks`; they are redirected to `/login`.
- Tenant scoping works: post-login, the operator's session-bound `tenantId` is the only scoping source per the existing R-3 + post-promotion validation chain.
- The user impact: post-login the operator lands at `/` (the workflow-shortcut landing page) instead of `/tasks` directly. One extra click via the nav.

Not blocking for Day-14 demo.

## §3 Hypotheses (NOT confirmed)

Listed in priority order based on the Day-12 surface:

### H1 — Vercel bypass-token routing interacts with middleware execution

The validation probe used `x-vercel-protection-bypass: <token>` to bypass deployment-protection. That code path may run differently from a real operator request:

- Vercel may serve the request via a fast-path that skips application middleware
- The bypass header may be terminated at the edge before the function sees it
- The combination of bypass + Next.js middleware may have an undocumented interaction

If this hypothesis is correct, **PR #127 works for the path that matters** (real operators with valid/cleared Supabase cookies, no bypass token) and the validation probe is the wrong test for this fix.

### H2 — middleware matcher pattern not actually matching `/tasks` in production

Matcher: `"/((?!_next/static|_next/image|favicon.ico).*)"` (negative lookahead).

In unit tests, the middleware function was called directly, bypassing Next.js's matcher. The matcher was never empirically tested against the runtime request path. A subtle path-to-regexp parsing difference between Next.js 16's matcher engine and the regex semantics expected could mean `/tasks` doesn't actually match.

If correct: tighten matcher to a known-good pattern (e.g., explicit list of paths or a different exclusion shape).

### H3 — middleware runs but x-pathname header doesn't propagate to the layout

Middleware uses `NextResponse.next({ request: { headers: requestHeaders } })`. The expected mechanism: Next.js's runtime translates the response-side sentinels (`x-middleware-override-headers` + `x-middleware-request-x-pathname`) into incoming request headers for downstream server components. The `(app)/layout.tsx` reads via `headers().get("x-pathname")`.

If the propagation breaks somewhere between middleware response and server-component header read — possibly a Next.js 16 production-mode quirk — the layout sees the original (empty) header and falls through to the `?? "/"` default.

Test surface gap: the unit test pinned the SENTINEL output but did not exercise the actual round-trip from middleware → server-component header read. That round-trip is what the production probe tests.

### H4 — Next.js 16 production-mode middleware semantics differ from dev

Less likely but possible: the `react-hooks/purity` rule firing on `performance.now()` (caught during PR #129 lint) hints at Next.js 16 / React 19 having stricter purity expectations. The middleware itself doesn't violate purity, but if the runtime has any other production-mode sharpening that affects `NextResponse.next({ request: { ... } })`, the symptom would match.

## §4 Empirical disambiguation step

The cleanest probe: hit `/tasks` from a real operator browser session that has been logged in then logged out (so the cookie is cleared but the user-agent and other request shape match real operator behavior). DO NOT use `x-vercel-protection-bypass` — use the production URL directly with a normal browser.

Procedure for Love (post-Day-14 cleanup):

1. Browser → `https://planner-olive-sigma.vercel.app/login`
2. Sign in as any operator (mpl/dnr/fbu admin)
3. Navigate to `/tasks` — confirm it loads (logged in)
4. Open the nav → click "Sign out" (POST to /logout)
5. While still on the resulting `/login` page, open a NEW tab and navigate to `https://planner-olive-sigma.vercel.app/tasks`
6. Observe the redirect target. Network tab → look at the redirect chain.
   - If `/login?next=%2Ftasks` → **H1 confirmed.** PR #127 works for the real-operator path. No fix needed; close this memo.
   - If `/login?next=%2F` → **H2/H3/H4 territory.** Deeper diagnosis follows.

Alternative: replicate via `curl` without the bypass token. The deployment is publicly addressable (preview-protection only blocks unauthenticated PROBE access, but the real production URL serves real traffic). A `curl -I https://planner-olive-sigma.vercel.app/tasks` without bypass should show the redirect Location.

## §5 What we know works (region-pin context)

The Day-12 EOD promotion (#132) carried PR #127 alongside PR #130 (region pin to bom1). The region pin is **verified working** — sub-400ms warm hits on /tasks, ~15-20× improvement realised in production. So the deploy itself is healthy; only the x-pathname behavior is anomalous.

The middleware file IS deployed (it's in the squash; build registered `ƒ Proxy (Middleware)`). It's running on SOMETHING. The question is whether `/tasks` paths are reaching it AND whether the header propagation works.

## §6 Cross-references

- [PR #127](https://github.com/lovemansgit/planner/pull/127) — the intended fix
- [PR #130](https://github.com/lovemansgit/planner/pull/130) — region pin (verified working in same promotion)
- [PR #132](https://github.com/lovemansgit/planner/pull/132) — Day-12 EOD promotion that carried both
- [middleware.ts](../middleware.ts) — the file
- [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) — the consumer of x-pathname (lines 60-64 `currentPath()`)
- [tests/unit/middleware.spec.ts](../tests/unit/middleware.spec.ts) — the unit tests that pass; gap is round-trip coverage
- [memory/followup_diagnosis_pattern_request_trace_first.md](followup_diagnosis_pattern_request_trace_first.md) — the diagnosis-pattern memo from Day 12; principle "request trace before instrumentation" applies here too — when this disambiguation runs, browser devtools network tab is the right first probe, not adding more code

---

*Open until disambiguation probe lands. If H1 confirmed, close. If H2/H3/H4, deeper investigation gets its own memo.*
