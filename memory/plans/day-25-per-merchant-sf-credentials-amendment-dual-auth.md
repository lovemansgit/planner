# Day-25 PM T3 plan AMENDMENT — Dual-path SF auth at region level

**Tier:** T3 (schema + auth + audit + UI — hard-stop at plan-amendment PR open + code-PR open).
**Brief dependency:** brief v1.15 amendment (PR #275 — docs-only T1). Plan amendment does NOT merge until v1.15 is on main.
**Predecessor plan (in force):** `memory/plans/day-25-per-merchant-sf-credentials.md` (PR #274, merged). This amendment overlays — read both together.
**Branch sequencing posture:** **Option A** per `memory/followup_t3_plan_code_branch_sequencing.md` — both amendment PRs forked off main; code-PR will fork off main once both merge.

---

## §0 Premise + dependencies

### §0.1 What this amendment does

Overrides three things from the v1.14 plan (PR #274):

1. **OQ-10 reversed.** v1.14 plan §13 OQ-10 ruled "replace — clean OAuth-path cutover, no feature flag". v1.15 rules **dual-path support with auth flavor selected at region level**. OAuth path is preserved for sandbox; API Key path lands for production regions.
2. **Schema reshape.** `suitefleet_regions` gains a non-nullable `auth_method` enum column. `tenants` credential columns renamed from `suitefleet_api_key_vault_id` / `_secret_vault_id` to generic `suitefleet_credential_1_vault_id` / `_2_vault_id` (semantics interpreted by `region.auth_method`).
3. **Resolver shape.** v1.14 plan §4.1 had the resolver return `{ clientId, customerId, apiKey, secretKey }`. v1.15 returns a discriminated union typed by `auth_method`.

### §0.2 What this amendment preserves from the v1.14 plan

- All §1 scope boundaries except as updated below
- All §2 schema additions other than the credential column names (table, region FK, RESTRICT semantics, backfill posture unchanged)
- All §3 Supabase Vault integration model — Vault is still the at-rest primitive; rotation semantics unchanged; plaintext-handling rules unchanged
- All §6 permission model (`region:manage`, `merchant:update` extension)
- All §9 audit events — `credentials.set` payload unchanged (still `{ tenant_id, classifier }` only; `auth_method` recoverable forensically via `tenant_id → region_id`); shape-divergence discipline note in `metadataNotes` carries forward
- All §10 integration spec coverage approach (canonical teardown skeleton)
- All ratified OQ rulings except OQ-10

### §0.3 Brief amendment dependency

Brief v1.15 PR #275 is the docs-only T1 amendment for this lane. Plan amendment can §3.6 round 1 in parallel. Plan amendment merge waits on v1.15 being on main.

### §0.4 Aqib auth-header dependency — narrowed to api_key path only

v1.14 plan §5 carried Aqib's reply as a blocker for the entire code-PR. **v1.15 narrows the blocker to the api_key code path only.** The OAuth code path ships independently because the existing `POST /api/auth/authenticate` flow is well-understood and already in production for sandbox. The code-PR opens and merges with the OAuth path live; api_key callers fall back to `ValidationError('credentials not configured')` until per-region `api_key` tenants are credentialed (which can't happen until Aqib's reply lands).

### §0.5 Sequencing relative to PR #274 (merged v1.14 plan)

PR #274 is on main; the plan markdown at `memory/plans/day-25-per-merchant-sf-credentials.md` is the in-force plan with locked OQ rulings. This amendment overlays as a sibling doc at `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`. Code-PR description (forthcoming) references BOTH plan docs in §3.6 round-2 hard-stop checklist.

---

## §1 Scope changes vs v1.14 plan §1

### §1.1 In scope — additions

- `suitefleet_regions.auth_method` column (NOT NULL, CHECK in `('oauth', 'api_key')`)
- Seed migration assigns `oauth` to sandbox + `api_key` to the three production regions
- `tenants` credential columns renamed to generic (v1.14's `_api_key_vault_id` / `_secret_vault_id` never shipped — this amendment changes the planned migration content before code-PR opens)
- `createRegion` service gains an `auth_method` parameter (mandatory at creation; IMMUTABLE thereafter)
- `updateRegion` service rejects any `auth_method` mutation (Zod schema omits the field; if supplied returns `ValidationError`)
- Resolver returns the discriminated union per §4 below
- Auth-client `login()` branches on the discriminator (§5 below)
- `/admin/regions/new` form adds an auth_method radio (`OAuth` / `API Key`); list view + detail view show the column
- `/admin/merchants/[id]/credentials` form-field labels branch on the merchant's region's `auth_method`

### §1.2 In scope — removals

- The v1.14 plan §13 OQ-10 ruling "replace — clean OAuth cutover" is RETIRED. No code path retirement; both flavors live.

### §1.3 Out of scope (preserved + extended)

- `migrateRegionAuthMethod` (operator-driven re-credentialing flow when a region's auth method changes) — future enhancement; not in v1.15. The IMMUTABLE constraint enforces this.
- Mixed-auth-method regions (a region with merchants on different auth methods) — explicitly NOT supported; one region = one auth method.
- Per-tenant auth-method override — explicitly NOT supported; auth method is region-scoped not merchant-scoped.

---

## §2 Schema changes (replaces v1.14 plan §2)

### §2.1 `suitefleet_regions` table — final shape

```sql
CREATE TABLE suitefleet_regions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  auth_method  text NOT NULL,                    -- v1.15 amendment
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'inactive')),
  CHECK (client_id ~ '^[a-z][a-z0-9]*$'),
  CHECK (auth_method IN ('oauth', 'api_key'))   -- v1.15 amendment
);

CREATE INDEX idx_suitefleet_regions_status ON suitefleet_regions (status);
```

No `DEFAULT` for `auth_method` — every region creation must explicitly select. Defaulting would silently classify and obscure the operator decision.

### §2.2 Seed migration (replaces v1.14 plan §2.2)

```sql
INSERT INTO suitefleet_regions (client_id, display_name, status, auth_method) VALUES
  ('transcorpsb',    'Sandbox',          'active', 'oauth'),    -- preserves working sandbox path
  ('transcorp',      'Transcorp KSA',    'active', 'api_key'),  -- per SF OpsPortal CSV
  ('transcorpuae',   'Transcorp UAE',    'active', 'api_key'),  -- per SF OpsPortal CSV
  ('transcorpqatar', 'Transcorp Qatar',  'active', 'api_key');  -- per SF OpsPortal CSV
```

### §2.3 `tenants` column additions — final shape

```sql
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id              uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT,
  ADD COLUMN suitefleet_credential_1_vault_id  uuid,    -- semantics per region.auth_method
  ADD COLUMN suitefleet_credential_2_vault_id  uuid;    -- semantics per region.auth_method

-- Backfill (unchanged from v1.14 plan)
UPDATE tenants
SET    suitefleet_region_id = (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb')
WHERE  suitefleet_region_id IS NULL;

ALTER TABLE tenants ALTER COLUMN suitefleet_region_id SET NOT NULL;
```

### §2.4 Migration comment block (OQ-9 from v1.14 plan, expanded)

Top-of-file comment on `0024_*.sql` per OQ-9 ratification, expanded for v1.15:

```sql
-- Migration 0024: per-merchant SuiteFleet credentials + multi-region auth
--
-- Brief: PLANNER_PRODUCT_BRIEF.md §3.6 + §3.7 (v1.14 + v1.15 amendments)
-- Plans: memory/plans/day-25-per-merchant-sf-credentials.md (in force)
--        memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md (v1.15 overlay)
--
-- Four-layer SF identifier model + region-level auth_method:
--   1. region.client_id     (DB, e.g. transcorpsb)
--   2. region.auth_method   (DB, 'oauth' | 'api_key' — IMMUTABLE post-create)
--   3. tenant.customer_code (DB, numeric merchant id)
--   4. credential_1 / credential_2 (Supabase Vault — semantics by region.auth_method)
--
-- Vault columns hold:
--   region.auth_method='oauth'   → credential_1=username,   credential_2=password
--   region.auth_method='api_key' → credential_1=api_key,    credential_2=secret_key
--
-- Operators never see "credential_N" — UI labels branch on region.auth_method.
-- Resolver returns a discriminated union typed by auth_method.
```

---

## §3 Supabase Vault integration (delta vs v1.14 plan §3)

### §3.1 Vault availability verification

Unchanged.

### §3.2 Service-layer wrapper (`src/modules/credentials/vault-store.ts`)

Unchanged — same generic `createVaultSecret` / `updateVaultSecret` / `readVaultSecret` interface. The semantic interpretation lives in the caller (resolver + credentials service), not the Vault wrapper.

### §3.3 Plaintext handling rules

Unchanged — all four rules carry forward verbatim. Additional rule:

- **Plaintext never crosses the auth-method boundary.** A merchant's credentials cannot be re-used against a different `auth_method`. If a region's `auth_method` changes (out of scope today; future `migrateRegionAuthMethod`), every tenant under that region must re-provision.

### §3.4 Rotation semantics

Unchanged. `storeSuitefleetCredentials` writes both credential columns regardless of `auth_method` — the only semantic change is which form fields populate them.

---

## §4 Auth resolver rewrite (replaces v1.14 plan §4)

### §4.1 New resolver shape — discriminated union

```typescript
export type SuitefleetCredentials =
  | { auth_method: 'oauth';   clientId: string; customerId: number; username: string; password: string }
  | { auth_method: 'api_key'; clientId: string; customerId: number; apiKey: string;   secretKey: string };

export async function resolveSuitefleetCredentials(
  ctx: Ctx,
  tenantId: Uuid
): Promise<SuitefleetCredentials>;
```

Read path (inside `withServiceRole`):
1. SELECT `t.suitefleet_customer_code`, `t.suitefleet_credential_1_vault_id`, `t.suitefleet_credential_2_vault_id`, `r.client_id`, `r.status`, `r.auth_method` FROM `tenants` t JOIN `suitefleet_regions` r ON t.suitefleet_region_id = r.id WHERE t.id = $1.
2. Fail-closed cases unchanged (NULL vault uuids, inactive region, missing customer_code).
3. Read both Vault secrets.
4. Construct discriminated union — switch on `r.auth_method`:
   - `'oauth'` → `{ auth_method: 'oauth', clientId, customerId, username: cred1, password: cred2 }`
   - `'api_key'` → `{ auth_method: 'api_key', clientId, customerId, apiKey: cred1, secretKey: cred2 }`
5. Return.

### §4.2 Fail-closed verification path

Unchanged.

### §4.3 OAuth removal — RETIRED

This sub-section from the v1.14 plan is RETIRED. OAuth path stays. Callers handle BOTH discriminator branches (compiler enforces via exhaustive switch).

### §4.4 Token cache invalidation interface

Unchanged.

---

## §5 SF auth-client `login()` rewire (replaces v1.14 plan §5)

### §5.1 Current shape

Unchanged from v1.14 plan §5.1.

### §5.2 v1.15 dual-path shape

Auth-client switches on the discriminator:

```typescript
async function login(creds: SuitefleetCredentials): Promise<SuiteFleetTokenSet> {
  switch (creds.auth_method) {
    case 'oauth': {
      // Existing flow — POST /api/auth/authenticate with username/password in query string,
      // Clientid: <client_id> header. Unchanged from current production code.
      return loginOAuth(creds);
    }
    case 'api_key': {
      // Aqib-confirmed header pattern (STILL PENDING — see §5.3).
      return loginApiKey(creds);
    }
  }
}
```

The OAuth path is the existing `auth-client.ts:213-226` flow, preserved as-is. The `api_key` path is a new sibling function `loginApiKey` whose request shape is locked when Aqib confirms.

### §5.3 Aqib auth-header dependency — narrowed scope

Plan-amendment §0.4 narrowed the Aqib blocker scope. **The code-PR opens and merges when the OAuth path is implemented and tested**, with `loginApiKey` stubbed to throw `ConfigurationError('api_key auth not yet implemented; awaiting SF OpsPortal header confirmation')`. The stub satisfies the discriminated-union type signature but fails closed at runtime for any tenant routed through an `api_key` region.

The api_key path lights up in a **follow-on T2 PR** (small surface — only `loginApiKey` body + one integration spec) when Aqib's reply lands. This unblocks the v1.15 code-PR from Aqib's coordination latency.

---

## §6 Permission model

Unchanged from v1.14 plan §6.

---

## §7 Region admin UI (extends v1.14 plan §7)

### §7.1 `/admin/regions` list view — add `Auth Method` column

| Column | Source |
|---|---|
| Display Name | `suitefleet_regions.display_name` |
| Client ID | `suitefleet_regions.client_id` (rendered in mono) |
| **Auth Method** | `suitefleet_regions.auth_method` (badge: OAuth / API Key — stone neutral, no semantic color) |
| Status | badge: active (green) / inactive (stone) |
| In-Use Count | COUNT(tenants) per region |
| Created | `created_at` formatted |
| Actions | DEACTIVATE / ACTIVATE |

### §7.2 `/admin/regions/new` — add `auth_method` radio

Form gains a third field:
- Client ID (text input, mono)
- Display Name (text input)
- **Auth Method (radio):** OAuth — username + password / API Key — api_key + secret_key
- Submit: CREATE REGION

The radio is REQUIRED (no default selection — operator must explicitly pick). Below the radio, helper copy notes: "This selection is permanent for this region. Auth method cannot be changed after creation."

### §7.3 `/admin/regions/[id]` detail view

Add `Auth Method` row beneath status. No mutation affordance (IMMUTABLE per §2.1 — `updateRegion` Zod schema does not accept the field).

### §7.4 Activation path

Unchanged from v1.14 plan §7.4.

---

## §8 Credentials UI — form-field labels branch on region.auth_method (extends v1.14 plan §8)

### §8.1 `/admin/merchants/[id]/credentials` — branched labels

The page renders the form with field labels driven by the merchant's region's `auth_method`:

**Region `auth_method = 'oauth'`:**
- Label 1: "OAuth Username" (text input, autocomplete=off)
- Label 2: "OAuth Password" (password input, autocomplete=off)
- Submit button: SET CREDENTIALS / ROTATE CREDENTIALS (unchanged)

**Region `auth_method = 'api_key'`:**
- Label 1: "API Key" (password input, autocomplete=off)
- Label 2: "Secret Key" (password input, autocomplete=off)
- Submit button: SET CREDENTIALS / ROTATE CREDENTIALS (unchanged)

The page's read path resolves the merchant's `suitefleet_region_id` then JOINs `suitefleet_regions` for the `auth_method`. The form field naming under the hood is generic (`credential_1`, `credential_2`); the operator sees only the semantic labels. Server action stores values into the appropriate Vault columns regardless of label rendering.

### §8.2 Confirmation modal copy adjusts per auth_method

**OAuth rotation modal:**
> "Rotating the OAuth username and password will invalidate the current credentials. Pushes from this merchant will fail until SuiteFleet's side is updated. Continue?"

**API Key rotation modal:**
> "Rotating the API Key and Secret Key will invalidate the current credentials. Pushes from this merchant will fail until SuiteFleet OpsPortal is updated. Continue?"

### §8.3 Merchant detail page integration

Status badge unchanged ("Credentials configured" / "Credentials missing" per v1.14 plan §8.3). MANAGE CREDENTIALS CTA destination unchanged. Detail page also surfaces the parent region's `auth_method` in the Routing section so operators can see the auth flavor at a glance without round-tripping to the credentials page.

### §8.4 Region picker on merchant edit page

Unchanged from v1.14 plan §8.4. The picker filters to `status='active'` regions; auth_method is incidental at picker time (operator sees the region name; the merchant's auth method falls out from the selected region).

---

## §9 Audit events

Unchanged from v1.14 plan §9. `credentials.set` payload is `{ tenant_id, classifier }` per the locked OQ-8 ruling — `auth_method` is intentionally NOT in the payload because it's recoverable forensically via `tenant_id → region_id → auth_method`. Shape-divergence discipline note in `metadataNotes` carries forward.

---

## §10 Integration spec coverage — additions to v1.14 plan §10

Two new specs in addition to the six from v1.14 plan §10:

7. **`tests/integration/admin-regions-auth-method-immutable.spec.ts`** — assert `updateRegion` rejects any `auth_method` mutation (Zod schema test + service-layer test). Assert `createRegion` requires `auth_method` (no default).
8. **`tests/integration/suitefleet-resolve-credentials-discriminated-union.spec.ts`** — assert resolver returns the correct discriminator + field set per region.auth_method. Two test cases: OAuth-region tenant → `{ auth_method: 'oauth', username, password, ... }`; API Key-region tenant → `{ auth_method: 'api_key', apiKey, secretKey, ... }`. Type-narrowing via exhaustive switch tested via TypeScript compile (tsc must reject a non-exhaustive switch over the union at the auth-client `login()` site).

Two of the v1.14 plan's spec names update to reflect the rename:
- `admin-merchants-credentials-set.spec.ts` — body assertions update to use `credential_1_vault_id` / `_2_vault_id`.
- `suitefleet-resolve-credentials.spec.ts` — extended to test both branches of the discriminated union.

Canonical teardown skeleton (per `memory/followup_audit_rule_cascade_conflict.md`) unchanged.

---

## §11 Sequencing + CI gate + §3.6 hard-stop

### §11.1 Merge sequence

1. PR #275 (brief v1.15, T1 docs) → §3.6 round 1 → merge once CI green
2. This plan-amendment PR → §3.6 round 1 → merge once CI green AND v1.15 on main
3. Code-PR opens off main (Option A) → §3.6 round 2 → merge once CI green + Love clears verdict
   - OAuth path live + tested at code-PR open
   - `loginApiKey` stubbed with `ConfigurationError` until Aqib's reply
4. Vercel promote
5. Production backfill verification (per v1.14 plan §11.1 step 6)
6. **Follow-on T2 PR (post-Aqib):** wire `loginApiKey` body against confirmed headers; one integration spec lands the request-shape assertion

### §11.2 Pre-merge §3.6 hard-stop gates (round 1 — this plan amendment)

- [ ] Plan compliance: brief v1.15 (PR #275) covers all sections referenced
- [ ] OQ-10 reversal documented at §0.1
- [ ] OQ-amend-1 (generic credential column names) + OQ-amend-2 (single code-PR with both paths) ratifications captured at §13
- [ ] Branch sequencing posture explicit at §0 (Option A)
- [ ] CI status verified per brief v1.13 §7.1 — plan-amendment is markdown only; CI green is no-op pass

### §11.3 Pre-merge §3.6 hard-stop gates (round 2 — code-PR)

- [ ] Vault schema present on production DB (unchanged from v1.14 plan §11.3)
- [ ] All eight integration specs land at PR open (6 from v1.14 plan + 2 new from this amendment §10)
- [ ] CI green per v1.13 §7.1
- [ ] Discriminated-union exhaustiveness verified by tsc (non-exhaustive switch over `auth_method` at `login()` callsite must fail compile)
- [ ] `loginApiKey` stub throws `ConfigurationError` cleanly (not a generic crash)
- [ ] OAuth path tested against sandbox during pre-merge verification (smoke at minimum)
- [ ] Backfill SQL block runs cleanly on production (unchanged)
- [ ] Follow-on T2 PR for `loginApiKey` body scope explicitly noted in code-PR description

### §11.4 CI gate (v1.13 §7.1)

`CI status: <PASS|FAIL|UNSTABLE|PENDING>. Local tests: N/A (plan-markdown only). tsc: N/A.`

---

## §12 Findings tracker (§3.6 round 1 — to be filled by reviewer)

### §12.1 NEEDS-FIX (apply as fixups before merge)

_None pending._

### §12.2 NEEDS-CLARIFICATION (OQ — open questions for reviewer ruling)

See §13.

---

## §13 Open questions — ratified per Love's product call

**OQ-amend-1 — Generic credential column names (`credential_1_vault_id` + `credential_2_vault_id`) vs auth-method-specific (`username_vault_id` + `password_vault_id` + `api_key_vault_id` + `secret_vault_id`)?**

- Default lean: generic `credential_1` + `credential_2` columns. Simpler schema, semantic interpretation from `region.auth_method`. Two columns always populated regardless of auth flavor; four-column variant has two always-null columns per tenant.
- Alternative: four columns with auth-method-specific names. Self-documenting at the column level but doubles the surface and forces every tenant to keep two columns null.
- **§3.6 round-1 ratification (Love, Day-25 PM):** APPROVED — generic credential column names per default lean.

**OQ-amend-2 — Single code-PR with both paths, OR phased (PR-A ships OAuth + scaffolding, PR-B ships API Key once Aqib replies)?**

- Default lean: single code-PR. Plan §5.3 narrows the Aqib blocker to `loginApiKey` body only (one function); rest of the surface ships independently. Phased doubles PR-merge ceremony with no real benefit — production-region tenants stay un-credentialed regardless.
- Alternative: phased. Aqib reply landed → second code-PR opens → `loginApiKey` body wired.
- **§3.6 round-1 ratification (Love, Day-25 PM):** APPROVED — single code-PR with both paths; `loginApiKey` stub for the api_key branch; follow-on T2 PR (small) lands the body when Aqib replies.

### §13.1 v1.14 plan OQ rulings — carry-forward status

All v1.14 plan §13 OQ rulings carry forward EXCEPT **OQ-10 (REVERSED — dual-path retained, no clean OAuth cutover)**. Specifically:

| OQ | v1.14 ruling | v1.15 status |
|---|---|---|
| OQ-1 (`merchant:update` reuse) | APPROVED | unchanged |
| OQ-2 (resolver fail-closed on inactive region) | APPROVED | unchanged |
| OQ-3 (flat-diff for `region.updated`) | APPROVED | unchanged |
| OQ-4 (Vault wrapper at `src/modules/credentials/vault-store.ts`) | APPROVED | unchanged |
| OQ-5 (token cache invalidation on both rotation + initial-set) | APPROVED | unchanged |
| OQ-6 (single-migration backfill) | APPROVED | unchanged — with v1.15 column-name change applied |
| OQ-7 (regions list alphabetical by `display_name`) | APPROVED | unchanged |
| OQ-8 (`credentials.set` distinct event type + metadataNotes shape-divergence note) | APPROVED | unchanged — `auth_method` deliberately NOT in payload per §9 |
| OQ-9 (migration comment block) | APPROVED | extended in §2.4 with `auth_method` semantics |
| **OQ-10 (clean OAuth cutover)** | **APPROVED at v1.14** | **REVERSED at v1.15 — dual-path retained** |

---

## §14 Plan-amendment PR diff summary

Plan-amendment PR (this PR): adds `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md` (this file).
Brief v1.15 (PR #275, separate): brief amendment + decision memo.
Code-PR (forthcoming): migration + service + admin UI + integration specs + auth-client rewire (with `loginApiKey` stub).
Follow-on T2 PR (post-Aqib): `loginApiKey` body + one integration spec.

No code changes in the plan-amendment PR. CI is no-op pass.

---

## §15 References

- Brief v1.15 amendment: PR #275
- v1.14 plan (in force, this amends): `memory/plans/day-25-per-merchant-sf-credentials.md` (PR #274 — merged)
- v1.15 decision memo: `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`
- v1.14 decision memo (predecessor): `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`
- T3 sequencing memo (Option A): `memory/followup_t3_plan_code_branch_sequencing.md`
- Audit-rule cascade canonical teardown: `memory/followup_audit_rule_cascade_conflict.md` (load-bearing)
- §3.6 review-discipline + CI gate: `memory/decision_review_discipline_ci_gate.md`
