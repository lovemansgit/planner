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
  PickupAddress,
  TenantStatus,
} from "./types";

// -----------------------------------------------------------------------------
// updateMerchantFields patch shape (Day 25 / T3 Edit Merchant)
// -----------------------------------------------------------------------------

/**
 * Patch shape consumed by updateMerchantFields. Every field is
 * optional; absent fields are preserved via COALESCE against the
 * current row value. The service layer is responsible for the
 * "at least one field" + "no-op diff" gates per plan §3.2; this
 * repo fn issues whatever UPDATE the caller asks for.
 *
 * `pickupAddress` is all-or-none at the service boundary — when
 * supplied here it carries all three sub-fields (the service has
 * already validated non-empty trimming). When omitted, none of the
 * three pickup_address_* columns are touched.
 */
export interface UpdateMerchantFieldsPatch {
  readonly name?: string;
  readonly pickupAddress?: PickupAddress;
  readonly suitefleetCustomerCode?: string;
  /**
   * SF region FK — Day 26 / T3 Sub-PR 3. Updates
   * `tenants.suitefleet_region_id`. The DB FK (ON DELETE RESTRICT
   * against `suitefleet_regions(id)`) catches bogus UUIDs at write
   * time; the column is NOT NULL post-migration-0024 so the
   * COALESCE-style update is null-safe (sentinel-null preserves the
   * existing value).
   */
  readonly suitefleetRegionId?: Uuid;
}

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
  suitefleet_customer_code: string | null;
  suitefleet_region_id: string;
  suitefleet_credential_1_vault_id: string | null;
  suitefleet_credential_2_vault_id: string | null;
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
    suitefleetCustomerCode: row.suitefleet_customer_code,
    suitefleetRegionId: row.suitefleet_region_id as Uuid,
    suitefleetCredential1VaultId: row.suitefleet_credential_1_vault_id as Uuid | null,
    suitefleetCredential2VaultId: row.suitefleet_credential_2_vault_id as Uuid | null,
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
      pickup_address_emirate,
      suitefleet_customer_code
    ) VALUES (
      ${input.slug},
      ${input.name},
      ${input.pickupAddress.line},
      ${input.pickupAddress.district},
      ${input.pickupAddress.emirate},
      ${input.suitefleetCustomerCode}
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
 * UPDATE one tenant row with the supplied patch — Pattern A
 * COALESCE-style: each editable column is updated to the patch value
 * when supplied, otherwise preserved via COALESCE against the current
 * column. Null-sentinel binds work because none of the editable
 * columns legitimately accept NULL as a "clear" semantic for v1
 * (the create form requires all of name / slug / pickup_address_* /
 * suitefleet_customer_code on insert, and the edit form preserves
 * those values via pre-fill).
 *
 * If a future field added here legitimately accepts NULL ("clear this
 * field"), Pattern A breaks and we revisit; for v1 scope this is fine.
 *
 * `updated_at = now()` is set explicitly — defensive in case the
 * BEFORE-UPDATE trigger from 0001 is ever modified, mirrors the
 * existing `updateMerchantStatus:215` shape.
 *
 * Returns the updated row (mapped to camelCase) on success; null when
 * no row matched (vanished mid-tx — caller's FOR UPDATE lock should
 * prevent this in practice, returns null here so the service can map
 * to NotFoundError consistently with `updateMerchantStatus`).
 *
 * No 23505 path under the current patch shape — `slug` (the only
 * UNIQUE-constrained editable column on `tenants`) was removed from
 * UpdateMerchantFieldsPatch in the slug-edit-removal PR. The service
 * layer still wraps the call in isUniqueViolation/ConflictError mapping
 * as defense-in-depth so any future UNIQUE-constrained column added
 * here lights up the existing 409 path without touching the service.
 */
export async function updateMerchantFields(
  tx: DbTx,
  id: Uuid,
  patch: UpdateMerchantFieldsPatch,
): Promise<Merchant | null> {
  const name = patch.name ?? null;
  const pickupLine = patch.pickupAddress?.line ?? null;
  const pickupDistrict = patch.pickupAddress?.district ?? null;
  const pickupEmirate = patch.pickupAddress?.emirate ?? null;
  const suitefleetCustomerCode = patch.suitefleetCustomerCode ?? null;
  const suitefleetRegionId = patch.suitefleetRegionId ?? null;

  const rows = await tx.execute<TenantRow>(sqlTag`
    UPDATE tenants
    SET
      name = COALESCE(${name}, name),
      pickup_address_line = COALESCE(${pickupLine}, pickup_address_line),
      pickup_address_district = COALESCE(${pickupDistrict}, pickup_address_district),
      pickup_address_emirate = COALESCE(${pickupEmirate}, pickup_address_emirate),
      suitefleet_customer_code = COALESCE(${suitefleetCustomerCode}, suitefleet_customer_code),
      suitefleet_region_id = COALESCE(${suitefleetRegionId}::uuid, suitefleet_region_id),
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `);

  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * SELECT every tenant matching the filter, newest first. Cross-tenant
 * scope — caller is in `withServiceRole`.
 *
 * Filter precedence (Day-18 §5 cleanup; ListMerchantsFilters
 * documented in src/modules/merchants/types.ts):
 *
 *   - `status === 'archived'`       → returns archived rows only;
 *                                     `excludeArchived` is ignored.
 *                                     (Forensic-review path; the
 *                                     /admin/merchants UI surfaces
 *                                     this via `?status=archived`.)
 *   - `status === <other>`          → returns rows in that status;
 *                                     `excludeArchived` is ignored.
 *   - `status === undefined`        → applies `excludeArchived`
 *                                     (default `true`).
 *     - `excludeArchived: true`     → `WHERE status != 'archived'`
 *                                     (default; demo-hygiene).
 *     - `excludeArchived: false`    → no filter; all rows including
 *                                     archived (debug only).
 *
 * Day-24: composable filter refactor. Status + archive + search are
 * each independent SQL fragments composed into a single SELECT — was
 * three forked branches per Day-18, now one statement.
 */
export async function listMerchants(
  tx: DbTx,
  filters: ListMerchantsFilters = {},
): Promise<readonly Merchant[]> {
  const excludeArchived = filters.excludeArchived ?? true;
  const statusFilter =
    filters.status !== undefined
      ? sqlTag`AND status = ${filters.status}`
      : excludeArchived
        ? sqlTag`AND status != 'archived'`
        : sqlTag``;
  const searchFilter = buildMerchantSearchFilter(filters.searchTerm);

  const rows = await tx.execute<TenantRow>(sqlTag`
    SELECT * FROM tenants
    WHERE 1 = 1
      ${statusFilter}
      ${searchFilter}
    ORDER BY created_at DESC
  `);
  return rows.map(mapRow);
}

function buildMerchantSearchFilter(searchTerm: string | undefined) {
  if (!searchTerm) return sqlTag``;
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) return sqlTag``;
  const pattern = `%${trimmed}%`;
  return sqlTag`AND (name ILIKE ${pattern} OR slug ILIKE ${pattern})`;
}
