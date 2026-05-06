// subscription-addresses repository — Drizzle queries.
//
// Day 16 / Block 4-E — Service E. Pure-DB layer: every fn takes a
// `tx: DbTx` from the caller's `withTenant` block, runs one
// statement, and maps to camelCase. No permission checks, no audit
// emits.
//
// Tables touched:
//   - subscription_address_rotations (write surface for rotation;
//     UNIQUE on (subscription_id, weekday) per migration 0014)
//   - addresses (READ-ONLY here; the cross-consignee ownership helper
//     SELECTs a minimal projection, no INSERT/UPDATE/DELETE)
//   - subscriptions (READ-ONLY; FOR UPDATE lookup with consignee_id +
//     status)
//
// Defence-in-depth tenant_id predicate alongside RLS — same posture
// as consignees + subscription-exceptions repositories.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type {
  AddressOwnershipRow,
  CurrentRotationRow,
  IsoWeekday,
  RotationEntry,
  SubscriptionForRotation,
} from "./types";

// -----------------------------------------------------------------------------
// findAddressForConsignee — shared cross-consignee ownership helper
// -----------------------------------------------------------------------------

/**
 * Returns the address row IF it exists AND belongs to `consigneeId`
 * AND is in `tenantId`. Returns null otherwise.
 *
 * The three predicates are AND-joined; null on any failure means the
 * caller treats it as "not found for this consignee" without
 * distinguishing the failure variant (defence-in-depth — don't leak
 * existence-vs-ownership information to the service-layer caller's
 * error message; the service throws a single ValidationError).
 *
 * This is the shared helper called by:
 *   - `changeAddressRotation` (this module's service.ts) for every
 *     entry in input.rotation.
 *   - `addSubscriptionException` (subscription-exceptions/service.ts)
 *     for the `addressOverrideId` field on type='address_override_one_off'
 *     and 'address_override_forward' branches.
 *
 * RLS scopes the underlying SELECT by `tenant_id =
 * app.current_tenant_id` (see migration 0014); the explicit
 * `tenant_id = $3` predicate here is defence-in-depth and gives the
 * SQL self-describing in pg_stat / EXPLAIN.
 *
 * Cross-consignee within same tenant is the failure mode this guards
 * — RLS allows the SELECT to see the row (same tenant), but the
 * `consignee_id = $2` predicate rejects it.
 */
export async function findAddressForConsignee(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
  addressId: Uuid,
): Promise<AddressOwnershipRow | null> {
  type Row = {
    id: string;
    consignee_id: string;
    tenant_id: string;
    label: string;
    is_primary: boolean;
  } & Record<string, unknown>;

  const rows = await tx.execute<Row>(sqlTag`
    SELECT id, consignee_id, tenant_id, label, is_primary
    FROM addresses
    WHERE id = ${addressId}
      AND consignee_id = ${consigneeId}
      AND tenant_id = ${tenantId}
  `);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as Uuid,
    consigneeId: row.consignee_id as Uuid,
    tenantId: row.tenant_id as Uuid,
    label: row.label as "home" | "office" | "other",
    isPrimary: row.is_primary,
  };
}

// -----------------------------------------------------------------------------
// findSubscriptionForRotation — FOR UPDATE lookup with consignee_id
// -----------------------------------------------------------------------------

/**
 * SELECT id, tenant_id, consignee_id, status FROM subscriptions
 * WHERE id = $ FOR UPDATE.
 *
 * Row-locks the subscription so concurrent rotation writes serialize.
 * Returns null on missing row / RLS-hidden / cross-tenant. The status
 * union ('active' | 'paused' | 'ended') reflects the
 * `subscription_status` enum from 0005; service-layer rejects
 * non-active.
 *
 * Distinct from `subscription-exceptions/service.ts`'s internal
 * `getSubscriptionForUpdate` because rotation needs `consignee_id`
 * but doesn't need `start_date`/`end_date`/`days_of_week`. Not a
 * shared helper — different field projections, different concerns.
 */
export async function findSubscriptionForRotation(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
): Promise<SubscriptionForRotation | null> {
  type Row = {
    id: string;
    tenant_id: string;
    consignee_id: string;
    status: string;
  } & Record<string, unknown>;

  const rows = await tx.execute<Row>(sqlTag`
    SELECT id, tenant_id, consignee_id, status
    FROM subscriptions
    WHERE id = ${subscriptionId} AND tenant_id = ${tenantId}
    FOR UPDATE
  `);

  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.status !== "active" && row.status !== "paused" && row.status !== "ended") {
    throw new Error(
      `findSubscriptionForRotation: unexpected status '${row.status}'`,
    );
  }
  return {
    id: row.id as Uuid,
    tenantId: row.tenant_id as Uuid,
    consigneeId: row.consignee_id as Uuid,
    status: row.status,
  };
}

// -----------------------------------------------------------------------------
// selectCurrentRotation — for no_op detection + delete-set computation
// -----------------------------------------------------------------------------

