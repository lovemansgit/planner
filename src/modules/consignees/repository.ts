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
// RLS is the primary defence. Every callsite runs inside a
// `withTenant(tenantId, …)` block, so the
// `app.current_tenant_id`-keyed RLS policy on `consignees` filters
// reads, blocks cross-tenant updates/deletes, and rejects inserts
// whose `tenant_id` doesn't match the session value via WITH CHECK
// (defensive form — see 0001_identity.sql header).
//
// Defence in depth: every write path AND every list/lookup that takes
// a `tenantId` carries an explicit `AND tenant_id = ${tenantId}`
// predicate alongside RLS. Same value, same result, but the WHERE
// clause is self-describing in pg_stat / EXPLAIN, and the application
// layer no longer relies on RLS being correctly configured as the
// sole filter — matching the R-3 isolation test's mental model.
//
//   - `insert`         takes tenantId explicitly because WITH CHECK
//                      requires the column to be set.
//   - `list`           filters by tenantId in the WHERE.
//   - `update` / `delete` take tenantId and combine it with id in the
//                      WHERE — the cross-tenant write surface is the
//                      single biggest blast-radius footgun, so they
//                      get belt-and-braces.
//   - `findById`       relies on RLS alone. Reads have no blast radius
//                      beyond what RLS hides; adding a parameter would
//                      complicate every caller without changing the
//                      observable behaviour.

import { sql as sqlTag, type SQL } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type { TenantStatus } from "../merchants/types";

