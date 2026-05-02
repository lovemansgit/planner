// integration module — plan §3.3 / §5 SuiteFleet (ADR-007 auth).
//
// Day 4 / S-1: public surface is the `LastMileAdapter` interface plus
// the internal-language types it operates on. SuiteFleet-specific code
// lives under providers/suitefleet/ and is not re-exported — callers
// resolve a provider instance through the adapter factory (lands later
// in Day 4 once auth + cred plumbing is in place).
//
// Day 4 / S-4: provider-specific webhook verifier exposed by name
// (`verifySuiteFleetWebhook`). When a second provider lands, each gets
// its own export; the route layer picks one per route.

export type { LastMileAdapter } from "./last-mile-adapter";

export type {
  AssetTrackingPackage,
  AssetTrackingState,
  AssetType,
  AuthenticatedSession,
  ConsigneeSnapshot,
  DeliveryAddress,
  DeliveryWindow,
  HeadersLike,
  InternalTaskStatus,
  PaymentMethod,
  TaskCreateRequest,
  TaskCreateResult,
  TaskKind,
  WebhookEvent,
  WebhookEventKind,
  WebhookVerificationResult,
} from "./types";

export { verifySuiteFleetWebhook } from "./providers/suitefleet/webhook-verifier";
export { parseSuiteFleetWebhookEvents } from "./providers/suitefleet/webhook-parser";
export { mapSuiteFleetStatusToInternal } from "./providers/suitefleet/status-mapper";
export { createSuiteFleetTokenCache } from "./providers/suitefleet/token-cache";
export type {
  SuiteFleetTokenCache,
  SuiteFleetTokenCacheDeps,
} from "./providers/suitefleet/token-cache";
export {
  createSuiteFleetTaskClient,
  buildSuiteFleetTaskBody,
  parseSuiteFleetTaskResponse,
  SuiteFleetAwbExistsError,
} from "./providers/suitefleet/task-client";
export type {
  SuiteFleetTaskClient,
  SuiteFleetTaskClientDeps,
} from "./providers/suitefleet/task-client";
export { createSuiteFleetAuthClient } from "./providers/suitefleet/auth-client";
export type {
  SuiteFleetAuthClient,
  SuiteFleetAuthClientDeps,
  SuiteFleetRefreshInput,
} from "./providers/suitefleet/auth-client";

export {
  createSuiteFleetAssetTrackingClient,
  parseAssetTrackingPage,
  parseAssetTrackingRecord,
} from "./providers/suitefleet/asset-tracking-client";
export type {
  SuiteFleetAssetTrackingClient,
  SuiteFleetAssetTrackingClientDeps,
} from "./providers/suitefleet/asset-tracking-client";

// Day 5 / T-8 — assembly factory that combines the primitives above
// into a single constructable LastMileAdapter instance.
export { createSuiteFleetLastMileAdapter } from "./providers/suitefleet/last-mile-adapter-factory";
export type { SuiteFleetLastMileAdapterDeps } from "./providers/suitefleet/last-mile-adapter-factory";
