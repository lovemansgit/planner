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

import type { TenantStatus } from "../merchants/types";

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
//   - integer[]: bound via `ARRAY[${arr}]::integer[]` so the array
//     constructor + explicit type cast produces a single array literal
//     in the rendered SQL. A bare `${arr}` would spread as N
//     comma-separated parameters — correct for `IN (…)` clauses, but
//     interpreted as a record/tuple in a single-column VALUES slot,
//     incompatible with the `integer[]` column type (Postgres 42804).
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
      ${daysOfWeekArrayLiteral(input.daysOfWeek)},
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
 * Day-23 §3.3.2 — SELECT every subscription for `consigneeId` within
 * `tenantId`, newest first. Drives the consignee-detail Subscription
 * tab (replaces the PlaceholderTab that shipped at Day-17). Tenant
 * predicate is explicit alongside RLS for defence-in-depth and
 * legibility, matching `listAddressesForConsignee` precedent.
 */
export async function listSubscriptionsByConsignee(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
): Promise<readonly Subscription[]> {
  const rows = await tx.execute<SubscriptionRow>(sqlTag`
    SELECT * FROM subscriptions
    WHERE tenant_id = ${tenantId}
      AND consignee_id = ${consigneeId}
    ORDER BY created_at DESC
  `);
  return rows.map(mapSubscription);
}

// -----------------------------------------------------------------------------
// Day-22 §3.22 Fix 1 — list subscriptions with consignee name JOIN
// -----------------------------------------------------------------------------

/**
 * Wrapper row returned by `listSubscriptionsWithConsigneeByTenant`.
 * Adds the consignee's display name + id as separate fields so the
 * /subscriptions list page can render the operator-readable name
 * instead of a truncated UUID.
 */
export interface SubscriptionWithConsignee {
  readonly subscription: Subscription;
  readonly consigneeName: string;
}

/**
 * Day-22 §3.22 Fix 1 — JOIN subscriptions + consignees so the operator
 * /subscriptions list shows consignee names instead of UUID
 * shorthands. Tenant-scoped on both tables for defence-in-depth
 * alongside RLS. Newest-first per existing convention.
 */
export async function listSubscriptionsWithConsigneeByTenant(
  tx: DbTx,
  tenantId: Uuid,
  opts: { readonly searchTerm?: string } = {},
): Promise<readonly SubscriptionWithConsignee[]> {
  type JoinedRow = SubscriptionRow & {
    readonly consignee_name: string;
  };
  const searchFilter = buildSubscriptionSearchFilter(opts.searchTerm);
  const rows = await tx.execute<JoinedRow>(sqlTag`
    SELECT s.*, c.name AS consignee_name
    FROM subscriptions s
    JOIN consignees c ON c.id = s.consignee_id AND c.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${tenantId}
      ${searchFilter}
    ORDER BY s.created_at DESC
  `);
  return rows.map((row) => ({
    subscription: mapSubscription(row),
    consigneeName: row.consignee_name,
  }));
}

function buildSubscriptionSearchFilter(searchTerm: string | undefined) {
  if (!searchTerm) return sqlTag``;
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) return sqlTag``;
  const pattern = `%${trimmed}%`;
  return sqlTag`AND (c.name ILIKE ${pattern} OR s.external_ref ILIKE ${pattern})`;
}

// -----------------------------------------------------------------------------
// Day 19 / Phase 1.5 — cross-tenant admin list
// -----------------------------------------------------------------------------

/**
 * Filters for listAllSubscriptionsRows. Optional merchantSlug narrows
 * to a single tenant; limit/offset for pagination (defaults applied
 * at fn body — default 50, max 500 per merged plan scope item 8).
 */
export interface ListAllSubscriptionsFilters {
  readonly merchantSlug?: string;
  readonly limit?: number;
  readonly offset?: number;
}

type AdminSubscriptionJoinRow = SubscriptionRow & {
  readonly merchant_tenant_id: string;
  readonly merchant_slug: string;
  readonly merchant_name: string;
  readonly merchant_status: TenantStatus;
};

/**
 * Day 19 / Phase 1.5 — cross-tenant SELECT of subscriptions across all
 * merchants. Caller is in withServiceRole; no RLS predicate. JOIN
 * tenants for merchant surface columns per merged plan §5.3.
 *
 * ORDER BY created_at DESC per merged plan scope item 9.
 */
export async function listAllSubscriptionsRows(
  tx: DbTx,
  filters: ListAllSubscriptionsFilters = {},
): Promise<
  readonly {
    subscription: Subscription;
    merchant: {
      tenantId: Uuid;
      slug: string;
      name: string;
      status: TenantStatus;
    };
  }[]
