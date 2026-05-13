---
name: Brief v1.14 amendment — per-merchant SF credentials + multi-region client_id resolver
description: Day-25 PM amendment. Deepens §3.6 three-layer SF identifier model to four layers (region + merchant + api_key + secret_key). Adds suitefleet_regions table, per-tenant Vault-backed credential storage, write-only credentials UI, region admin UI, region:manage permission, four audit events, and new §3.7 security posture section. Phase 2 (§4) AWS Secrets Manager row reshaped from "regional credentials" to "Vault → AWS Secrets ARN swap".
type: project
---

## Driver

Production cutover requires per-merchant SuiteFleet isolation. The v1.7 model (region-scoped `client_id` env-backed + per-merchant `customerId` DB-backed) cannot reach production because all merchants in a region share one SF account credential — `transcorpsb` sandbox is the path that bypasses this. `followup_secrets_manager_swap_critical_path.md` flagged this as the production blocker on Day-10.

Aqib confirmed the SF auth path going forward is API Key + Secret Key (generated per merchant via SF OpsPortal), NOT the OAuth username/password flow currently in `src/modules/credentials/suitefleet-resolver.ts`. This collapses the "Secrets Manager swap" + "per-merchant isolation" + "OAuth → API Key migration" into a single coordinated lane.

## Architectural changes

### Identifier model deepens to four layers (replaces §3.6 three-layer table)

| Layer | Identifier | Storage | Scope |
|---|---|---|---|
| Region | `client_id` (e.g. `transcorpuae`) | `suitefleet_regions.client_id` (DB-backed; was env-backed) | Per region |
| Merchant | `customerId` (numeric, e.g. 588) | `tenants.suitefleet_customer_code` (unchanged) | Per merchant within region |
| Auth — API Key | `api_key` (opaque token from SF OpsPortal) | Supabase Vault, referenced via `tenants.suitefleet_api_key_vault_id` | Per merchant |
| Auth — Secret Key | `secret_key` (opaque secret from SF OpsPortal) | Supabase Vault, referenced via `tenants.suitefleet_secret_vault_id` | Per merchant |
| AWB prefix | `customer.code` (alphanumeric) | unchanged | Cosmetic |

Region `client_id` moves from env-backed to DB-backed because adding regions becomes a normal operator-facing flow (region admin UI), not a deploy. Env-var configuration retires for SF credentials entirely.

### Resolver rewrite

`resolveSuitefleetCredentials(ctx, tenantId)` returns `{ clientId, customerId, apiKey, secretKey }`:
- `clientId` ← JOIN through `suitefleet_regions` on `tenants.suitefleet_region_id`
- `customerId` ← `tenants.suitefleet_customer_code`
- `apiKey`, `secretKey` ← `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id IN (...)` keyed off `tenants.suitefleet_*_vault_id`
- Fail-closed: throws `ValidationError("credentials not configured")` if either Vault column is NULL or the JOIN target region is `inactive`

OAuth username/password resolution (current behaviour) is removed entirely. No fallback path. Existing env vars `SUITEFLEET_SANDBOX_USERNAME` / `PASSWORD` / `CLIENT_ID` retire post-deploy.

### Vault as storage primitive

Supabase Vault is the at-rest encryption layer (pgsodium-backed AEAD). Service-layer functions wrap `vault.create_secret` (initial set) + `vault.update_secret` (rotation) + `vault.decrypted_secrets` view (read). Plaintext never stored in `tenants` row, never logged, never returned from any function except the resolver's authenticated call path. The token cache (`src/modules/integration/providers/suitefleet/token-cache.ts`) already wraps the auth call so credential resolution only fires on cache miss/refresh — Vault read cost is bounded.

## §3.1.1 schema additions

```sql
-- New table
CREATE TABLE suitefleet_regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'inactive')),
  CHECK (client_id ~ '^[a-z][a-z0-9]*$')
);

-- tenants additions
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT,
  ADD COLUMN suitefleet_api_key_vault_id uuid,
  ADD COLUMN suitefleet_secret_vault_id uuid;
```

