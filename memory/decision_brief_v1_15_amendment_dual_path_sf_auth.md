---
name: Brief v1.15 amendment — dual-path SF auth at region level
description: Day-25 PM amendment, post v1.14 merge. Overrides v1.14 OQ-10 ruling (single OAuth-path retirement) with dual-path support — `auth_method` enum on `suitefleet_regions` selects per-region auth flavor. Sandbox stays on OAuth username/password; production regions target API Key + Secret Key. Tenant Vault columns generalised to credential_1 + credential_2 with semantic interpretation by region.auth_method.
type: project
---

## Driver

Post-merge of v1.14 (PR #273 + #274) + Love's product review of SF OpsPortal credentials CSV revealed that the production regions are being provisioned with API Key + Secret Key per OpsPortal, but the existing sandbox region (`transcorpsb`) cannot migrate cleanly — its credentials remain OAuth username/password and have been working stably since Day-4. Retiring the OAuth path entirely (v1.14 OQ-10) would force a sandbox re-auth event without engineering benefit; preserving both paths at region level is the right cutover discipline.

This amendment lands BEFORE the code-PR opens. No code on main has been written against the v1.14 single-path scope yet.

## Architectural change vs v1.14

### Region-level auth_method enum

`suitefleet_regions` gains a non-nullable `auth_method` column:

```sql
ALTER TABLE suitefleet_regions
  ADD COLUMN auth_method text NOT NULL DEFAULT 'api_key',
  ADD CONSTRAINT suitefleet_regions_auth_method_check
    CHECK (auth_method IN ('oauth', 'api_key'));
```

Seed migration (the migration that created the regions table) updates to assign per-region:

```sql
INSERT INTO suitefleet_regions (client_id, display_name, status, auth_method) VALUES
  ('transcorpsb',    'Sandbox',          'active', 'oauth'),
  ('transcorp',      'Transcorp KSA',    'active', 'api_key'),
  ('transcorpuae',   'Transcorp UAE',    'active', 'api_key'),
  ('transcorpqatar', 'Transcorp Qatar',  'active', 'api_key');
```

`auth_method` is IMMUTABLE after region creation. Changing the auth method of a live region is a destructive operation requiring credential re-provisioning of every tenant pointing at it — out of scope; future enhancement is a `migrateRegionAuthMethod` flow with operator-driven re-credentialing.

### Tenant credential columns renamed to generic credential_1 / credential_2

The v1.14 names (`suitefleet_api_key_vault_id`, `suitefleet_secret_vault_id`) imply API Key semantics. With OAuth on the menu, the columns now hold either `{ username, password }` or `{ api_key, secret_key }` depending on region.auth_method. Rename to:

```sql
ALTER TABLE tenants
  ADD COLUMN suitefleet_credential_1_vault_id uuid,   -- semantics per region.auth_method
  ADD COLUMN suitefleet_credential_2_vault_id uuid;   -- semantics per region.auth_method
```

Semantic interpretation (documented in migration comment + brief §3.7):

| region.auth_method | suitefleet_credential_1_vault_id holds | suitefleet_credential_2_vault_id holds |
|---|---|---|
| `'oauth'` | OAuth username | OAuth password |
| `'api_key'` | API Key | Secret Key |

### Resolver returns discriminated union

`resolveSuitefleetCredentials(ctx, tenantId)` returns one of:

```typescript
type SuitefleetCredentials =
  | { auth_method: 'oauth';   clientId: string; customerId: number; username: string; password: string }
  | { auth_method: 'api_key'; clientId: string; customerId: number; apiKey: string;   secretKey: string };
```

The auth-client's `login()` branches on `auth_method`:
- `'oauth'` path: existing `POST /api/auth/authenticate` with username/password (unchanged from current code; sandbox keeps working).
- `'api_key'` path: Aqib-confirmed header pattern (still pending; this code path remains blocked on Aqib's reply).

## §3.1.1 schema diff vs v1.14

```sql
-- v1.14 (pre-amendment)
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id        uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT,
  ADD COLUMN suitefleet_api_key_vault_id uuid,
  ADD COLUMN suitefleet_secret_vault_id  uuid;

-- v1.15 (this amendment)
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id              uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT,
  ADD COLUMN suitefleet_credential_1_vault_id  uuid,
  ADD COLUMN suitefleet_credential_2_vault_id  uuid;

ALTER TABLE suitefleet_regions
  ADD COLUMN auth_method text NOT NULL DEFAULT 'api_key';

ALTER TABLE suitefleet_regions
  ADD CONSTRAINT suitefleet_regions_auth_method_check
    CHECK (auth_method IN ('oauth', 'api_key'));
```

The migration ordering is: create regions table → add auth_method (with `DEFAULT 'api_key'` so the column NOT NULL is satisfiable before seed) → seed regions with explicit per-row auth_method override → add tenants columns → backfill region_id to sandbox.

## §3.6 — auth method varies by region (clarification)

§3.6 four-layer identifier model preserves the layer structure but the "Auth — Credential 1" and "Auth — Credential 2" rows become semantically conditioned on the region's `auth_method`. New row added to the table:

| Layer | Identifier | Storage | Scope |
|---|---|---|---|
| Region | `client_id` | `suitefleet_regions.client_id` | Per region |
| Region auth method | `auth_method` (enum: `'oauth'` \| `'api_key'`) | `suitefleet_regions.auth_method` | Per region; IMMUTABLE after creation (v1.15) |
| Merchant | `customerId` (numeric) | `tenants.suitefleet_customer_code` | Per merchant |
| Auth — Credential 1 | OAuth username OR API Key per region.auth_method | `tenants.suitefleet_credential_1_vault_id` | Per merchant; never shared, never logged |
| Auth — Credential 2 | OAuth password OR API Key Secret per region.auth_method | `tenants.suitefleet_credential_2_vault_id` | Per merchant; never shared, never logged |
| AWB prefix | `customer.code` | (SF-managed) | Cosmetic |

## §3.7 security posture — credential semantics per auth_method

§3.7 (introduced in v1.14 as Supabase Vault posture) extends with the semantic interpretation block:

> The Vault columns store opaque secrets; their semantic interpretation depends on the parent region's `auth_method`. For an `oauth` region, `credential_1` is the OAuth username (a non-secret identifier, but stored in Vault for storage uniformity) and `credential_2` is the OAuth password. For an `api_key` region, `credential_1` is the API Key and `credential_2` is the Secret Key. The resolver enforces this mapping; the UI labels its form fields accordingly (Username/Password for OAuth regions; API Key/Secret Key for API Key regions). Operators do not type "credential_1" / "credential_2" anywhere — the abstraction lives only in the persistence layer.

## §4 Phase 2 reshape

AWS Secrets Manager swap row UNCHANGED in terms of target (Vault UUID → Secrets Manager ARN). The `auth_method` enum is orthogonal to the at-rest storage primitive — both OAuth and API Key credentials live in Vault today; both would migrate to Secrets Manager ARNs in the same Phase 2 swap. The Secrets Manager resolver implementation also branches on `auth_method`; the swap is transparent to the brief-level scope.

## §9 amendment log entry

```
| v1.15 | 13 May 2026 (Day 25 PM, post v1.14 merge) | **Dual-path SF auth at region level.** Overrides v1.14 OQ-10 "clean OAuth cutover" ruling. `suitefleet_regions` gains a NOT NULL `auth_method` enum column (`'oauth'` \| `'api_key'`) with seed assignments: `transcorpsb` → `oauth` (preserves working sandbox path); `transcorp` / `transcorpuae` / `transcorpqatar` → `api_key` (production regions targeting SF OpsPortal credentials). `auth_method` is IMMUTABLE after region creation. Tenant Vault columns renamed from `suitefleet_api_key_vault_id` / `_secret_vault_id` to `suitefleet_credential_1_vault_id` / `_2_vault_id` with semantic interpretation by region.auth_method (OAuth: username/password; API Key: api_key/secret_key). Resolver returns a discriminated union `{ auth_method: 'oauth', username, password, clientId } | { auth_method: 'api_key', apiKey, secretKey, clientId }`. SF auth-client `login()` branches on the discriminator. Sandbox OAuth path ships independently of Aqib's API Key header confirmation; the `api_key` code path remains blocked on Aqib's reply. UI: `/admin/regions/new` adds an auth_method radio (immutable post-create); `/admin/merchants/[id]/credentials` form-field labels branch on the region's auth_method. Phase 2 AWS Secrets Manager swap is orthogonal — the auth_method enum carries through the swap. Filed at `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`. Companion plan amendment: `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md` (forthcoming T3 plan-PR). |
```

## Provenance

- Driver: Love product call after SF OpsPortal credentials CSV review, Day-25 PM post-merge of PR #273 + #274.
- Override of v1.14 OQ-10 ruling: "REPLACE → DUAL-PATH SUPPORT" (clean cutover retracted; dual-path retained at region level).
- v1.14 brief amendment: `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md` (in force; this amendment extends, does not replace).
- v1.14 plan: `memory/plans/day-25-per-merchant-sf-credentials.md` (in force; companion plan amendment overlays).

## Out of scope

- Migration tool for region auth_method change (`migrateRegionAuthMethod`) — future enhancement when a production region needs to migrate from OAuth to API Key or vice versa. Requires bulk credential re-provisioning; not needed today.
- `customer.code` cosmetic field handling — unchanged from v1.14.
- AWS Secrets Manager swap — unchanged from v1.14 Phase 2 scope.
- Audit events — `credentials.set` event payload unchanged; classifier semantics carry forward (no new events).

## Cross-references

- T3 plan amendment (PR-B, forthcoming): `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`
- v1.14 brief amendment (predecessor): `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`
- T3 sequencing memo (Option A holds for amendment PRs too): `memory/followup_t3_plan_code_branch_sequencing.md`
- §3.6 review-discipline + CI gate: `memory/decision_review_discipline_ci_gate.md`
