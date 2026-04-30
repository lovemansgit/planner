// Asset-tracking domain types — Day 6 / B-1.
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in 0011_asset_tracking_cache.sql.
//
// One row per PACKAGE, not per task. A single AWB with N packages
// returns N tracking records from SF; the cache mirrors that 1:1
// (unique key: trackingId, format `<awb>-<index>`). See
// memory/followup_suitefleet_asset_tracking_api.md "Cardinality"
// section for the full design rationale.
//
// Wire-shape types (`AssetType`, `AssetTrackingState`,
// `AssetTrackingPackage`) live in @/modules/integration/types per the
// integration-module convention. This file adds the cache-row
// projection that layers internal FK + freshness-metadata fields on
// top of the wire shape.

import type {
  AssetTrackingPackage,
  AssetTrackingState,
  AssetType,
} from "@/modules/integration/types";
import type { IsoTimestamp, Uuid } from "@/shared/types";

export type { AssetType, AssetTrackingState, AssetTrackingPackage };

/**
 * Cached row with internal tenant + task FK + freshness metadata.
 * What `findCacheByAwb` returns and `upsertCacheRow` writes.
 *
 * `lastSyncedAt` drives the 5-minute TTL: a row whose `lastSyncedAt`
 * is older than 5 min triggers a read-through GET. The TTL constant
 * lives in the service layer (B-2), not on the row.
 */
export interface AssetTrackingCacheRow extends AssetTrackingPackage {
  readonly id: Uuid;
  readonly taskId: Uuid;
  readonly tenantId: Uuid;
  readonly lastSyncedAt: IsoTimestamp;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
