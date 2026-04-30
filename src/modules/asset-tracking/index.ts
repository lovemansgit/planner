// asset-tracking module — public surface.
//
// Day 6 / B-1: types + repository + outbound SF adapter wiring.
// B-2 adds the service layer (read-through cache + 5-min TTL),
// surface routes, and the paymentMethod probe (separate concern).
//
// "Bag tracking" is the operational nickname; the API surface is
// asset-typed. See memory/followup_suitefleet_asset_tracking_api.md
// for terminology + design rationale.

export type {
  AssetTrackingCacheRow,
  AssetTrackingPackage,
  AssetTrackingState,
  AssetType,
} from "./types";

export { findCacheByAwb, upsertCacheRow } from "./repository";