Seed regions: `transcorpsb`, `transcorp`, `transcorpuae`, `transcorpqatar` (all `active`). Backfill existing tenants (MPL, DNR, FBU, Demo Bistro) to `transcorpsb`. After backfill: `ALTER COLUMN suitefleet_region_id SET NOT NULL`.

`ON DELETE RESTRICT` per Day-22 pattern memory — `SET NULL` would silently break the NOT NULL CHECK at runtime. Region deletion is blocked while tenants reference it; the operator-facing flow is deactivate, not delete.

## §3.1.2 new audit events

- `region.created` — `{ region_id, client_id, display_name }`
- `region.updated` — `{ region_id, changes: { <field>: { before, after } } }`
- `region.deactivated` — `{ region_id }`
- `credentials.set` — `{ tenant_id, classifier: 'initial-set' | 'rotation' }` — NO plaintext, NO Vault IDs in payload

## §3.1.3 new permission

- `region:manage` — Transcorp-sysadmin only; covers region create / update / deactivate. Added to `API_KEY_FORBIDDEN_PERMISSIONS` (matches `merchant:create` / `merchant:update` precedent for privilege-escalation guarding). The existing `merchant:update` permission (v1.12) extends to cover `storeSuitefleetCredentials` — same operator scope as `updateMerchant`; both are SF routing config.

## §3.1.4 new service methods

- `createRegion(ctx, { client_id, display_name })`
- `updateRegion(ctx, regionId, params)`
- `deactivateRegion(ctx, regionId)`
- `storeSuitefleetCredentials(ctx, tenantId, { apiKey, secretKey })` — gated on `merchant:update`. Initial-set vs rotation determined by whether existing Vault IDs are null. Emits `credentials.set` with classifier. Plaintext never returned, never logged, never echoed back to UI.
- `resolveSuitefleetCredentials(ctx, tenantId)` — see §3.6 rewrite below. Replaces current env-backed resolver.

## §3.2.1 new admin routes

- `/admin/regions` — list view (Display Name / Client ID / Status / In-Use Count / Created / row-actions)
- `/admin/regions/new` — create form
- `/admin/regions/[id]` — read-only detail + deactivate action
- `/admin/merchants/[id]/credentials` — write-only credentials surface. SET CREDENTIALS / ROTATE CREDENTIALS button label depends on state. Rotation gated on confirmation modal warning about SF-side invalidation. Page never displays existing values. Coordinates with PR #271 merchant detail page: detail page renders "Credentials configured" / "Credentials missing" badge with MANAGE CREDENTIALS CTA.

## §3.6 rewrite (four-layer identifier model)

§3.6 expanded from three layers to four. Resolver section rewritten to describe the Vault-backed read path. Demo Q&A rehearsal updated for production-grade posture ("each merchant has its own SF API Key + Secret Key, isolated at the database via Supabase Vault; sandbox merchants share a region, production merchants do not share credentials"). Phase 2 row reshaped — "Regional credential expansion" stays as a Phase 2 row (adding new region rows via admin UI is in scope for v1.14, but onboarding the actual regions is post-pilot operational work).

## §3.7 NEW — Security posture: credential storage

§3.7 introduces the at-rest credential encryption architecture:

- Supabase Vault (pgsodium AEAD) is the storage primitive for SF API Key + Secret Key
- `vault.create_secret(plaintext)` returns a UUID; the UUID is what `tenants` row stores
- Reads via `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $vault_id` — restricted by Supabase RLS to service-role
- Plaintext never logged, never cached past the token-cache scope, never returned from any service function outside the authenticated SF call path
- Rotation invalidates the in-memory token cache for that tenant; next push triggers a fresh `login()` against SF
- Future migration to AWS Secrets Manager swaps the Vault UUID storage for a Secrets Manager ARN — same column shape, different resolver — see §4

## §4 Phase 2 updates

