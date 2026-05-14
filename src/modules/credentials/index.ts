// credentials module — per-merchant SF credentials lane.
//
// Day 4 / S-3: SuiteFleet auth credential resolution (env-backed,
//              superseded by Day-26 DB-backed resolver).
// Day 4 / S-4: SuiteFleet webhook credential resolution (separate
//              secret pair; verifies inbound webhook deliveries).
// Day 26 / T3: per-merchant Vault-stored credentials with region-level
//              auth_method discriminator + region CRUD + storeCredentials
//              service. Resolver returns a discriminated union typed by
//              auth_method.

export type { SuiteFleetCredentials, SuiteFleetWebhookCredentials } from "./types";
export { resolveSuiteFleetCredentials } from "./suitefleet-resolver";
export { resolveSuiteFleetWebhookCredentials } from "./suitefleet-webhook-resolver";

// Day 26 — service surface for the per-merchant credentials lane.
export {
  createRegion,
  updateRegion,
  deactivateRegion,
  storeSuitefleetCredentials,
} from "./service";
export type {
  Region,
  RegionAuthMethod,
  RegionStatus,
  CreateRegionInput,
  CreateRegionResult,
  UpdateRegionInput,
  UpdateRegionResult,
  DeactivateRegionResult,
  StoreCredentialsInput,
  StoreCredentialsResult,
  CredentialsClassifier,
} from "./service";

// Vault primitives — exposed for tests; production callers go through
// the service surface above. Read access is intended for the resolver
// internally.
export { createVaultSecret, updateVaultSecret, readVaultSecret } from "./vault-store";
