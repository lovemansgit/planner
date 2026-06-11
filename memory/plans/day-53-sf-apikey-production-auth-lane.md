# Day-53 — SF production auth lane (api_key Client Credentials): plan

**Lane:** T3, Love-directed Day-53 PM (`memory/decision_d53_pm_uat_calls.md` §"Same check-in, Love-directed"). Plan-PR first, code-PR second, **both park** (dispatch-explicit).
**Source contract:** Aqib's delivered docs as verified in `memory/decision_aqib_api_key_auth_header_verified.md` — `POST /api/auth/authenticate` with `clientId` + `clientApiKey` + `clientSecretKey` HEADERS (no query string), OAuth-shaped token body, 30-day access / 180-day refresh TTLs. Header shape is documentation-asserted; **probe-gated before first production provisioning** (Rule-A, bulk-cancel-AWB precedent).

## §1 Grounded current state (verified against main, not assumed)

The wiring the lane directive names **already exists end-to-end on main**:

| Piece | State on main |
|---|---|
| Resolver `api_key` branch | LIVE — `suitefleet-resolver.ts` returns `{ auth_method:'api_key', clientId, customerId, apiKey, secretKey }` (v1.15 discriminated union) |
| `login()` dispatch | LIVE — discriminator switch routes `api_key` → `loginApiKey()` |
| `loginApiKey()` | LIVE since PR #341 (`4e5927f`) — headers per Q2, reuses `parseTokenSet`/`callWithRetry`, 5 mocked-wire test cases |
| Token lifecycle | LIVE + auth-method-agnostic — `token-cache.ts` `getSession`: login → cache → renew at T-1h lead → fall back to serviceable cached token; concurrency-deduped |
| Probe | `scripts/probe-sf-api-key-auth.mjs` exists; **not yet runnable** (no api_key credentials; sandbox is OAuth-only) |

"Gated-inert" is therefore a **provisioning state, not a code gap**: no production-region merchant holds api_key credentials, and the probe gate blocks provisioning them.

## §2 The genuine delta — api_key renewal must not ride an unverified wire

`performRenewal` attempts `authClient.refresh()` for EVERY cached session in the renewal window. The refresh wire (`GET /api/auth/refresh` + `Cookie: refreshToken=…` + `Clientid`) is **OAuth-verified only** — the decision memo's **Q4 residual** explicitly leaves the api_key refresh wire unknown. Today an api_key session reaching its renewal window would fire the api_key refresh token across an unverified wire shape; on mismatch it 401s into the full-login fallback (safe but noisy, and it ships a long-lived credential artifact over a wire we never confirmed).

**Proposed renewal strategy (the plan's one design call):** for `auth_method === 'api_key'`, **skip the refresh attempt entirely** and renew via full `loginApiKey()`.

- Correctness: the fallback path already proves full login is a complete renewal; skipping refresh just makes it the first choice.
- Cost: access tokens last 30 days; with the 1-hour renewal lead, renewal fires ~monthly per merchant. A full login that infrequent is negligible — the refresh optimization exists for OAuth's 24-hour tokens, not for these.
- Honesty: no unverified wire is exercised in the production auth path. The Q4 residual stays open as a PROBE observation (see §3), not a runtime gamble.
- OAuth path: byte-identical behavior (sandbox untouched).

Implementation shape (code-PR): `performRenewal` consults `credentials.auth_method` (already in hand — credentials resolve before the refresh attempt) and bypasses the refresh block unless `oauth`. One conditional + log line; no type changes, no new exports, no migration.

## §3 Probe extension (closes Q4 empirically when it runs)

`scripts/probe-sf-api-key-auth.mjs` gains a **refresh-wire observation step**: after a successful api_key login, attempt the OAuth-shaped refresh with the returned refresh token and RECORD the outcome (status + body shape) without failing the probe on mismatch. If the probe one day shows the OAuth wire works for api_key tokens, flipping §2's skip back to attempt-refresh is a one-line revert with evidence.

## §4 Tests (code-PR, RED-first)

1. token-cache: api_key session in the renewal window → `refresh()` NEVER called, `login()` called, session re-cached. (Fails pre-change: refresh is attempted.)
2. token-cache: OAuth session in the renewal window → `refresh()` attempted exactly as today (regression pin).
3. Existing #341 auth-client cases untouched.

## §5 Park-flags (standing, both PRs' ORCH-PARK entries)

1. **Real production credential values are entered by Love/Aqib directly via `/admin/merchants/[id]/credentials` — never through this terminal.** No credential value, env var, or Vault write flows through the build session.
2. **The live production probe call fires only on Love's named go.** The probe-gate posture of `decision_aqib_api_key_auth_header_verified.md` is unchanged by this lane: merged ≠ production-ready until the probe confirms the header shape (and now also records the refresh-wire observation) against a live api_key region.

## §6 Out of scope

- Sandbox OAuth path (untouched, byte-identical).
- Credential provisioning UI / vault store (already shipped, v1.14/v1.15).
- Migration: none anywhere in this lane.
- Region seeding/activation for production regions (separate provisioning act, Love/Aqib).

## §7 Brief refs

§3.6 (four-layer identifier model), §3.7 (credential storage), v1.15 amendment (dual-path auth — this lane is the api_key half reaching production-readiness *behind the probe gate*).

---

## Day-54 annotation (append-only) — §1 sandbox premise corrected

§1's "Probe … not yet runnable (no api_key credentials; sandbox is OAuth-only)" carried the Planner-side assumption Love corrected on 2026-06-11: SuiteFleet accepts both methods on all tenants, sandbox included. The probe gained a sandbox target (Demo Bistro) via the Day-54 lane (`memory/plans/day-54-sandbox-apikey-method-switch.md`); the §2 renewal strategy and §3 probe extension are unchanged by the correction.
