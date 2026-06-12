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

/**
 * Day-54 P1 — where a scan-log observation came from.
 *   read_through — operator-triggered TTL-miss refresh (B-2 path)
 *   poll         — the 30-minute scheduled sweep (Love's cadence ruling)
 *   webhook      — reserved for webhook-driven cache writes (unwired)
 */
export type AssetScanSource = "read_through" | "poll" | "webhook";

/**
 * Insert shape for one append-only `asset_scan_log` line. One entry
 * per OBSERVED state per package — first sighting and every
 * transition; never written when the observed state matches the
 * cached state.
 *
 * `vendorScannedAt` is NULL until SF ships scan timestamps on the
 * wire (vendor roadmap — memory/followup_vendor_scanned_at_activation.md).
 * `receivedAt` is when Planner observed the state; Love's ruling:
 * display vendorScannedAt when present, else receivedAt labeled
 * "recorded in Planner".
 */
export interface AssetScanLogEntryInput {
  readonly taskId: Uuid;
  readonly trackingId: string;
  readonly awb: string;
  readonly state: AssetTrackingState;
  readonly vendorScannedAt: IsoTimestamp | null;
  readonly receivedAt: IsoTimestamp;
  readonly scannedBy: unknown | null;
  readonly source: AssetScanSource;
  readonly sfPayload: unknown;
}

/** Read shape for one `asset_scan_log` row (P2 log surface reads these). */
export interface AssetScanLogRow extends AssetScanLogEntryInput {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly createdAt: IsoTimestamp;
}

/** Summary returned by the 30-minute poll for one tenant. */
export interface AssetTrackingPollSummary {
  readonly tenantId: Uuid;
  readonly awbsPolled: number;
  readonly chunks: number;
  readonly recordCount: number;
  readonly stateChanges: number;
  readonly orphansDropped: number;
}

/**
 * Per-poll AWB cap. 200 AWBs / 10-per-chunk = ≤20 SF GETs per tenant
 * per poll tick — bounded and respectful of the unknown endpoint rate
 * limit (vendor question 3). The repository LIMITs its in-motion query
 * at this value; the service logs a warning when the cap is hit
 * rather than silently truncating.
 */
export const POLL_AWB_CAP = 200;
