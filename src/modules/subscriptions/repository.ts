// Subscription repository — Drizzle queries against `subscriptions` (0009).
//
// "Repository" here is the data-access layer per Day-5 brief §6.1 T-2:
// "types + repository — Drizzle queries, no business logic." Every
// function takes a `tx: DbTx` (from the caller's `withTenant` /
// `withServiceRole` block), runs one or two statements, and maps rows
// to the camelCase domain shape. No permission checks, no audit emits,
// no validation beyond null-vs-undefined handling — those belong in
// the S-4 service layer.
//
// RLS is the primary defence. Every callsite runs inside a
// `withTenant(tenantId, …)` block, so the
// `app.current_tenant_id`-keyed RLS policy on `subscriptions` filters
// reads, blocks cross-tenant updates/deletes, and rejects inserts
// whose `tenant_id` doesn't match the session value via WITH CHECK
// (defensive form — see 0001_identity.sql header).
//
// Defence in depth: every write path AND every list/lookup that takes
// a `tenantId` carries an explicit `AND tenant_id = ${tenantId}`
// predicate alongside RLS. Same value, same result, but the WHERE
// clause is self-describing in pg_stat / EXPLAIN. `findSubscriptionById`
// is the lone exception — read by id has no blast radius beyond what
// RLS hides, and adding a parameter would complicate every caller.
//
// Before/after capture for audit (S-4):
//   `updateSubscription`, `pauseSubscription`, `resumeSubscription`,
//   `endSubscription` all return a `{ before, after }` pair for
//   forensic-grade audit emits. The before-state is captured under
//   `SELECT … FOR UPDATE` inside the same transaction as the UPDATE,
//   so the pair is consistent (no concurrent transaction can race the
//   row between SELECT and UPDATE — the row is locked).
//
// Lifecycle transitions:
//   pauseSubscription:  status='active'        → 'paused'   (set paused_at)
//   resumeSubscription: status='paused'        → 'active'   (clear paused_at)
//   endSubscription:    status IN ('active','paused') → 'ended' (set ended_at, clear paused_at)
//   Illegal transitions throw ConflictError — same convention as other
//   service-layer-friendly errors (e.g. C-21's last-tenant-admin guard).
//
// Empty-patch short-circuit:
//   `updateSubscription({})` returns `{ before, after: before }` with
//   referentially identical objects. No UPDATE statement is issued.

import { sql as sqlTag, type SQL } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import { ConflictError, NotFoundError } from "@/shared/errors";
import type { IsoTimestamp, Uuid } from "@/shared/types";

import type {
  CreateSubscriptionInput,
  Subscription,
  SubscriptionAddressOverride,
  SubscriptionStatus,
  SubscriptionUpdate,
  UpdateSubscriptionPatch,
} from "./types";

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------
// Drizzle's tx.execute<T> constrains T to Record<string, unknown>; the
// `& Record<string, unknown>` intersection satisfies that without polluting
// the caller-visible Subscription shape.
//
// Type handling per postgres-js conventions:
//   - timestamptz: Date OR ISO string (preview pooler returns strings;
//     CI Postgres returns Date instances). Coerced via `toIso`.
//   - date: string ('YYYY-MM-DD').
//   - time: string ('HH:MM:SS').
//   - integer[]: number[] (postgres-js binds Postgres arrays directly).
//   - jsonb: parsed object | null (postgres-js JSON-parses jsonb columns).

type SubscriptionRow = {
  id: string;
  tenant_id: string;
  consignee_id: string;
  status: SubscriptionStatus;
  start_date: Date | string;
  end_date: Date | string | null;
  days_of_week: number[];
  delivery_window_start: string;
  delivery_window_end: string;
  delivery_address_override: SubscriptionAddressOverride | null;
  meal_plan_name: string | null;
  external_ref: string | null;
  notes_internal: string | null;
  paused_at: Date | string | null;
  ended_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): IsoTimestamp {
  return (
    value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  ) as IsoTimestamp;
}

function toIsoOrNull(value: Date | string | null): IsoTimestamp | null {
  return value === null ? null : toIso(value);
}

