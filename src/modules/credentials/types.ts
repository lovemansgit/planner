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
