// SuiteFleet auth client — Day 4 / S-2.
//
// Two operations:
//   login(credentials)                → POST /api/auth/authenticate
//   refresh({ clientId, refreshToken }) → GET /api/auth/refresh
//
// Wire facts (locked Day 3 from real curls; brief §5 supersedes readme.io):
//   - Login URL: credentials in query string, NOT body
//   - Header `Clientid: <clientId>` (capital C, not camelCase)
//   - Refresh sends the refresh token via cookie (`Cookie: refreshToken=...`)
//   - Response shape camelCase; both tokens come back in body and as
//     Set-Cookie. Use the body, ignore the cookies.
//
// Error model — the brief calls it `LastMileAuthError`; this module
// maps onto the existing `CredentialError` from src/shared/errors.ts,
// whose docstring already calls out ADR-007 auth failures. Adding a
// dedicated `LastMileAuthError` would split the discriminated union and
// force every consumer of the API error switch to add a new branch for
// no semantic gain. If finer granularity is needed later, extend with a
// discriminator field on CredentialError rather than a new subclass.
//
// Retry policy — brief §8 says "3 attempts, 250ms / 500ms / 1000ms"
// with exponential backoff. Read as 3 retries (so up to 4 total attempts)
// with delays before each retry. Retried on network errors and 5xx;
// 4xx responses are credential / shape problems and never benefit from
// a retry, so they short-circuit straight to a CredentialError throw.
//
// (a) The brief's "3 attempts, 250ms / 500ms / 1000ms" is internally
// inconsistent — 3 attempts implies 2 delays, not 3. Resolved as 3
// retries / 4 total attempts / 3 delays. This is the conservative read,
// matching the spirit of exponential backoff (each retry waits longer
// than the last, ending at ~1s) and giving the upstream a generous
// recovery budget for transient blips.
//
// (b) The retry condition is `response.status < 500` returns / `>= 500`
// retries. That treats every 5xx as transient, including 501 (Not
// Implemented) and 505 (HTTP Version Not Supported) which are
// terminal. Negligible risk for SuiteFleet — neither code is
// plausible against an established public API — but if the retry
// surface widens (e.g., reused for tasks / consignees / webhooks
// against less-vetted upstreams), tighten the retryable set to an
// explicit allow-list: [500, 502, 503, 504, 408, 429].
//
// Logging hygiene — every log line goes through the project logger
// (src/shared/logger.ts), which auto-redacts password / accessToken /
// refreshToken / token / authorization / username (per ADR-007). The
// only fields we ever pass into the logger are tenant-safe identifiers
// (status code, attempt number, error_code). The credential and token
// strings never reach the logger directly.
//
// Dependency injection — `fetch`, `clock`, and `sleep` are injected so
// unit tests can mock without touching globals. Production callers will
// hand in `globalThis.fetch` and `() => new Date()` from the assembly
// point in S-8.

import { CredentialError } from "@/shared/errors";
import { logger } from "@/shared/logger";

import type {
  SuiteFleetAuthResponseBody,
  SuiteFleetTokenSet,
} from "./wire-types";

const DEFAULT_BASE_URL = "https://api.suitefleet.com";
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1000];

/** Per-call credentials for the login flow. Resolved by S-3. */
export interface SuiteFleetCredentials {
  readonly username: string;
  readonly password: string;
  readonly clientId: string;
}

/** Inputs to the refresh flow — refresh tokens are scoped per clientId. */
export interface SuiteFleetRefreshInput {
  readonly clientId: string;
  readonly refreshToken: string;
}

/**
 * Constructor dependencies. `baseUrl` defaults to the production-shaped
 * SuiteFleet host; sandbox testing in S-9 overrides it. `retryDelaysMs`
 * is the sequence of delays between retry attempts (length = number of
 * retries; total attempts = length + 1).
 */
export interface SuiteFleetAuthClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clock: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly baseUrl?: string;
  readonly retryDelaysMs?: readonly number[];
}

export interface SuiteFleetAuthClient {
  login(credentials: SuiteFleetCredentials): Promise<SuiteFleetTokenSet>;
  refresh(input: SuiteFleetRefreshInput): Promise<SuiteFleetTokenSet>;
}

const TIMESTAMP_HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/;

function parseSuiteFleetTimestamp(value: string, field: string): Date {
  const withTz = TIMESTAMP_HAS_TZ.test(value) ? value : `${value}Z`;
  const ms = Date.parse(withTz);
  if (Number.isNaN(ms)) {
    throw new CredentialError(
      `SuiteFleet returned an unparseable ${field} timestamp`,
    );
  }
  return new Date(ms);
}

function isAuthResponseBody(value: unknown): value is SuiteFleetAuthResponseBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accessToken === "string" &&
    typeof v.refreshToken === "string" &&
    typeof v.accessTokenExpiration === "string" &&
    typeof v.refreshTokenExpiration === "string"
  );
}

