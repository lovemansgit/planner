// Credentials-module types — Day 26 / per-merchant SF credentials lane.
//
// The credentials module is the canonical owner of the resolved-secret
// shapes for each external-service integration. Other modules (notably
// the integration module's SuiteFleet provider) import these types
// through credentials/index.ts; the eslint module-boundary rule blocks
// any deeper reach.
//
// Why a SuiteFleet-specific type lives in this module rather than in
// integration/providers/suitefleet/: the credentials module owns the
// "where do these values come from" concern. Day-4 read from env vars;
// Day-26 reads from per-tenant Supabase Vault rows joined to a
// region-scoped `client_id` and a region-scoped `auth_method`
// discriminator. Owning the type alongside the resolver keeps the path
// of change unambiguous when the storage substrate evolves (Phase 2
// will swap Vault UUIDs for AWS Secrets Manager ARNs — same shape,
// different resolver implementation).

/**
 * Resolved per-merchant SuiteFleet credentials. Discriminated union
 * over `auth_method` — region-level per v1.15 amendment §4.1:
 *
 *   - 'oauth'   — sandbox region (`transcorpsb`). Existing flow:
 *                 POST /api/auth/authenticate with username/password in
 *                 query string + `Clientid` header. Preserved as-is.
 *   - 'api_key' — production regions (`transcorp` / `transcorpuae` /
 *                 `transcorpqatar`). Per SF OpsPortal — exact request-
 *                 header shape pending Aqib's reply; the api_key code
 *                 path lights up in a follow-on T2 PR (Sub-PR 2's
 *                 auth-client stubs `loginApiKey` with
 *                 ConfigurationError).
 *
 * `clientId` and `customerId` are common to both branches — every
 * SuiteFleet request needs the region's `Clientid` header value and
 * the merchant's numeric `customerId`. The discriminator narrows the
 * credential pair (username/password vs apiKey/secretKey).
 *
 * Resolver returns this shape per `region.auth_method`. The auth
 * client's `login()` switches on the discriminator with an exhaustive
 * switch; tsc rejects any non-exhaustive switch over the union.
 */
export type SuiteFleetCredentials =
  | {
      readonly auth_method: "oauth";
      readonly clientId: string;
      readonly customerId: number;
      readonly username: string;
      readonly password: string;
    }
  | {
      readonly auth_method: "api_key";
      readonly clientId: string;
      readonly customerId: number;
      readonly apiKey: string;
      readonly secretKey: string;
    };

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
