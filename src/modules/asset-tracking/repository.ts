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
//   `upsertCacheRows` is one INSERT … ON CONFLICT (tracking_id) DO
//   UPDATE per package. Same trackingId arriving with a new state
//   updates the row in place and bumps `last_synced_at` to now() so
//   the TTL clock resets. New trackingIds INSERT cleanly.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { IsoTimestamp, Uuid } from "@/shared/types";

import type {
  AssetTrackingCacheRow,
  AssetTrackingPackage,
  AssetTrackingState,
  AssetType,
} from "./types";

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
      awb,
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
      ${pkg.awb},
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
      awb                    = EXCLUDED.awb,
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
