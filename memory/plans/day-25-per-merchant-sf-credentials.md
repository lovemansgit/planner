# Day-25 PM T3 plan — Per-merchant SuiteFleet credentials + multi-region `client_id` resolver

**Tier:** T3 (schema + auth + audit + new admin surfaces; hard-stop twice — plan-PR open + code-PR open).
**Brief dependency:** brief v1.14 amendment (PR #273 — docs-only T1). Plan-PR does NOT merge until v1.14 is on main.
**Auth-header dependency:** Aqib's confirmation of SF API Key + Secret Key request-header pattern. Code-PR does NOT open until reply lands. See §5.
**Branch sequencing posture:** **Option A** per `memory/followup_t3_plan_code_branch_sequencing.md` — code branch forks off `main` after plan-PR merges; plan deltas cherry-picked into code branch. (Option A is preferred when plan deltas are small — this plan markdown is the only plan delta; everything else is code.)

---

## §0 Premise + dependencies

### §0.1 What this plan does

Replaces the v1.7 region-scoped env-backed OAuth credential model with a per-merchant Vault-stored API Key + Secret Key model. Adds DB-backed regions table so adding a new region is operator-facing flow, not a deploy. Adds the admin surfaces for both. Rewrites `resolveSuitefleetCredentials` and the SF auth-client `login()` request shape.

### §0.2 What this plan does NOT do

- Does NOT migrate to AWS Secrets Manager — that remains Phase 2 per brief v1.14 §4 (reshaped to "Vault UUID → Secrets Manager ARN per merchant").
- Does NOT add a tenant-admin / merchant-portal-facing region selector — current scope is Transcorp-sysadmin only.
- Does NOT add bulk credential rotation or expiry tracking (SF tokens have no documented expiry; revisit if Aqib confirms).
- Does NOT remove env vars `SUITEFLEET_SANDBOX_USERNAME` / `PASSWORD` / `CLIENT_ID` from Vercel — that's a T1 follow-on after deploy + credential provisioning is verified clean.

### §0.3 Brief amendment dependency

Brief v1.14 PR #273 is the docs-only T1 amendment for this lane. Plan-PR can §3.6 round 1 in parallel with v1.14 review. Plan-PR merge waits on v1.14 being on main.

### §0.4 Aqib auth-header dependency (load-bearing for code-PR)

Industry-standard candidates for API Key + Secret Key request auth:
- **(a)** `Clientid: <client_id>` + `X-Api-Key: <api_key>` + `X-Api-Secret: <secret_key>` headers
- **(b)** `Authorization: Bearer <base64(api_key:secret_key)>` + `Clientid: <client_id>`

Reviewer is sourcing the answer from Aqib. Until answered, the plan-PR's §3.6 round 1 can proceed; code-PR does NOT open. §5 carries this as the open dependency.

### §0.5 Branch sequencing — Option A rationale

Plan-PR diff is small (this single markdown plan file + brief amendment already in PR #273). Code-PR diff is large (schema + service + UI + tests). Per `followup_t3_plan_code_branch_sequencing.md`:
- Plan-PR forks off main → merges → deleted via `--delete-branch`.
- Code-PR forks off main (NOT off plan-PR's branch). After plan-PR merges, plan deltas are already on main, so code-PR doesn't need to cherry-pick anything from this plan-PR.
- Both `--delete-branch` operations are safe — neither branch is parent to the other.

### §0.6 Demo distance

Demo already shipped (Day-19 May 12). Per Day-24 EOD `§F`, current posture is post-pilot foundation-building toward Phase 2 production cutover. No demo-blocker urgency on this lane; correctness > speed.

---

## §1 Scope boundaries

### §1.1 In scope

**Schema:**
- New `suitefleet_regions` table with seeded rows for sandbox + 3 production regions
- New `tenants` columns: `suitefleet_region_id` (FK, `ON DELETE RESTRICT`, NOT NULL post-backfill), `suitefleet_api_key_vault_id` (nullable), `suitefleet_secret_vault_id` (nullable)
- Backfill all existing tenants to point at the `transcorpsb` (sandbox) region

**Service layer:**
- `createRegion`, `updateRegion`, `deactivateRegion` (Transcorp-staff scope)
- `storeSuitefleetCredentials` (initial-set + rotation paths; wraps Vault calls)
- `resolveSuitefleetCredentials` rewrite (returns `{ clientId, customerId, apiKey, secretKey }`; reads region via JOIN + secrets via `vault.decrypted_secrets`)
- Token cache invalidation hook on rotation

**Permission:**
- New `region:manage` (Transcorp-sysadmin only; added to `API_KEY_FORBIDDEN_PERMISSIONS`)
- Existing `merchant:update` extends to gate `storeSuitefleetCredentials`

**Audit events:**
- `region.created`, `region.updated`, `region.deactivated`, `credentials.set` (no plaintext, no Vault UUIDs in `credentials.set` body)

**Admin UI:**
- `/admin/regions` list (Display Name / Client ID / Status / In-Use Count / Created / row-actions)
- `/admin/regions/new` create form
- `/admin/regions/[id]` read-only detail + deactivate
- `/admin/merchants/[id]/credentials` write-only credentials surface (SET / ROTATE)
- Merchant detail page (`/admin/merchants/[id]` from PR #271) gains credentials status badge + MANAGE CREDENTIALS CTA

**Auth resolver rewrite:**
- `pushSingleTask` + any other resolver caller fails closed via `ValidationError('credentials not configured')` if either Vault UUID is NULL or region is `inactive`
- SF auth-client `login()` rewires to the API Key + Secret Key header pattern (exact shape pending §5 dependency resolution)

### §1.2 Out of scope (explicit)

- AWS Secrets Manager swap (Phase 2 per brief v1.14 §4)
- Tenant-admin / merchant-portal region selector (Phase 2 per brief v1.14 §4)
- Bulk credential management / mass rotation
- Credential expiry tracking (no documented SF semantics)
- Vercel env-var removal for retired SF env vars (T1 follow-on post-deploy)
- Email-on-rotation / merchant-side notification of credential rotation (Phase 2 if ever needed)

---

## §2 Schema changes

### §2.1 New `suitefleet_regions` table (migration 0024)

```sql
CREATE TABLE suitefleet_regions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'inactive')),
  CHECK (client_id ~ '^[a-z][a-z0-9]*$')
);

CREATE INDEX idx_suitefleet_regions_status ON suitefleet_regions (status);
```

RLS: this is a Transcorp-cross-tenant table (regions are global). Service-role only; no tenant-scoped RLS policy.

### §2.2 Seed data (same migration)

```sql
INSERT INTO suitefleet_regions (client_id, display_name, status) VALUES
  ('transcorpsb',    'Sandbox',          'active'),
  ('transcorp',      'Transcorp KSA',    'active'),
  ('transcorpuae',   'Transcorp UAE',    'active'),
  ('transcorpqatar', 'Transcorp Qatar',  'active');
```

### §2.3 `tenants` column additions + backfill (migration 0024)

```sql
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id        uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT,
  ADD COLUMN suitefleet_api_key_vault_id uuid,
  ADD COLUMN suitefleet_secret_vault_id  uuid;

-- Backfill existing tenants to sandbox region
UPDATE tenants
SET    suitefleet_region_id = (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb')
WHERE  suitefleet_region_id IS NULL;

-- Lock NOT NULL after backfill
ALTER TABLE tenants ALTER COLUMN suitefleet_region_id SET NOT NULL;
```

`ON DELETE RESTRICT` per Day-22 pattern — `SET NULL` would silently break the NOT NULL CHECK at runtime. Vault FK columns stay nullable until provisioned via the admin UI; resolver fails closed when null (see §4.2).

### §2.4 Why `customer_code` stays unchanged

`tenants.suitefleet_customer_code` (numeric merchant identifier) is unchanged. The four-layer identifier model only ADDS layers; it doesn't relocate existing layers. Backfill semantics: existing rows have `customer_code` populated (588 / 586 / 578 / 591); Vault columns NULL until provisioned.

### §2.5 audit-rule cascade compatibility

`audit_events_no_delete` RULE (per `memory/followup_audit_rule_cascade_conflict.md`) is unaffected — this lane adds two new tables (regions table) and three columns to tenants, none of which interact with `audit_events`. Integration spec teardown for the new specs uses the canonical try/catch wrap pattern from the load-bearing memo (see §10).

---

## §3 Supabase Vault integration model

### §3.1 Vault availability verification (pre-merge)

**Verification step before code-PR merge:** confirm `vault` schema exists on production DB via Supabase SQL editor — `SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';` should return one row. Supabase enables Vault by default on hosted projects; this is a precondition check, not a migration.

If Vault is NOT enabled: code-PR holds for an enabling migration. Most likely Vault is already enabled (Supabase default).

### §3.2 Service-layer wrapper (new module)

New file `src/modules/credentials/vault-store.ts`:

```typescript
// Public surface (signatures only — full implementation in code-PR)
export async function createVaultSecret(plaintext: string): Promise<string /* uuid */>;
export async function updateVaultSecret(id: string, plaintext: string): Promise<void>;
export async function readVaultSecret(id: string): Promise<string /* plaintext */>;
```

Each wraps the Postgres-side `vault.create_secret` / `vault.update_secret` / `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = $1`. All three execute inside `withServiceRole` (the Vault view is service-role only by Supabase RLS).

### §3.3 Plaintext handling rules (load-bearing)

- Plaintext NEVER stored outside Vault. The `tenants` row stores ONLY the UUID.
- Plaintext NEVER appears in `audit_events.metadata`. The `credentials.set` event body excludes both plaintext AND the Vault UUIDs themselves — only `tenant_id`, `classifier`, and `actor`.
- Plaintext NEVER logged. The token-cache module (`src/modules/integration/providers/suitefleet/token-cache.ts`) already wraps `login()` calls; resolver-returned credentials are passed to `login()` and discarded after the SF call.
- Plaintext NEVER returned to the UI. The `/admin/merchants/[id]/credentials` page is write-only; existing values are not fetched at render time.

### §3.4 Rotation semantics

Rotation flow:
1. Operator enters new API Key + Secret Key on `/admin/merchants/[id]/credentials`
2. Confirmation modal warns about SF-side invalidation
3. On confirm: `storeSuitefleetCredentials(ctx, tenantId, { apiKey, secretKey })` → `vault.update_secret` on both existing UUIDs (preserves UUIDs, replaces plaintext)
4. Audit emit `credentials.set` with `classifier='rotation'`
5. Token cache invalidation: explicit `tokenCache.invalidate(tenantId)` call so the next push triggers a fresh authenticated `login()` against the new credentials

---

## §4 Auth resolver rewrite + fail-closed posture

### §4.1 New resolver shape

`src/modules/credentials/suitefleet-resolver.ts` — full rewrite, retains export name + tenantId signature.

```typescript
export interface SuiteFleetCredentials {
  clientId:   string;  // from suitefleet_regions.client_id
  customerId: number;  // from tenants.suitefleet_customer_code
  apiKey:     string;  // from vault.decrypted_secrets via tenants.suitefleet_api_key_vault_id
  secretKey:  string;  // from vault.decrypted_secrets via tenants.suitefleet_secret_vault_id
}

export async function resolveSuitefleetCredentials(
  ctx: Ctx,
  tenantId: Uuid
): Promise<SuiteFleetCredentials>;
```

Read path (all inside `withServiceRole`):
1. SELECT `t.suitefleet_customer_code`, `t.suitefleet_api_key_vault_id`, `t.suitefleet_secret_vault_id`, `r.client_id`, `r.status` FROM `tenants` t JOIN `suitefleet_regions` r ON t.suitefleet_region_id = r.id WHERE t.id = $1.
2. Fail-closed: throw `ValidationError('credentials not configured for this merchant')` if:
   - tenant row not found, OR
   - either Vault UUID is NULL, OR
   - `r.status = 'inactive'`, OR
   - `customer_code` is NULL or non-positive
3. Read both secrets via `readVaultSecret(uuid)`.
4. Return the credentials object.

### §4.2 Fail-closed verification path

`pushSingleTask` (`src/modules/task-push/service.ts:364-404`) currently has an upstream guard for missing `customer_code`. v1.14 extends this:
- The existing missing-`customer_code` guard short-circuits early (no resolver call needed) — keep this path; it's an optimisation.
- The resolver itself becomes the second fail-closed layer for missing Vault UUIDs / inactive region.
- Any caller of `resolveSuitefleetCredentials` receives `ValidationError` and propagates it.

### §4.3 OAuth removal

The v1.7 resolver returned `{ username, password, clientId, customerId }`. The v1.14 resolver returns `{ clientId, customerId, apiKey, secretKey }`. All callers update in the same code-PR:
- `src/modules/integration/providers/suitefleet/token-cache.ts` — `getSession` consumes new shape
- `src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts` — adapter factory consumes new shape
- `src/modules/integration/providers/suitefleet/auth-client.ts` — `login()` request shape rewires (per §5)

### §4.4 Token cache invalidation interface

Add to `src/modules/integration/providers/suitefleet/token-cache.ts`:

```typescript
interface SuiteFleetTokenCache {
  // existing
  getSession(tenantId: Uuid): Promise<AuthenticatedSession>;
  // new (v1.14)
  invalidate(tenantId: Uuid): void;
}
```

`storeSuitefleetCredentials` calls `invalidate(tenantId)` on every rotation (and on initial-set, defensively, in case there's a stale negative-cache entry).

---

## §5 SF auth-client login() rewire — OPEN DEPENDENCY (Aqib)

### §5.1 Current shape

`src/modules/integration/providers/suitefleet/auth-client.ts:213-226` — currently `POST /api/auth/authenticate` with `username` + `password` in query string, `Clientid: <clientId>` header.

### §5.2 Candidate v1.14 shapes (pending Aqib reply)

**Candidate (a) — three-header:**
```
POST /api/auth/<api-key-auth-endpoint-TBD>
Headers:
  Clientid: <client_id>
  X-Api-Key: <api_key>
  X-Api-Secret: <secret_key>
```

**Candidate (b) — Bearer:**
```
POST /api/auth/<api-key-auth-endpoint-TBD>
Headers:
  Authorization: Bearer <base64(api_key:secret_key)>
  Clientid: <client_id>
```

Both candidates eliminate the username/password query-string. Both require Aqib confirmation of:
1. Endpoint path (does `/api/auth/authenticate` stay, or is there an `/api/auth/api-key` variant?)
2. Header names + casing
3. Whether tokens returned have different shape/TTL than OAuth tokens
4. Whether a refresh-token path exists or every login is fresh

### §5.3 Implementation guard

Code-PR does NOT open until §5.2 resolves. Reviewer sources answer from Aqib; once confirmed, the code-PR rewires `login()` against the confirmed shape, and the integration spec at §10 pins the request shape via a fetch mock.

---

## §6 Permission model

### §6.1 New permission

`region:manage` registered in `src/modules/identity/permissions.ts`:
```typescript
"region:manage": {
  id: "region:manage",
  resource: "region",
  action: "manage",
  description: "Manage SuiteFleet region configuration (create, update, deactivate)",
  systemOnly: true,  // Transcorp-sysadmin only; never tenant-scoped
}
```

Added to `API_KEY_FORBIDDEN_PERMISSIONS` set (matches `merchant:create` precedent — privilege-escalation guard).

### §6.2 Role mapping

`transcorp-sysadmin` already inherits via `new Set(ALL)` at `src/modules/identity/roles.ts:213`; no role-map change needed.

### §6.3 merchant:update extension

Existing `merchant:update` permission gates `storeSuitefleetCredentials`. No new permission needed — same operator scope as `updateMerchant` (both touch SF routing config; one-bit-of-privilege escalation would be a security improvement here but the brief calls explicitly for `merchant:update` reuse, and a separate `credentials:set` permission would force an ALL-set update at `roles.ts:213` which is the same blast radius).

---

## §7 Region admin UI

### §7.1 `/admin/regions` list view

Server component at `src/app/(admin)/admin/regions/page.tsx`. Reads via new repository fn `listRegionsWithUsage(ctx)` which JOINs `suitefleet_regions` + counts `tenants` per region.

| Column | Source |
|---|---|
| Display Name | `suitefleet_regions.display_name` |
| Client ID | `suitefleet_regions.client_id` (rendered in mono) |
| Status | badge: active (green) / inactive (stone) |
| In-Use Count | COUNT(tenants) per region |
| Created | `created_at` formatted |
| Actions | DEACTIVATE / ACTIVATE row action |

Top-right: NEW REGION button → `/admin/regions/new`.

### §7.2 `/admin/regions/new` create form

Server action mirrors `/admin/merchants/new`. Fields:
- Client ID (text input, monospace, placeholder `transcorpuae`)
- Display Name (text input)

Client-side validation mirrors the CHECK constraint (`^[a-z][a-z0-9]*$`). Server validation catches UNIQUE collision with `ConflictError`. Submit: CREATE REGION. Success: redirect to `/admin/regions` with toast.

### §7.3 `/admin/regions/[id]` detail view

Read-only. Renders all fields + in-use count. Deactivate action gated on warning copy if in-use count > 0 ("Deactivating this region prevents new merchants from selecting it but does not affect existing merchants. Existing merchants will continue to authenticate; their credentials remain valid. Continue?").

### §7.4 Activation path

ACTIVATE / DEACTIVATE row actions on the list view. ACTIVATE has no warning. Both emit appropriate audit events.

---

## §8 Credentials UI + merchant detail integration

### §8.1 `/admin/merchants/[id]/credentials` write-only surface

Server component at `src/app/(admin)/admin/merchants/[id]/credentials/page.tsx`. On render:
1. Read tenant row (verify both Vault UUIDs presence to determine SET vs ROTATE label).
2. Render form with two password inputs (autocomplete="off").
3. Submit button label: SET CREDENTIALS (both Vault UUIDs null) | ROTATE CREDENTIALS (otherwise).
4. ROTATE path opens a confirmation modal client-side before form submit.

Server action `storeCredentialsAction(tenantId, formData)`:
1. Permission: `merchant:update`
2. Validate both inputs non-empty (Zod)
3. Call `storeSuitefleetCredentials(ctx, tenantId, { apiKey, secretKey })`
4. Redirect to `/admin/merchants/[id]` with success toast

Modal is hand-rolled per the `AdHocTaskDialog` pattern (PR #266 precedent — mirrors `MerchantStatusModal`). No Radix Dialog import.

### §8.2 Existing values are intentionally undisplayable

The page MUST NOT fetch `decrypted_secret` at render. The page MUST NOT show partial/masked previews (`api_key: AKIA****1234`). Reasoning: any echo path becomes a privilege-escalation vector if the page itself is misconfigured later. Write-only by design.

### §8.3 Merchant detail page integration (PR #271 coordination)

PR #271 (`/admin/merchants/[id]`) merged before this lane opens. The detail page gains a credentials status row in the Routing section:
- "Credentials configured" green badge if both Vault UUIDs present
- "Credentials missing" amber badge if either is null
- MANAGE CREDENTIALS link → `/admin/merchants/[id]/credentials`

Integration changes happen in the same code-PR as this plan, not a separate follow-on.

### §8.4 Region picker on merchant edit page

Existing `/admin/merchants/[id]/edit` form (PR #264) gains a "SF region" select input. Source: `listRegions(ctx)` filtered to `status='active'`. Default value: tenant's current `suitefleet_region_id`. `updateMerchant` extends to handle the new field. Audit event `merchant.updated` already supports flat-diff payload (per Day-25 §A); region change appears as `{ region_id: { before, after } }`.

---

## §9 Audit events

### §9.1 Event registration

All four events registered in `src/modules/audit/event-types.ts` (insert before line 838 closing brace):

```typescript
"region.created": {
  id: "region.created",
  resource: "region",
  action: "created",
  description: "SuiteFleet region created via /admin/regions/new",
  metadataNotes: "region_id (uuid), client_id (text), display_name (text).",
  systemOnly: true,
},
"region.updated": {
  id: "region.updated",
  resource: "region",
  action: "updated",
  description: "SuiteFleet region updated via /admin/regions/[id]",
  metadataNotes: "region_id (uuid), changes (object: { <field>: { before, after } }).",
  systemOnly: true,
},
"region.deactivated": {
  id: "region.deactivated",
  resource: "region",
  action: "deactivated",
  description: "SuiteFleet region deactivated via /admin/regions/[id]",
  metadataNotes: "region_id (uuid).",
  systemOnly: true,
},
"credentials.set": {
  id: "credentials.set",
  resource: "credentials",
  action: "set",
  description: "Per-merchant SuiteFleet credentials set or rotated via /admin/merchants/[id]/credentials",
  metadataNotes: "tenant_id (uuid), classifier ('initial-set' | 'rotation'). NEVER contains plaintext credentials or Vault UUIDs.",
  systemOnly: true,
},
```

### §9.2 Emit sites

| Event | Emit site |
|---|---|
| `region.created` | `createRegion` service, post-commit |
| `region.updated` | `updateRegion` service, post-commit, with flat-diff body |
| `region.deactivated` | `deactivateRegion` service, post-commit |
| `credentials.set` | `storeSuitefleetCredentials` service, post-commit |

All four are `systemOnly` (Transcorp-cross-tenant scope; `tenant_id` in metadata for `credentials.set`, omitted for region events).

---

## §10 Integration spec coverage (Day-23 §F discipline)

Six new integration specs lands alongside the code-PR per the load-bearing teardown pattern at `memory/followup_audit_rule_cascade_conflict.md`:

1. **`tests/integration/admin-regions-create.spec.ts`** — assert region row + audit event + UNIQUE collision returns 409.
2. **`tests/integration/admin-regions-deactivate.spec.ts`** — assert deactivation flips status + emits event + does NOT cascade to existing tenants (they remain operational).
3. **`tests/integration/admin-merchants-credentials-set.spec.ts`** — assert Vault write happens, tenant row stores UUID, audit event has `classifier='initial-set'`, plaintext is NOT in audit body, plaintext is NOT in log output (via test logger spy).
4. **`tests/integration/admin-merchants-credentials-rotate.spec.ts`** — assert second set call hits `vault.update_secret` path (UUID preserved), audit `classifier='rotation'`, token cache invalidated for the tenant.
5. **`tests/integration/suitefleet-resolve-credentials.spec.ts`** — assert resolver returns correct shape; fails closed when either Vault UUID is NULL; fails closed when region is `inactive`; fails closed when `customer_code` missing.
6. **`tests/integration/suitefleet-push-fail-closed.spec.ts`** — assert `pushSingleTask` returns / throws expected fail-closed result when credentials not configured.

All six use the canonical teardown skeleton:
```typescript
afterAll(async () => {
  try {
    await withServiceRole("<spec name> teardown", async (tx) => {
      await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (...)`);
    });
  } catch {
    /* audit_events_no_delete RULE; ignore */
  }
});
```

Specs that touch the new `suitefleet_regions` table also DELETE region rows BEFORE the tenant DELETE in the same tx (`ON DELETE RESTRICT` would otherwise block tenant cleanup if any tenants point at a test region).

Vault rows leak (no `vault.delete_secret` wrapper used in tests) — this is acceptable because Vault test rows are per-run UUID-keyed and don't collide. If accumulation becomes a problem, a Phase-2 cleanup helper can be added.

---

## §11 Sequencing + CI gate + §3.6 hard-stop

### §11.1 Merge sequence

1. PR #273 (brief v1.14, T1 docs) → §3.6 round 1 → merge once CI green
2. This plan-PR → §3.6 round 1 → merge once CI green AND v1.14 on main
3. Aqib confirms SF API Key + Secret Key request-header shape (§5)
4. Code-PR opens off main (Option A) → §3.6 round 2 → merge once CI green + Love clears verdict
5. Vercel promote against post-merge main HEAD
6. Production backfill verification: confirm regions table seeded; confirm existing tenants point at sandbox; confirm Vault schema enabled; provision Demo Bistro credentials via the new UI as a smoke test

### §11.2 Pre-merge §3.6 hard-stop gates (round 1 — this plan-PR)

- [ ] Plan compliance: brief v1.14 (PR #273) covers all sections plan references; plan scope matches v1.14 §3.6 + §3.7
- [ ] Open dependency on Aqib captured at §5; plan acknowledges code-PR blocks until resolved
- [ ] Branch sequencing posture explicit at §0.5 (Option A)
- [ ] CI status verified per brief v1.13 §7.1 — plan-PR is plan-markdown only, so CI green is no-op pass

### §11.3 Pre-merge §3.6 hard-stop gates (round 2 — code-PR)

To be expanded in code-PR description. Pre-flight items:
- [ ] Vault schema present on production DB (verified pre-merge via Supabase SQL editor)
- [ ] All six integration specs at §10 land at PR open (Day-23 §F discipline)
- [ ] CI green per v1.13 §7.1 (red is a blocker; no `--admin` bypass)
- [ ] Token cache invalidation tested (§4.4)
- [ ] OAuth env vars confirmed retired post-deploy (the Vercel env-var removal is a follow-on T1, but the code path must read zero env vars at run time)
- [ ] Backfill SQL block runs cleanly on production (single statement; idempotent — existing tenants get sandbox region; no-op on re-run)

### §11.4 CI gate (v1.13 §7.1)

This plan-PR reports `CI status: <PASS|FAIL|UNSTABLE|PENDING>. Local tests: N/A (plan-markdown only). tsc: N/A.` in the PR-open message.

---

## §12 Findings tracker (§3.6 round 1 — to be filled by reviewer)

(Placeholder. Reviewer adds NEEDS-FIX findings + OQ answers below at §3.6 round 1.)

### §12.1 NEEDS-FIX (apply as fixups before merge)

_None pending._

### §12.2 NEEDS-CLARIFICATION (OQ — open questions for reviewer ruling)

See §13.

---

## §13 Open questions (OQs)

These resolve at §3.6 round 1 by reviewer ruling. Each has a default lean; reviewer overrides or confirms.

**OQ-1 — Permission split: `merchant:update` vs. new `credentials:set` for `storeSuitefleetCredentials`?**

- Default lean (per brief v1.14 + user prompt): reuse `merchant:update`. Same operator scope; same blast radius.
- Alternative: a discrete `credentials:set` permission for finer-grained privilege control (and separate `credentials:read` for the resolver's service-role-only path, though that's implicit by `systemOnly`).
- Reviewer ruling locked at: __reuse `merchant:update`__ per user prompt §6.

**OQ-2 — Region deactivation behaviour: read-side filter only, or also block new merchant creation?**

- Default lean: filter from the "available regions" picker on `/admin/merchants/new` + `/admin/merchants/[id]/edit`. Deactivated regions remain selectable nowhere. Existing tenants pointing at deactivated regions continue to authenticate (their credentials are valid; the region row is just hidden from new selection).
- Alternative: deactivated region causes resolver fail-closed for all tenants pointing at it. Aggressive kill-switch; potentially surprising to operators.
- Reviewer ruling: __resolver fails closed when region is inactive__ per §4.1. This is more aggressive but documented in brief v1.14 §3.7 ("operational kill-switch for compromised-region scenarios"). Acceptable because: (a) deactivation is rare; (b) compromise scenarios are exactly when fail-closed matters.

**OQ-3 — Audit event scope for `region.updated` flat-diff vs. structured per-field events?**

- Default lean: flat-diff `{ changes: { <field>: { before, after } } }` matching the v1.12 `merchant.updated` precedent.
- Alternative: discrete `region.client_id.changed` / `region.display_name.changed` events.
- Reviewer ruling locked: flat-diff per `merchant.updated` precedent. Reduces audit-event-type count.

**OQ-4 — Vault wrapper module location: `src/modules/credentials/vault-store.ts` vs. `src/shared/vault.ts`?**

- Default lean: `src/modules/credentials/vault-store.ts` (co-located with the resolver). Vault is used only by this lane right now; co-location keeps the surface narrow.
- Alternative: `src/shared/vault.ts` if future modules might want Vault for other secrets (e.g., webhook signing keys).
- Reviewer ruling: __`src/modules/credentials/vault-store.ts`__ (YAGNI; relocate if a second consumer emerges).

**OQ-5 — Token cache invalidation: on rotation only, or also on initial-set?**

- Default lean: both. Initial-set is defensive against stale negative-cache entries (a tenant whose first push failed before this rotation might have a cached fail-closed token).
- Alternative: rotation only. Initial-set has no cache to invalidate by definition.
- Reviewer ruling: __both__, per §3.4 step 5.

**OQ-6 — Backfill ordering — backfill UPDATE in same migration as ALTER, or two-step?**

- Default lean: single migration. Add column → backfill → SET NOT NULL — atomic.
- Alternative: two migrations. 0024 adds column nullable; ops backfill; 0025 SET NOT NULL. Safer for very large tables.
- Reviewer ruling: __single migration__ — `tenants` is small (~10 rows in production), backfill takes microseconds.

**OQ-7 — Region UI: list view sortable, or static order?**

- Default lean: static order (created_at ASC). UI is Transcorp-internal, 4 regions seeded, low cardinality.
- Reviewer ruling: __static, alphabetical by display_name__. Sorting affordance not needed at this scale.

**OQ-8 — `storeSuitefleetCredentials` permission: `merchant:update`, but should the audit event tag the change as a separate forensic class from regular merchant updates?**

- Default lean: yes — discrete `credentials.set` event (already in §9.1). Even though the permission is `merchant:update`, the event-type separation gives ops a clean filter for "rotation history" queries.
- Reviewer ruling: __confirmed__ — separate event type per §9.1.

**OQ-9 — Should the migration include a comment block explaining the four-layer model + Vault for future readers?**

- Default lean: yes — a top-of-file SQL comment summarising the change + linking to brief v1.14 §3.6. Mirrors `0013_sf_integration_required_fields.sql` precedent.
- Reviewer ruling: __yes, include comment block__ — supports future readers.

**OQ-10 — Should the SF auth-client `login()` path be replaced or wrapped (feature-flag a new path)?**

- Default lean: replace. OAuth path retires entirely; no merchants are on production yet (sandbox only). No need for a feature flag.
- Alternative: feature-flag for safer rollback. But the feature would have to read which path to use per-tenant, which couples to the same Vault column being non-null → effectively the same fail-closed posture.
- Reviewer ruling: __replace__ — clean cutover; old path dead-code.

---

## §14 Plan-PR diff summary

Plan-PR (this PR): adds `memory/plans/day-25-per-merchant-sf-credentials.md` (this file).
Brief v1.14 (PR #273, separate): brief amendment + decision memo.
Code-PR (forthcoming): migration + service + admin UI + integration specs + auth-client rewire.

No code changes in the plan-PR. CI is no-op pass.

---

## §15 References

- Brief v1.14 amendment: PR #273
- T3 sequencing memo (Option A vs. B): `memory/followup_t3_plan_code_branch_sequencing.md`
- Audit-rule cascade canonical teardown: `memory/followup_audit_rule_cascade_conflict.md` (load-bearing)
- §3.6 review-discipline + CI gate: `memory/decision_review_discipline_ci_gate.md`
- v1.7 three-layer identifier model (predecessor): `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`
- Secrets Manager swap (now reshaped to per-merchant scope): `memory/followup_secrets_manager_swap_critical_path.md`
- Credential resolver type narrowing (auto-retires post-cutover): `memory/followup_credential_resolver_type_narrowing.md`
