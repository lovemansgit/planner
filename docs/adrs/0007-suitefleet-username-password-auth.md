# ADR-007 · SuiteFleet auth via username/password JWT, not OAuth2 client credentials

## Status

Accepted · 25 April 2026 · Supersedes the OAuth2 client-credentials flow described in plan v2.1 §5.6.1.

## Context

Plan v2.1 §5.6.1 specified SuiteFleet auth as OAuth2 client credentials: exchange `client_id` + `client_secret` at a `/oauth/token` endpoint for a short-lived access token, then use the access token as Bearer on subsequent calls. The plan explicitly noted this needed verification against the SuiteFleet sandbox on Day 4 before adapter implementation began.

When the operator obtained sandbox credentials and verified actual API behaviour, the auth model is different:

- No `/oauth/token` endpoint with `grant_type=client_credentials`. SuiteFleet uses **username + password** posted to a login endpoint (exact path TBD on Day 4) returning a **24-hour JWT**.
- Subsequent calls send **two** headers: `Authorization: Bearer <jwt>` and `Clientid: <client_id>`. `client_id` is a tenant-routing identifier on every request, not a credential.
- Sandbox base URL: `https://api.suitefleet.com/api`. The `https://sandbox.suitefleet.com/api/v2` path used in the plan does not exist.
- A separate `accountId` scalar may be required by certain endpoints (TBD on Day 4).

This is a contract change at the integration layer only. The surrounding architecture is unaffected: per-tenant credentials still live in AWS Secrets Manager, the adapter still implements `LastMileProvider`, the rate limiter and circuit breaker still scope per `(tenant_id, provider, environment)`, and the auth token is still cached in Upstash Redis with `(expiry − 60s)` TTL for proactive refresh.

## Decision

The Day 4 SuiteFleet adapter implements username/password JWT authentication:

1. **Verify the exact login endpoint path and request body** against the SuiteFleet sandbox docs **before** writing adapter code. Do not assume.
2. POST credentials (form-encoded or JSON — confirm on Day 4) to the login endpoint; receive a 24-hour JWT.
3. Cache the JWT in Upstash Redis under `sf:jwt:${tenantId}:${environment}` with TTL `(expiry − 60s)` for proactive refresh.
4. Attach `Authorization: Bearer ${jwt}` AND `Clientid: ${creds.clientId}` headers on every subsequent API call.
5. On 401: evict cache, re-authenticate once, retry. A second 401 surfaces as `CredentialError`.

The AWS Secrets Manager credential record for SuiteFleet now contains: `apiBaseUrl`, `clientId`, `accountId`, `username`, `password`, `environment`. The `client_secret` field from §5.6.1 is removed entirely — it does not exist in this auth model.

`.env.example` schema changes (commit 4 alongside this ADR):

- **Removed:** `SUITEFLEET_SANDBOX_CLIENT_SECRET`
- **Added:** `SUITEFLEET_SANDBOX_USERNAME`, `SUITEFLEET_SANDBOX_PASSWORD`
- **Updated:** `SUITEFLEET_SANDBOX_API_BASE_URL` → `https://api.suitefleet.com/api`
- **Repurposed (name unchanged):** `SUITEFLEET_SANDBOX_CLIENT_ID` is the value sent on the `Clientid` header, not an OAuth2 client identifier

## Consequences

- **Positive — matches the actual SuiteFleet API.** No fictional auth code on Day 4; the adapter is built against verified behaviour.
- **Positive — caching shape unchanged.** The JWT cache key, TTL pattern, and refresh logic from §5.6.1 carry over verbatim — only the cache value type (JWT vs OAuth2 access token) and the path used to obtain it differ.
- **Negative — 24-hour JWT lifetime increases blast radius if leaked, vs. typical 1-hour OAuth2 access tokens.** Mitigated by per-tenant secret isolation (R-3 wrapper + AWS Secrets Manager IAM scoping per §8.3), proactive `(expiry − 60s)` refresh, and audit-log emission on every credential rotation (§8.5).
- **Negative — the two-header pattern (Authorization + Clientid) is a SuiteFleet-specific shape that the `LastMileProvider` interface must accommodate.** The interface stays vendor-agnostic; the two-header detail lives only in `src/modules/integration/providers/suitefleet/client.ts`.
- **Negative — the exact login endpoint path is still TBD.** This ADR commits to the _flow_, not a specific path. Day 4 verification finalises the path before code is written.
- **Reversible — yes.** If SuiteFleet ever adds OAuth2 client credentials in addition to username/password, the adapter swaps one auth helper for another with no impact on business logic.
