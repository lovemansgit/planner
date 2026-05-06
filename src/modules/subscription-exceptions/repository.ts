// Subscription-exceptions repository — Day-16 Block 4-B Service A.
//
// DB layer for the exception model. INSERT, idempotency-replay SELECT,
// and active-pause-windows SELECT used by the service-layer wrapper
// around `skip-algorithm.ts:computeCompensatingDate`.
//
// Pattern mirrors src/modules/subscriptions/repository.ts:
//   - snake_case at the DB boundary; camelCase at the public type
//   - tenantId predicate alongside RLS for defence in depth
//   - drizzle's sql tag for parameterised queries
//   - unique-violation 23505 mapped at the service layer (not here)
//
// All operations run inside a caller-provided DbTx (withTenant from
// shared/db.ts). The repository never opens its own transaction.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type {
  PauseWindowRange,
  SubscriptionException,
  SubscriptionExceptionType,
} from "./types";

// -----------------------------------------------------------------------------
// Row shape (DB) → domain type mapping
// -----------------------------------------------------------------------------

type SubscriptionExceptionRow = {
  readonly id: string;
  readonly subscription_id: string;
  readonly tenant_id: string;
  readonly type: string;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly target_date_override: string | null;
  readonly skip_without_append: boolean;
  readonly reason: string | null;
  readonly address_override_id: string | null;
  readonly compensating_date: string | null;
  readonly correlation_id: string;
  readonly idempotency_key: string;
  readonly created_by: string;
  readonly created_at: string;
} & Record<string, unknown>;

