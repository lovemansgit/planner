// SuiteFleet token cache — Day 4 / S-7.
//
// Wraps the auth client (S-2) and the credential resolver (S-3) into a
// per-tenant session cache. Hides login / refresh / cache plumbing
// from callers — the public API is `getSession(tenantId)` returning
// an `AuthenticatedSession`.
//
// Cache lifecycle:
//
//   First call (cache miss)
//     → resolve credentials → login → cache → return session
//
//   Subsequent call (cache hit, fresh — outside the refresh window)
//     → return cached session, no network call
//
//   Subsequent call (cache hit, within T-1h of access-token expiry)
//     → resolve credentials → refresh using cached refresh token →
//       cache the new session → return
//
//   Subsequent call (cache hit, refresh token also expired, or refresh
//   throws)
//     → resolve credentials → full login → cache → return
//
// The "proactive" refresh is lazy: refresh is triggered by the next
// `getSession` call that lands within the refresh window. There is no
// background timer. With in-memory state and request-driven traffic
// this is sufficient for pilot scale; the Day-5+ Redis swap may
// introduce a real background refresh job if needed.
//
// TODO(Day-5): replace the in-memory Map with Upstash Redis. The cache
// API is the same shape; only the backing store changes. Keys:
//   sf:session:<tenantId>
// Values: serialised AuthenticatedSession with TTL = (renewalExpiresAt - now).
//
// Concurrency: this implementation does NOT dedupe concurrent
// cache-miss requests. Two simultaneous getSession calls for the same
// tenantId can each trigger a login. Pilot-scale traffic makes this a
// non-issue; the Redis swap on Day 5+ will use SETNX-style guards.

import { logger } from "../../../../shared/logger";
import type { Uuid, IsoTimestamp } from "../../../../shared/types";

import type { resolveSuiteFleetCredentials } from "../../../credentials";

import type { AuthenticatedSession } from "../../types";

import type { SuiteFleetAuthClient } from "./auth-client";
import type { SuiteFleetTokenSet } from "./wire-types";

const log = logger.with({ component: "suitefleet_token_cache" });

const DEFAULT_REFRESH_LEAD_TIME_MS = 60 * 60 * 1000;

type CredentialResolver = typeof resolveSuiteFleetCredentials;

export interface SuiteFleetTokenCacheDeps {
  readonly authClient: SuiteFleetAuthClient;
  readonly resolveCredentials: CredentialResolver;
  readonly clock: () => Date;
  readonly refreshLeadTimeMs?: number;
}

export interface SuiteFleetTokenCache {
  /**
   * Returns a usable `AuthenticatedSession` for the tenant. Hits the
   * cache when fresh, refreshes proactively when near expiry, falls
   * back to full login when the refresh token is expired or refresh
   * fails. Throws `CredentialError` if neither refresh nor login can
   * produce a valid session.
   */
  getSession(tenantId: Uuid): Promise<AuthenticatedSession>;
  /** Drop the cached session for one tenant, or all tenants. */
  invalidate(tenantId?: Uuid): void;
}

function toAuthenticatedSession(
  tenantId: Uuid,
  tokens: SuiteFleetTokenSet,
): AuthenticatedSession {
  return {
    tenantId,
    token: tokens.accessToken,
    renewalToken: tokens.refreshToken,
    tokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() as IsoTimestamp,
    renewalTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString() as IsoTimestamp,
  };
}

export function createSuiteFleetTokenCache(
  deps: SuiteFleetTokenCacheDeps,
): SuiteFleetTokenCache {
  const cache = new Map<Uuid, AuthenticatedSession>();
  const refreshLeadTimeMs = deps.refreshLeadTimeMs ?? DEFAULT_REFRESH_LEAD_TIME_MS;

  async function getSession(tenantId: Uuid): Promise<AuthenticatedSession> {
    const now = deps.clock().getTime();
    const cached = cache.get(tenantId);

    if (cached !== undefined) {
      const tokenExpiresAtMs = Date.parse(cached.tokenExpiresAt);
      const refreshAtMs = tokenExpiresAtMs - refreshLeadTimeMs;
      if (now < refreshAtMs) {
        return cached;
      }
    }

    // Either: cache miss, or cached session is within the refresh
    // window, or fully expired. All three paths need credentials.
    const credentials = await deps.resolveCredentials(tenantId);

    if (cached !== undefined) {
      const renewalExpiresAtMs = Date.parse(cached.renewalTokenExpiresAt);
      if (now < renewalExpiresAtMs) {
        try {
          const tokens = await deps.authClient.refresh({
            clientId: credentials.clientId,
            refreshToken: cached.renewalToken,
          });
          const session = toAuthenticatedSession(tenantId, tokens);
          cache.set(tenantId, session);
          log.info({
            operation: "refresh_session",
            tenant_id: tenantId,
            outcome: "ok",
          });
          return session;
        } catch (err) {
          log.warn({
            operation: "refresh_session",
            tenant_id: tenantId,
            outcome: "fallback_to_login",
            message: err instanceof Error ? err.message : "unknown",
          });
        }
      }
    }

    const tokens = await deps.authClient.login(credentials);
    const session = toAuthenticatedSession(tenantId, tokens);
    cache.set(tenantId, session);
    log.info({
      operation: "login_session",
      tenant_id: tenantId,
      outcome: "ok",
    });
    return session;
  }

  function invalidate(tenantId?: Uuid): void {
    if (tenantId === undefined) {
      cache.clear();
    } else {
      cache.delete(tenantId);
    }
  }

  return { getSession, invalidate };
}
