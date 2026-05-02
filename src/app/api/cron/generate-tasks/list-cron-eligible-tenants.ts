// Day 8 / β — cron-eligible tenant enumeration.
//
// Extracted from the inline `listAllTenantIds` helper that lived in
// route.ts before β. The extraction is testability-driven: a unit
// test in tests/unit/cron-list-tenants-filters-by-customer-code.spec.ts
// pins the WHERE filter so future code changes can't accidentally
// drop it without a CI failure.
//
// -----------------------------------------------------------------------------
// Why filter at enumeration (not just at the per-tenant guard)
// -----------------------------------------------------------------------------
// The cron's per-tenant push code (D8-4a / src/modules/task-push/service.ts)
// already has a `missing_customer_code` fail-closed guard that emits
// `tenant.push_skipped` and short-circuits the per-tenant pass. That
// guard stays — it's the per-tenant defence-in-depth (race-condition
// belt: if a tenant has a customer_code at enumeration time but the
// value gets cleared between enumeration and per-tenant-push, the
// guard catches it).
//
// β adds enumeration-level filtering as the FIRST gate. Without it,
// the cron walks every tenant in the table — including the 339 stale
// test tenants from earlier development phases (see
// memory/followup_audit_rule_cascade_conflict.md for the upstream
// cleanup gap). The 340-tenant walk hit the Vercel Pro 300s cron
// timeout on the second trigger (2 May 2026), captured in
// memory/followup_suitefleet_bulk_push_empirical.md.
//
// This is NOT a workaround — it's the right place for the filter.
// Tenant onboarding is sequential:
//   1. Tenant row created (operator action)
//   2. SuiteFleet customer_code backfilled (operator action,
//      typically same day or next morning)
//   3. Tenant becomes eligible for the nightly cron
//
// The customer_code filter IS the production-readiness gate. Tenants
// at step (1) get auth-checks against the resolver but no cron runs
// for them; tenants at step (2) start receiving pushes the next
// scheduled cron pass. No special signalling needed; the column
// itself is the gate.
//
// Operational consequence: 339 stale test tenants stay in the
// database but are no longer in the cron path. Test-hygiene cleanup
// of those rows remains a Day 9+ concern (see
// memory/followup_audit_rule_cascade_conflict.md for the cleanup
// mechanism gap — the audit-rule prevents straightforward DELETE).

// Caller is the cron route handler at ./route.ts which carries
// `import "server-only"` itself. Keeping this helper SSR-only via
// the call-graph (rather than its own server-only marker) lets the
// unit test in tests/unit/cron-list-tenants-filters-by-customer-code.spec.ts
// import + introspect the SQL without a vitest "server-only" shim.

import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole } from "@/shared/db";
import type { Uuid } from "@/shared/types";

/**
 * List the tenant ids the cron should enumerate this run.
 *
 * Filter: `suitefleet_customer_code IS NOT NULL AND suitefleet_customer_code != ''`.
 * Empty-string defensive check parallels the per-tenant
 * `missing_customer_code` guard in src/modules/task-push/service.ts
 * (`config.suitefleetCustomerCode?.trim()` falsy-check) — keep the
 * two paths consistent so a value that the per-tenant guard would
 * skip is also excluded here at enumeration.
 *
 * Order: `created_at ASC` preserves D8-4a's α-fix posture (sandbox
 * tenant at position 1 via `created_at = '2024-01-01'` UPDATE). The
 * α-fix is now load-bearing for predictable single-tenant batches —
 * keep the same ordering so timing characteristics stay stable
 * pass-to-pass.
 */
export async function listCronEligibleTenantIds(): Promise<readonly Uuid[]> {
  return withServiceRole("cron:generate_tasks list eligible tenants", async (tx) => {
    type Row = { id: string } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT id
      FROM tenants
      WHERE suitefleet_customer_code IS NOT NULL
        AND suitefleet_customer_code <> ''
      ORDER BY created_at ASC
    `);
    return rows.map((r) => r.id);
  });
}
