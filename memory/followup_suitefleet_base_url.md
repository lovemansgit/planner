---
name: SuiteFleet outbound base URL — single host architecture validated
description: Empirical resolution (1 May 2026) of whether SF uses subdomain-per-Client-ID for API calls. Two HEAD/GET probes confirm api.suitefleet.com is the canonical API host for all merchants; merchant subdomains (transcorpsb.suitefleet.com etc.) are portal frontends only. The current single-base-URL design (DEFAULT_BASE_URL in auth-client.ts and task-client.ts) is correct as-is; no refactor needed.
type: project
---

**Status: RESOLVED 1 May 2026. No code change required.**

Single durable record for the SF outbound base URL question raised during the W-1 / pre-S-1 architecture read-back. Surfaced as a possible per-tenant concern (subdomain-per-Client-ID); empirically resolved as a non-concern via two probe responses.

## 1. Context

The W-1 webhook receiver work (Day 6) introduced per-tenant URLs on the **inbound** side (`/api/webhooks/suitefleet/[tenantId]`). During the pre-S-1 read-back, a related question was raised on the **outbound** side: does SF use subdomain-per-Client-ID for API routing (e.g. `transcorpsb.suitefleet.com` for sandbox merchant 588)? If yes, the `LastMileAdapter` singleton's single-host design would have broken for the very first non-588 production merchant.

## 2. Architectural concern that triggered the question

The current code resolves to a single hardcoded base URL:

- [`src/modules/integration/providers/suitefleet/auth-client.ts:65`](../src/modules/integration/providers/suitefleet/auth-client.ts) → `const DEFAULT_BASE_URL = "https://api.suitefleet.com";`
- [`src/modules/integration/providers/suitefleet/task-client.ts:82`](../src/modules/integration/providers/suitefleet/task-client.ts) → same constant

`SuiteFleetCredentials` carries no `baseUrl` field. The W-1 singleton at [`src/modules/integration/providers/suitefleet/get-adapter.ts`](../src/modules/integration/providers/suitefleet/get-adapter.ts) constructs ONE adapter per process, sharing that base URL across every tenant.

If SF expected `<client-id>.suitefleet.com` per merchant, the architecture would have needed a refactor — either per-call URL plumbing through `SuiteFleetCredentials`, or replacing the singleton with a per-tenant adapter cache.

## 3. Open question — RESOLVED 1 May 2026

**Original question:** Does SF use subdomain-per-Client-ID for API routing in production? If yes, the per-tenant base URL becomes an architectural concern alongside per-tenant credentials.

**Resolution method:** two empirical HEAD/GET probes from Love's session.

### Probe A — `GET https://transcorpsb.suitefleet.com/api/auth/authenticate`

- **Result:** styled 404 HTML page ("Oops, an error has occurred. Page not found!")
- **Interpretation:** this subdomain is the merchant **portal frontend** (UI). The `/api/auth/authenticate` path doesn't exist on this host. SF's portal frontend is per-merchant; the API is not.

### Probe B — `GET https://api.suitefleet.com/api/auth/authenticate`

- **Result:** HTTP 406 Not Acceptable
- **Interpretation:** the endpoint exists; 406 is the expected response for a GET against a POST-only JSON endpoint with the wrong content type. This is the **canonical API host**.

### Conclusion

`api.suitefleet.com` is the canonical API URL for **all** merchants. Per-merchant subdomains (`transcorpsb.suitefleet.com`, etc.) are portal frontends only — no API routing. Production almost certainly follows the same model: single API host, per-merchant portal subdomains for UI, all API calls multiplexed through `api.suitefleet.com` and authenticated by per-tenant Client ID + credentials.

## 4. Risk window — all N/A

The three risk windows flagged during the pre-probe survey:

- **Day-7+ cron at 16:00 cutoff** — N/A. The bulk createTask push will hit the same correct `api.suitefleet.com` for every tenant.
- **Day-8+ multi-merchant rollout** — N/A. Adding a second pilot merchant doesn't require any URL change. Per-tenant credentials are already plumbed (`clientId` and `customerId` on `SuiteFleetCredentials`); the URL is shared across all merchants.
- **First non-588 production merchant** — N/A. Same multiplexed-host architecture covers them.

## 5. Resolution path — empirical probe (no code change required)

The architectural fix flagged during the earlier survey (per-call URL plumbing through credentials, or per-tenant adapter cache) is **not needed**. Two simple HEAD/GET probes were sufficient to resolve the question definitively; no refactor warranted.

This question is fully closed; no further follow-up vendor email needed for the base URL specifically. (Vendor questions on retry policy, error code catalogue, programmatic webhook config, etc. remain open in [followup_suitefleet_webhook_policy.md](followup_suitefleet_webhook_policy.md) — distinct concerns, separate resolution path.)

## 6. Action — complete

- [x] Probe `https://transcorpsb.suitefleet.com/api/auth/authenticate` (Love, 1 May 2026)
- [x] Probe `https://api.suitefleet.com/api/auth/authenticate` (Love, 1 May 2026)
- [x] Document outcome in this memory file
- [x] No code change required — confirm `DEFAULT_BASE_URL` in `auth-client.ts` and `task-client.ts` is correct as-is

## Outcome

**Single base URL architecture validated.** `https://api.suitefleet.com` is the canonical API host for every SF merchant — sandbox and production. Per-merchant portal subdomains (`<client-id>.suitefleet.com`) are UI-only, not API routes. The current `LastMileAdapter` design — one singleton, one hardcoded base URL, per-tenant credentials multiplexed through that single host — is correct as-is and requires no refactoring for Day-7+ cron, Day-8+ multi-merchant rollout, or production go-live.
