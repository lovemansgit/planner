// Day 10. Replacement for src/shared/demo-context.ts as the canonical
// RequestContext builder for server-side code (pages, route handlers,
// server actions).
//
// Posture A graceful migration (per memory/plans/auth_implementation_plan.md
// §2): real auth via Supabase SSR is the primary path. If no session is
// present AND `ALLOW_DEMO_AUTH=true` is explicitly set in the environment
// (Preview-scope only by convention), we fall through to the legacy demo
// context — Preview keeps working through the cutover. If no session AND
// no demo opt-in, we throw `UnauthorizedError`; route handlers map that
// to 401 via errorResponse, pages catch it and redirect to /login.
//
// Posture B (hard cutover) is a T1 follow-up after ~48h soak. It drops
// the ALLOW_DEMO_AUTH fallback and removes the `buildDemoContext` import.
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

import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { sql as sqlTag } from "drizzle-orm";
import { cookies } from "next/headers";

import {
  type BuiltInRoleSlug,
  type PermissionId,
  ROLES,
} from "@/modules/identity";

import { buildDemoContext } from "./demo-context";
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
  readonly permissions: ReadonlySet<PermissionId>;
  readonly email: string;
  readonly displayName: string | null;
}

/**
 * Resolve a Supabase auth user's id to the tenant + permission set carried
 * on `RequestContext.actor`. Single withServiceRole transaction joining
 * users + role_assignments + roles; permission set is unioned across the
 * user's role memberships using the frozen ROLES catalogue.
 *
 * Returns null when:
 *   - no public.users mirror row exists for the auth.users id, OR
 *   - the user has no role_assignments, OR
 *   - the user's disabled_at is set.
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
      role_slug: string;
      email: string;
      display_name: string | null;
    };
    const rows = await tx.execute<Row>(sqlTag`
      SELECT u.tenant_id, r.slug AS role_slug, u.email, u.display_name
      FROM users u
      JOIN role_assignments ra ON ra.user_id = u.id AND ra.tenant_id = u.tenant_id
      JOIN roles r ON r.id = ra.role_id
      WHERE u.id = ${userId}
        AND u.disabled_at IS NULL
    `);

    if (rows.length === 0) return null;

    const tenantId = rows[0].tenant_id;
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
    return { tenantId, permissions, email, displayName };
  });
}

/**
 * Build a RequestContext for the current server-side request. Replacement
 * for buildDemoContext from Day 3. Posture A graceful migration: real
 * auth via Supabase SSR primary, demo fallback opt-in via
 * `ALLOW_DEMO_AUTH=true` (Preview-only by convention).
 *
 * Throws UnauthorizedError when no Supabase session is present AND demo
 * fallback is not opted in. Route handlers map the throw to 401 via
 * errorResponse; pages catch it and call redirect("/login?...").
 */
export async function buildRequestContext(
  path: string,
  requestId: string,
): Promise<RequestContext> {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const resolved = await resolveUserContext(user.id);
    if (!resolved) {
      // Auth.users row exists but no usable mirror / role-assignment.
      // Treated as unauthorized (account is not fully provisioned). The
      // operator path: re-run scripts/onboard-merchant.mjs or check
      // role_assignments by hand.
      throw new UnauthorizedError("user account is not provisioned");
    }
    return {
      actor: {
        kind: "user",
        userId: user.id,
        tenantId: resolved.tenantId,
        permissions: resolved.permissions,
        email: resolved.email,
        displayName: resolved.displayName,
      },
      tenantId: resolved.tenantId,
      requestId,
      path,
    };
  }

  // Posture A fallthrough — Preview opt-in only.
  if (process.env.ALLOW_DEMO_AUTH === "true") {
    return await buildDemoContext(path, requestId);
  }

  throw new UnauthorizedError("login required");
}
