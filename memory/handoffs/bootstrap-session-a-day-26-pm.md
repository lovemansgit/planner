# Bootstrap — Session A, Day-26 PM

Mid-day handoff. The per-merchant SuiteFleet credentials lane is two
thirds shipped on main; the fresh session resumes by opening Sub-PR 3
(admin UI) off the latest main HEAD.

This memo is **builder bootstrap context only** — it is not a project
cabinet file and must not be treated as one. Cabinet refresh is the
EOD ritual.

---

## Lane state

Lane: per-merchant SuiteFleet credentials + multi-region resolver +
dual-path auth. Three sub-PRs, Option-A branch posture (each forks off
main; no plan-branch chain per
`memory/followup_t3_plan_code_branch_sequencing.md`).

| Sub-PR | Scope | Status |
|---|---|---|
| 1 of 3 | Migration 0024 + schema (`suitefleet_regions` table + 4 seeded regions + 3 `tenants` columns + pinned-UUID DEFAULT for sandbox + backfill + SET NOT NULL) | **MERGED** as `913361a` (PR #284) |
| 2 of 3 | Service + resolver + auth-client + audit events + permission + 8 integration specs + `vault-stub.sql` test infrastructure | **MERGED** as `5f59837` (PR #285) |
| 3 of 3 | Admin UI (`/admin/regions` list + new + [id] + `/admin/merchants/[id]/credentials` + merchant detail badge + region picker on edit) | **NOT STARTED** — this is the remaining lane |

**Main HEAD:** `5f59837`.

---

## Sub-PR 3 scope

Per v1.14 plan §7 + §8 and v1.15 amendment §7 + §8. Build exactly:

### `/admin/regions` list view
Columns per v1.15 amendment §7.1:
Display Name · Client ID (mono) · **Auth Method** (badge: OAuth / API Key, stone-neutral) · Status (badge: green active / stone inactive) · In-Use Count · Created · Actions (DEACTIVATE / ACTIVATE row action).
Top-right NEW REGION CTA → `/admin/regions/new`.
Sort: static alphabetical by `display_name` ASC per ratified OQ-7.

### `/admin/regions/new` create form
Fields:
- Client ID (text input, mono, placeholder `transcorpuae`)
- Display Name (text input)
- **Auth Method (radio)** — `OAuth — username + password` / `API Key — api_key + secret_key`. REQUIRED (no default; operator must explicitly pick). Helper copy beneath: "This selection is permanent for this region. Auth method cannot be changed after creation."

Submit calls `createRegion` (already on main from Sub-PR 2). UNIQUE collision → `ConflictError` rendered inline.

### `/admin/regions/[id]` detail view
Read-only. Renders all fields + in-use count. DEACTIVATE action gated on warning copy when in-use count > 0 (v1.14 plan §7.3 copy: "Deactivating this region prevents new merchants from selecting it but does not affect existing merchants. Existing merchants will continue to authenticate; their credentials remain valid. Continue?"). Auth Method row beneath status; no mutation affordance (IMMUTABLE per v1.15).

### `/admin/merchants/[id]/credentials` write-only surface
Two password inputs (`autocomplete="off"`). Labels branch on the merchant's region's `auth_method` per v1.15 amendment §8.1:
- OAuth region: "OAuth Username" / "OAuth Password"
- API Key region: "API Key" / "Secret Key"

Submit button label: SET CREDENTIALS (both Vault UUIDs null) | ROTATE CREDENTIALS (otherwise). ROTATE opens a hand-rolled confirmation modal (per the AdHocTaskDialog / MerchantStatusModal precedent — **no Radix Dialog import** per v1.14 plan §8.1).

Rotation modal copy branches on auth_method per v1.15 amendment §8.2 — `OAuth username and password` vs `API Key and Secret Key`.

Existing values intentionally undisplayable (write-only — page MUST NOT fetch `decrypted_secret` at render). v1.14 plan §8.2 articulates the privilege-escalation reasoning.

### Merchant detail page integration (`/admin/merchants/[id]`)
In the Routing section: credentials status row.
- "Credentials configured" — green badge — both Vault UUIDs present.
- "Credentials missing" — amber badge — either UUID NULL.

Plus a MANAGE CREDENTIALS link → `/admin/merchants/[id]/credentials`.
Plus surface the region's `auth_method` per v1.15 amendment §8.3 (operators see the auth flavor at a glance without round-tripping to the credentials page).

### Region picker on `/admin/merchants/[id]/edit`
Existing edit form (PR #264 / Day-25) gains a "SF region" `<select>`. Source: `listRegions(ctx)` filtered to `status='active'`. Default value: tenant's current `suitefleet_region_id`. `updateMerchant` extends to handle the new field. `merchant.updated` audit event already supports flat-diff per Day-25 §A; region change appears as `{ region_id: { before, after } }`.

**Note:** `listRegions(ctx)` is NOT in the Sub-PR 2 service surface — Sub-PR 3 may need to add a small read fn (or extend `createRegion`'s repo module). Either is acceptable; surface in PR description.

---

## Carry-forwards / watch-items (load-bearing for Sub-PR 3)

### `invalidateSession` DI wiring — load-bearing review point
Sub-PR 2's `storeSuitefleetCredentials(ctx, tenantId, input, invalidateSession)` takes the cache-invalidator as a DI param. Sub-PR 3's credentials action layer (the `'use server'` handler wrapping `storeSuitefleetCredentials`) MUST wire the real `LastMileAdapter.invalidateSession` from `getSuiteFleetAdapter()`:

```typescript
const adapter = getSuiteFleetAdapter();
await storeSuitefleetCredentials(ctx, tenantId, input, (tid) => adapter.invalidateSession(tid));
```

If Sub-PR 3 omits this wiring, rotation will silently not invalidate the token cache. Reviewer is tracking this; will be checked at §3.6 round 2.

### Already-on-main surfaces (Sub-PR 3 consumes, does not re-create)
- `region:manage` permission (in `src/modules/identity/permissions.ts`; transcorp-sysadmin inherits via existing `new Set(ALL)`)
- The 4 audit events (`region.created` / `region.updated` / `region.deactivated` / `credentials.set` — note the SHAPE DIVERGENCE on `credentials.set`)
- `resolveSuiteFleetCredentials` returning a discriminated union typed by `auth_method`
- `createRegion` / `updateRegion` / `deactivateRegion` / `storeSuitefleetCredentials` services
- `vault-store.ts` (Sub-PR 3 should not import directly — go through services)
- `LastMileAdapter.invalidateSession` on the interface + factory wiring
- `loginApiKey` stub throwing `ConfigurationError` (the api_key path; OAuth is live)
- `ConfigurationError` class in `src/shared/errors.ts` (HTTP 503 at the API boundary)
- `tests/integration/setup/vault-stub.sql` + `scripts/setup-test-db.sh` (Sub-PR 3's specs inherit)

### Frontend skill + brand discipline
Sub-PR 3 is the credentials UI lane — invoke `frontend-design` skill at session start per brief §7. Transcorp brand tokens, hairline borders, sentence case, no shadows. Modals hand-rolled per AdHocTaskDialog / MerchantStatusModal precedent (no Radix Dialog import).

### Tier + discipline
- Tier: **T3** (new admin routes + permission-gated surfaces + auth-config UI).
- §3.6 hard-stop in force — open PR + STOP for review; do not merge.
- CI gate per brief v1.13 §7.1 — builder reports CI status in PR-open message alongside local tsc + tests.
- Recreate branch `day26/per-merchant-sf-credentials` off main `5f59837`. The Sub-PR 2 worktree at `/Users/lovemans/Code/planner-d26-sf-creds-svc` is stale (its branch was deleted on Sub-PR 2 merge) — remove it before re-adding under the same name.

### Plan deviations to know about (from Sub-PR 2)
- `resolveSuiteFleetCredentials` signature is `(tenantId: Uuid)` — NOT `(ctx, tenantId)` as the v1.14 plan §4.1 sketched. The fresh session should consume the existing signature; no need to re-relitigate.
- `storeSuitefleetCredentials` takes `invalidateSession` as a DI parameter — Sub-PR 3 wires the real adapter call at the action layer (see watch-item above).

---

## Open external dependency (NOT blocking Sub-PR 3)

Aqib / SuiteFleet API-key auth-header reply still pending. Does **NOT** block Sub-PR 3 — the api_key path is stubbed (`ConfigurationError` thrown by `loginApiKey`); the UI builds regardless. When the reply lands, a small follow-on T2 PR wires the `loginApiKey` body + one integration spec.

The UI in Sub-PR 3 will:
- Show api_key regions as fully selectable in the region picker
- Render the API Key / Secret Key labels on `/admin/merchants/[id]/credentials` for api_key-region tenants
- Successfully provision Vault credentials for api_key tenants
- Fail closed at push time (the `loginApiKey` stub throws `ConfigurationError`)

This is the v1.15 dual-path posture working as designed — sandbox keeps pushing via OAuth; production regions stay un-pushable until the api_key body lands.

---

## Standing items (Love's actions, not builder's)

These do **not** block Sub-PR 3 PR-open + CI-validation. They block any Vercel promote.

- **Production DB migration of 0024** still pending. Sub-PR 2's runtime code reads the new columns; CI's ephemeral DB has its own apply path (via the updated `setup-test-db.sh`) and is unaffected, but production needs the migration applied via Supabase SQL editor before any promote.
- **Vercel promote of the Day-26 bundle** — Love's call at the promote boundary. Multiple Day-26 commits accumulated on main (`5f59837` + `913361a` + `09502fa` + `2c36a08` + the Day-25 docs from Session B); promote sequencing is Love's discipline per `memory/followup_vercel_auto_promote_main_to_production.md`.

---

## Reference

- v1.14 plan: `memory/plans/day-25-per-merchant-sf-credentials.md`
- v1.15 amendment: `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`
- Brief: `PLANNER_PRODUCT_BRIEF.md` §3.1.4 services + §3.2.1 admin routes + §3.6 four-layer model + §3.7 security posture (brief on main is v1.15)
- Canonical teardown skeleton (for any new integration specs Sub-PR 3 adds): `memory/followup_audit_rule_cascade_conflict.md` (🔴 LOAD-BEARING)
- Branch sequencing memo (Option A reuse): `memory/followup_t3_plan_code_branch_sequencing.md`

---

End of mid-day handoff. Builder stands down post-filing.
