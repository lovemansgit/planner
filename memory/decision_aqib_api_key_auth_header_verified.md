# Decision · SuiteFleet API-Key auth-header — Aqib-verified, probe-gated

**Status:** Decided. Code merges to main now (code-only). **PROBE-GATED ON FIRST PRODUCTION-REGION PROVISIONING, NOT ON MERGE.** The header shape below is documentation-asserted from Aqib's reply; empirical confirmation via `scripts/probe-sf-api-key-auth.mjs` is a HARD GATE on provisioning the first production-region api_key merchant — it is **not** a code-merge gate (bulk-cancel-AWB precedent — see §"Rule-A caveat"). **Merged ≠ production-ready.**
**Decision date:** 9 June 2026.
**Lane:** API-key auth-unblock (Phase-1 sub-PR A). Closes the `loginApiKey` blocker narrowed by brief v1.15.
**Decided by:** Reviewer counter-session + Aqib's SF OpsPortal API-key reply.
**Source:** Aqib's API-key documentation, delivered Day-51 (2026-06-09) per [`handoffs/day-51-eod.md`](handoffs/day-51-eod.md) §G ("Aqib delivered API key docs Day-51"; "docs are durable in a shared location"). ⚠️ PENDING reviewer fill — Aqib delivery medium/link to be confirmed and patched. (Recorded as a placeholder; NOT fabricated — known open item, tracked.)

## Summary