function toDateString(value: Date | string): string {
  // Date columns may arrive as Date (midnight UTC) or string. The
  // canonical wire shape is YYYY-MM-DD; toISOString().slice(0, 10)
  // covers the Date case, and a string already in YYYY-MM-DD form
  // passes through unchanged.
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.length > 10 ? value.slice(0, 10) : value;
}

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    consigneeId: row.consignee_id,
    status: row.status,
    startDate: toDateString(row.start_date),
    endDate: row.end_date === null ? null : toDateString(row.end_date),
    daysOfWeek: row.days_of_week,
    deliveryWindowStart: row.delivery_window_start,
    deliveryWindowEnd: row.delivery_window_end,
    deliveryAddressOverride: row.delivery_address_override,
    mealPlanName: row.meal_plan_name,
    externalRef: row.external_ref,
    notesInternal: row.notes_internal,
    pausedAt: toIsoOrNull(row.paused_at),
    endedAt: toIsoOrNull(row.ended_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/**
 * INSERT one subscription. Returns the newly-inserted row mapped to
 * the Subscription domain shape. `tenant_id` is bound by the caller's
 * `withTenant` session via the WITH CHECK clause on the RLS policy;
 * we pass it explicitly for defence-in-depth and for legibility in
 * pg_stat.
 */
export async function insertSubscription(
  tx: DbTx,
  tenantId: Uuid,
  input: CreateSubscriptionInput
): Promise<Subscription> {
  const rows = await tx.execute<SubscriptionRow>(sqlTag`
    INSERT INTO subscriptions (
      tenant_id,
      consignee_id,
      status,
      start_date,
      end_date,
      days_of_week,
      delivery_window_start,
      delivery_window_end,
      delivery_address_override,
      meal_plan_name,
      external_ref,
      notes_internal
    ) VALUES (
      ${tenantId},
      ${input.consigneeId},
      ${input.status ?? "active"},
      ${input.startDate},
      ${input.endDate ?? null},
      ${input.daysOfWeek as number[]},
      ${input.deliveryWindowStart},
      ${input.deliveryWindowEnd},
      ${input.deliveryAddressOverride ?? null},
      ${input.mealPlanName ?? null},
      ${input.externalRef ?? null},
      ${input.notesInternal ?? null}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error("insertSubscription: INSERT … RETURNING produced zero rows for subscription");
  }
  return mapSubscription(rows[0]);
}

/**
 * SELECT one subscription by id. Returns null if the row does not
 * exist OR is hidden by RLS (indistinguishable, which is the correct
 * default-deny posture).
 */
export async function findSubscriptionById(tx: DbTx, id: Uuid): Promise<Subscription | null> {
  const rows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions WHERE id = ${id}
  `);
  return rows[0] ? mapSubscription(rows[0]) : null;
}

/**
 * SELECT every subscription for `tenantId`, newest first. The tenant
 * filter is explicit alongside RLS — same value, same result, but the
 * WHERE clause makes the query self-describing in logs and pg_stat.
 */
export async function listSubscriptionsByTenant(
  tx: DbTx,
  tenantId: Uuid
): Promise<readonly Subscription[]> {
  const rows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
  `);
  return rows.map(mapSubscription);
}

/**
 * UPDATE selected scalar fields on one subscription, scoped to
 * `tenantId` for defence in depth alongside RLS. Only fields present
 * on `patch` are written.
 *
 * Returns `{ before, after }` for S-4's audit-emit before/after diff,
 * or null if no row matched (RLS-hidden or non-existent).
 *
 * Empty patch (no keys present) short-circuits to a tenant-scoped
 * `findSubscriptionById` — one round-trip, no UPDATE statement issued,
 * `before` and `after` are referentially identical.
 *
 * Non-empty patch issues two statements inside the caller's
 * transaction:
 *   1. SELECT … FOR UPDATE — captures pre-state with a row lock so a
 *      concurrent transaction cannot race the UPDATE.
 *   2. UPDATE … RETURNING * — applies the patch and returns the
 *      post-state.
 */
export async function updateSubscription(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid,
  patch: UpdateSubscriptionPatch
): Promise<SubscriptionUpdate | null> {
  const sets: SQL[] = buildUpdateSets(patch);

  if (sets.length === 0) {
    // Empty patch: short-circuit to a re-read. before === after by
    // reference; no UPDATE issued.
    const current = await findSubscriptionByIdScoped(tx, tenantId, id);
    if (current === null) return null;
    return { before: current, after: current };
  }

  const beforeRows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE id = ${id} AND tenant_id = ${tenantId}
    FOR UPDATE
  `);
  if (beforeRows.length === 0) return null;
  const before = mapSubscription(beforeRows[0]);

  const afterRows = await tx.execute<SubscriptionRow>(sqlTag`
    UPDATE subscriptions SET ${sqlTag.join(sets, sqlTag`, `)}
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  if (afterRows.length === 0) {
    // Should not happen given the FOR UPDATE lock above. If it does,
    // the row was deleted between the lock and the UPDATE — surface
    // loudly rather than fall through to a null return.
    throw new Error(
      `updateSubscription: SELECT FOR UPDATE captured row ${id} but UPDATE produced zero rows`
    );
  }
  return { before, after: mapSubscription(afterRows[0]) };
}

/**
 * Transition a subscription from 'active' to 'paused'. Sets
 * `paused_at = now()`. Returns `{ before, after }` on success, null if
 * the row does not exist / is RLS-hidden. Throws `ConflictError` if
 * the row exists but is not in 'active' state.
 */
export async function pauseSubscription(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid
): Promise<SubscriptionUpdate | null> {
  const beforeRows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE id = ${id} AND tenant_id = ${tenantId}
    FOR UPDATE
  `);
  if (beforeRows.length === 0) return null;
  const before = mapSubscription(beforeRows[0]);

  if (before.status !== "active") {
    throw new ConflictError(
      `Cannot pause subscription ${id}: status is '${before.status}', expected 'active'`
    );
  }

  const afterRows = await tx.execute<SubscriptionRow>(sqlTag`
    UPDATE subscriptions
    SET status = 'paused', paused_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  return { before, after: mapSubscription(afterRows[0]) };
}

/**
 * Transition a subscription from 'paused' to 'active'. Clears
 * `paused_at` to NULL (status is the canonical truth; paused_at is
 * the annotation). Returns `{ before, after }` on success, null if
 * the row does not exist. Throws `ConflictError` on illegal
 * transition.
 */
export async function resumeSubscription(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid
): Promise<SubscriptionUpdate | null> {
  const beforeRows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE id = ${id} AND tenant_id = ${tenantId}
    FOR UPDATE
  `);
  if (beforeRows.length === 0) return null;
  const before = mapSubscription(beforeRows[0]);

  if (before.status !== "paused") {
    throw new ConflictError(
      `Cannot resume subscription ${id}: status is '${before.status}', expected 'paused'`
    );
  }

  const afterRows = await tx.execute<SubscriptionRow>(sqlTag`
    UPDATE subscriptions
    SET status = 'active', paused_at = NULL
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  return { before, after: mapSubscription(afterRows[0]) };
}

/**
 * Transition a subscription from 'active' or 'paused' to 'ended'
 * (terminal). Sets `ended_at = now()` and clears `paused_at` (the
 * paused-since annotation no longer applies). Returns
 * `{ before, after }` on success, null if the row does not exist.
 * Throws `ConflictError` if the row is already 'ended'.
 */
export async function endSubscription(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid
): Promise<SubscriptionUpdate | null> {
  const beforeRows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE id = ${id} AND tenant_id = ${tenantId}
    FOR UPDATE
  `);
  if (beforeRows.length === 0) return null;
  const before = mapSubscription(beforeRows[0]);

  if (before.status === "ended") {
    throw new ConflictError(`Cannot end subscription ${id}: status is already 'ended' (terminal)`);
  }

  const afterRows = await tx.execute<SubscriptionRow>(sqlTag`
    UPDATE subscriptions
    SET status = 'ended', ended_at = now(), paused_at = NULL
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  return { before, after: mapSubscription(afterRows[0]) };
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function buildUpdateSets(patch: UpdateSubscriptionPatch): SQL[] {
  const sets: SQL[] = [];
  if (patch.consigneeId !== undefined) sets.push(sqlTag`consignee_id = ${patch.consigneeId}`);
  if (patch.startDate !== undefined) sets.push(sqlTag`start_date = ${patch.startDate}`);
  if (patch.endDate !== undefined) sets.push(sqlTag`end_date = ${patch.endDate}`);
  if (patch.daysOfWeek !== undefined)
    sets.push(sqlTag`days_of_week = ${patch.daysOfWeek as number[]}`);
  if (patch.deliveryWindowStart !== undefined)
    sets.push(sqlTag`delivery_window_start = ${patch.deliveryWindowStart}`);
  if (patch.deliveryWindowEnd !== undefined)
    sets.push(sqlTag`delivery_window_end = ${patch.deliveryWindowEnd}`);
  if (patch.deliveryAddressOverride !== undefined)
    sets.push(sqlTag`delivery_address_override = ${patch.deliveryAddressOverride}`);
  if (patch.mealPlanName !== undefined) sets.push(sqlTag`meal_plan_name = ${patch.mealPlanName}`);
  if (patch.externalRef !== undefined) sets.push(sqlTag`external_ref = ${patch.externalRef}`);
  if (patch.notesInternal !== undefined) sets.push(sqlTag`notes_internal = ${patch.notesInternal}`);
  return sets;
}

async function findSubscriptionByIdScoped(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid
): Promise<Subscription | null> {
  const rows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
  return rows[0] ? mapSubscription(rows[0]) : null;
}

// Re-export the typed errors used by transitional methods so callers
// of this module can match without importing from @/shared/errors.
// (Same convention as failed-pushes module.)
export { ConflictError, NotFoundError };
