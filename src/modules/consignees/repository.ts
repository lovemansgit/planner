// Consignee repository — Drizzle queries against `consignees` (0004).
//
// "Repository" here is the data-access layer per Day-3 brief §4.1 C-2:
// "types + repository — Drizzle queries, no business logic." Every
// function takes a `tx: DbTx` (from the caller's `withTenant` /
// `withServiceRole` block), runs one statement, and maps rows to the
// camelCase domain shape. No permission checks, no audit emits, no
// validation beyond null-vs-undefined handling — those belong in the
// C-3 service layer.
//
// RLS scoping is implicit. Every callsite is expected to be inside a
// `withTenant(tenantId, …)` block, so the
// `app.current_tenant_id`-keyed RLS policy on `consignees` filters
// reads, blocks cross-tenant updates/deletes, and rejects inserts
// whose `tenant_id` doesn't match the session value via WITH CHECK
// (defensive form — see 0001_identity.sql header). The `findById`,
// `update`, and `delete` functions do NOT take a tenantId argument
// because RLS handles that filter; the `list` and `insert` functions
// do, because (a) `list` reads more clearly with an explicit tenant
// filter alongside RLS (defense in depth), and (b) `insert` must set
// the column explicitly to satisfy the WITH CHECK clause.

import { sql as sqlTag, type SQL } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type { Consignee, CreateConsigneeInput, UpdateConsigneePatch } from "./types";

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------
// Drizzle's tx.execute<T> constrains T to Record<string, unknown>;
// `& Record<string, unknown>` satisfies that without polluting the
// caller-visible `Consignee` shape. Same pattern as identity's
// CountRow / AssignmentRow.
//
// postgres.js returns `timestamptz` as Date instances. The domain
// type carries IsoTimestamp (string) for cross-layer simplicity, so
// the mapper converts here. Doing the conversion at the repository
// boundary means the service / API / UI layers never have to know
// about Date vs string.
type ConsigneeRow = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  email: string | null;
  address_line: string;
  emirate_or_region: string;
  delivery_notes: string | null;
  external_ref: string | null;
  notes_internal: string | null;
  created_at: Date;
  updated_at: Date;
} & Record<string, unknown>;

function mapRow(row: ConsigneeRow): Consignee {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addressLine: row.address_line,
    emirateOrRegion: row.emirate_or_region,
    deliveryNotes: row.delivery_notes,
    externalRef: row.external_ref,
    notesInternal: row.notes_internal,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/**
 * INSERT one consignee. The caller's `withTenant` transaction already
 * has `app.current_tenant_id` bound; the explicit `tenant_id` column
 * value below must equal the session value or the RLS WITH CHECK
 * clause raises `new row violates row-level security policy`.
 *
 * Returns the inserted row, including DB-defaulted columns
 * (id, created_at, updated_at).
 */
export async function insertConsignee(
  tx: DbTx,
  tenantId: Uuid,
  input: CreateConsigneeInput
): Promise<Consignee> {
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    INSERT INTO consignees (
      tenant_id,
      name,
      phone,
      email,
      address_line,
      emirate_or_region,
      delivery_notes,
      external_ref,
      notes_internal
    ) VALUES (
      ${tenantId},
      ${input.name},
      ${input.phone},
      ${input.email ?? null},
      ${input.addressLine},
      ${input.emirateOrRegion},
      ${input.deliveryNotes ?? null},
      ${input.externalRef ?? null},
      ${input.notesInternal ?? null}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    // INSERT … RETURNING never returns zero rows on success; if it
    // does, something is very wrong (RLS WITH CHECK shouldn't suppress
    // RETURNING — it raises an error instead). Throw rather than
    // returning a synthetic value so the caller sees the anomaly.
    throw new Error("insertConsignee: INSERT … RETURNING produced zero rows");
  }
  return mapRow(rows[0]);
}

/**
 * SELECT one consignee by id. RLS scopes by tenant; a row that exists
 * but belongs to another tenant returns null (indistinguishable from
 * "row does not exist" — which is the correct default-deny posture).
 */
export async function findConsigneeById(tx: DbTx, id: Uuid): Promise<Consignee | null> {
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    SELECT * FROM consignees WHERE id = ${id}
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * SELECT every consignee for `tenantId`, newest first. The tenant
 * filter is explicit alongside RLS — same value, same result, but
 * the WHERE clause makes the query self-describing in logs and pg_stat.
 */
export async function listConsigneesByTenant(
  tx: DbTx,
  tenantId: Uuid
): Promise<readonly Consignee[]> {
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    SELECT * FROM consignees
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
  `);
  return rows.map(mapRow);
}

/**
 * UPDATE selected fields on one consignee. Only fields present on
 * `patch` are written; others are left untouched. tenant_id, id, and
 * timestamps are not patchable — the type already enforces this, and
 * the SET-clause builder below has no branch for them.
 *
 * Returns the updated row, or `null` if no row matched (because the
 * id was unknown, or RLS hid it as cross-tenant).
 *
 * Empty patch (no keys present) returns the current row unchanged via
 * findConsigneeById — single round-trip, no UPDATE statement issued.
 * The C-3 service layer should normally validate non-empty patches,
 * but this defensive branch keeps the repository total.
 */
export async function updateConsignee(
  tx: DbTx,
  id: Uuid,
  patch: UpdateConsigneePatch
): Promise<Consignee | null> {
  const sets: SQL[] = [];
  if (patch.name !== undefined) sets.push(sqlTag`name = ${patch.name}`);
  if (patch.phone !== undefined) sets.push(sqlTag`phone = ${patch.phone}`);
  if (patch.email !== undefined) sets.push(sqlTag`email = ${patch.email}`);
  if (patch.addressLine !== undefined) sets.push(sqlTag`address_line = ${patch.addressLine}`);
  if (patch.emirateOrRegion !== undefined)
    sets.push(sqlTag`emirate_or_region = ${patch.emirateOrRegion}`);
  if (patch.deliveryNotes !== undefined)
    sets.push(sqlTag`delivery_notes = ${patch.deliveryNotes}`);
  if (patch.externalRef !== undefined) sets.push(sqlTag`external_ref = ${patch.externalRef}`);
  if (patch.notesInternal !== undefined)
    sets.push(sqlTag`notes_internal = ${patch.notesInternal}`);

  if (sets.length === 0) {
    return findConsigneeById(tx, id);
  }

  const setClause = sqlTag.join(sets, sqlTag`, `);
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    UPDATE consignees
    SET ${setClause}
    WHERE id = ${id}
    RETURNING *
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * DELETE one consignee. Returns `true` if a row was removed, `false`
 * if no row matched (unknown id or RLS-hidden cross-tenant id).
 *
 * Hard delete in pilot per the 0004 header note — soft-delete is
 * deferred until the audit-history view requirements firm up. The
 * `consignee.deleted` audit event in C-3 captures the row identity
 * pre-delete so the action is recoverable from the audit trail.
 */
export async function deleteConsignee(tx: DbTx, id: Uuid): Promise<boolean> {
  const result = await tx.execute(sqlTag`
    DELETE FROM consignees WHERE id = ${id}
  `);
  // postgres.js's row-list result carries `count` for non-RETURNING
  // statements. Fall back to length check for shapes returned by tests
  // that pre-stub `execute` to return a plain array.
  const count =
    typeof (result as { count?: number }).count === "number"
      ? (result as { count: number }).count
      : Array.isArray(result)
        ? result.length
        : 0;
  return count > 0;
}
