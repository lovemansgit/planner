// Asset-tracking repository — Drizzle queries against
// `asset_tracking_cache` (0011).
//
// "Repository" here is the data-access layer per Day-5 brief §6.1 —
// every function takes a `tx: DbTx` (from the caller's `withTenant` /
// `withServiceRole` block), runs one or two statements, and maps rows
// to the camelCase domain shape. No permission checks, no audit
// emits, no validation beyond null-vs-undefined handling — those
// belong in the B-2 service layer.
//
// RLS is the primary defence. Every callsite runs inside a
// `withTenant(tenantId, …)` block, so the
// `app.current_tenant_id`-keyed RLS policy on `asset_tracking_cache`
// filters reads, blocks cross-tenant updates/deletes, and rejects
// inserts whose `tenant_id` does not match the session value via
// WITH CHECK (defensive form — see 0001 header).
//
// Defence in depth: every write path AND every list/lookup that
// takes a `tenantId` carries an explicit `AND tenant_id = ${tenantId}`
// predicate alongside RLS. Same value, same result, but the WHERE
// clause is self-describing in pg_stat / EXPLAIN. Mirrors the
// subscriptions / consignees repository pattern.
//
// Upsert semantics:
//   `upsertCacheRow` is one INSERT … ON CONFLICT (tracking_id) DO
//   UPDATE per package. Same trackingId arriving with a new state
//   updates the row in place and bumps `last_synced_at` to now() so
//   the TTL clock resets. New trackingIds INSERT cleanly.
//
// `awb` is NOT in the INSERT column list — 0011 declares it as a
// GENERATED ALWAYS AS (...) STORED column derived from tracking_id.
// The schema computes it on every INSERT/UPDATE; the repository
// cannot override (Postgres rejects writes to GENERATED ALWAYS
// columns). The wire-shape `pkg.awb` is still mapped through to the
// service / caller via the cache row read, but the value the cache
// returns is the schema-computed one.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { IsoTimestamp, Uuid } from "@/shared/types";

import { POLL_AWB_CAP } from "./types";
import type {
  AssetScanLogEntryInput,
  AssetScanLogRow,
  AssetTrackingCacheRow,
  AssetTrackingPackage,
  AssetTrackingState,
  AssetType,
} from "./types";

/**
 * Tagged result for the task → AWB resolution. Distinguishes the
 * three cases the service-layer read-through needs to branch on:
 *   - task does not exist or is RLS-hidden
 *   - task exists but has no AWB yet (not pushed to SF)
 *   - task exists and carries an AWB
 */
export type TaskAwbLookup =
  | { readonly kind: "not_found" }
  | { readonly kind: "no_awb" }
  | { readonly kind: "ok"; readonly awb: string };

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------

