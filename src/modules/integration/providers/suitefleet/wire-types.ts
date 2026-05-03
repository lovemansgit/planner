// SuiteFleet wire-format types — provider-internal, not exported beyond
// this directory. Plan §5 / ADR-007 / Day-4 brief §5.
//
// These shapes mirror exactly what SuiteFleet returns on the wire. The
// auth-client (and later request-shape modules) translate between these
// and the internal-language types in src/modules/integration/types.ts;
// nothing under src/modules/integration/ outside providers/suitefleet/
// imports from this file.

/**
 * The `/api/auth/authenticate` and `/api/auth/refresh` response body
 * (only the fields the auth client needs). SuiteFleet returns more —
 * `email`, `name`, `role.permissions`, `companyId` — but those aren't
 * load-bearing for token management.
 *
 * `accessTokenExpiration` and `refreshTokenExpiration` arrive as ISO-8601
 * strings without a timezone designator (e.g. `2026-04-29T08:58:15.295614`).
 * The auth client parses them as UTC; SuiteFleet's actual timezone
 * convention isn't documented, so this is a best-default that holds
 * unless their server clock is set to a different zone. If sandbox
 * smoke testing reveals drift, the parser is the single point to adjust.
 */
export interface SuiteFleetAuthResponseBody {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiration: string;
  readonly refreshTokenExpiration: string;
}

/**
 * Provider-internal token set, parsed and ready for the cache (S-7) and
 * the higher-level `AuthenticatedSession` wrapper (S-8 assembly point).
 *
 * Why we keep this separate from `AuthenticatedSession`:
 *   - The provider can return tokens without knowing a `tenantId`; the
 *     tenantId binding lives one layer up.
 *   - The provider's wire-shape may evolve (e.g. SuiteFleet adding new
 *     fields); the higher-level interface stays stable.
 */
export interface SuiteFleetTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenExpiresAt: Date;
}
