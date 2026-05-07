// C-21 — "at least one Tenant Admin per tenant" invariant.
//
// Plan §11.3 + commit-9 prep approval: enforced at the service layer,
// NOT as a DB constraint. The DB cannot easily express the rule
// (Postgres CHECK constraints can't aggregate, and triggers that
// query other rows have surprising semantics under concurrent writes
// and CASCADE deletes). The service layer enforces it as a precheck
// inside the same `withTenant` transaction as the mutation, so the
// check and the change are atomic with respect to other writers.
//
// Two operations can violate the invariant:
//   1. role_assignment:delete — directly removes a tenant-admin
//      assignment.
//   2. user:delete — cascades through role_assignments via FK and
//      removes every assignment that user holds.
//
// Both go through `assertCanRemoveAssignments(tx, tenantId, ids)`. The
// caller computes which assignment ids are about to disappear and
// passes them in. The check counts how many of those are tenant-admin
// assignments and how many tenant-admin assignments exist tenant-wide
// — if removal would land at zero, it throws ConflictError.
//
// Concurrency — pessimistic locking via SELECT FOR UPDATE:
// -------------------------------------------------------------------
// Without locking, two concurrent transactions could each pass the
// check and each delete one of two admins, leaving the tenant with
// zero — both reads see "2 admins exist" before either delete commits.
// The total-count query below uses `FOR UPDATE OF ra` (wrapped in a
// CTE because PostgreSQL does not allow FOR UPDATE alongside aggregate
// functions) to lock every existing tenant-admin assignment row in
// this tenant for the life of the caller's transaction. A second
// transaction hitting this query against the same tenant blocks until
// we COMMIT or ROLLBACK; once unblocked it re-evaluates against the
// post-commit state, so the count it sees reflects our delete.
//
// INSERTs of new tenant-admin assignments concurrent with this check
// are intentionally NOT serialized — adding admins never violates the
// invariant. Non-admin DELETEs are also unaffected; FOR UPDATE only
// locks rows matching the WHERE filter (tenant-admin in this tenant).
//
// Integration test of the lock semantics is a separate concern —
// requires concurrent transactions against a real Postgres. Out of
// scope for the unit tests in this commit; covered when the bulk
// of admin-management endpoints land.

import { sql as sqlTag } from "drizzle-orm";

import { ConflictError } from "../../shared/errors";
import type { DbTx } from "../../shared/db";
import type { Uuid } from "../../shared/types";

import { TENANT_ADMIN_ROLE_SLUG } from "./roles";

// Drizzle's `tx.execute<T>` constrains T to `Record<string, unknown>`.
// Using a type alias with an intersection (instead of an interface)
// satisfies that constraint cleanly. Same shape used in
// tests/integration/rls-tenant-isolation.spec.ts.
type CountRow = { n: number } & Record<string, unknown>;

/**
 * Throws ConflictError if removing the assignments named in
 * `removingAssignmentIds` from `tenantId` would leave the tenant with
 * zero Tenant Admin assignments.
 *
 * Run inside a `withTenant` transaction (the caller's tx). The check
 * and the subsequent mutation belong in the same transaction so that
 * a concurrent writer cannot remove the other Tenant Admin between
 * the check and the delete.
 *
 * Empty `removingAssignmentIds` is a no-op — used by callers that
 * conditionally compute the set and want a single call site.
 */
export async function assertCanRemoveAssignments(
  tx: DbTx,
  tenantId: Uuid,
  removingAssignmentIds: readonly Uuid[]
): Promise<void> {
  if (removingAssignmentIds.length === 0) {
    return;
  }

  // Count tenant-wide tenant-admin assignments. SELECT FOR UPDATE on
  // the matching role_assignments rows is the C-21 race fix — see the
  // file header's "Concurrency" block. Wrapped in a CTE because
  // Postgres rejects FOR UPDATE adjacent to count(*).
  const totalRows = await tx.execute<CountRow>(sqlTag`
    WITH locked AS (
      SELECT ra.id
      FROM role_assignments ra
      JOIN roles r ON r.id = ra.role_id
      WHERE ra.tenant_id = ${tenantId}
        AND r.slug = ${TENANT_ADMIN_ROLE_SLUG}
      FOR UPDATE OF ra
    )
    SELECT count(*)::int AS n FROM locked
  `);
  const total = totalRows[0]?.n ?? 0;

  // Of the assignments being removed, how many are tenant-admin?
  // Filter by tenant_id too so a malformed caller passing assignment
  // ids from another tenant cannot influence the check (RLS would
  // already filter, but this is defense in depth — the query reads
  // the same way regardless of pool routing).
  //
  // No FOR UPDATE here: the rows we're about to count are a subset
  // of the rows the previous query already locked. Re-locking the
  // same set is redundant.
  // Pattern E per src/shared/sql-helpers.ts — manual array literal.
  // drizzle-orm 0.45.2 + postgres-js splats `${jsArr}` into a record
  // which cannot be cast to uuid[]. Constructing `{a,b,c}` as a single
  // string parameter avoids the splat. Safe for uuid[] only.
  const removingAdminRows = await tx.execute<CountRow>(sqlTag`
    SELECT count(*)::int AS n
    FROM role_assignments ra
    JOIN roles r ON r.id = ra.role_id
    WHERE ra.id = ANY(${'{' + (removingAssignmentIds as string[]).join(',') + '}'}::uuid[])
      AND ra.tenant_id = ${tenantId}
      AND r.slug = ${TENANT_ADMIN_ROLE_SLUG}
  `);
  const removingAdmins = removingAdminRows[0]?.n ?? 0;

  if (removingAdmins === 0) {
    // None of the assignments being removed are tenant-admin —
    // invariant cannot be threatened by this operation.
    return;
  }

  const remainingAdmins = total - removingAdmins;
  if (remainingAdmins <= 0) {
    throw new ConflictError(
      `cannot remove the last Tenant Admin from tenant — every tenant must retain at least one Tenant Admin assignment (C-21)`
    );
  }
}
