// audit read path — Day-52 / R8 (task-history drawer).
//
// The module's FIRST read surface. emit.ts stays the sole writer; this
// file is the query side, deliberately shaped as a small reusable base
// per the R8 ruling-7 scope ("scalable spine, not speculative
// features"): resource-oriented list functions with keyset pagination
// that a future broader audit surface can call as-is. Nothing here is
// drawer-specific, and nothing here pre-builds unscoped viewer features
// (no cross-tenant scans, no free-form filters, no export shapes).
//
// Both functions take the caller's transaction. Run them inside
// `withTenant` — audit_events RLS is FOR SELECT scoped to
// app.current_tenant_id, so a tenant transaction reads exactly its own
// rows and cross-tenant system events (tenant_id IS NULL) stay
// invisible by design. No service-role reads happen here.
//
// Ordering is newest-first on (occurred_at, id) — the R8 ruling fixes
// most-recent-first for operator-facing history, and the id tiebreak
// makes the keyset cursor total (occurred_at alone can collide within
// one emit batch).

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "../../shared/db";
import type { AuditActorKind } from "./emit";

/** One audit_events row as read back out of the table. */
export interface AuditEventRecord {
  readonly id: string;
  /** ISO 8601 with timezone (occurred_at::text). */
  readonly occurredAt: string;
  readonly actorKind: AuditActorKind;
  readonly actorId: string;
  readonly eventType: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly metadata: Record<string, unknown>;
}

/**
 * Keyset cursor: "events strictly older than this (occurred_at, id)".
 * Taken verbatim from a previously returned record, so paging stays
 * stable while new rows append at the head of the stream.
 */
export interface AuditEventCursor {
  readonly occurredAt: string;
  readonly id: string;
}

type AuditEventRow = {
  id: string;
  occurred_at: string;
  actor_kind: AuditActorKind;
  actor_id: string;
  event_type: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
} & Record<string, unknown>;

// occurred_at is rendered as fixed-width UTC ISO (6-digit microseconds,
// 'Z' suffix) rather than ::text. Two callers depend on the fixed
// width: lexicographic comparison of two occurredAt strings must equal
// chronological order (the task-history merge + cursor logic compares
// in application code), and `new Date(iso)` must parse it portably
// (Postgres ::text emits a space separator and a bare '+00' offset,
// which ECMA-262 does not guarantee to parse).
const SELECT_COLUMNS = sqlTag`
  id,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  actor_kind,
  actor_id,
  event_type,
  resource_type,
  resource_id,
  metadata
`;

function toRecord(row: AuditEventRow): AuditEventRecord {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorKind: row.actor_kind,
    actorId: row.actor_id,
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: row.metadata,
  };
}

function beforeClause(before: AuditEventCursor | undefined) {
  return before !== undefined
    ? sqlTag`AND (occurred_at, id) < (${before.occurredAt}::timestamptz, ${before.id}::uuid)`
    : sqlTag``;
}

export interface ListAuditEventsForResourceParams {
  readonly resourceType: string;
  readonly resourceId: string;
  /**
   * Event types to drop at the query layer. Exclusion lives in SQL
   * (not post-filtering) so `limit` keeps its meaning — a burst of
   * excluded events cannot starve a page.
   */
  readonly excludeEventTypes?: readonly string[];
  readonly before?: AuditEventCursor;
  readonly limit: number;
}

/**
 * Events for one resource, newest first. Uses the audit_resource
 * partial index from 0002_audit.sql.
 */
export async function listAuditEventsForResource(
  tx: DbTx,
  params: ListAuditEventsForResourceParams,
): Promise<readonly AuditEventRecord[]> {
  const exclude =
    params.excludeEventTypes !== undefined && params.excludeEventTypes.length > 0
      ? sqlTag`AND event_type <> ALL(${"{" + params.excludeEventTypes.join(",") + "}"}::text[])`
      : sqlTag``;

  const rows = await tx.execute<AuditEventRow>(sqlTag`
    SELECT ${SELECT_COLUMNS}
    FROM audit_events
    WHERE resource_type = ${params.resourceType}
      AND resource_id = ${params.resourceId}
      ${exclude}
      ${beforeClause(params.before)}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${params.limit}
  `);
  return rows.map(toRecord);
}

export interface ListAuditEventsForSubscriptionParams {
  readonly subscriptionId: string;
  readonly limit: number;
}

/**
 * Events whose metadata names a subscription, newest first.
 *
 * The subscription-family emit convention (subscriptions,
 * subscription-exceptions services) puts `subscription_id` in metadata
 * on every event, while resource_type/resource_id vary
 * ('subscription' rows point at the subscription;
 * 'subscription_exception' rows point at the exception row). Keying on
 * metadata->>'subscription_id' is therefore the one filter that
 * captures the whole family.
 *
 * No keyset cursor here: callers consume the family whole and filter
 * per-task relevance in application code (the predicates need
 * cross-event context — e.g. a resume's pause window lives on the
 * paired paused event). Subscription event volume is operator-action
 * bound, so `limit` is a guard rail, not pagination; callers should
 * treat a result that hits `limit` as truncated.
 *
 * Unindexed jsonb filter — acceptable at current volume because the
 * tenant-scoped RLS read keeps the scan bounded. If a broader audit
 * surface later leans on this query, add an expression index on
 * (metadata->>'subscription_id') in its own migration.
 */
export async function listAuditEventsForSubscription(
  tx: DbTx,
  params: ListAuditEventsForSubscriptionParams,
): Promise<readonly AuditEventRecord[]> {
  const rows = await tx.execute<AuditEventRow>(sqlTag`
    SELECT ${SELECT_COLUMNS}
    FROM audit_events
    WHERE metadata->>'subscription_id' = ${params.subscriptionId}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${params.limit}
  `);
  return rows.map(toRecord);
}
