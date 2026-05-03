---
name: P4 operator nav + landing page plan — Day 10/11 (T2)
description: Plan-only memo for the operator-facing top nav + landing page that follows the Day-10 P2 auth merge. Top nav (horizontal header, not sidebar) with permission-gated visibility per role; minimal landing page surfacing the two highest-frequency operator destinations (Today's tasks + Failed pushes); logout via POST form against the existing /logout route handler. T2 (no schema, no security-load-bearing surface; auth gating is the existing RLS + permission layer). Plan gets reviewed alongside the auth PR (#104) before P4 implementation kicks off.
type: project
---

# P4 operator nav + landing page plan

**Tier:** T2 (operator UI, no schema/security surface — defers to existing RLS + permission gates)
**Driver:** MVP definition — *3 test merchants × 1000 tasks × 1 operator each by Day 14.* After auth (P2) and onboarding (P3), operators need to navigate the system without typing URLs.
**Status:** plan-only — no code in this PR. Implementation lives in a follow-up PR after the auth PR (#104) merges and validates in Preview.
**Hard-stop:** plan-memo only; do NOT open a P4 implementation PR today. Reviewed alongside #104 by Love.

---

## §0 What's already in place

After P2 auth merges:

- 4 pages (`/admin/failed-pushes`, `/admin/webhook-config`, `/consignees`, `/subscriptions`) and 12 API routes resolve `RequestContext` via `buildRequestContext`
- Permission catalogue (per `src/modules/identity/permissions.ts`) covers every nav-relevant resource
- Brand tokens at `src/styles/brand-tokens.css` (warm off-white surface, deep navy fg, hairline borders, Mulish + Sanchez)
- `/login`, `/logout` exist and work
- `RootLayout` at `src/app/layout.tsx` wraps everything in Mulish + Sanchez + brand stylesheet

What's missing:

- Top nav rendered on every authenticated page
- Landing page at `/` (currently a stub at [src/app/page.tsx:1-8](src/app/page.tsx) saying "Build in progress")
- Logout affordance visible to operators
- Active-route indicator on the current page

---

## §1 Routing structure

### Decision: top nav (horizontal header), not sidebar

**Why:** 5 nav items max in pilot. A sidebar's affordance — vertical scroll, dense link grouping — is overkill for that count and steals horizontal real estate from the actual data view. A horizontal header sits flush with the page header and matches the brand's clean / spacious posture (per existing pages' `mx-auto max-w-* px-12 py-16` shape).

### Route inventory the nav links to

| Label              | Path                       | Permission gate         | Currently exists? |
|--------------------|----------------------------|-------------------------|-------------------|
| Home (logo only)   | `/`                        | (none — auth gates)     | stub              |
| Tasks              | `/tasks`                   | `task:read`             | NO (P5 ships it)  |
| Subscriptions      | `/subscriptions`           | `subscription:read`     | YES               |
| Consignees         | `/consignees`              | `consignee:read`        | YES               |
| Failed pushes      | `/admin/failed-pushes`     | `failed_pushes:retry`   | YES               |
| Webhook config     | `/admin/webhook-config`    | `webhook_config:read`   | YES               |

`/tasks` is a forward reference. P4 ships the nav linking to it; P5 ships the page itself. Acceptable: if an operator clicks the nav link before P5 lands, they get a 404 (Next.js default), which is informational rather than broken.

### Layout shape

Two options for nav placement:

- **A) Render unconditionally in `RootLayout`, hide on `/login`** — simplest, one layout file, conditional render. Drawback: the layout has to do a session lookup just to decide whether to render the nav, which means every page (including `/login`) pays the auth-resolve cost.
- **B) Route group `(app)` with its own layout, `/login` outside the group** — Next.js idiomatic, cleaner separation, no auth-resolve cost on `/login`. Migration: move 4 existing pages + (future) `/tasks` under `src/app/(app)/`.

**Recommend B.** The migration cost is paid once; ongoing wins (no auth lookup on `/login`, separable middleware later) outweigh the one-time move.

```
src/app/
├── (app)/
│   ├── layout.tsx              ← top nav lives here
│   ├── page.tsx                ← / landing page
│   ├── tasks/page.tsx          ← P5
│   ├── subscriptions/page.tsx  ← moved from src/app/subscriptions/
│   ├── consignees/page.tsx     ← moved from src/app/consignees/
│   └── admin/
│       ├── failed-pushes/page.tsx
│       └── webhook-config/page.tsx
├── login/                      ← stays at top level (no nav)
├── logout/                     ← stays at top level
└── layout.tsx                  ← root: fonts + brand css + audit observer
```

### Migration discipline (route group rename)

Moving pages into `(app)/` is a path-only refactor — file contents don't change, URL paths don't change (parens-wrapped folders are URL-invisible per Next.js convention). Verify with `npm test` + `npm run typecheck` + Preview smoke after move; no runtime behaviour should differ.

---

## §2 Permission model — which roles see which nav items

Derived from `src/modules/identity/roles.ts` (post-Day-9 P4a state):

| Nav item        | Permission gate        | Tenant Admin | Ops Manager | CS Agent |
|-----------------|------------------------|:------------:|:-----------:|:--------:|
| Tasks           | `task:read`            | ✅           | ✅          | ✅       |
| Subscriptions   | `subscription:read`    | ✅           | ✅          | ✅       |
| Consignees      | `consignee:read`       | ✅           | ✅          | ✅       |
| Failed pushes   | `failed_pushes:retry`  | ✅           | ❌          | ❌       |
| Webhook config  | `webhook_config:read`  | ✅           | ✅          | ❌       |

Tenant Admin gets all five via `TENANT_SCOPED` auto-pickup. Ops Manager gets four (excluded from `failed_pushes:retry` per the lifecycle-permission posture documented in [permissions.ts:392-417](src/modules/identity/permissions.ts#L392-L417)). CS Agent gets three (read-mostly slice — no admin-tier visibility, matching the `failed_pushes:retry` and `webhook_config:read` exclusions in the hand-rolled set).

### Implementation pattern

`(app)/layout.tsx` is a server component. It calls `buildRequestContext("/", requestId)` once per request and passes the resolved `permissions` (a `ReadonlySet<PermissionId>`) to the `<TopNav permissions={...} activePath={...} />` client component. The client filters the **declarative `NAV_ITEMS` config** by `permission` membership.

Permission-set membership is the source of truth — no role-name pattern matching, no role-list inference. If a custom role (post-pilot) carries `task:read`, it sees Tasks; the nav doesn't care which role granted the permission.

### Declarative nav config — single source of truth (locked at counter-review)

The nav MUST NOT use inline `if (permissions.has(...)) renderItem()` filtering. Instead, define a single `NAV_ITEMS` const at module scope mapping each nav item to its required permission, and filter declaratively at render time:

```ts
// src/app/(app)/nav-config.ts (new file)
import type { PermissionId } from "@/modules/identity";

export interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly permission: PermissionId;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Tasks",          path: "/tasks",                  permission: "task:read" },
  { label: "Subscriptions",  path: "/subscriptions",          permission: "subscription:read" },
  { label: "Consignees",     path: "/consignees",             permission: "consignee:read" },
  { label: "Failed pushes",  path: "/admin/failed-pushes",    permission: "failed_pushes:retry" },
  { label: "Webhook config", path: "/admin/webhook-config",   permission: "webhook_config:read" },
] as const;
```

Then in the nav render:

```tsx
const visible = NAV_ITEMS.filter((item) => permissions.has(item.permission));
return <nav>{visible.map(...)}</nav>;
```

**Why this matters:**

1. **Single source of truth.** Adding a nav item is one entry in `NAV_ITEMS`; the visibility table in §2 of this plan can be regenerated from the config + the role catalogue. No drift between the comment block and the code.
2. **Testability.** The unit test in §6 can iterate over `NAV_ITEMS` and assert each role's expected visibility set programmatically — currently it would need 5 hard-coded `expect()` calls per role test, which drift if a new nav item is added without updating the test.
3. **Permission-catalogue audit-ability.** A grep for `NavItem.permission` immediately surfaces which nav links exist and what they gate on, in one place.
4. **Future-proofing.** When a nav item needs additional metadata (icon, sort key, badge count, hover description), it's a single struct addition rather than scattered conditional blocks. Stays the right shape as the surface grows.
5. **Avoids the `roles.ts` refactor anti-pattern.** Inline filtering tempts a future reviewer to bake role-name checks back in ("show this only for ops-manager") because it's just one more `if` block. The declarative shape forbids this — every nav item declares its permission, period.

The `NAV_ITEMS` config is also where future P5+ work plugs in: when `/tasks` ships, no nav code changes — the config entry already exists. When P4b lands the credential-management subsection of `/admin/webhook-config`, no nav code changes — same path, same permission gate.

### Active-tab indication

Active route gets a 1px bottom border (matching brand hairline weight) and `font-medium` text. Inactive items stay regular weight. `usePathname()` from `next/navigation` provides the current path on the client side; nav matches it against each item's path with a startsWith check (so `/admin/failed-pushes/some-detail` highlights "Failed pushes").

---

## §3 Landing page (`/`) content

### Decision: workflow shortcut, not metrics dashboard

Three options considered:

- **Empty stub** — minimal but wastes screen real estate; operator lands and has to consciously click a nav item to do anything
- **Workflow shortcut** — two large link cards directing to the most-frequent operator destinations (Today's tasks + Failed pushes). Zero data fetch. Fast TTFB. Operator lands → one click to active work.
- **Metrics dashboard** — counts of active/paused subscriptions, today's task count, unresolved failed pushes. Highest information density, but every count requires a service call → slower TTFB + extra surface area for permission errors. Not justified for MVP.

**Recommend workflow shortcut.** Maps to MVP definition's "operator can navigate without typing URLs" goal directly. Defer metrics dashboard to post-MVP if operators ask for it during pilot.

### Layout

```
┌──────────────────────────────────────────────┐
│  Subscription planner                        │
│  Welcome back, <display_name or email>       │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─────────────┐  ┌─────────────┐           │
│  │ Today's     │  │ Failed      │           │
│  │ tasks       │  │ pushes      │           │
│  │             │  │             │           │
│  │ View →      │  │ View →      │           │
│  └─────────────┘  └─────────────┘           │
│                                              │
└──────────────────────────────────────────────┘
```

Two link cards. Each renders only when the operator's permissions grant it (Failed pushes card hidden for Ops Manager / CS Agent). If neither permission is held, fall back to a plain "Welcome" message — but in practice every pilot operator has at minimum task:read, so the empty state is unreachable.

`<display_name or email>` resolution: `display_name` from the public.users mirror if set, else `email`. Both are in the resolved actor's profile (would need to widen `Actor.kind === "user"` to carry `email` + `displayName`, currently it only carries userId/tenantId/permissions). Small actor-shape change required during P4 implementation.

### Brand consistency

- Same Mulish + Sanchez + warm off-white + hairline borders + uppercase-tracking-0.2em label patterns as `/admin/webhook-config` and `/admin/failed-pushes`
- No hero numerals on the landing page (those are reserved for count-displaying admin pages)
- Card hover state: opacity-80 transition (matches login button precedent)

---

## §4 Logout affordance

### Decision: form-with-POST in nav, posts to existing `/logout` route handler

`/logout` exists post-P2 and accepts both POST (canonical) and GET (idempotent dispatch to POST semantics). In the nav, the logout button is a small `<form action="/logout" method="POST">` containing a styled submit button. Form-with-POST is preferred over a plain `<a href="/logout">` for two reasons:

1. **CSRF posture:** POST forms include same-origin enforcement; GET links can be triggered cross-site (e.g. an `<img src="/logout">` in a malicious email logs the user out, harmless but annoying). The route handler serves both methods, so this is a defence-in-depth choice.
2. **Stable web semantics:** "logout" is a state-mutating action; POST is the right verb. GET-as-dispatch is the convenience escape hatch for direct URL hits.

### Placement

Far-right of the nav. Smaller text size than nav items (`text-xs uppercase tracking-[0.2em]`) so it doesn't compete with the navigation hierarchy. Visible on every authenticated page; absent on `/login`.

### `/profile` stub — NOT in P4 scope

The plan §3 in [memory/plans/auth_implementation_plan.md](memory/plans/auth_implementation_plan.md) mentioned `/profile` as a possible logout button host. With the form-in-nav approach, no profile stub is needed. Any future profile page (account management, password change, etc.) is post-MVP per plan §8 OUT.

---

## §5 File-level scope

| File | Change | Rationale |
|------|--------|-----------|
| `src/app/(app)/layout.tsx` | NEW (server component) | Resolves session + permissions; passes to TopNav; wraps children |
| `src/app/(app)/nav.tsx` | NEW (client component) | Nav rendering + active-tab via usePathname() |
| `src/app/(app)/page.tsx` | NEW (server component) | Landing page (replaces stub at `src/app/page.tsx`) |
| `src/app/page.tsx` | DELETED | Moves under `(app)/` |
| `src/app/subscriptions/page.tsx` | MOVED to `(app)/subscriptions/` | Path-only |
| `src/app/consignees/page.tsx` | MOVED to `(app)/consignees/` | Path-only |
| `src/app/admin/failed-pushes/page.tsx` | MOVED to `(app)/admin/failed-pushes/` | Path-only |
| `src/app/admin/webhook-config/page.tsx` | MOVED to `(app)/admin/webhook-config/` | Path-only |
| `src/shared/tenant-context.ts` | UPDATE — widen `Actor.kind === "user"` to carry `email` + `displayName?` | Landing page header needs display_name; small ergonomic widening |
| `src/shared/request-context.ts` | UPDATE — `resolveUserContext` returns email + display_name from the users mirror | Same as above |
| `src/app/(app)/tests/nav.spec.tsx` | NEW | 6-8 unit tests covering permission filtering + active-tab |
| `src/app/(app)/tests/page.spec.tsx` | NEW | 2-3 unit tests covering landing-page card visibility |
| `tests/integration/operator-nav.spec.ts` | NEW (optional) | 1-2 tests covering RSC resolution → nav permission filtering |

Estimated diff: ~400-500 lines (4 new files + 4 page moves + 2 actor-shape touches).

---

## §6 Test plan (~6-10 unit + 1-2 integration)

### Unit (~6-8 tests in `src/app/(app)/tests/nav.spec.tsx`)

Mock `usePathname` from `next/navigation`. Pass each role's permission set as a prop. Assert which nav items render.

- Tenant Admin permissions → all 5 items render
- Ops Manager permissions → 4 items (Failed pushes hidden)
- CS Agent permissions → 3 items (Failed pushes + Webhook config hidden)
- Empty permission set → only the home / logout affordance render
- Active route indicator fires on current path
- Active route indicator fires on subpath (`/admin/failed-pushes/some-id` → "Failed pushes" highlighted)
- Logout form has `method="POST"` and `action="/logout"`

### Unit (~2-3 tests in `src/app/(app)/tests/page.spec.tsx`)

- Landing page renders both cards for Tenant Admin
- Landing page hides Failed pushes card for Ops Manager
- Landing page falls back to plain Welcome when no actionable permissions present

### Integration (optional — 1-2 tests in `tests/integration/operator-nav.spec.ts`)

- Seed two users (one Tenant Admin, one CS Agent) → call `buildRequestContext` for each → assert the resolved permission sets correctly drive nav rendering. Mostly a regression guard against permission-catalogue drift.

Skip integration if the unit coverage feels sufficient; permission-catalogue drift is already pinned by `permissions.spec.ts`'s invariant tests.

---

## §7 Watch-list for reviewer

1. **Route-group migration is path-only** — no URL changes, no test fixture changes. Smoke test in Preview confirms each existing page still renders identically.
2. **Permission set is the source of truth, not role names** — nav filters on permission membership. Custom roles (post-pilot) automatically slot in correctly without code changes.
3. **Logout form posts to the existing `/logout` route handler** — no new route, no new server action. Consumes P2's existing infrastructure.
4. **Actor shape widening** — `Actor.kind === "user"` gains `email` + `displayName?` fields. Existing call sites that destructure the actor still typecheck (additive change). Touched in P4 because the landing page needs display_name; small enough to land in P4 rather than carve into a separate prep PR.
5. **/tasks link is a forward reference** — clicking it before P5 lands → 404. Acceptable.
6. **Active-tab indicator uses `usePathname()`** — client component. The `<TopNav>` boundary is the only client surface in the layout shell. The landing page itself stays server.
7. **No metrics-fetching on the landing page** — deferred to post-MVP unless pilot operators ask for it. Keeps TTFB tight and avoids a permission-error surface area on the home page.

---

## §8 Sequencing relative to P5/P6

P4 ships the nav + landing page. The nav links to `/tasks` even though the page doesn't exist yet — operators clicking it before P5 lands get a 404, which is acceptable.

P5 (`/tasks` page — operator workflow with status filters + label print) ships in a separate PR; it slots into the existing `(app)/` route group with no nav changes.

P6 (bulk task seeding script) is sysadmin-runnable, no UI surface.

So the dependency chain is:

```
P2 auth (PR #104, hard-stopped today)
  └─ P3 onboarding CLI runs (Love-executed, after #104 merges)
       └─ P4 nav + landing page (this plan)
            └─ P5 /tasks page
                 └─ P6 bulk seeding (parallel-able with P5)
```

P4 unblocks P5+P6's operator visibility but doesn't block their implementation — P5 can ship behind P4 in the same day if scoped tightly.

---

## §9 Out of scope (post-MVP)

- Sidebar / collapsible nav for high-density information layouts
- Metrics dashboard on the landing page (counts, charts)
- `/profile` page (account management, password change, MFA enrolment)
- Notifications / alerts surface in the nav
- Tenant switcher (single-tenant pilot model — switching tenants requires re-login)
- Internationalisation / Arabic locale toggle (`NEXT_PUBLIC_ENABLE_ARABIC` exists in `.env.example` but is `false` in pilot per feature flag)
- Search bar in the nav (no global search surface in pilot)
- Breadcrumbs (page hierarchy is shallow; nav alone is sufficient)
- Dark mode (brand hasn't specced a dark palette; pilot is single-mode)

---

## Cross-references

- [memory/plans/auth_implementation_plan.md](memory/plans/auth_implementation_plan.md) — P2 auth plan; P4 builds on the resolved `RequestContext` shape
- [src/modules/identity/roles.ts](src/modules/identity/roles.ts) — role-to-permission catalogue driving the nav-visibility table in §2
- [src/modules/identity/permissions.ts](src/modules/identity/permissions.ts) — permission catalogue; nav links gate on entries here
- [src/styles/brand-tokens.css](src/styles/brand-tokens.css) — Z-1 brand tokens (warm off-white, deep navy, hairlines)
- [src/app/admin/webhook-config/page.tsx](src/app/admin/webhook-config/page.tsx) — D9 P4a brand precedent the landing page + nav match
- [src/app/admin/failed-pushes/page.tsx](src/app/admin/failed-pushes/page.tsx) — D8-5 brand precedent (hero numeral + hairline borders)
- [src/app/login/page.tsx](src/app/login/page.tsx) — login page; the nav is *absent* on this page (route group separation)
- [src/app/logout/route.ts](src/app/logout/route.ts) — logout endpoint the nav posts to
