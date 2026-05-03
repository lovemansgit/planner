// Credentials-module types — plan §3.3 / §8.4 per-tenant credentials.
//
// The credentials module is the canonical owner of the resolved-secret
// shapes for each external-service integration. Other modules (notably
// the integration module's SuiteFleet provider) import these types
// through credentials/index.ts; the eslint module-boundary rule blocks
// any deeper reach.
//
// Why a SuiteFleet-specific type lives in this module rather than in
// integration/providers/suitefleet/: the credentials module owns the
// "where do these values come from" concern (env in Day 4, AWS Secrets
// Manager in Day 5+). Owning the type alongside the resolver keeps the
// path of change unambiguous when the storage substrate swaps.

/**
 * Resolved per-tenant SuiteFleet secret. All four fields are required;
 * `customerId` is the SuiteFleet-side numeric identifier scoping every
 * task to the tenant's merchant record (brief §5: present in the JWT's
 * `managedEntitiesIds` AND required in the task body).
 *
 * The auth client (S-2) uses `username` / `password` / `clientId` only;
 * `customerId` is consumed downstream by `createTask` (S-8). They live
 * in the same shape because SuiteFleet's per-tenant secret in production
 * stores all four together at the same Secrets Manager path.
 */
export interface SuiteFleetCredentials {
  readonly username: string;
  readonly password: string;
  readonly clientId: string;
  readonly customerId: number;
}

/**
 * Resolved per-tenant SuiteFleet webhook secret. Values are configured
 * by the merchant operator in SuiteFleet's portal (when they choose to
 * — credential configuration is opt-in per merchant per the P2 reshape
 * memo) and sent on every inbound webhook as `clientid` / `clientsecret`
 * lowercase headers (no dashes — see Day-7 empirical capture in
 * `memory/followup_webhook_auth_architecture.md`).
 *
 * SEPARATE from `SuiteFleetCredentials` — auth credentials are for
 * OUTBOUND calls; webhook credentials are for verifying INBOUND
 * deliveries.
 *
 * Storage: per-tenant row in `tenant_suitefleet_webhook_credentials`
 * (Day 8 / D8-2 schema). `clientSecretHash` is a bcrypt hash, NEVER
 * plaintext — verification compares the inbound request's plaintext
 * secret via `bcrypt.compare(plaintext, hash)`. The clientId is stored
 * in plaintext because it is not a secret; it is the public-facing
 * identifier the merchant types into the SuiteFleet portal alongside
 * the secret.
 */
export interface SuiteFleetWebhookCredentials {
  readonly clientId: string;
  readonly clientSecretHash: string;
}