> {
  const limit = Math.min(filters.limit ?? 50, 500);
  const offset = filters.offset ?? 0;
  const merchantFilter =
    filters.merchantSlug !== undefined
      ? sqlTag`AND ten.slug = ${filters.merchantSlug}`
      : sqlTag``;

  const rows = await tx.execute<AdminSubscriptionJoinRow>(sqlTag`
    SELECT
      s.*,
      ten.id   AS merchant_tenant_id,
      ten.slug AS merchant_slug,
      ten.name AS merchant_name,
      ten.status AS merchant_status
    FROM subscriptions s
    JOIN tenants ten ON ten.id = s.tenant_id
    WHERE 1 = 1
      AND ten.status != 'archived'
      ${merchantFilter}
    ORDER BY s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return rows.map((row) => ({
    subscription: mapSubscription(row),
    merchant: {
      tenantId: row.merchant_tenant_id as Uuid,
      slug: row.merchant_slug,
      name: row.merchant_name,
      status: row.merchant_status,
    },
  }));
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

// Day-16 / Block 4-C — `resumeSubscription` repository helper DELETED.
// The new service-layer `resumeSubscription` in service.ts performs
// the multi-table tx inline (find pause_window exception → restore
// tasks → flip subscription → recompute end_date for early-manual)
// per merged plan §4 + brief §3.1.7.
//
// `pauseSubscription` repository helper KEPT below — it remains the
// single-table status-flip primitive used by the system-actor
// `autoPauseSubscriptionForRepeatedFailure` flow (Day-7 / MP-14)
// where bounded-pause semantics don't apply (auto-pause is an
// emergency halt on N consecutive push failures, not an
// operator-chosen window). The new operator-driven pauseSubscription
// in service.ts does the multi-table tx itself; it does NOT call this
// helper.

/**
 * Transition a subscription from 'active' to 'paused'. Sets
 * `paused_at = now()`. Returns `{ before, after }` on success, null if
 * the row does not exist / is RLS-hidden. Throws `ConflictError` if
 * the row exists but is not in 'active' state.
 *
 * **Scope-limited as of Day-16 Block 4-C.** Used ONLY by
 * `autoPauseSubscriptionForRepeatedFailure` for the system-actor
 * emergency-halt path. The operator-driven bounded-pause flow
 * (`pauseSubscription` in service.ts) does NOT use this helper —
 * it does its own multi-table tx (subscription_exceptions INSERT +
 * tasks bulk UPDATE + subscriptions flip with end_date extension).
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

/**
 * Render a Postgres `integer[]` array literal for the given weekday list.
 *
 * Why this exists (Day-22 PM regression fix): a bare `${arr}` embed in
 * Drizzle's `sql` template wraps the spread in parentheses —
 * `($1, $2, $3)` — which Postgres parses as a record/tuple. Bound into
 * an `integer[]` column slot, Postgres raises 42804 datatype_mismatch.
 *
 * `sql.join([...], ', ')` produces a flat `$1, $2, $3` list without the
 * surrounding parens, so wrapping it in `ARRAY[…]::integer[]` produces
 * the valid array-constructor form. Each element binds as its own
 * scalar param.
 */
function daysOfWeekArrayLiteral(days: readonly number[]): SQL {
  return sqlTag`ARRAY[${sqlTag.join(
    days.map((d) => sqlTag`${d}`),
    sqlTag`, `,
  )}]::integer[]`;
}

function buildUpdateSets(patch: UpdateSubscriptionPatch): SQL[] {
  const sets: SQL[] = [];
  if (patch.consigneeId !== undefined) sets.push(sqlTag`consignee_id = ${patch.consigneeId}`);
  if (patch.startDate !== undefined) sets.push(sqlTag`start_date = ${patch.startDate}`);
  if (patch.endDate !== undefined) sets.push(sqlTag`end_date = ${patch.endDate}`);
  if (patch.daysOfWeek !== undefined)
    sets.push(sqlTag`days_of_week = ${daysOfWeekArrayLiteral(patch.daysOfWeek)}`);
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

/**
 * Day 7 / C-8 — list candidate subscriptions for the end-date sweep.
 *
 * Returns the id list of subscriptions where:
 *   - tenant_id = tenantId
 *   - end_date IS NOT NULL (open-ended subscriptions are never swept)
 *   - end_date < asOfDate (passed in YYYY-MM-DD form)
 *   - status != 'ended' (terminal — already swept on a prior pass)
 *
 * Service-layer caller iterates the list and transitions each via
 * `endSubscription` per-row, accepting per-row race-loser ConflictError
 * as the idempotency mechanism.
 */
export async function listSweepCandidates(
  tx: DbTx,
  tenantId: Uuid,
  asOfDate: string,
): Promise<readonly Uuid[]> {
  type IdRow = { id: string } & Record<string, unknown>;
  const rows = await tx.execute<IdRow>(sqlTag`
    SELECT id FROM subscriptions
    WHERE tenant_id = ${tenantId}
      AND end_date IS NOT NULL
      AND end_date < ${asOfDate}::date
      AND status != 'ended'
    ORDER BY end_date ASC
  `);
  return rows.map((r) => r.id);
}

// Re-export the typed errors used by transitional methods so callers
// of this module can match without importing from @/shared/errors.
// (Same convention as failed-pushes module.)
export { ConflictError, NotFoundError };
