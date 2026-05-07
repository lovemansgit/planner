// Day 10 / Day 15. Canonical RequestContext builder for server-side code
// (pages, route handlers, server actions). Real auth via Supabase SSR is
// the only path; no session means UnauthorizedError, route handlers map
// that to 401 via errorResponse, pages catch it and redirect to /login.
//
// Cookie-handling contract across the three Next.js 16 contexts:
//   - Server Component (RSC): `cookies()` is read-only. The Supabase
//     SDK may attempt to write a refreshed token cookie via setAll;
//     we swallow the throw (RSC can't write) and let the next mutating
//     context (Server Action / Route Handler) refresh the cookie.
//   - Route Handler: cookies() is read-write; setAll succeeds.
//   - Server Action: cookies() is read-write; setAll succeeds.
//
// The integration test at tests/integration/auth-end-to-end.spec.ts
// exercises one of each context to pin the contract.
//
// Day 11 — per-request session memoization (followup_double_session_resolve_per_request.md):
// the (app)/ route group's layout AND each page both call
// buildRequestContext, so without memoization the supabase.auth.getUser
// + resolveUserContext DB join fires twice per authenticated request.
// resolveSession is wrapped with React's cache() so the layout + page
// render in the same RSC pass share one resolution. cache() is
// request-scoped during a server-component render — concurrent requests
// don't share state, so the cross-tenant isolation invariant
// (session-resolved tenantId is the only scoping source) is preserved.

import "server-only";

import { cache } from "react";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { sql as sqlTag } from "drizzle-orm";
import { cookies } from "next/headers";

import {
  type BuiltInRoleSlug,
  type PermissionId,
  ROLES,
} from "@/modules/identity";

