// SuiteFleet token cache — Day 4 / S-7.
//
// Wraps the auth client (S-2) and credential resolver (S-3) into a
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
// -------------------------------------------------------------------
// Renewal opportunism (load-bearing):
//
// A cached token valid for another 59 minutes is not "expired" — it is
// "renew when convenient." Any failure during the optimistic renewal
// window — credential resolver throws, refresh throws, login throws —
// falls back to the still-serviceable cached token if `now <
// cached.tokenExpiresAt`. Only when no serviceable cached token
// exists does the error propagate.
// -------------------------------------------------------------------
//
// Concurrency dedup (load-bearing):
//
// In-flight renewals are tracked in a Map<Uuid, Promise>. When a
// `getSession` call decides renewal is needed, it checks for an
// in-flight entry first; if found, it awaits that Promise instead of
// starting its own. This makes 100 simultaneous getSession calls for
// the same tenant produce a single login, not 100. The .finally()
// hook clears the entry on settle (success or failure) so subsequent
// retries are not blocked by a stale entry.
//
// This mirrors the Day-5+ Redis SETNX guard pattern — first arriver
// locks, others wait. The Day-5 swap relocates the same logic to the
// distributed primitive without changing the semantics.
//
// -------------------------------------------------------------------
//
// The "proactive" refresh is lazy: refresh is triggered by the next
// `getSession` call that lands within the refresh window. There is no
// background timer.
//
// TODO(Day-5): replace the in-memory Map with Upstash Redis.
//   Cache keys:    sf:session:<tenantId>
//   In-flight:     sf:renewal-lock:<tenantId> (SET NX EX 30)
//   Values:        serialised AuthenticatedSession with TTL =
//                  (renewalExpiresAt - now)

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
   * back to the still-serviceable cached token if any renewal step
   * fails. Throws only when there's no usable session at all.
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
  const inFlightRenewals = new Map<Uuid, Promise<AuthenticatedSession>>();
  const refreshLeadTimeMs = deps.refreshLeadTimeMs ?? DEFAULT_REFRESH_LEAD_TIME_MS;

  async function performRenewal(
    tenantId: Uuid,
    cached: AuthenticatedSession | undefined,
  ): Promise<AuthenticatedSession> {
    try {
      const credentials = await deps.resolveCredentials(tenantId);

      if (cached !== undefined) {
        const renewalExpiresAtMs = Date.parse(cached.renewalTokenExpiresAt);
        const renewalNow = deps.clock().getTime();
        if (renewalNow < renewalExpiresAtMs) {
          try {
            const tokens = await deps.authClient.refresh({
              clientId: credentials.clientId,
              refreshToken: cached.renewalToken,
            });
            const session = toAuthenticatedSession(tenantId, tokens);
            cache.set(tenantId, session);
            log.info({ operation: "refresh_session", tenant_id: tenantId, outcome: "ok" });
            return session;
          } catch (refreshErr) {
            log.warn({
              operation: "refresh_session",
              tenant_id: tenantId,
              outcome: "fallback_to_login",
              message: refreshErr instanceof Error ? refreshErr.message : "unknown",
            });
          }
        }
      }

      const tokens = await deps.authClient.login(credentials);
      const session = toAuthenticatedSession(tenantId, tokens);
      cache.set(tenantId, session);
      log.info({ operation: "login_session", tenant_id: tenantId, outcome: "ok" });
      return session;
    } catch (err) {
      // Renewal failed somewhere (resolver / refresh / login). Fall
      // back to the cached token if it's still serviceable.
      if (cached !== undefined) {
        const fallbackNow = deps.clock().getTime();
        if (fallbackNow < Date.parse(cached.tokenExpiresAt)) {
          log.warn({
            operation: "renewal_session",
            tenant_id: tenantId,
            error_code: "renewal_failed_using_cached",
            message: err instanceof Error ? err.message : "unknown",
          });
          return cached;
        }
      }
      throw err;
    }
  }

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

    // Concurrent-renewal dedup: if another caller is already running
    // the renewal flow for this tenant, await that Promise instead of
    // starting our own.
    const inFlight = inFlightRenewals.get(tenantId);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const renewal = performRenewal(tenantId, cached).finally(() => {
      inFlightRenewals.delete(tenantId);
    });
    inFlightRenewals.set(tenantId, renewal);
    return renewal;
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
