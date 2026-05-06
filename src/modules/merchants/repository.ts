// Merchant repository — Drizzle queries against the `tenants` table.
//
// Day 16 / Block 4-D — Service D. Pure-DB layer per the C-2 brief §4.1
// repository convention: every fn takes a `tx: DbTx` (from the caller's
// `withServiceRole` block — these are CROSS-tenant ops by definition,
// not `withTenant` like other modules), runs one statement, and maps
// rows to the camelCase domain shape. No permission checks, no audit
// emits, no validation beyond null-vs-undefined handling — those belong
// in the service layer.
//
// Cross-tenant scope: all merchant operations are operator-driven by
// transcorp-sysadmin / transcorp_staff actors and SHOULD bypass the
// per-tenant RLS policy on `tenants` (which scopes by `id =
// app.current_tenant_id`). The service layer wraps each call site in
// `withServiceRole` per `src/modules/identity/tenant-lookup.ts:42` /
// `src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts:75`
// existing convention.
//
// Pickup-address nested-vs-flat boundary: the module surface uses
// nested `pickupAddress: { line, district, emirate }` (per Block 4-D
// Gate 4 Option C); the schema columns are flat
// (`pickup_address_line`, `pickup_address_district`,
// `pickup_address_emirate` per migration 0017). The flatten/unflatten
// happens here at the repository layer — `insertMerchant` expands
// nested DTO → flat columns; `mapRow` collapses flat columns → nested
// DTO.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type {
  CreateMerchantInput,
  ListMerchantsFilters,
  Merchant,
  TenantStatus,
} from "./types";

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  pickup_address_line: string | null;
  pickup_address_district: string | null;
  pickup_address_emirate: string | null;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Collapse the three flat pickup_address_* columns to a nested
 * `pickupAddress` object, OR null when ALL three are NULL (legacy
 * pre-0017 rows). Mixed-null shape (some columns set, some null) is
 * surfaced as null on the DTO — that data state shouldn't exist for
 * any merchant created via the MVP `createMerchant` service, but if
 * it does (manual SQL fix-up, partial backfill), the DTO doesn't
 * lie about partial completeness; it returns null and the operator
 * surface treats it as missing. A future Phase 2 NOT NULL promotion
 * eliminates the mixed-null possibility.
 */
function mapRow(row: TenantRow): Merchant {
  const allPickupNull =
    row.pickup_address_line === null &&
    row.pickup_address_district === null &&
    row.pickup_address_emirate === null;
  const allPickupNonNull =
    row.pickup_address_line !== null &&
    row.pickup_address_district !== null &&
    row.pickup_address_emirate !== null;

  const pickupAddress = allPickupNonNull
    ? {
        line: row.pickup_address_line as string,
        district: row.pickup_address_district as string,
        emirate: row.pickup_address_emirate as string,
      }
    : allPickupNull
      ? null
      : null; // mixed-null surfaces as null per header comment

  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status as TenantStatus,
    pickupAddress,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/**
 * INSERT one tenant row. The caller's `withServiceRole` block bypasses
 * RLS (no `app.current_tenant_id` is set during merchant creation —
 * tenants is the table that scopes everything else). `status` is
 * NOT supplied; the column DEFAULT 'provisioning' (per migration
 * 0001 line 5-6) populates it. Slug uniqueness is enforced by the
 * UNIQUE constraint on `tenants.slug`; a duplicate raises SQLSTATE
 * 23505 which the service layer maps to ConflictError.
 *
 * Returns the inserted row mapped to camelCase, including DB-defaulted
 * columns (id, status, created_at, updated_at).
 */
export async function insertMerchant(
  tx: DbTx,
  input: CreateMerchantInput,
): Promise<Merchant> {
  const rows = await tx.execute<TenantRow>(sqlTag`
    INSERT INTO tenants (
      slug,
      name,
      pickup_address_line,
      pickup_address_district,
      pickup_address_emirate
    ) VALUES (
      ${input.slug},
      ${input.name},
      ${input.pickupAddress.line},
      ${input.pickupAddress.district},
      ${input.pickupAddress.emirate}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error("insertMerchant: INSERT … RETURNING produced zero rows");
  }
  return mapRow(rows[0]);
}

/**
 * SELECT one tenant by id. Returns null when the row is missing.
 * Cross-tenant scope — caller is in `withServiceRole`; no RLS filter
 * applies.
 */
export async function findMerchantById(tx: DbTx, id: Uuid): Promise<Merchant | null> {
  const rows = await tx.execute<TenantRow>(sqlTag`
    SELECT * FROM tenants WHERE id = ${id}
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * SELECT one tenant by slug. Returns null when no row matches. Used
 * by the service layer for pre-INSERT slug-collision detection (the
 * UNIQUE constraint is the actual enforcement; this is a courtesy
 * pre-check for cleaner error surfaces).
 */
export async function findMerchantBySlug(
  tx: DbTx,
  slug: string,
): Promise<Merchant | null> {
  const rows = await tx.execute<TenantRow>(sqlTag`
    SELECT * FROM tenants WHERE slug = ${slug}
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * SELECT one tenant FOR UPDATE — row-locks for the duration of the
 * transaction. Used by activate/deactivate to read the current
 * status, run the strict state-machine gate against it, and then
 * UPDATE atomically without a read-after-write race against a
 * concurrent caller.
 *
 * Mirrors the `findConsigneeForCrmUpdate` pattern in the consignees
 * module (Service C) — same FOR UPDATE posture for state-machine
 * transitions.
 */
export async function findMerchantForStatusUpdate(
  tx: DbTx,
  id: Uuid,
): Promise<Merchant | null> {
  const rows = await tx.execute<TenantRow>(sqlTag`
    SELECT * FROM tenants WHERE id = ${id} FOR UPDATE
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * UPDATE tenants.status for one row + bump updated_at (the existing
 * BEFORE-UPDATE trigger from 0001 covers this, but explicit `now()`
 * here pins the timestamp value alongside the status flip for
 * audit-trail clarity).
 *
 * Returns true on success, false if no row matched (vanished mid-tx;
 * the caller's findMerchantForStatusUpdate FOR UPDATE lock should
 * prevent this — false here is a programming error and the caller
 * maps it to NotFoundError).
 */
export async function updateMerchantStatus(
  tx: DbTx,
  id: Uuid,
  toStatus: TenantStatus,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
    UPDATE tenants
    SET status = ${toStatus},
        updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * SELECT every tenant matching the filter, newest first. Cross-tenant
 * scope — caller is in `withServiceRole`. `status?` filter is the
 * only MVP option per merged plan §5.2.4.
 */
export async function listMerchants(
  tx: DbTx,
  filters: ListMerchantsFilters = {},
): Promise<readonly Merchant[]> {
  const rows = filters.status
    ? await tx.execute<TenantRow>(sqlTag`
        SELECT * FROM tenants
        WHERE status = ${filters.status}
        ORDER BY created_at DESC
      `)
    : await tx.execute<TenantRow>(sqlTag`
        SELECT * FROM tenants
        ORDER BY created_at DESC
      `);
  return rows.map(mapRow);
}