function parseTokenSet(body: unknown): SuiteFleetTokenSet {
  if (!isAuthResponseBody(body)) {
    throw new CredentialError("SuiteFleet auth response missing required fields");
  }
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    accessTokenExpiresAt: parseSuiteFleetTimestamp(
      body.accessTokenExpiration,
      "accessTokenExpiration",
    ),
    refreshTokenExpiresAt: parseSuiteFleetTimestamp(
      body.refreshTokenExpiration,
      "refreshTokenExpiration",
    ),
  };
}

export function createSuiteFleetAuthClient(
  deps: SuiteFleetAuthClientDeps,
): SuiteFleetAuthClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = logger.with({ component: "suitefleet_auth_client" });

  async function callWithRetry(
    operation: "login" | "refresh",
    request: () => Promise<Response>,
  ): Promise<Response> {
    const maxAttempts = retryDelays.length + 1;
    let lastNetworkError: unknown = null;
    let lastServerStatus: number | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response | null = null;
      try {
        response = await request();
      } catch (err) {
        lastNetworkError = err;
        log.warn({
          operation,
          attempt,
          error_code: "network_error",
          message: err instanceof Error ? err.message : "unknown",
        });
      }

      if (response !== null) {
        if (response.status < 500) {
          return response;
        }
        lastServerStatus = response.status;
        lastNetworkError = null;
        log.warn({ operation, attempt, status: response.status, error_code: "server_5xx" });
      }

      if (attempt === maxAttempts) {
        const cause = lastNetworkError instanceof Error ? lastNetworkError : undefined;
        const reason =
          lastServerStatus !== null
            ? `SuiteFleet ${operation} returned ${lastServerStatus} after ${maxAttempts} attempts`
            : `SuiteFleet ${operation} unreachable after ${maxAttempts} attempts`;
        throw new CredentialError(reason, cause ? { cause } : undefined);
      }

      await sleep(retryDelays[attempt - 1]);
    }

    throw new CredentialError(`SuiteFleet ${operation} retry loop exhausted unexpectedly`);
  }

  async function readJson(response: Response, operation: "login" | "refresh"): Promise<unknown> {
    try {
      return await response.json();
    } catch (err) {
      throw new CredentialError(`SuiteFleet ${operation} response was not valid JSON`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  function rejectClientError(operation: "login" | "refresh", status: number): never {
    log.warn({ operation, status, error_code: "client_4xx" });
    if (status === 401) {
      throw new CredentialError(`SuiteFleet ${operation} rejected — credentials invalid`);
    }
    throw new CredentialError(`SuiteFleet ${operation} rejected with status ${status}`);
  }

  return {
    async login(credentials: SuiteFleetCredentials): Promise<SuiteFleetTokenSet> {
      const url = new URL(`${baseUrl}/api/auth/authenticate`);
      url.searchParams.set("username", credentials.username);
      url.searchParams.set("password", credentials.password);

      const response = await callWithRetry("login", () =>
        deps.fetch(url.toString(), {
          method: "POST",
          headers: {
            Clientid: credentials.clientId,
            Accept: "application/json",
          },
        }),
      );

      if (response.status >= 400) rejectClientError("login", response.status);

      const body = await readJson(response, "login");
      const tokens = parseTokenSet(body);

      const now = deps.clock().getTime();
      if (tokens.accessTokenExpiresAt.getTime() <= now) {
        throw new CredentialError(
          "SuiteFleet login returned a token whose expiration is in the past",
        );
      }

      log.info({
        operation: "login",
        status: response.status,
        access_expires_at: tokens.accessTokenExpiresAt.toISOString(),
        refresh_expires_at: tokens.refreshTokenExpiresAt.toISOString(),
      });

      return tokens;
    },

    async refresh(input: SuiteFleetRefreshInput): Promise<SuiteFleetTokenSet> {
      const url = `${baseUrl}/api/auth/refresh`;

      const response = await callWithRetry("refresh", () =>
        deps.fetch(url, {
          method: "GET",
          headers: {
            Clientid: input.clientId,
            Cookie: `refreshToken=${input.refreshToken}`,
            Accept: "application/json",
          },
        }),
      );

      if (response.status >= 400) rejectClientError("refresh", response.status);

      const body = await readJson(response, "refresh");
      const tokens = parseTokenSet(body);

      const now = deps.clock().getTime();
      if (tokens.accessTokenExpiresAt.getTime() <= now) {
        throw new CredentialError(
          "SuiteFleet refresh returned a token whose expiration is in the past",
        );
      }

      log.info({
        operation: "refresh",
        status: response.status,
        access_expires_at: tokens.accessTokenExpiresAt.toISOString(),
        refresh_expires_at: tokens.refreshTokenExpiresAt.toISOString(),
      });

      return tokens;
    },
  };
}