Resolves the 4 open API-Key auth-header questions filed at [`followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md) (Day-27, 🔴-load-bearing → rotated to resolved by this memo). That followup is the API-key analogue of the OAuth/task-endpoint lane closed by [`decision_phase_1_aqib_doc_verified.md`](decision_phase_1_aqib_doc_verified.md); this memo mirrors that "doc-verified ledger" pattern.

**Net consequence:** `loginApiKey()` at [`src/modules/integration/providers/suitefleet/auth-client.ts`](../src/modules/integration/providers/suitefleet/auth-client.ts) implemented (was a `ConfigurationError` stub). Production-region (`transcorp` / `transcorpuae` / `transcorpqatar`) credential provisioning unblocks once the probe gate closes.

---

## Q1 — Endpoint path ✓ verified

`POST /api/auth/authenticate` — the **same** endpoint as the OAuth flow. No separate `/api/auth/api-key` variant.

## Q2 — Header names + casing ✓ verified (probe-gated)

Credentials travel in **request headers**, NOT the query string (the OAuth flow puts `username`/`password` in the query string — api_key does not):

- `clientId: <region client_id>`
- `clientApiKey: <api key>`
- `clientSecretKey: <secret key>`

## Q3 — Token semantics ✓ verified

Same response body shape as OAuth (`accessToken`, `refreshToken`, `accessTokenExpiration`, `refreshTokenExpiration`) — so `SuiteFleetAuthResponseBody` + `parseTokenSet` are reused **unchanged** (no `wire-types.ts` delta). TTLs differ:

- **Access token:** 30-day TTL (OAuth: 24h).
- **Refresh token:** 180-day TTL (OAuth: 6mo).

TTL is a *value* of the expiration timestamps, not a shape change — the parser reads it regardless.

## Q4 — Refresh path ⚠️ partially scoped

A 180-day refresh token is returned, so a refresh path exists. **Residual (out of scope for this PR):** whether the api_key refresh wire matches the OAuth `refresh()` (`GET /api/auth/refresh` + `Cookie: refreshToken=…` + `Clientid`) or differs. This PR scopes `loginApiKey()` only; `refresh()` for api_key tokens is a follow-up if the wire differs. Flagged for the probe to observe.

---

## Rule-A caveat — verified shape matched NEITHER candidate; probe-gated

The verified shape (`clientId` + `clientApiKey` + `clientSecretKey`) matches **neither** candidate documented in the pending followup:

- candidate (a): `Clientid` + `X-Api-Key` + `X-Api-Secret`
- candidate (b): `Authorization: Bearer base64(api_key:secret_key)` + `Clientid`

It is a **third shape**. Per the bulk-cancel-AWB precedent — where a Day-20 doc-verified claim ("comma-separated AWBs") was **empirically refuted** (HTTP 500, Java `NumberFormatException`) on Day-21 and corrected to numeric SF ids — a documented-but-unprobed shape MUST NOT reach a live production merchant. **HARD GATE (on provisioning, not merge):** before the first production-region api_key merchant is credential-provisioned, `scripts/probe-sf-api-key-auth.mjs` must empirically confirm the header names/casing + a 200 + the token body against a live api_key-region endpoint. The code merges to main without this; production provisioning does not.

### Probe-gate status — NOT YET RUN (gates production provisioning, not merge)

**This code is merged to main. That does NOT make api_key auth production-ready.** No production-region (`transcorp` / `transcorpuae` / `transcorpqatar`) merchant may be credential-provisioned until the probe confirms the header shape against a live api_key endpoint — until then `loginApiKey()` is unverified against the real wire and the first provisioning attempt could fail exactly like the Day-21 bulk-cancel 500. **"Merged" ≠ "production-ready."**

Two blockers in the build environment:

1. **No sandbox api_key path.** The sandbox region (`transcorpsb`) is OAuth-only; `api_key` applies only to production regions. "Probe the sandbox" has no api_key endpoint — a true probe needs a production-region api_key endpoint.
2. **No api_key credentials available.** No `SUITEFLEET_*_API_KEY`/`SECRET_KEY` env vars exist, and api_key credential provisioning is itself the blocked lane. The probe reads `SUITEFLEET_APIKEY_{CLIENT_ID,API_KEY,SECRET_KEY}` and fails closed when absent.

Closing the gate requires production-region api_key test credentials **plus** explicit production-probe authorization (the sandbox authorization does not cover a live production-auth call). Until then, the header shape above is documentation-asserted, not empirically verified.

---

## Code landed with this memo (branch `fix/d36-a-api-key-auth-header`, off main `3beb33c`)

- `loginApiKey()` at [`auth-client.ts`](../src/modules/integration/providers/suitefleet/auth-client.ts) — real implementation mirroring `loginOAuth()`; credentials in headers per Q2; reuses `callWithRetry` / `rejectClientError` / `parseTokenSet` / the past-dated-token guard. The `login()` discriminator switch already dispatched `api_key` here; only the stub body changed. `ConfigurationError` import dropped (no longer thrown).
- ≥5 integration cases in [`tests/auth-client.spec.ts`](../src/modules/integration/providers/suitefleet/tests/auth-client.spec.ts) — mocked `fetch`: happy-path 30d/180d parse, exact header-name/casing + no-query-string guard, 401 no-retry, 5xx retried-then-`CredentialError`, past-dated-token.
- `scripts/probe-sf-api-key-auth.mjs` — the merge-gate probe described above.

## Cross-references

- [`followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md) — the 4 questions; rotated 🔴 → resolved by this memo.
- [`decision_phase_1_aqib_doc_verified.md`](decision_phase_1_aqib_doc_verified.md) — the OAuth/task-endpoint analogue; the "doc-verified ledger" pattern this memo mirrors (incl. the Day-21 empirical-refutation precedent).
- [`decision_brief_v1_15_amendment_dual_path_sf_auth.md`](decision_brief_v1_15_amendment_dual_path_sf_auth.md) — dual-path posture that narrowed this blocker to `loginApiKey` only.
- [`plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`](plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md) §5.2 — the two original candidate shapes.
- [`handoffs/day-51-eod.md`](handoffs/day-51-eod.md) §G — "Aqib delivered API key docs Day-51"; the unfiled-decision-memo carry-forward this memo discharges.

## Meta

