// credentials module — plan §3.3 / §8.4 per-tenant credentials.
//
// Day 4 / S-3: SuiteFleet auth credential resolution.
// Day 4 / S-4: SuiteFleet webhook credential resolution (separate
//              secret pair; verifies inbound webhook deliveries).
//
// Both resolvers read from environment variables for the pilot dev
// path; Day 5+ swaps to AWS Secrets Manager at the per-tenant paths
// /transcorp/secrets/{tenantId}/suitefleet/credentials and
// /transcorp/secrets/{tenantId}/suitefleet/webhook-credentials without
// changing the function signatures.

export type { SuiteFleetCredentials, SuiteFleetWebhookCredentials } from "./types";
export { resolveSuiteFleetCredentials } from "./suitefleet-resolver";
export { resolveSuiteFleetWebhookCredentials } from "./suitefleet-webhook-resolver";