type CacheDbRow = {
  id: string;
  task_id: string;
  task_id_external: string | number;
  external_record_id: string | number;
  tracking_id: string;
  awb: string;
  type: AssetType;
  state: AssetTrackingState;
  photos: unknown | null;
  notes: string | null;
  supplementary_quantity: number | null;
  container_id: string | number | null;
  collected_by: unknown | null;
  enroute_by: unknown | null;
  received_by: unknown | null;
  returned_by: unknown | null;
  tenant_id: string;
  last_synced_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): IsoTimestamp {
  return (
    value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  ) as IsoTimestamp;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function toNumberOrNull(value: string | number | null): number | null {
  return value === null ? null : toNumber(value);
}

function mapCacheRow(row: CacheDbRow): AssetTrackingCacheRow {
  return {
    id: row.id as Uuid,
    taskId: row.task_id as Uuid,
    taskIdExternal: toNumber(row.task_id_external),
    externalRecordId: toNumber(row.external_record_id),
    trackingId: row.tracking_id,
    awb: row.awb,
    type: row.type,
    state: row.state,
    photos: row.photos,
    notes: row.notes,
    supplementaryQuantity: row.supplementary_quantity,
    containerId: toNumberOrNull(row.container_id),
    collectedBy: row.collected_by,
    enrouteBy: row.enroute_by,
    receivedBy: row.received_by,
    returnedBy: row.returned_by,
    tenantId: row.tenant_id as Uuid,
    lastSyncedAt: toIso(row.last_synced_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/**
 * Return every cached package row for `awb` within `tenantId`,
 * ordered by `trackingId` (deterministic). The unique constraint on
 * `tracking_id` means each AWB has at most one row per package; this
 * function is the cache-hit primitive for the B-2 read-through.
 */
export async function findCacheByAwb(
  tx: DbTx,
  tenantId: Uuid,
  awb: string
): Promise<readonly AssetTrackingCacheRow[]> {
  const rows = await tx.execute<CacheDbRow>(sqlTag`
    SELECT * FROM asset_tracking_cache
    WHERE tenant_id = ${tenantId} AND awb = ${awb}
    ORDER BY tracking_id ASC
  `);
  return rows.map(mapCacheRow);
}

/**
 * Upsert one package's tracking record into the cache. Called once
 * per record returned by SF; iterate at the service layer when SF
 * returns N packages on an AWB.
 *
 * `taskId` is the internal `tasks.id` (uuid), looked up by the
 * service layer from `tasks.external_id = packages[i].taskIdExternal`
 * before this call. The 0011 tenant-match trigger asserts
 * `cache.tenant_id = parent task's tenant_id` on every INSERT or
 * UPDATE; the repository trusts the caller to pass the right
 * `taskId` and lets the trigger reject if not.
 *
 * On conflict (same `tracking_id`), every column EXCEPT the PK,
 * `created_at`, and the FK targets refreshes — including
 * `last_synced_at = now()`, which resets the TTL clock.
 */
export async function upsertCacheRow(
  tx: DbTx,
  tenantId: Uuid,
  taskId: Uuid,
  pkg: AssetTrackingPackage
): Promise<AssetTrackingCacheRow> {
  const photosJson = pkg.photos === null ? null : JSON.stringify(pkg.photos);
  const collectedByJson =
    pkg.collectedBy === null ? null : JSON.stringify(pkg.collectedBy);
  const enrouteByJson = pkg.enrouteBy === null ? null : JSON.stringify(pkg.enrouteBy);
  const receivedByJson =
    pkg.receivedBy === null ? null : JSON.stringify(pkg.receivedBy);
  const returnedByJson =
    pkg.returnedBy === null ? null : JSON.stringify(pkg.returnedBy);

  const rows = await tx.execute<CacheDbRow>(sqlTag`
    INSERT INTO asset_tracking_cache (
      task_id,
      task_id_external,
      external_record_id,
      tracking_id,
      type,
      state,
      photos,
      notes,
      supplementary_quantity,
      container_id,
      collected_by,
      enroute_by,
      received_by,
      returned_by,
      tenant_id,
      last_synced_at
    ) VALUES (
      ${taskId},
      ${pkg.taskIdExternal},
      ${pkg.externalRecordId},
      ${pkg.trackingId},
      ${pkg.type},
      ${pkg.state},
      ${photosJson === null ? null : sqlTag`${photosJson}::jsonb`},
      ${pkg.notes},
      ${pkg.supplementaryQuantity},
      ${pkg.containerId},
      ${collectedByJson === null ? null : sqlTag`${collectedByJson}::jsonb`},
      ${enrouteByJson === null ? null : sqlTag`${enrouteByJson}::jsonb`},
      ${receivedByJson === null ? null : sqlTag`${receivedByJson}::jsonb`},
      ${returnedByJson === null ? null : sqlTag`${returnedByJson}::jsonb`},
      ${tenantId},
      now()
    )
    ON CONFLICT (tracking_id) DO UPDATE SET
      task_id                = EXCLUDED.task_id,
      task_id_external       = EXCLUDED.task_id_external,
      external_record_id     = EXCLUDED.external_record_id,
      type                   = EXCLUDED.type,
      state                  = EXCLUDED.state,
      photos                 = EXCLUDED.photos,
      notes                  = EXCLUDED.notes,
      supplementary_quantity = EXCLUDED.supplementary_quantity,
      container_id           = EXCLUDED.container_id,
      collected_by           = EXCLUDED.collected_by,
      enroute_by             = EXCLUDED.enroute_by,
      received_by            = EXCLUDED.received_by,
      returned_by            = EXCLUDED.returned_by,
      tenant_id              = EXCLUDED.tenant_id,
      last_synced_at         = now()
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error(
      `upsertCacheRow: INSERT … ON CONFLICT … RETURNING produced zero rows for tracking_id ${pkg.trackingId}`
    );
  }
  return mapCacheRow(rows[0]);
}

// -----------------------------------------------------------------------------
// Cross-module lookups (tasks)
// -----------------------------------------------------------------------------
// The service layer's read-through path needs to resolve:
//   (a) a Planner task uuid → its AWB (so we know what to GET from SF)
//   (b) an SF taskIdExternal (number) → the matching Planner task uuid
//       (so we can attach incoming asset-tracking rows to a parent
//        task; if no match, the orphan_dropped audit event fires).
//
// Both queries hit `tasks` directly via SQL rather than going through
// the tasks-module service. Reasoning:
//   - The service-layer permission check on the asset-tracking surface
//     is `asset_tracking:read`. Calling `tasks.getTask` would require
//     the actor to also hold `task:read` — gratuitously expanding the
//     auth surface for a derived data fetch.
//   - RLS still scopes the lookups (tenant_id in WHERE + RLS policy
//     on `tasks`).
//   - Living in this module's repository keeps the dependency arrow
//     pointing one way: asset-tracking depends on tasks data, not on
//     tasks-module internals.

/**
 * Resolve a Planner task to its SuiteFleet AWB
 * (`tasks.external_tracking_number`). Returns a tagged result so the
 * service can branch on the three meaningful outcomes without
 * conflating "task does not exist" with "task exists but has no AWB
 * yet".
 */
export async function findTaskAwb(
  tx: DbTx,
  tenantId: Uuid,
  taskId: Uuid,
): Promise<TaskAwbLookup> {
  type Row = { external_tracking_number: string | null } & Record<string, unknown>;
  const rows = await tx.execute<Row>(sqlTag`
    SELECT external_tracking_number FROM tasks
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
  `);
  if (rows.length === 0) return { kind: "not_found" };
  const awb = rows[0].external_tracking_number;
  if (awb === null) return { kind: "no_awb" };
  return { kind: "ok", awb };
}

/**
 * Resolve a SuiteFleet taskId (numeric) to a Planner task uuid via
 * `tasks.external_id`. Returns null when no Planner task matches —
 * the orphan-drop case the service-layer flags via the
 * `asset_tracking.orphan_dropped` audit event.
 *
 * `tasks.external_id` is `text` (per 0006); we coerce the SF numeric
 * id to its decimal-string form for the equality predicate.
 */
export async function findTaskIdByExternalId(
  tx: DbTx,
  tenantId: Uuid,
  externalTaskId: number,
): Promise<Uuid | null> {
  type Row = { id: string } & Record<string, unknown>;
  const rows = await tx.execute<Row>(sqlTag`
    SELECT id FROM tasks
    WHERE external_id = ${String(externalTaskId)} AND tenant_id = ${tenantId}
  `);
  return (rows[0]?.id as Uuid | undefined) ?? null;
}

// -----------------------------------------------------------------------------
// Append-only scan log (Day-54 P1 — 0032_asset_scan_log.sql)
// -----------------------------------------------------------------------------

type ScanLogDbRow = {
  id: string;
  tenant_id: string;
  task_id: string;
  tracking_id: string;
  awb: string;
  state: AssetTrackingState;
  vendor_scanned_at: Date | string | null;
  received_at: Date | string;
  scanned_by: unknown | null;
  source: "read_through" | "poll" | "webhook";
  sf_payload: unknown | null;
  created_at: Date | string;
} & Record<string, unknown>;

function mapScanLogRow(row: ScanLogDbRow): AssetScanLogRow {
  return {
    id: row.id as Uuid,
    tenantId: row.tenant_id as Uuid,
    taskId: row.task_id as Uuid,
    trackingId: row.tracking_id,
    awb: row.awb,
    state: row.state,
    vendorScannedAt: row.vendor_scanned_at === null ? null : toIso(row.vendor_scanned_at),
    receivedAt: toIso(row.received_at),
    scannedBy: row.scanned_by,
    source: row.source,
    sfPayload: row.sf_payload,
    createdAt: toIso(row.created_at),
  };
}

/**
 * Append scan-log lines. INSERT only — the 0032 trigger raises on any
 * UPDATE or DELETE, so a buggy caller fails loudly instead of
 * rewriting history. One INSERT per entry keeps the statement simple;
 * entry counts are small (bounded by packages-per-AWB × transitions
 * observed in one refresh).
 */
export async function insertScanLogEntries(
  tx: DbTx,
  tenantId: Uuid,
  entries: readonly AssetScanLogEntryInput[],
): Promise<void> {
  for (const entry of entries) {
    const scannedByJson = entry.scannedBy === null ? null : JSON.stringify(entry.scannedBy);
    const sfPayloadJson = entry.sfPayload === null ? null : JSON.stringify(entry.sfPayload);
    await tx.execute(sqlTag`
      INSERT INTO asset_scan_log (
        tenant_id,
        task_id,
        tracking_id,
        awb,
        state,
        vendor_scanned_at,
        received_at,
        scanned_by,
        source,
        sf_payload
      ) VALUES (
        ${tenantId},
        ${entry.taskId},
        ${entry.trackingId},
        ${entry.awb},
        ${entry.state},
        ${entry.vendorScannedAt},
        ${entry.receivedAt},
        ${scannedByJson === null ? null : sqlTag`${scannedByJson}::jsonb`},
        ${entry.source},
        ${sfPayloadJson === null ? null : sqlTag`${sfPayloadJson}::jsonb`}
      )
    `);
  }
}

/**
 * List scan-log lines for an AWB, newest observation first. P2's
 * Asset Log surface reads through this.
 */
export async function findScanLogByAwb(
  tx: DbTx,
  tenantId: Uuid,
  awb: string,
): Promise<readonly AssetScanLogRow[]> {
  const rows = await tx.execute<ScanLogDbRow>(sqlTag`
    SELECT * FROM asset_scan_log
    WHERE tenant_id = ${tenantId} AND awb = ${awb}
    ORDER BY COALESCE(vendor_scanned_at, received_at) DESC, id DESC
  `);
  return rows.map(mapScanLogRow);
}

// -----------------------------------------------------------------------------
// Poll scoping (Day-54 P1 — "AWBs plausibly in motion", Love's constraint 3)
// -----------------------------------------------------------------------------

/**
 * AWBs "plausibly in motion" for the 30-minute poll:
 *   - any non-terminal task (CREATED / ASSIGNED / IN_TRANSIT /
 *     ON_HOLD) with an AWB whose delivery_date is within the look-
 *     back window, OR
 *   - a terminal task (DELIVERED / FAILED / CANCELED) delivered
 *     recently — bags RETURN after delivery, so the RETURNED scan
 *     lands days after the task closes.
 *
 * 7-day look-back, 1-day look-ahead, newest first, capped at
 * POLL_AWB_CAP distinct AWBs.
 */
export async function findAwbsInMotion(
  tx: DbTx,
  tenantId: Uuid,
): Promise<readonly string[]> {
  type Row = { awb: string } & Record<string, unknown>;
  const rows = await tx.execute<Row>(sqlTag`
    SELECT DISTINCT external_tracking_number AS awb,
           MAX(delivery_date) AS most_recent
    FROM tasks
    WHERE tenant_id = ${tenantId}
      AND external_tracking_number IS NOT NULL
      AND delivery_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 1
    GROUP BY external_tracking_number
    ORDER BY most_recent DESC
    LIMIT ${POLL_AWB_CAP}
  `);
  return rows.map((r) => r.awb);
}
