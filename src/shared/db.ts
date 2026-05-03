// Database client + tenant-scoped wrappers per resolutions R-3.
// Lives in src/shared per plan §11.1. The module-boundary lint rule
// from PR #3 allows raw `db` use only inside this file, supabase/
// migrations/**, and scripts/** (the carve-out).
//
// =============================================================================
// Two-pool design (resolutions R-0, Day 2)
// =============================================================================
// Supabase's `postgres` role is a superuser and bypasses RLS. Connecting
// `withTenant` queries through that role would mean the RLS policies
// authored in 0001/0002 are correctly shaped but never filter at runtime —
// tenant isolation theoretical, not enforced. Closing that hole was R-0.
//
//   • appClient        — connects as `planner_app` (NOBYPASSRLS, see
//                        supabase/migrations/0003_app_role.sql). Used by
//                        `withTenant`. RLS filters on
//                        `app.current_tenant_id`. Default-deny if the
//                        session variable is unset/cleared because the
//                        policies use `NULLIF(..., '')::uuid` and
//                        `tenant_id = NULL` is FALSE under three-valued
//                        logic (see deviation note in 0001_identity.sql).
//
//   • superuserClient  — connects as `postgres` (BYPASSRLS). Used by
//                        `withServiceRole` for legitimate cross-tenant
//                        operations: audit_events INSERTs (the policy
//                        in 0002_audit.sql is FOR SELECT only, so a
//                        non-superuser INSERT would be denied), built-in
//                        role seeds, tenant onboarding (no session
//                        tenant_id exists yet at that moment), system
//                        cron actors that span tenants, sysadmin tooling.
//
// Migrations and seed scripts use `superuserClient` directly (carve-out
// for supabase/migrations/** and scripts/**).
// =============================================================================

import { sql as sqlTag } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// -----------------------------------------------------------------------------
// Env-var resolution — fail-loud
// -----------------------------------------------------------------------------
// Both URLs are required. Defaulting `SUPABASE_APP_DATABASE_URL` to
// `SUPABASE_DATABASE_URL` would silently restore the BYPASSRLS hole this
// module exists to close — every `withTenant` query would run as the
// superuser. Loud throw at import time is correct: a misconfigured env on a
// preview deploy must not boot a server that quietly bypasses RLS.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required. ` +
        (name === "SUPABASE_APP_DATABASE_URL"
          ? "Build the connection string for the planner_app role (see supabase/migrations/0003_app_role.sql header) and set it in Vercel Project Settings > Environment Variables."
          : "See .env.example.")
    );
  }
  return value;
}

const appClient = postgres(requireEnv("SUPABASE_APP_DATABASE_URL"), {
  // PgBouncer transaction pool mode (Supabase pooler default) requires this.
  prepare: false,
  max: 10,
});

// Smaller pool — service-role work (audit emit, admin, cross-tenant) is
// rare relative to business queries. Sizing it small also surfaces accidental
// hot paths through `withServiceRole` early.
const superuserClient = postgres(requireEnv("SUPABASE_DATABASE_URL"), {
  prepare: false,
  max: 5,
});

/**
 * The Drizzle database client backed by the **app pool** (`planner_app`,
 * NOBYPASSRLS). Use `withTenant` or `withServiceRole` for query work —
 * direct use of `db` from any other module is forbidden by the
 * no-restricted-imports rule from PR #3.
 *
 * A direct query through `db` outside `withTenant` will run as
 * `planner_app` with `app.current_tenant_id` unset — RLS-protected
 * tables return zero rows (fail-closed) and audit_events INSERTs are
 * denied by policy. Misuse degrades to a dead query, never a leak.
 */
export const db = drizzle(appClient);

/**
 * The Drizzle database client backed by the **superuser pool**
 * (`postgres`, BYPASSRLS). Internal — only `withServiceRole` reads
 * this. Not exported.
 */
const dbSuperuser = drizzle(superuserClient);

/**
 * Transaction handle threaded into `withTenant` / `withServiceRole`
 * callbacks. Extracted from Drizzle's transaction signature so it
 * stays accurate as Drizzle evolves; consumers see a `tx` parameter
 * with the same query API as `db` minus client-level methods.
 */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Run a database operation in a transaction with the
 * `app.current_tenant_id` Postgres session variable bound. RLS
 * policies on every multi-tenant table filter on this value (plan
 * §7.8 and the §11.3 non-negotiable). Every business-logic query
 * goes through this wrapper.
 *
 * After R-0 this runs on the app pool — `planner_app` is NOBYPASSRLS,
 * so the RLS policies are the actual security boundary, not
 * documentation.
 *
 * Implementation note — uses `set_config(name, value, true)` rather
 * than `SET LOCAL <var> = '<val>'` with template-string interpolation.
 * `set_config` takes the value as a bound parameter, eliminating SQL
 * injection by construction. R-3's example used SET LOCAL with the
 * comment "Quoting prevents SQL injection — tenantId is UUID-validated
 * upstream"; set_config achieves the same transaction-local scoping
 * (third `is_local` argument set to true) without depending on
 * upstream validation as the security boundary.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sqlTag`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    return await fn(tx);
  });
}

/**
 * Observer for service-role usage. The audit module on Day 2 wires
 * itself in via `setServiceRoleObserver` to emit a
 * `db.service_role.use` audit event per resolutions R-3 + R-4. The
 * audit module's own emits skip re-emitting that event to prevent
 * recursion per R-4. The observer lives in shared rather than a
 * direct `audit.emit(...)` call so shared/ stays free of
 * application-specific deps per plan §3.4.
 */
type ServiceRoleObserver = (reason: string) => void;
let serviceRoleObserver: ServiceRoleObserver | null = null;

export function setServiceRoleObserver(observer: ServiceRoleObserver | null): void {
  serviceRoleObserver = observer;
}

/**
 * Service-role operations that legitimately bypass RLS — migrations,
 * cross-tenant admin operations, system actors that span tenants, and
 * audit emit (the audit table's RLS is read-only-for-tenants per R-4
 * so inserts must bypass).
 *
 * After R-0 this runs on the superuser pool (`postgres`, BYPASSRLS).
 * The RLS bypass is the whole point — non-superuser INSERTs into
 * audit_events would be denied by the FOR SELECT-only policy in
 * 0002_audit.sql, and cross-tenant admin queries by definition cannot
 * scope to a single `app.current_tenant_id`.
 *
 * Implementation note — explicitly clears the tenant session variable
 * so RLS-enabled tables match against an empty value. On the superuser
 * pool this is defense-in-depth (RLS is bypassed regardless), but it
 * keeps the wrapper safe to reason about if the pool routing ever
 * changes and removes any dependence on caller state from a previous
 * transaction on the same connection.
 */
export async function withServiceRole<T>(reason: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  serviceRoleObserver?.(reason);
  return await dbSuperuser.transaction(async (tx) => {
    await tx.execute(sqlTag`SELECT set_config('app.current_tenant_id', '', true)`);
    return await fn(tx);
  });
}