import { withServiceRole } from "./db";
import { UnauthorizedError } from "./errors";
import type { RequestContext } from "./tenant-context";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is required for auth. Add it to Vercel Production + Preview scopes (Development scope is reserved for .env.local per project convention).`,
    );
  }
  return v;
}

/**
 * Construct a Supabase server-side client bound to the current request's
 * cookies. Exposed for the login / logout server actions which call
 * supabase.auth.signInWithPassword and signOut respectively. Most other
 * call sites should reach for buildRequestContext instead.
 */
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options as CookieOptions);
            }
          } catch {
            // RSC context — cookies are read-only. Per the @supabase/ssr
            // contract this is expected and recoverable; the next
            // Server Action / Route Handler will rewrite the refreshed
            // token cookie. See file header for the three-context
            // contract.
          }
        },
      },
    },
  );
}

export interface ResolvedUserContext {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly permissions: ReadonlySet<PermissionId>;
  readonly email: string;
  readonly displayName: string | null;
}

/**
 * Resolve a Supabase auth user's id to the tenant + permission set carried
 * on `RequestContext.actor`. Single withServiceRole transaction joining
 * users + role_assignments + roles + tenants; permission set is unioned
 * across the user's role memberships using the frozen ROLES catalogue.
 *
 * Returns null when:
 *   - no public.users mirror row exists for the auth.users id, OR
 *   - the user has no role_assignments, OR
 *   - the user's disabled_at is set, OR
 *   - the user's tenant has status != 'active' (Day-16 §10.5: blocks
 *     login for users on provisioning / suspended / inactive tenants;
 *     `deactivateMerchant` flipping a tenant to 'inactive' is the
 *     load-bearing case — that operator's session is invalidated on
 *     the next request without a separate session-revocation surface).
 *
 * Built-in roles are matched by slug against ROLES; unknown slugs (custom
 * roles, post-pilot per plan §13.1) are skipped — their permission set
 * lives on the roles row itself, not in the code catalogue, and is
 * read directly. Custom-role permission resolution is deferred until
 * custom roles ship; until then, only built-in role memberships
 * contribute to the permission union.
 */
export async function resolveUserContext(userId: string): Promise<ResolvedUserContext | null> {
  return await withServiceRole("auth: resolve user context", async (tx) => {
    type Row = {
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
      role_slug: string;
      email: string;
      display_name: string | null;
    };
    const rows = await tx.execute<Row>(sqlTag`
      SELECT u.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
             r.slug AS role_slug, u.email, u.display_name
      FROM users u
      JOIN role_assignments ra ON ra.user_id = u.id AND ra.tenant_id = u.tenant_id
      JOIN roles r ON r.id = ra.role_id
      JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = ${userId}
        AND u.disabled_at IS NULL
        AND t.status = 'active'
    `);

    if (rows.length === 0) return null;

    const tenantId = rows[0].tenant_id;
    const tenantName = rows[0].tenant_name;
    const tenantSlug = rows[0].tenant_slug;
    const email = rows[0].email;
    const displayName = rows[0].display_name;
    const permissions = new Set<PermissionId>();
    for (const row of rows) {
      const role = ROLES[row.role_slug as BuiltInRoleSlug];
      if (!role) continue;
      for (const p of role.permissions) {
        permissions.add(p);
      }
    }
    return { tenantId, tenantName, tenantSlug, permissions, email, displayName };
  });
}

/**
 * Resolved real-auth session — null when no Supabase session is present.
 * The `kind` discriminator pairs with an "unprovisioned" terminal that
 * surfaces as a thrown UnauthorizedError; callers can't observe that
 * branch directly because cache() caches the throw, but the branch is
 * documented here for the test surface.
 */
export interface ResolvedSession {
  readonly userId: string;
  readonly resolved: ResolvedUserContext;
}

/**
 * Inner uncached implementation of resolveSession. Tests import this
 * directly to bypass React's cache() (which deduplicates per-process in
 * a node test environment without a React renderer scope) — production
 * call sites go through the cached wrapper below.
 */
export async function resolveSessionImpl(): Promise<ResolvedSession | null> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const resolved = await resolveUserContext(user.id);
  if (!resolved) {
    // Auth.users row exists but no usable mirror / role-assignment.
    // Treated as unauthorized (account is not fully provisioned). The
    // operator path: re-run scripts/onboard-merchant.mjs or check
    // role_assignments by hand.
    throw new UnauthorizedError("user account is not provisioned");
  }
  return { userId: user.id, resolved };
}

/**
 * Per-request memoized session resolver. React's cache() scopes the
 * cached result to the current server-component render lifecycle, so
 * the (app)/ layout + each page in the same RSC pass share one
 * supabase.auth.getUser + resolveUserContext call.
 *
 * Cross-tenant isolation invariant (preserved): the cached value is
 * derived from the request's cookies; concurrent requests have distinct
 * cookie stores and distinct render lifecycles, so the cache is NEVER
 * shared across tenants. The session-resolved tenantId stays the only
 * scoping source — the cache memoizes the lookup, not the identity.
 *
 * Implementation note: the cached wrapper is re-creatable via
 * __resetSessionCacheForTests so vitest can isolate tests across the
 * module's process-scoped cache (React's cache() falls back to
 * module-scope when no React renderer is present).
 */
let cachedResolver = cache(resolveSessionImpl);

export async function resolveSession(): Promise<ResolvedSession | null> {
  return await cachedResolver();
}

/**
 * Test-only escape hatch. Production code MUST NOT call this. Replaces
 * the module's cached resolver with a fresh one, isolating one test's
 * cached result from the next.
 */
export function __resetSessionCacheForTests(): void {
  cachedResolver = cache(resolveSessionImpl);
}

/**
 * Build a RequestContext for the current server-side request.
 *
 * Throws UnauthorizedError when no Supabase session is present. Route
 * handlers map the throw to 401 via errorResponse; pages catch it and
 * call redirect("/login?...").
 */
export async function buildRequestContext(
  path: string,
  requestId: string,
): Promise<RequestContext> {
  const session = await resolveSession();

  if (session) {
    return {
      actor: {
        kind: "user",
        userId: session.userId,
        tenantId: session.resolved.tenantId,
        permissions: session.resolved.permissions,
        email: session.resolved.email,
        displayName: session.resolved.displayName,
        tenantName: session.resolved.tenantName,
        tenantSlug: session.resolved.tenantSlug,
      },
      tenantId: session.resolved.tenantId,
      requestId,
      path,
    };
  }

  throw new UnauthorizedError("login required");
}
