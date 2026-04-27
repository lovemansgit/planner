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

  // Count tenant-wide tenant-admin assignments.
  const totalRows = await tx.execute<CountRow>(sqlTag`
    SELECT count(*)::int AS n
    FROM role_assignments ra
    JOIN roles r ON r.id = ra.role_id
    WHERE ra.tenant_id = ${tenantId}
      AND r.slug = ${TENANT_ADMIN_ROLE_SLUG}
  `);
  const total = totalRows[0]?.n ?? 0;

  // Of the assignments being removed, how many are tenant-admin?
  // Filter by tenant_id too so a malformed caller passing assignment
  // ids from another tenant cannot influence the check (RLS would
  // already filter, but this is defense in depth — the query reads
  // the same way regardless of pool routing).
  const removingAdminRows = await tx.execute<CountRow>(sqlTag`
    SELECT count(*)::int AS n
    FROM role_assignments ra
    JOIN roles r ON r.id = ra.role_id
    WHERE ra.id = ANY(${removingAssignmentIds as string[]}::uuid[])
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