import type {
  Consignee,
  ConsigneeCrmEvent,
  ConsigneeCrmState,
  CreateConsigneeInput,
  SubscriptionExceptionType,
  TaskTerminalStatus,
  TimelineEvent,
  UpdateConsigneePatch,
} from "./types";

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------
// Drizzle's tx.execute<T> constrains T to Record<string, unknown>;
// `& Record<string, unknown>` satisfies that without polluting the
// caller-visible `Consignee` shape. Same pattern as identity's
// CountRow / AssignmentRow.
//
// postgres.js's timestamptz return shape is configuration-dependent —
// against the Supabase pooler it returns ISO strings; against a fresh
// node-postgres-style connection it can return Date instances. C-2's
// initial typing assumed Date and broke at runtime against the live
// preview DB; the coercion via `new Date(...).toISOString()` works for
// both shapes (Date is idempotent through the constructor, string
// parses back to the same instant). Surfaced during C-4 smoke-testing.
type ConsigneeRow = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  email: string | null;
  address_line: string;
  emirate_or_region: string;
  district: string;
  delivery_notes: string | null;
  external_ref: string | null;
  notes_internal: string | null;
  /**
   * Day 16 / Block 4-D — column added by migration 0016 (NOT NULL
   * DEFAULT 'ACTIVE'); always present on read. Mapped to camelCase
   * `crmState` on the Consignee shape.
   */
  crm_state: string;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: ConsigneeRow): Consignee {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addressLine: row.address_line,
    emirateOrRegion: row.emirate_or_region,
    district: row.district,
    deliveryNotes: row.delivery_notes,
    externalRef: row.external_ref,
    notesInternal: row.notes_internal,
    crmState: row.crm_state as ConsigneeCrmState,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
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
      district,
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
      ${input.district},
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
 *
 * Optional `searchTerm` narrows the result set with case-insensitive
 * ILIKE against `name`, and against `phone` after stripping non-digits
 * from the query (so operators can paste either E.164 `+971501234567`
 * or local format `050 123 4567` and match the same row).
 */
export async function listConsigneesByTenant(
  tx: DbTx,
  tenantId: Uuid,
  opts: { readonly searchTerm?: string } = {},
): Promise<readonly Consignee[]> {
  const searchFilter = buildConsigneeSearchFilter(opts.searchTerm);
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    SELECT * FROM consignees
    WHERE tenant_id = ${tenantId}
      ${searchFilter}
    ORDER BY created_at DESC
  `);
  return rows.map(mapRow);
}

function buildConsigneeSearchFilter(searchTerm: string | undefined) {
  if (!searchTerm) return sqlTag``;
  const trimmed = searchTerm.trim();
  if (trimmed.length === 0) return sqlTag``;
  const phoneDigits = trimmed.replace(/\D/g, "");
  const namePattern = `%${trimmed}%`;
  if (phoneDigits.length > 0) {
    const phonePattern = `%${phoneDigits}%`;
    return sqlTag`AND (name ILIKE ${namePattern} OR phone ILIKE ${phonePattern})`;
  }
  return sqlTag`AND name ILIKE ${namePattern}`;
}

// -----------------------------------------------------------------------------
// Day 19 / Phase 1.5 — cross-tenant admin list
// -----------------------------------------------------------------------------

/**
 * Filters for listAllConsigneesRows. Optional merchantSlug narrows
 * to a single tenant; limit/offset for pagination (defaults applied
 * at fn body — default 50, max 500 per merged plan scope item 8).
 */
export interface ListAllConsigneesFilters {
  readonly merchantSlug?: string;
  readonly limit?: number;
  readonly offset?: number;
}

type AdminConsigneeJoinRow = ConsigneeRow & {
  readonly merchant_tenant_id: string;
  readonly merchant_slug: string;
  readonly merchant_name: string;
  readonly merchant_status: TenantStatus;
};

/**
 * Day 19 / Phase 1.5 — cross-tenant SELECT of consignees across all
 * merchants. Caller is in withServiceRole; no RLS predicate. JOIN
 * tenants for merchant surface columns per merged plan §5.2.
 *
 * ORDER BY created_at DESC per merged plan scope item 9.
 */
export async function listAllConsigneesRows(
  tx: DbTx,
  filters: ListAllConsigneesFilters = {},
): Promise<
  readonly {
    consignee: Consignee;
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

  const rows = await tx.execute<AdminConsigneeJoinRow>(sqlTag`
    SELECT
      c.*,
      ten.id   AS merchant_tenant_id,
      ten.slug AS merchant_slug,
      ten.name AS merchant_name,
      ten.status AS merchant_status
    FROM consignees c
    JOIN tenants ten ON ten.id = c.tenant_id
    WHERE 1 = 1
      ${merchantFilter}
    ORDER BY c.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return rows.map((row) => ({
    consignee: mapRow(row),
    merchant: {
      tenantId: row.merchant_tenant_id as Uuid,
      slug: row.merchant_slug,
      name: row.merchant_name,
      status: row.merchant_status,
    },
  }));
}

/**
 * UPDATE selected fields on one consignee, scoped to `tenantId` for
 * defence in depth alongside RLS. Only fields present on `patch` are
 * written; others are left untouched. `tenant_id`, `id`, and
 * timestamps are not patchable — the type already enforces this, and
 * the SET-clause builder below has no branch for them.
 *
 * Returns the updated row, or `null` if no row matched (because the
 * id was unknown, was hidden by RLS, or carried a different tenant_id
 * than the explicit predicate — same observable null in every case).
 *
 * Empty patch (no keys present) short-circuits to a tenant-scoped
 * SELECT — one round-trip, no UPDATE statement issued. The C-3
 * service layer should normally validate non-empty patches, but this
 * defensive branch keeps the repository total. The SELECT uses the
 * same `id = ? AND tenant_id = ?` predicate as the UPDATE so both
 * paths through this function carry the same defence-in-depth filter.
 */
export async function updateConsignee(
  tx: DbTx,
  tenantId: Uuid,
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
  if (patch.district !== undefined) sets.push(sqlTag`district = ${patch.district}`);
  if (patch.deliveryNotes !== undefined)
    sets.push(sqlTag`delivery_notes = ${patch.deliveryNotes}`);
  if (patch.externalRef !== undefined) sets.push(sqlTag`external_ref = ${patch.externalRef}`);
  if (patch.notesInternal !== undefined)
    sets.push(sqlTag`notes_internal = ${patch.notesInternal}`);

  if (sets.length === 0) {
    const rows = await tx.execute<ConsigneeRow>(sqlTag`
      SELECT * FROM consignees WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const setClause = sqlTag.join(sets, sqlTag`, `);
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    UPDATE consignees
    SET ${setClause}
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING *
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * DELETE one consignee, scoped to `tenantId` for defence in depth.
 * Returns `true` if a row was removed, `false` if no row matched
 * (unknown id, RLS-hidden cross-tenant id, or tenant_id mismatch
 * against the explicit predicate).
 *
 * Hard delete in pilot per the 0004 header note — soft-delete is
 * deferred until the audit-history view requirements firm up. The
 * `consignee.deleted` audit event in C-3 captures the row identity
 * pre-delete so the action is recoverable from the audit trail.
 */
export async function deleteConsignee(tx: DbTx, tenantId: Uuid, id: Uuid): Promise<boolean> {
  const result = await tx.execute(sqlTag`
    DELETE FROM consignees WHERE id = ${id} AND tenant_id = ${tenantId}
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

// -----------------------------------------------------------------------------
// CRM state operations (Day 16 / Block 4-D — Service C)
// -----------------------------------------------------------------------------

/**
 * SELECT one consignee FOR UPDATE within the current tx — row-locks the
 * consignee for the duration of the transaction. Used by
 * `changeConsigneeCrmState` to read the current crm_state, run the
 * matrix gate against it, and then UPDATE it atomically without a
 * read-after-write race against a concurrent caller.
 *
 * Defence-in-depth tenant_id predicate alongside RLS, same as
 * updateConsignee / deleteConsignee.
 *
 * Returns null when the row is missing, RLS-hidden, or tenant_id
 * mismatch — same observable null-on-deny posture as findConsigneeById.
 */
export async function findConsigneeForCrmUpdate(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid,
): Promise<Consignee | null> {
  const rows = await tx.execute<ConsigneeRow>(sqlTag`
    SELECT * FROM consignees
    WHERE id = ${id} AND tenant_id = ${tenantId}
    FOR UPDATE
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * UPDATE consignees.crm_state for one row, scoped to tenantId. Returns
 * `true` on a successful single-row update, `false` if no row matched
 * (vanished mid-tx — the caller's findConsigneeForCrmUpdate should
 * have row-locked, so a `false` here is a programming error or the
 * lock was lost; either way the caller maps to NotFoundError).
 *
 * No `updated_at` touch — the column has its own DB-level trigger
 * established in 0004 (`set_updated_at` BEFORE-UPDATE). Don't
 * double-write here.
 */
export async function updateConsigneeCrmState(
  tx: DbTx,
  tenantId: Uuid,
  id: Uuid,
  toState: ConsigneeCrmState,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string } & Record<string, unknown>>(sqlTag`
    UPDATE consignees
    SET crm_state = ${toState}
    WHERE id = ${id} AND tenant_id = ${tenantId}
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * INSERT one consignee_crm_events row. Returns the inserted row mapped
 * to camelCase. RLS WITH CHECK requires tenant_id to match the
 * `app.current_tenant_id` session value; the explicit `${tenantId}`
 * value below must equal the session value or the WITH CHECK clause
 * raises.
 *
 * `from_state` is the prior state; nullable per migration 0016 to
 * accommodate initial-create rows from a future onboarding-emit path.
 * The Service C call site always passes a non-null fromState because
 * the consignee row already exists when a transition fires.
 */
export async function insertConsigneeCrmEvent(
  tx: DbTx,
  input: {
    consigneeId: Uuid;
    tenantId: Uuid;
    fromState: ConsigneeCrmState | null;
    toState: ConsigneeCrmState;
    reason: string | null;
    actor: Uuid;
  },
): Promise<ConsigneeCrmEvent> {
  type Row = {
    id: string;
    consignee_id: string;
    tenant_id: string;
    from_state: string | null;
    to_state: string;
    reason: string | null;
    actor: string;
    occurred_at: Date | string;
  } & Record<string, unknown>;

  const rows = await tx.execute<Row>(sqlTag`
    INSERT INTO consignee_crm_events (
      consignee_id,
      tenant_id,
      from_state,
      to_state,
      reason,
      actor
    ) VALUES (
      ${input.consigneeId},
      ${input.tenantId},
      ${input.fromState},
      ${input.toState},
      ${input.reason},
      ${input.actor}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error(
      "insertConsigneeCrmEvent: INSERT … RETURNING produced zero rows",
    );
  }
  const row = rows[0];
  return {
    id: row.id,
    consigneeId: row.consignee_id,
    tenantId: row.tenant_id,
    fromState: row.from_state as ConsigneeCrmState | null,
    toState: row.to_state as ConsigneeCrmState,
    reason: row.reason,
    actor: row.actor,
    occurredAt: toIso(row.occurred_at),
  };
}

/**
 * Day 17 — SELECT consignee_crm_events history for a single consignee,
 * newest-first. Powers the History tab on `/consignees/[id]` per CRM
 * state UI plan §3.3 + §5. Tenant-scoped via RLS + explicit tenant_id
 * predicate (defence-in-depth — same posture as listConsigneesByTenant).
 *
 * `limit` defaults to 50 and is clamped at 200 to prevent unbounded
 * fetches. `before` is an optional ISO timestamp cursor used for
 * pagination; rows older than `before` are returned newest-first.
 *
 * Returns rows mapped to ConsigneeCrmEvent. Empty input results return
 * [].
 */
export async function selectCrmHistoryForConsignee(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
  options?: { limit?: number; before?: string },
): Promise<readonly ConsigneeCrmEvent[]> {
  const limit = Math.min(options?.limit ?? 50, 200);
  const before = options?.before ?? null;

  type Row = {
    id: string;
    consignee_id: string;
    tenant_id: string;
    from_state: string | null;
    to_state: string;
    reason: string | null;
    actor: string;
    occurred_at: Date | string;
  } & Record<string, unknown>;

  const rows = await tx.execute<Row>(sqlTag`
    SELECT id, consignee_id, tenant_id, from_state, to_state, reason, actor, occurred_at
    FROM consignee_crm_events
    WHERE consignee_id = ${consigneeId}
      AND tenant_id = ${tenantId}
      ${before ? sqlTag`AND occurred_at < ${before}::timestamptz` : sqlTag``}
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    consigneeId: row.consignee_id,
    tenantId: row.tenant_id,
    fromState: row.from_state as ConsigneeCrmState | null,
    toState: row.to_state as ConsigneeCrmState,
    reason: row.reason,
    actor: row.actor,
    occurredAt: toIso(row.occurred_at),
  }));
}

// -----------------------------------------------------------------------------
// Day 22 / §3.3.7 — consignee_timeline_events VIEW consumer
// -----------------------------------------------------------------------------
//
// Reads the chronological event projection across CRM transitions,
// subscription exceptions, and terminal task statuses. The VIEW
// (migration 0016 §3) is SECURITY INVOKER so RLS on the underlying
// tables applies — the caller must be inside a `withTenant` block. The
// explicit `tenant_id = ${tenantId}` predicate is defence in depth.
//
// `payload` is jsonb; postgres-js parses it to an unknown record. We
// narrow per `event_kind` via the dispatch below; unknown kinds throw
// (the view's UNION is closed-set; a new kind landing without code
// support is a coding bug we want loud).

interface TimelineRowBase {
  readonly event_kind: "crm_state" | "subscription_exception" | "task_status";
  readonly occurred_at: Date | string;
  readonly payload: Record<string, unknown>;
  readonly actor_id: string | null;
}

type TimelineRow = TimelineRowBase & Record<string, unknown>;

/**
 * Day 22 — SELECT the unified timeline for a single consignee from
 * `consignee_timeline_events`, newest-first. Powers the History tab
 * on `/consignees/[id]` per brief §3.3.7.
 *
 * `limit` defaults to 50 and is clamped at 200. `before` is an
 * optional ISO timestamp cursor for paging (rows older than `before`).
 */
export async function selectTimelineForConsignee(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
  options?: { limit?: number; before?: string },
): Promise<readonly TimelineEvent[]> {
  const limit = Math.min(options?.limit ?? 50, 200);
  const before = options?.before ?? null;

  const rows = await tx.execute<TimelineRow>(sqlTag`
    SELECT event_kind, occurred_at, payload, actor_id
    FROM consignee_timeline_events
    WHERE consignee_id = ${consigneeId}
      AND tenant_id = ${tenantId}
      ${before ? sqlTag`AND occurred_at < ${before}::timestamptz` : sqlTag``}
    ORDER BY occurred_at DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => mapTimelineRow(row));
}

function mapTimelineRow(row: TimelineRow): TimelineEvent {
  const eventAt = toIso(row.occurred_at);
  const payload = row.payload;

  switch (row.event_kind) {
    case "crm_state":
      return {
        kind: "crm_state",
        eventAt,
        fromState: (payload.from_state as ConsigneeCrmState | null) ?? null,
        toState: payload.to_state as ConsigneeCrmState,
        reason: (payload.reason as string | null) ?? null,
        actor: (row.actor_id ?? "") as Uuid,
      };
    case "subscription_exception":
      return {
        kind: "subscription_exception",
        eventAt,
        type: payload.type as SubscriptionExceptionType,
        subscriptionId: payload.subscription_id as Uuid,
        startDate: payload.start_date as string,
        endDate: (payload.end_date as string | null) ?? null,
        compensatingDate: (payload.compensating_date as string | null) ?? null,
        reason: (payload.reason as string | null) ?? null,
        actor: (row.actor_id ?? "") as Uuid,
      };
    case "task_status":
      return {
        kind: "task_status",
        eventAt,
        taskId: payload.task_id as Uuid,
        internalStatus: payload.internal_status as TaskTerminalStatus,
        deliveryDate: payload.delivery_date as string,
      };
    default: {
      // Closed-set switch guard. A new event_kind from the VIEW without
      // matching code support is a coding bug — surface loud.
      const _exhaustive: never = row.event_kind;
      throw new Error(
        `selectTimelineForConsignee: unknown event_kind '${_exhaustive as string}'`,
      );
    }
  }
}
