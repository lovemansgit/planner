// Demo RequestContext builder — hard-coded to the first tenant.
//
// Until Supabase Auth wiring lands, server-side code that needs a
// `RequestContext` (every API route, every server component that calls
// service methods) constructs one through here. The shape:
//
//   - actor.kind = "user"
//   - actor.userId = a deterministic synthetic UUID, distinct from any
//     real user, so audit_events emitted via the demo path are visibly
//     synthetic to anyone reading the log.
//   - actor.tenantId = the first tenant in the DB (ordered by created_at).
//     Pilot has 3 tenants; the first one is whichever was provisioned
//     earliest. Demo ergonomics, not a security boundary — all routes
//     here will go through real auth before pilot.
//   - actor.permissions = the full Tenant Admin permission set, sourced
//     from the `tenant-admin` built-in role's frozen catalogue entry.
//     This grants the demo user every tenant-scoped permission, matching
//     the most common review-time use case.
//   - tenantId mirrors actor.tenantId.
//
// Production gate (per PR #23 review):
//   buildDemoContext refuses to run when NODE_ENV === "production"
//   unless `ALLOW_DEMO_AUTH=true` is explicitly set. The gate fires at
//   the top of buildDemoContext, before the DB lookup, so production
//   never even reaches the first-tenant query. Vercel Preview deploys
//   opt in via the Preview-scope env var; Production scope must NOT
//   set ALLOW_DEMO_AUTH. .env.example documents the variable with that
//   constraint called out.
//
// Documented limitations (per the Day-3 brief §8 + this header):
//   - Returns 503 if no tenants exist yet — fail-loud instead of
//     synthesising a phantom UUID that would silently fail-closed
//     against RLS.
//   - Caches nothing. Every call hits the DB. Auth wiring will replace
//     this with a JWT-derived context that doesn't query the DB on
//     every request.
//   - Server-only. Importing this from a client component is a build
//     error (the `import "server-only"` line below).

import "server-only";

import { sql as sqlTag } from "drizzle-orm";

import { ROLES } from "@/modules/identity";

import { withServiceRole } from "./db";
import { NoTenantConfiguredError } from "./errors";
import type { RequestContext } from "./tenant-context";

// Re-export so existing call sites that import NoTenantConfiguredError
// from this module keep working. The class itself lives in
// src/shared/errors.ts so it participates in the AppError discriminated
// union and the error-response switch's exhaustiveness check.
export { NoTenantConfiguredError };

/**
 * Deterministic synthetic UUID for the demo user. Distinguishable from
 * any real user uuid because it's all-`d` digits.
 */
const DEMO_USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/** Frozen permission set — the same one a Tenant Admin role assignment carries. */
const DEMO_PERMISSIONS = ROLES["tenant-admin"].permissions;

/**
 * Read the first tenant id from the DB (ordered by created_at). Uses
 * withServiceRole because we have no tenant context to scope a withTenant
 * call yet — bootstrapping the context is precisely what we're doing.
 *
 * Returns `null` if no tenants exist; callers map that to 503.
 */
async function fetchFirstTenantId(): Promise<string | null> {
  return await withServiceRole("demo-context: lookup first tenant", async (tx) => {
    type Row = { id: string } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1
    `);
    return rows[0]?.id ?? null;
  });
}

/**
 * Build a RequestContext for the demo state. Fails loudly via
 * NoTenantConfiguredError if no tenants exist. Refuses to run in
 * production unless ALLOW_DEMO_AUTH=true is explicitly set (see file
 * header for the env-var contract).
 */
export async function buildDemoContext(
  path: string,
  requestId: string
): Promise<RequestContext> {
  // Production gate. NODE_ENV === "production" covers both the real
  // production deploy AND Vercel Preview deploys (which also boot with
  // NODE_ENV=production). Preview opts in by setting ALLOW_DEMO_AUTH=true
  // in its env scope; Production scope must not. Throwing a generic
  // Error rather than a typed AppError is intentional — this is an
  // operator misconfiguration, not a runtime user-facing case, so the
  // framework's 500 path handles it without leaking detail.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_AUTH !== "true") {
    throw new Error(
      "buildDemoContext is not permitted in production without explicit ALLOW_DEMO_AUTH=true opt-in"
    );
  }

  const tenantId = await fetchFirstTenantId();
  if (!tenantId) {
    throw new NoTenantConfiguredError();
  }
  return {
    actor: {
      kind: "user",
      userId: DEMO_USER_ID,
      tenantId,
      permissions: DEMO_PERMISSIONS,
    },
    tenantId,
    requestId,
    path,
  };
}