function mapRow(row: SubscriptionExceptionRow): SubscriptionException {
  return {
    id: row.id as Uuid,
    subscriptionId: row.subscription_id as Uuid,
    tenantId: row.tenant_id as Uuid,
    type: row.type as SubscriptionExceptionType,
    startDate: row.start_date,
    endDate: row.end_date,
    targetDateOverride: row.target_date_override,
    skipWithoutAppend: row.skip_without_append,
    reason: row.reason,
    addressOverrideId: (row.address_override_id ?? null) as Uuid | null,
    compensatingDate: row.compensating_date,
    correlationId: row.correlation_id as Uuid,
    idempotencyKey: row.idempotency_key as Uuid,
    createdBy: row.created_by as Uuid,
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------------------
// Insert
// -----------------------------------------------------------------------------

/**
 * Input for `insertException`. The service layer mints `correlationId`
 * (uuid v4 per A1 deferral) and resolves all type-specific fields
 * before calling.
 *
 * The CHECK constraints on `subscription_exceptions` enforce the
 * type/column invariants (e.g., compensating_date populated only for
 * type='skip'). The service is responsible for shaping fields per
 * type; this insert binds them as supplied.
 */
export interface InsertExceptionInput {
  readonly subscriptionId: Uuid;
  readonly type: SubscriptionExceptionType;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly targetDateOverride: string | null;
  readonly skipWithoutAppend: boolean;
  readonly reason: string | null;
  readonly addressOverrideId: Uuid | null;
  readonly compensatingDate: string | null;
  readonly correlationId: Uuid;
  readonly idempotencyKey: Uuid;
  readonly createdBy: Uuid;
}

/**
 * INSERT one subscription_exceptions row. Returns the inserted domain
 * object. On 23505 unique-violation against
 * `subscription_exceptions_idempotency_idx`, the caller (service layer)
 * is responsible for catching and routing to the idempotent-replay path.
 */
export async function insertException(
  tx: DbTx,
  tenantId: Uuid,
  input: InsertExceptionInput,
): Promise<SubscriptionException> {
  const rows = await tx.execute<SubscriptionExceptionRow>(sqlTag`
    INSERT INTO subscription_exceptions (
      subscription_id,
      tenant_id,
      type,
      start_date,
      end_date,
      target_date_override,
      skip_without_append,
      reason,
      address_override_id,
      compensating_date,
      correlation_id,
      idempotency_key,
      created_by
    ) VALUES (
      ${input.subscriptionId},
      ${tenantId},
      ${input.type},
      ${input.startDate},
      ${input.endDate},
      ${input.targetDateOverride},
      ${input.skipWithoutAppend},
      ${input.reason},
      ${input.addressOverrideId},
      ${input.compensatingDate},
      ${input.correlationId},
      ${input.idempotencyKey},
      ${input.createdBy}
    )
    RETURNING *
  `);
  if (rows.length === 0) {
    // RETURNING * on INSERT always returns the inserted row; reaching
    // here implies a driver oddity. Surface rather than crash silently.
    throw new Error("insertException: INSERT … RETURNING returned zero rows");
  }
  return mapRow(rows[0]);
}

// -----------------------------------------------------------------------------
// Idempotency replay
// -----------------------------------------------------------------------------

/**
 * Look up an existing exception by `(subscription_id, idempotency_key)`
 * — the natural key behind the
 * `subscription_exceptions_idempotency_idx` UNIQUE index.
 *
 * Used by the service layer for the idempotency-replay path: when a
 * client retries with the same key, return the original exception's
 * fields with HTTP 409 instead of attempting another INSERT.
 *
 * The service can choose to short-circuit the entire request on the
 * pre-INSERT SELECT path OR rely on the post-INSERT 23505 catch path.
 * Service A (this PR) uses the pre-INSERT SELECT path for clearer
 * audit-event semantics — no audit events emit on idempotent replay.
 */
export async function findByIdempotencyKey(
  tx: DbTx,
  subscriptionId: Uuid,
  idempotencyKey: Uuid,
): Promise<SubscriptionException | null> {
  const rows = await tx.execute<SubscriptionExceptionRow>(sqlTag`
    SELECT *
    FROM subscription_exceptions
    WHERE subscription_id = ${subscriptionId}
      AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `);
  return rows.length === 0 ? null : mapRow(rows[0]);
}

// -----------------------------------------------------------------------------
// Active pause-window read for the wrapper
// -----------------------------------------------------------------------------

type PauseWindowRow = {
  readonly start_date: string;
  readonly end_date: string;
} & Record<string, unknown>;

/**
 * Read all `pause_window` exception rows for a subscription whose end
 * date is on or after `cutoff_date` — i.e., still active or future.
 * Used by the service-layer wrapper around
 * `skip-algorithm.ts:computeCompensatingDate` to feed the helper's
 * `pauseWindows` input.
 *
 * `pause_window` rows always carry `end_date IS NOT NULL` per the
 * `exc_pause_window_requires_end_date` CHECK constraint in 0015.
 *
 * `cutoff_date` filter: the wrapper only cares about pause windows
 * that could intersect candidate compensating dates, so windows whose
 * `end_date < cutoff_date` are filtered out at the DB layer to keep
 * the helper input small.
 */
export async function listActivePauseWindows(
  tx: DbTx,
  subscriptionId: Uuid,
  cutoffDate: string,
): Promise<readonly PauseWindowRange[]> {
  const rows = await tx.execute<PauseWindowRow>(sqlTag`
    SELECT start_date, end_date
    FROM subscription_exceptions
    WHERE subscription_id = ${subscriptionId}
      AND type = 'pause_window'
      AND end_date >= ${cutoffDate}
    ORDER BY start_date ASC
  `);
  return rows.map((r) => ({ start: r.start_date, end: r.end_date }));
}

// -----------------------------------------------------------------------------
// Existing-skip count (for max-skips cap; MVP unused per §10.1)
// -----------------------------------------------------------------------------

/**
 * Count existing skip exceptions for a subscription where
 * `skip_without_append=false`. Used by the wrapper to feed the pure
 * helper's `existingSkipCount` input. MVP per §10.1 confirms NO cap
 * (column reads NULL → unlimited), so the count is computed but the
 * cap is not enforced — the wrapper passes `maxSkipsPerSubscription:
 * undefined` to disable the check.
 */
export async function countExistingSkipsForCap(
  tx: DbTx,
  subscriptionId: Uuid,
): Promise<number> {
  type CountRow = { count: number } & Record<string, unknown>;
  const rows = await tx.execute<CountRow>(sqlTag`
    SELECT COUNT(*)::int AS count
    FROM subscription_exceptions
    WHERE subscription_id = ${subscriptionId}
      AND type = 'skip'
      AND skip_without_append = false
  `);
  return rows[0]?.count ?? 0;
}
