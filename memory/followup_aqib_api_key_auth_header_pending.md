# 🔴 LOAD-BEARING — Aqib SF API Key + Secret Key auth-header reply pending

**Filed:** Day-27 (15 May 2026), EOD — replaces `memory/followup_production_identity_schema_absent.md` as the active load-bearing lane followup. That prior memo was superseded by [PR #288](https://github.com/lovemansgit/planner/pull/288) and its lane (production schema reconciliation) closed Day-27 PM-late with the Vercel promote of `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F`.

**Severity:** Blocks production-region credential provisioning end-to-end. Does NOT block sandbox-region happy path (OAuth, live).

**Scope:** Narrow per v1.15 amendment. v1.14 had this as the blocker for the entire credentials code-PR; v1.15's dual-path SF auth ratification narrowed the blocker to the `loginApiKey` body only. OAuth path ships unblocked; api_key path stubs with `ConfigurationError` until Aqib's reply lands.

## What Aqib needs to confirm

Documented at `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md` §5.2. Four points:

1. **Endpoint path** — does `/api/auth/authenticate` stay for API Key auth, or is there an `/api/auth/api-key` variant?
2. **Header names + casing** — two industry-standard candidates documented in the plan amendment:
   - **(a)** `Clientid: <client_id>` + `X-Api-Key: <api_key>` + `X-Api-Secret: <secret_key>`
   - **(b)** `Authorization: Bearer <base64(api_key:secret_key)>` + `Clientid: <client_id>`
3. **Token semantics** — whether the tokens returned differ in shape / TTL from the OAuth flow's tokens.
4. **Refresh path** — whether a refresh-token path exists or every login is a fresh authenticate call.

## Current production state (as of Day-27 EOD)

- **Main HEAD:** `e49913e` (post-PR #293).
- **Production:** `https://planner-olive-sigma.vercel.app` served by `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F` (built from main `e49913e`, promoted Day-27 PM-late via rebuild-against-production-env path).
- **Schema state:** migration 0024 applied; `suitefleet_regions` seeded with 4 regions; 559 tenants backfilled to sandbox region; `users_set_updated_at` trigger restored; `webhook_events` and `audit_events` grants narrowed to `INSERT, SELECT` only.
- **`suitefleet_regions` row identities** (captured for the audit record + any future cross-reference):
  - `transcorpsb` → `11111111-1111-4111-a111-111111111111` (sandbox, OAuth, pinned UUID)
  - `transcorp` → `8c298b3f-5228-40d1-a336-7899e395be66` (KSA, api_key)
  - `transcorpqatar` → `521f51fc-dd0f-40f2-aa36-a9f1c5ac8694` (Qatar, api_key)
  - `transcorpuae` → `172207b2-a59b-4d00-b570-755ca0dde755` (UAE, api_key)
- **Sandbox-region credential provisioning:** OAuth path live via `loginOAuth`. `/admin/merchants/[id]/credentials` page renders correctly for sandbox-region tenants; live SET pending Aqib end-to-end review (smoke check 5).
- **Production-region credential provisioning:** page renders correctly. SUBMIT throws `ConfigurationError("API Key auth not yet enabled — pending vendor configuration")` (HTTP 503) per the lane stub at `src/modules/integration/providers/suitefleet/auth-client.ts`. Tenants on production regions can be CREATED and the page renders, but credentials cannot be persisted until this unblocks.

## Trigger for unblock

Aqib's reply arrives via Slack / email / SF OpsPortal documentation. Reply must answer the 4 points in §"What Aqib needs to confirm" above. Once that lands, the follow-on T2 PR is small (~1 hour).

## Follow-on T2 PR scope (when Aqib replies)

- **One function body.** `src/modules/integration/providers/suitefleet/auth-client.ts` → `loginApiKey()` currently throws `ConfigurationError`. Replace the stub with the confirmed request shape (endpoint + headers + body if any). Token response handling reuses the existing OAuth-token-cache path — that's an open question Aqib's point 3 settles.
- **One integration spec.** Assert the request-header shape against an HTTP mock per Aqib's confirmation.
- **Possible small adjustments** to the token-cache / refresh handling per Aqib's points 3-4.
- **Expected total scope:** ~1 hour. Single PR, T2 tier, single-session execution.

## What's blocked downstream

- **Production-region tenants** (`transcorp`, `transcorpuae`, `transcorpqatar`) can be CREATED on Planner.
- They CANNOT have credentials provisioned (SUBMIT throws `ConfigurationError`).
- They CANNOT push tasks to SuiteFleet via the production-region auth path.
- **Sandbox region (`transcorpsb`) remains fully functional** — OAuth path is unaffected by this gating dependency. Demo flow runs on sandbox.

## What's NOT blocked

- Schema-side reconciliation (complete Day-27).
- Day-26 + Day-27 code bundles on production (live as of Day-27 EOD).
- Sandbox-region end-to-end (OAuth, live; smoke check 5 pending Aqib end-to-end review on sandbox, but the path itself works).
- Day-28 demo (runs on sandbox).

## Demo-day positioning (Day-28, May 16)

The demo to acting Director of IT + COO runs on the sandbox-region happy path. Production-region credential provisioning is **not** part of the demo narrative — it's positioned as "ready and waiting on vendor confirmation, will go live within an hour of Aqib's reply." This is consistent with the v1.15 amendment's explicit narrowing of the blocker and the lane's "ship dual-path so OAuth is unblocked while api_key resolves" posture.

If Aqib's reply lands BEFORE the demo: the T2 follow-on PR can ship and the production-region path becomes live in the demo. If the reply lands AFTER: production-region path remains stubbed and the demo narrative is unchanged.

## Cross-references

- [`memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`](decision_brief_v1_15_amendment_dual_path_sf_auth.md) — brief amendment that introduced the dual-path posture and explicitly narrowed this blocker.
- [`memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`](plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md) §5.2 — the two candidate header shapes.
- [`memory/handoffs/day-27-eod.md`](handoffs/day-27-eod.md) §G + §M — production state at EOD + load-bearing rotation rationale.
- `src/modules/integration/providers/suitefleet/auth-client.ts` — the file with the `loginApiKey` stub (currently throws `ConfigurationError`); the only file the T2 follow-on PR needs to touch.

## Meta

This is the active load-bearing followup for the next external-dependency-gated production-completeness lane. The single-diagnostic-surprise discipline memo (PR #293) is institutional discipline, NOT rotated to load-bearing here. The 501-orphaned-tenants cleanup, the `webhook_events` policy narrowing, the defensive-depth RULEs, and the view-grant cleanup are all deferred to post-demo lanes per Day-27 §3.6 rulings + Day-27 D.1 reviewer ruling.

---

**End of load-bearing followup. Rotates as the next active substantive lane (T2 follow-on PR when Aqib replies) opens or closes.**