Filed 9 June 2026 as part of the API-key auth-unblock T2 (branch `fix/d36-a-api-key-auth-header`, off main `3beb33c`). Companion to the `loginApiKey()` implementation in the same PR. Production provisioning (NOT merge) is gated on the probe per the Rule-A caveat. Rotates `followup_aqib_api_key_auth_header_pending.md` from load-bearing to resolved.

---

## Day-54 annotation (append-only) — "sandbox is OAuth-only" was a Planner-side assumption, corrected by Love

> "Love's correction, 2026-06-11: SuiteFleet accepts BOTH auth methods on ALL tenants, sandbox included — 'sandbox is OAuth-only' was a Planner-side assumption, not a vendor limitation."

This memo's probe-gate section asserts "There is NO sandbox api_key path. The sandbox region (transcorpsb) is OAuth-only" and "a true probe needs a production-region api_key endpoint." Per the correction those statements described **Planner's own region seeding**, not SuiteFleet. Consequences (Day-53/54 night lane, `memory/decision_d53_night_sandbox_apikey_lane.md`):

- The header-shape probe AND the Q4 refresh-wire residual are provable on **sandbox** Client Credentials — production credentials and production-probe authorization are no longer prerequisites for closing them.
- The production provisioning gate itself is unchanged: the first production-region merchant still waits on the probe's empirical confirmation — the probe just gained a sandbox target (Demo Bistro, on Love's clearance).
- Original text above left intact per the append-only discipline.

---

## Day-53 annotation (append-only) — first wire observation: login REJECTED 401 (cause undetermined)

2026-06-11 10:30:56Z, the first-ever wire test of the §-verified header shape fired — Demo Bistro proof run, Planner's own resolver→Vault→`loginApiKey` chain, sandbox client `transcorpsb` (full evidence: `decision_d53_demo_bistro_apikey_wire_evidence.md`). **One** `POST /api/auth/authenticate` with `clientId`/`clientApiKey`/`clientSecretKey` headers → **HTTP 401, empty body**. Stopped per dispatch; no retry.

- The empty body cannot distinguish wrong header names/casing from a wrong/inactive key pair (pair was entered post-flip by Love; lengths 20/20; SF-side scoping unverifiable from Planner).
- **Q4 (refresh wire) remains OPEN** — no session was ever issued, the observation step never fired.
- The Rule-A production-provisioning gate stays CLOSED: this header shape is still wire-unconfirmed. Next step is Love's call (re-check/re-enter the SF pair, authorize a header-shape diagnostic probe, or rollback).

---

## Day-53 annotation (append-only) — header shape WIRE-VERIFIED; Q4 CLOSED on sandbox evidence

2026-06-11 ~11:29Z, Demo Bistro proof re-run after Love re-entered the pair (the earlier 401 was a wrong secret value on first entry — `secretKey_len` 20 → 40; full record in `decision_d53_demo_bistro_apikey_wire_evidence.md`):

- **The verified header shape (`clientId`/`clientApiKey`/`clientSecretKey` on POST `/api/auth/authenticate`) authenticated 200 on the real wire** — the probe-gate's empirical confirmation, obtained on sandbox per the Day-54 annotation above. An authenticated read on the same session also returned 200.
- **Q4 (api_key refresh wire) is CLOSED — ACCEPTED:** the OAuth-shaped refresh wire (GET `/api/auth/refresh`, refresh token via cookie) returned new tokens for an api_key session, observed twice. The token-cache's login-only renewal strategy for api_key is now a conservative choice rather than a necessity; revisiting it is a future cleared PR.
- **TTL observation:** returned expirations were ~3 years (access) / ~8 years (refresh), NOT the documented 30-day/180-day. Values recorded verbatim in the evidence memo.
- **Rule-A consequence:** the header-shape precondition on production provisioning is now met. Production provisioning still waits on Love's named go + production credential entry by Love/Aqib via the admin screen (standing park-flags unchanged).
