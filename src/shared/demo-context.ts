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
import type { RequestContext } from "./tenant-context";

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
 * Error type signalling "no tenants yet" — the route layer maps this
 * to HTTP 503. Distinct from Forbidden / Validation / NotFound so
 * callers don't conflate "the system is uninitialised" with "your
 * request was wrong."
 */
export class NoTenantConfiguredError extends Error {
  readonly code = "NO_TENANT_CONFIGURED";
  constructor() {
    super("No tenants configured yet — onboard at least one tenant before using the demo API");
  }
}

/**
 * Build a RequestContext for the demo state. Fails loudly via
 * NoTenantConfiguredError if no tenants exist.
 */
export async function buildDemoContext(
  path: string,
  requestId: string
): Promise<RequestContext> {
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