/**
 * SELECT every rotation row for the subscription, ordered by weekday
 * ASC. Caller (service layer) uses this for two purposes:
 *   1. No-op detection — compare input to current as a SET of
 *      (weekday, addressId) pairs.
 *   2. Compute the weekdays-to-delete set (current weekdays MINUS
 *      input weekdays).
 *
 * Defence-in-depth tenant_id predicate. RLS already scopes by
 * tenant_id; explicit predicate is consistent with the rest of the
 * module.
 */
export async function selectCurrentRotation(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
): Promise<readonly CurrentRotationRow[]> {
  type Row = {
    id: string;
    weekday: number;
    address_id: string;
    created_at: Date | string;
  } & Record<string, unknown>;

  const rows = await tx.execute<Row>(sqlTag`
    SELECT id, weekday, address_id, created_at
    FROM subscription_address_rotations
    WHERE subscription_id = ${subscriptionId}
      AND tenant_id = ${tenantId}
    ORDER BY weekday ASC
  `);

  return rows.map((row) => ({
    id: row.id as Uuid,
    weekday: row.weekday as IsoWeekday,
    addressId: row.address_id as Uuid,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  }));
}

// -----------------------------------------------------------------------------
// upsertRotationEntries — multi-row UPSERT on (subscription_id, weekday)
// -----------------------------------------------------------------------------

/**
 * INSERT one row per entry in `entries`; on conflict on the UNIQUE
 * (subscription_id, weekday) index from migration 0014, UPDATE
 * `address_id` to the new value.
 *
 * Idempotent at the row level: re-running with the same input lands
 * the same final state. Combined with the no_op short-circuit at the
 * service layer (input matches current → return without write), the
 * common operator-double-click path produces zero DB churn.
 *
 * Empty `entries` is a no-op (SQL with VALUES () would be malformed;
 * the caller guards by branching before calling). Service layer
 * checks `entries.length > 0`; if zero, it skips the upsert call
 * entirely.
 *
 * No `created_at` / `updated_at` touch — the table from migration
 * 0014 has no `updated_at` column; rotation rows are short-lived
 * (subscriptions delete + recreate them rather than UPDATE in place
 * for full rotation changes, but UPSERT path keeps stable rows for
 * unchanged weekdays).
 */
export async function upsertRotationEntries(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  entries: readonly RotationEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // Build the multi-row VALUES clause as a single sql tag with
  // joined fragments — same approach Drizzle's documentation
  // suggests for variadic VALUES.
  const valueFragments = entries.map(
    (e) => sqlTag`(${subscriptionId}, ${tenantId}, ${e.weekday}, ${e.addressId})`,
  );
  const valuesClause = sqlTag.join(valueFragments, sqlTag`, `);

  await tx.execute(sqlTag`
    INSERT INTO subscription_address_rotations
      (subscription_id, tenant_id, weekday, address_id)
    VALUES ${valuesClause}
    ON CONFLICT (subscription_id, weekday)
    DO UPDATE SET address_id = EXCLUDED.address_id
  `);
}

// -----------------------------------------------------------------------------
// deleteRotationEntries — remove specific weekdays for a subscription
// -----------------------------------------------------------------------------

/**
 * DELETE the rotation rows for the subscription whose weekday is in
 * the supplied set. Empty `weekdays` is a no-op (caller branches).
 *
 * Used in the rotation-replace flow: the service computes (current
 * weekdays MINUS input weekdays) → those are deleted; (input
 * weekdays) → those go through upsertRotationEntries. The two
 * operations together implement full-replace semantic.
 *
 * Implementation note — `weekday IN (...)` instead of
 * `weekday = ANY($::int[])`:
 *
 * Drizzle binds a JS array passed to a `${arr}` interpolation as
 * `($1, $2, …, $N)` — a Postgres ROW/tuple constructor, not an
 * array. The cast `::int[]` would then fail at runtime because a
 * row cannot be cast to an array. The idiomatic fix for
 * fixed-cardinality lists (max 7 weekdays here) is `IN (…)` with
 * `sqlTag.join` building the placeholder list. Same generated plan
 * as ANY-with-array but Drizzle binds each value as a discrete
 * parameter, which is what Postgres expects for IN.
 */
export async function deleteRotationEntries(
  tx: DbTx,
  tenantId: Uuid,
  subscriptionId: Uuid,
  weekdays: readonly IsoWeekday[],
): Promise<void> {
  if (weekdays.length === 0) return;

  const placeholders = weekdays.map((w) => sqlTag`${w as number}`);
  const inClause = sqlTag.join(placeholders, sqlTag`, `);

  await tx.execute(sqlTag`
    DELETE FROM subscription_address_rotations
    WHERE subscription_id = ${subscriptionId}
      AND tenant_id = ${tenantId}
      AND weekday IN (${inClause})
  `);
}
