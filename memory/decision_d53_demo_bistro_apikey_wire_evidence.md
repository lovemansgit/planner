# Day-53 — Demo Bistro api_key wire proof: EVIDENCE PARKED (login rejected 401)

**Date:** 2026-06-11 (Day-53). **Dispatch:** Love's Day-53 proof run (runbook `memory/runbooks/day-54-demo-bistro-apikey-proof.md`, preferred no-plaintext shape). **Outcome: the wire rejected the api_key login on the first and only attempt. Stopped per the dispatch — no retry-loop, no rollback without Love's word.**

## State going in (read-only checks, all healthy)

- `tenants` row (production DB, SELECT only): Demo Bistro `29502ac3-1c3b-460c-9125-e87c7dae4047`, active, customer 591, `suitefleet_auth_method_override='api_key'`, **both vault credential IDs present** (existence only — values never read in the terminal).
- Audit sequence correct: `credentials.method_changed` 2026-06-11 10:18:42Z (the flip) → `credentials.set` 10:19:09Z (Love's entry). Pair entered AFTER the flip cleared the columns — no stale-pair ambiguity.

## The run (one-shot vitest spec, temp file, not committed)

Auth flowed through Planner's own chain — `resolveSuiteFleetCredentials` → Vault decrypt in-process → `createSuiteFleetTokenCache.getSession` → `loginApiKey`. No plaintext in the terminal at any point; evidence below is lengths + statuses only.

| Leg | Request | Result | Timing |
|---|---|---|---|
| A — resolver | SELECT + Vault decrypt (in-process) | `auth_method=api_key`, `override_active=true`, `apiKey_len=20`, `secretKey_len=20`, clientId `transcorpsb`, customerId 591 | 934ms |
| B — login | ONE `POST https://api.suitefleet.com/api/auth/authenticate` with headers `clientId` + `clientApiKey` + `clientSecretKey` (values from Vault, in-process) | **HTTP 401, empty response body** → `CredentialError: SuiteFleet login rejected — credentials invalid` | attempt at 2026-06-11T10:30:56.582Z |
| C — authenticated read | NOT REACHED | — | — |
| D — refresh-wire observation | NOT REACHED | — | — |

Exactly one wire call was made: 4xx short-circuits the auth client's retry policy by design. The same host serves the working OAuth sandbox path, so reachability is not in question — this is an auth-layer rejection.

## Q4 verdict: NOT REACHED

The refresh-wire observation never fired (no session existed). Q4 (api_key refresh wire) remains the open residual; the token-cache's login-only renewal strategy for api_key stays correct and unaffected.

## What the 401 does and does not establish

- **Does:** the first-ever wire test of the Day-52 header shape (`clientId`/`clientApiKey`/`clientSecretKey`, documentation-asserted from Aqib's OpsPortal reply, explicitly probe-gated in `auth-client.ts`) did not authenticate with this key pair. The production probe gate stays CLOSED.
- **Does not:** distinguish wrong header shape from wrong/inactive key values. The empty 401 body gives zero discrimination. Both remain candidate causes:
  1. Key-pair side — pair created for a different client than `transcorpsb`, not yet activated, or the two values entered into swapped fields (write-only UI cannot show this).
  2. Header-shape side — names/casing differ on the real wire from the OpsPortal documentation.

## Standing state + the decision that is Love's

Demo Bistro remains on `api_key` with the entered pair → **its outbound pushes fail loud (`credentials invalid`) until resolved. That is the designed between-state, not breakage.** Every other merchant is untouched on OAuth; today's UAT path is unaffected.

Love's options (one word each):
1. **Re-check SF-side** — confirm on SF OpsPortal the pair belongs to client `transcorpsb` and is active; re-enter (right fields) on the credentials page → say "re-entered" and the one-shot proof re-runs.
2. **Authorize one diagnostic probe** — `scripts/probe-sf-api-key-auth.mjs` run with Love pasting the values into his own shell (header-shape discrimination; still no plaintext through the builder).
3. **Rollback** — two admin actions per runbook §7 (switch back to OAuth, re-enter OAuth pair); only on your word.
