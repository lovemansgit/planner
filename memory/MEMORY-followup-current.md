# Followup · Per-merchant SF credentials + multi-region resolver + dual-path auth

**Status:** Active load-bearing. Rotated in Day-25 EOD from the previous
load-bearing followup (Team Management UI) which shipped end-to-end
Day 24 via PRs #259 + #260.
**Owner:** Session A T3 lane (next substantive code-PR).
**Source:** Brief v1.14 amendment
([`memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`](decision_brief_v1_14_amendment_per_merchant_sf_credentials.md))
+ v1.15 amendment
([`memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`](decision_brief_v1_15_amendment_dual_path_sf_auth.md))
+ approved plan PR #274 ([`memory/plans/day-25-per-merchant-sf-credentials.md`](plans/day-25-per-merchant-sf-credentials.md))
+ dual-auth overlay PR #276 ([`memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`](plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md)).
**Original decision:** Plans + brief amendments on main HEAD `6c637f4`
as of Day-25 EOD; code-PR is the next substantive lane and has not
opened yet.

## Gap (current state)

The v1.7 SF identifier model (region `client_id` env-backed,
per-merchant `customerId` DB-backed, AWB-prefix cosmetic) is in
production today. Two architectural gaps the v1.14 + v1.15 amendments
close:

- **Region `client_id` is env-backed.** Adding a new region (KSA, UAE,
  Qatar) today requires a Vercel env-var landing + a redeploy.
  v1.14's `suitefleet_regions` table + Vault-stored region secrets
  flip this to DB-backed: add a new region by inserting a row + a
  credential-provisioning admin action; no redeploy.
- **Single auth path at the region level.** Today every region uses
  the same OAuth username/password flow against
  `api.suitefleet.com/api/auth/oauth/token`. SF OpsPortal-provisioned
  production regions use API Key + Secret Key headers instead. v1.15's
  `auth_method` enum on `suitefleet_regions` (IMMUTABLE post-create)
  branches the auth flow per region. Sandbox stays OAuth; KSA / UAE /
  Qatar regions seed as `api_key`.

Together: per-merchant `customerId` already DB-backed (Day-18 PR #187);
this lane finishes the model by moving region credentials to DB +
opening the second auth path.

## Blockers

### 1. Aqib SF API Key + Secret Key auth-header reply (BLOCKER — narrowed scope)

Aqib (SuiteFleet vendor contact) has been asked for the exact request
headers SF uses to authenticate API Key + Secret Key per merchant.
Industry-standard candidates:

- `Clientid: <client_id>` + `X-Api-Key: <api_key>` + `X-Api-Secret: <secret_key>`
- `Authorization: Bearer <base64(api_key:secret_key)>` + `Clientid: <client_id>`

**Scope narrowed per v1.15.** Before v1.15 this blocked the entire
code-PR. v1.15 narrows the blocker to the `loginApiKey` body only:

- **OAuth code path ships in the code-PR.** Sandbox keeps working
  via `loginOAuth` with the existing username/password flow.
- **API Key code path is stubbed at code-PR open** with
  `ConfigurationError("API Key auth not yet enabled — pending vendor configuration")`.
  Tenants on `api_key` regions can be created + credentialed, but
  their pushes fail closed at runtime until Aqib's reply lands.
- **Follow-on T2 PR** lands the `loginApiKey` body + one integration
  spec when Aqib confirms.

### 2. Vault availability verification on production DB (pre-merge gate)

The code-PR's pre-merge gate requires confirming `supabase_vault`
extension is enabled on production via Supabase SQL editor:

```sql
SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';
```

Supabase enables Vault by default on hosted projects, so this is
almost certainly already true. The verification is the precondition
check per plan §3.1; landing the code-PR without it means migration
0024 may fail-closed if the extension is unexpectedly disabled.

## Success criteria

- **Migration 0024 applied to production** — `suitefleet_regions`
  table created with `auth_method` enum + `tenants` column additions
  (`region_id` + `suitefleet_credential_1_vault_id` /
  `_2_vault_id`).
- **4 regions seeded** — `transcorpsb` (sandbox, auth_method=oauth),
  `transcorp` (KSA, auth_method=api_key), `transcorpuae` (UAE,
  auth_method=api_key), `transcorpqatar` (Qatar, auth_method=api_key).
- **Backfill verified on production** — existing 4 tenants (MPL,
  DNR, FBU, Demo Bistro) all point at `transcorpsb` region with
  their existing credentials migrated into Vault.
- **Sandbox push works via OAuth path** — existing cron behaviour
  preserved end-to-end; no production-impact regression vs v1.7
  baseline.
- **`api_key` path stubbed cleanly** with `ConfigurationError("API Key auth not yet enabled — pending vendor configuration")`.
- **Vercel env-var retirement T1 follow-on PR filed + merged** —
  `SUITEFLEET_SANDBOX_USERNAME` / `PASSWORD` / `CLIENT_ID` retired
  from Production + Preview scopes (dead config post-cutover).
- **8 integration specs land at code-PR open** — 6 from v1.14 plan
  + 2 from v1.15 amendment (auth_method immutability +
  discriminated-union resolver).

## Carry-forward (post-pilot)

- **AWS Secrets Manager migration.** Vault → AWS Secrets ARN swap
  for region credentials. Plan §11 deferral; triggered when
  production traffic warrants the additional vendor surface.
- **Credential rotation UX.** Today the admin UI ships
  `/admin/merchants/[id]/credentials` as write-only (set / replace
  but no in-place rotation flow). Post-pilot UX hardening adds an
  explicit rotation workflow with audit trail.
