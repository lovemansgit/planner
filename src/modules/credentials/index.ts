// credentials module — plan §3.3 / §8.4 per-tenant credentials.
//
// Day 4 / S-3: SuiteFleet credential resolution lands here. Reads from
// environment variables for the pilot dev path; swaps to AWS Secrets
// Manager at /transcorp/secrets/{tenantId}/suitefleet/credentials on
// Day 5+ without changing the function signature.

export type { SuiteFleetCredentials } from "./types";
export { resolveSuiteFleetCredentials } from "./suitefleet-resolver";