- **"AWS Secrets Manager swap (regional credentials)"** row reshaped: now reads "AWS Secrets Manager swap — Vault UUID → Secrets Manager ARN, per-merchant scope" (the "regional credentials" framing retires because regions no longer hold credentials; merchants hold credentials).
- **"Integrations page (SF credential entry/test in merchant portal)"** row deleted: the per-merchant credentials surface now lands MVP via `/admin/merchants/[id]/credentials` (Transcorp-staff scope). A merchant-portal-facing version would be Phase 2 if ever needed, but the current operator model is Transcorp-managed credential provisioning.
- **"Credential rotation UX"** row deleted: rotation lands MVP via the same `/admin/merchants/[id]/credentials` surface.
- **"Adding new regions via tenant-admin UI"** new Phase 2 row: current scope is Transcorp-sysadmin only; merchant-side region selection is post-pilot if ever needed.

## §9 amendment log entry

```
| v1.14 | 13 May 2026 (Day 25 PM) | **Per-merchant SF credentials + multi-region client_id resolver.** §3.6 identifier model deepens from three layers to four (region + merchant + api_key + secret_key). New `suitefleet_regions` table (seeded sandbox + transcorp / transcorpuae / transcorpqatar); `tenants` gains `suitefleet_region_id` (NOT NULL post-backfill) + two nullable Vault FK columns. Supabase Vault (pgsodium AEAD) is the at-rest encryption layer. New `region:manage` permission (Transcorp-sysadmin only); existing `merchant:update` extends to credentials write. Four new audit events: `region.created` / `region.updated` / `region.deactivated` / `credentials.set` (no plaintext in payload). New admin routes: `/admin/regions` list/new/[id] + `/admin/merchants/[id]/credentials` write-only surface (display of existing values intentionally absent). New §3.7 documents Vault-backed credential storage posture. §4 Phase 2 row reshape — "AWS Secrets Manager swap" now means Vault UUID → Secrets Manager ARN; "Integrations page" and "Credential rotation UX" rows retire (now MVP). OAuth username/password resolution removed entirely; auth migrates to API Key + Secret Key per SF OpsPortal. Filed at `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`. Companion: T3 plan-PR (forthcoming).
```

## Open dependency — Aqib auth header pattern

Code-PR for the plan-PR derived from this amendment is blocked on Aqib's confirmation of SF's exact request headers for API Key + Secret Key auth. Industry-standard candidates:
- `Clientid: <client_id>` + `X-Api-Key: <api_key>` + `X-Api-Secret: <secret_key>`
- OR `Authorization: Bearer <base64(api_key:secret_key)>`

Plan-PR §9 carries this as a flagged open dependency. Code-PR does NOT open until Aqib's reply lands.

## Cross-references

- T3 plan-PR (forthcoming, Day-25 PM)
- `memory/followup_t3_plan_code_branch_sequencing.md` — plan-PR §0 selects Option A (fork code off main, cherry-pick plan deltas) since this lane has small plan deltas
- `memory/followup_secrets_manager_swap_critical_path.md` — superseded scope from Day-10; v1.14 lands the structural reshape this followup was the placeholder for
- `memory/followup_credential_resolver_type_narrowing.md` — `as string` casts on three env reads retire automatically because the resolver no longer reads env
- `memory/decision_brief_v1_7_amendment_sf_identifier_model.md` — the v1.7 three-layer model that v1.14 extends

## Backwards-compatibility / retired surfaces

- `SUITEFLEET_SANDBOX_USERNAME` / `PASSWORD` / `CLIENT_ID` env vars retire after code-PR deploys and existing tenants are credentialed via the new UI. Vercel env removal is a follow-on T1.
- `suitefleet-resolver.ts` keeps its export name + tenant-id signature; return shape changes (replaces `{ username, password, clientId, customerId }` with `{ clientId, customerId, apiKey, secretKey }`). All callers update in the same code-PR.
- OAuth `login()` call in `auth-client.ts` rewires to the API Key + Secret Key header pattern (exact shape pending Aqib reply).
