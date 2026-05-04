---
name: P4 introduces double session resolution per authenticated request
description: After P4 (PR #117) every authenticated route fires buildRequestContext twice — once from src/app/(app)/layout.tsx, once from the page itself. Each call hits supabase.auth.getUser() AND resolveUserContext (a join across users + role_assignments + roles). Pre-PR: 1 resolve per request. Post-PR: 2 resolves per request. Surfaced during PR-#117 review (4 May 2026) and accepted as ship-as-is with this follow-up filed pre-P5. Fix is a thin React cache() wrapper around an extracted resolveSession() helper; trade-off is test infrastructure adjustment for cache() behavior in vitest.
type: project
---

# P4 introduces double session resolution per authenticated request

**Surfaced:** 4 May 2026 (Day 11, PR #117 pre-merge review)
**Status:** filed pre-P5; fix lands as a small T2 follow-up before P5 implementation begins
**Tier of the fix PR:** T2 (touches T3 auth-surface code but the change is structural, not semantic)

---

## §1 The regression

After PR #117 squash-merged, the operator UI's authenticated request path fires two independent session resolutions:

```
GET /admin/failed-pushes
  ├─ src/app/(app)/layout.tsx renders → buildRequestContext("/", req-A)
  │     ├─ supabase.auth.getUser()         (cookie → JWT verify)
  │     └─ resolveUserContext(user.id)     (DB: users ⨝ role_assignments ⨝ roles)
  │
  └─ src/app/(app)/admin/failed-pushes/page.tsx renders → buildRequestContext("/admin/failed-pushes", req-B)
        ├─ supabase.auth.getUser()         (cookie → JWT verify, AGAIN)
        └─ resolveUserContext(user.id)     (DB query, AGAIN)
```

The expensive part is `resolveUserContext` — it joins three tables. Doubling it on every operator page load is meaningful at scale (3 tenants × 1 operator × steady-state navigation is fine; pilot stays healthy). The fix is structural, not urgent — but should land before P5 because the same pattern will recur on every new page added under `(app)/`.

Pre-PR-#117 baseline: 1 resolve per request. Each page called `buildRequestContext` once at the top of its server component, no layout wrapper ran auth.

Post-PR-#117: 2 resolves per request. Layout's auth resolution feeds the nav's permission-driven filtering; pages keep their own resolution because the moved files were path-only edits.

## §2 Why it shipped this way

The plan ([memory/plans/p4_operator_nav_plan.md](plans/p4_operator_nav_plan.md)) called for the layout to resolve auth and pass the permission set to `<TopNav>`. It did NOT call out that the moved pages would continue to resolve auth themselves — the route-group migration was billed as path-only.

Both halves of that posture are correct in isolation:
- Layout SHOULD resolve auth, because the nav needs `permissions` to filter visibility, and the layout is the natural home for the cross-page nav surface.
- Moved pages SHOULDN'T be touched mechanically beyond the path move, because that keeps the migration low-risk.

What was missed: combining them creates the double-resolve surface. Surfaced during PR-#117 counter-review on Day 11 (4 May 2026); accepted as ship-as-is with this follow-up filed pre-P5.

## §3 Fix sketch (~50-line PR)

Extract the expensive part of `buildRequestContext` into a memoizable helper, wrap with React's `cache()`, then have `buildRequestContext` compose against the cached result.

```ts
// src/shared/request-context.ts (sketch, not committed)
import { cache } from "react";

interface ResolvedSession {
  readonly userId: string;
  readonly resolved: ResolvedUserContext;
}

/**
 * Per-request memoized session resolution. React's cache() scopes the
 * cached result to the current server-component render lifecycle, so
 * the layout + page in the same request share one resolution.
 *
 * Returns null when the visitor is not signed in. Throws
 * UnauthorizedError when signed in but not provisioned (mirrors the
 * old buildRequestContext behavior).
 */
const resolveSessionCached = cache(async (): Promise<ResolvedSession | null> => {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const resolved = await resolveUserContext(user.id);
  if (!resolved) {
    throw new UnauthorizedError("user account is not provisioned");
  }
  return { userId: user.id, resolved };
});

export async function buildRequestContext(path: string, requestId: string): Promise<RequestContext> {
  const session = await resolveSessionCached();
  if (session) {
    return {
      actor: {
        kind: "user",
        userId: session.userId,
        tenantId: session.resolved.tenantId,
        permissions: session.resolved.permissions,
        email: session.resolved.email,
        displayName: session.resolved.displayName,
      },
      tenantId: session.resolved.tenantId,
      requestId,
      path,
    };
  }
  if (process.env.ALLOW_DEMO_AUTH === "true") {
    return await buildDemoContext(path, requestId);
  }
  throw new UnauthorizedError("login required");
}
```

The signature of `buildRequestContext` is unchanged. Layout + page both call it with their own `path` + `requestId`, and the cached `resolveSessionCached()` returns the same resolution for both — one DB query per request, regardless of how many components ask for the context.

## §4 Test infrastructure question

The existing test at [src/shared/tests/request-context.spec.ts](../src/shared/tests/request-context.spec.ts) calls `buildRequestContext` once per `it()` block with a fresh mock setup. React's `cache()` deduplicates by argument — `resolveSessionCached()` takes no arguments, so within a single module-scope it caches exactly one result.

Across tests, `vi.clearAllMocks()` in `afterEach` resets `mockGetUser` + `mockExecute` but does NOT clear React's cache. Without intervention, test #2 would observe test #1's cached resolution.

Two viable approaches:
1. **`vi.resetModules()` between tests + dynamic import.** Forces a fresh module instance per test, which gets a fresh cache. Cleanest semantically; modest test rewrite.
2. **Test the inner uncached function directly.** Export `resolveSessionImpl` (the uncached version) for testing; export the cached version for production. Tests don't exercise the cache wrapper but the wrapper is so thin there's no logic to break.

Lean toward (2) for the fix-PR — minimal test churn, the cache wrapper is a one-line composition that's not worth a dedicated test path.

## §5 Why this is pre-P5 not pre-MVP-go-live

P5 ships `/tasks` (the operator workflow page). It will inherit the same double-resolve pattern by default — every new page under `(app)/` calls `buildRequestContext`, and the layout's call doubles every one of them. Fixing the structure before P5 means P5 ships clean; deferring means P5 inherits the regression and the fix touches more files.

MVP-go-live (Day 14) is not the gating concern — pilot scale (3 tenants × 1 operator each × normal navigation) absorbs 2 resolves per page load without a problem. The gate is "before more pages adopt the pattern."

## §6 Cross-references

- [memory/plans/p4_operator_nav_plan.md](plans/p4_operator_nav_plan.md) — the plan whose execution introduced this; §2 (Permission model) is where the fix's caching contract lives semantically
- [src/shared/request-context.ts](../src/shared/request-context.ts) — the file the fix touches
- [src/shared/tests/request-context.spec.ts](../src/shared/tests/request-context.spec.ts) — the test surface that needs the small adjustment
- [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) — first call site
- [src/app/(app)/page.tsx](../src/app/(app)/page.tsx), [src/app/(app)/consignees/page.tsx](../src/app/(app)/consignees/page.tsx), [src/app/(app)/subscriptions/page.tsx](../src/app/(app)/subscriptions/page.tsx), [src/app/(app)/admin/failed-pushes/page.tsx](../src/app/(app)/admin/failed-pushes/page.tsx), [src/app/(app)/admin/webhook-config/page.tsx](../src/app/(app)/admin/webhook-config/page.tsx) — the 5 second-call sites
