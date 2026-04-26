// Database client + tenant-scoped wrappers per resolutions R-3.
// Lives in src/shared per plan §11.1. The module-boundary lint rule
// from PR #3 allows raw `db` use only inside this file, supabase/
// migrations/**, and scripts/** (the carve-out).

import { sql as sqlTag } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres(process.env.SUPABASE_DATABASE_URL!, {
  // PgBouncer transaction pool mode (Supabase pooler default) requires this.
  prepare: false,
  max: 10,
});

/**
 * The Drizzle database client. Use `withTenant` or `withServiceRole`
 * for query work — direct use of `db` from any other module is
 * forbidden by the no-restricted-imports rule from PR #3.
 */
export const db = drizzle(client);

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
 * Implementation note — explicitly clears the tenant session variable
 * so RLS-enabled tables match against an empty value and return zero
 * rows (fail-closed) if a service-role wrapper is accidentally used
 * where `withTenant` should have been.
 */
export async function withServiceRole<T>(reason: string, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  serviceRoleObserver?.(reason);
  return await db.transaction(async (tx) => {
    await tx.execute(sqlTag`SELECT set_config('app.current_tenant_id', '', true)`);
    return await fn(tx);
  });
}
