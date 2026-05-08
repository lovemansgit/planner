// Merchants module domain types.
//
// Day 16 / Block 4-D — Service D. Greenfield module under
// src/modules/merchants/ (flat per reviewer Gate 2). Owns the
// Transcorp-staff cross-tenant surface: createMerchant,
// activateMerchant, deactivateMerchant, listMerchants.
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in 0001_identity.sql tenants
// table + 0017_tenants_pickup_address.sql.
//
// Note on naming: the underlying DB table is `tenants` (the original
// multi-tenant scoping table). The MVP uses `tenants` rows to model
// merchants because each merchant maps 1:1 to a tenant in the
// platform — there is no separate `merchants` table. The module is
// named `merchants/` because that's the brief framing (§3.1.4
// service-layer additions: Transcorp-staff createMerchant /
// activate / deactivate); the audit events follow the same framing
// (`merchant.created`, `merchant.activated`, `merchant.deactivated`
// per audit/event-types.ts).
//
// Audit body shape decision (Block 4-D Gate 4 waiver, Option C):
// merchant.created uses NESTED `pickup_address: { line, district,
// emirate }` per registered metadataNotes at audit/event-types.ts
// :707-708 + brief v1.3 §3.1.1 service-DTO shape. The DTO at this
// module's surface is also nested for symmetry; the repository
// flattens to schema columns at the persistence boundary.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * tenants.status — 5-state lowercase canon. Migration 0001 shipped
 * the original 4-state (`provisioning | active | suspended | inactive`);
 * migration 0021 widened the CHECK constraint to include `'archived'`
 * (Day-18 fixture cleanup).
 *
 * Operator-driven lifecycle in MVP exposes only:
 *   `provisioning → active`  (activateMerchant)
 *   `active → inactive`      (deactivateMerchant)
 *
 * `'suspended'` is reserved (part-2 service-surface decision deferred
 * per brief §3.1.1 + memory/followup_merchant_lifecycle_transition_expansion.md).
 *
 * `'archived'` is set ONLY by the Day-18 fixture-cleanup migration
 * (0021_tenants_status_archived.sql). No service fn flips a tenant
 * to `'archived'` — operator-driven `archiveMerchant` is queued for
 * Phase 2 lifecycle expansion (same followup memo). Archived rows
 * are excluded from the admin list page by default (see
 * ListMerchantsFilters.excludeArchived) and from the cron β tenant
 * walk via the `AND status IN ('provisioning', 'active')` filter at
 * src/app/api/cron/generate-tasks/list-cron-eligible-tenants.ts.
 */
export type TenantStatus = "provisioning" | "active" | "suspended" | "inactive" | "archived";

/**
 * Pickup-address DTO — nested object shape per brief v1.3 §3.1.1
 * service-layer DTO + Block 4-D Gate 4 waiver Option C registered
 * audit body shape. Persistence layer maps the nested object to flat
 * schema columns (`pickup_address_line`, `pickup_address_district`,
 * `pickup_address_emirate`) at the repository boundary.
 *
 * Nullable on the read side because migration 0017 added the columns
 * as nullable (legacy tenants pre-dating the column-add carry NULL).
 * `createMerchant` requires non-empty values at service-layer input
 * validation; new merchants always land with all three populated.
 */
export interface PickupAddress {
  readonly line: string;
  readonly district: string;
  readonly emirate: string;
}

/**
 * Merchant domain DTO surfaced by listMerchants + the merchant
 * lifecycle service result types. Mirrors the tenants table 1:1
 * for the columns the merchant surface cares about; other tenants
 * columns (suitefleet_customer_code, source_of_truth, migration_gate_*)
 * are intentionally NOT projected here — they belong to other
 * modules' surfaces (task-push, identity).
 */
export interface Merchant {
  readonly tenantId: Uuid;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  /**
   * Nested per Block 4-D Gate 4 Option C. `null` only for legacy
   * tenants that pre-date migration 0017 (rows created before the
   * column-add). Tenants created via `createMerchant` always have
   * all three sub-fields populated.
   */
  readonly pickupAddress: PickupAddress | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

// -----------------------------------------------------------------------------
// Service input + result types
// -----------------------------------------------------------------------------

/**
 * createMerchant input. `pickup_address` is nested at the service
 * boundary; the repository flattens it before INSERT. All four sub-
 * fields are required and non-empty (validated at service entry);
 * the brief v1.3 §3.1.1 specifies non-null at create time and the
 * NOT NULL promotion is queued for Phase 2 once data is clean.
 */
export interface CreateMerchantInput {
  readonly name: string;
  readonly slug: string;
  readonly pickupAddress: PickupAddress;
}

/**
 * Result discriminated by `status` literal. Each method returns a
 * unique status literal so callers can switch on result.status
 * without inspecting the called method's identity. No `no_op` shape
 * because the natural-idempotency posture per Block 4-D ruling
 * (UNIQUE-slug constraint on create; state-machine-409 on
 * activate/deactivate) means duplicate calls always throw rather
 * than silently succeed.
 */
export interface CreateMerchantResult {
  readonly status: "created";
  readonly tenantId: Uuid;
}

export interface ActivateMerchantResult {
  readonly status: "activated";
  readonly tenantId: Uuid;
  readonly previousStatus: "provisioning";
  readonly newStatus: "active";
}

export interface DeactivateMerchantResult {
  readonly status: "deactivated";
  readonly tenantId: Uuid;
  readonly previousStatus: "active";
  readonly newStatus: "inactive";
}

/**
 * listMerchants filter shape per merged plan §5.2.4. Day-18 cleanup
 * (PR #189 plan + this code-PR) added `excludeArchived?` so the admin
 * list page renders demo merchants only by default while preserving
 * a forensic-review path via the explicit `status: 'archived'` filter.
 *
 * Precedence rule (enforced in repository.ts:listMerchants):
 *   - `status === 'archived'`  → returns archived rows; `excludeArchived` ignored.
 *   - `status === <other>`     → returns rows in that status; `excludeArchived` ignored.
 *   - `status === undefined`   → applies `excludeArchived` (default `true`).
 *     - `excludeArchived: true`  → `WHERE status != 'archived'` (default).
 *     - `excludeArchived: false` → all rows including archived (debug/forensic).
 *
 * Additional filters (slug pattern, created_at range) are Phase 2.
 */
export interface ListMerchantsFilters {
  readonly status?: TenantStatus;
  /**
   * Default `true` (excludes archived rows). Ignored when an explicit
   * `status` filter is provided. Set to `false` to surface archived
   * rows in a no-status-filter call (rare; debugging only).
   */
  readonly excludeArchived?: boolean;
}
