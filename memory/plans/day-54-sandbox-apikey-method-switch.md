# Day-54 — per-merchant SF auth-method switch (sandbox api_key enablement): plan

**Lane:** T3, Love-directed Day-53/54 night (`memory/decision_d53_night_sandbox_apikey_lane.md` — ruling verbatim there). Plan-PR then code-PR, both park tonight; migration parks with SQL-TO-APPLY.

## §1 The blocker (Planner-side, grounded)

`auth_method` lives on `suitefleet_regions`, IMMUTABLE post-create (v1.15 §2.1; enforced by `updateRegion` + pinned by `admin-regions-auth-method-immutable.spec.ts`). All sandbox merchants share the ONE `transcorpsb` region row (`oauth`). Ruling 2 requires switching individual existing merchants; ruling 5 requires siblings untouched. Region-level anything cannot express "Demo Bistro api_key, siblings oauth."

## §2 Shape decision (trade-off in three sentences, as directed)

Region-level mutability would flip every merchant on the region at once and unwind a ratified immutability ruling plus its enforcement and tests, then still need per-merchant sequencing bolted on top. A per-merchant override (`tenants.suitefleet_auth_method_override`, nullable, default NULL → region's method) expresses exactly ruling 2 + ruling 5 with one column, one COALESCE in the resolver, and zero change to region semantics or seeds. **Picked: per-merchant override** — region stays the default, the override is the explicit, auditable exception.

## §3 Between-states behavior (ruling-mandated, fail-LOUD)

Flipping a merchant's method makes its existing vault pair semantically WRONG (OAuth username/password would be read as apiKey/secretKey). Therefore the flip action **clears both `suitefleet_credential_*_vault_id` columns in the same transaction** (orphaned Vault ciphertext rows are inert; no delete primitive exists — noted, acceptable). The resolver's EXISTING fail-closed branch (`credentials_not_configured` → `CredentialError`) then fires on any outbound attempt → failed-push visibility surface. No silent queueing, no OAuth fallback, no stale-credential misread. Pinned by an explicit integration test (§5 case 2). Flipping is idempotent-safe: setting the same effective method is a no-op (no credential clearing, no audit emit).

## §4 Build list (code-PR)

1. **Migration `0030_tenants_suitefleet_auth_method_override.sql`** — one nullable text column + CHECK (`'oauth' | 'api_key'`). No default, no backfill. **PARKS; SQL TO APPLY.**
2. **Resolver** — SELECT adds the override; effective method = `override ?? region.auth_method`; discriminated union switches on the effective method. Log line carries the effective method + an `override_active` flag (no plaintext, unchanged posture).
3. **Service** — `setMerchantAuthMethodOverride(ctx, tenantId, method)` in the credentials module: `merchant:update` gate; Zod enum; reads region + current override; no-op if effective method unchanged; else one tx = set override + NULL both vault columns; `invalidateSession(tenantId)` (token cache); emits `merchant.updated` with `changes: { suitefleet_auth_method_override: { before, after } }` + `credentials_cleared: true` metadata. NO new audit event type (reuses the registered `merchant.updated`).
4. **Admin UI** — `/admin/merchants/[id]/credentials`: page state gains the effective method + override; a method-switch control (radio + explicit confirm copy: switching clears stored credentials and the merchant fails loud on SF until new ones are entered); credentials-form labels branch on the EFFECTIVE method (today they branch on the region's). Same write-only posture — existing values stay undisplayable.
5. **Record scrub (ruling-mandated)** — brief amendment **v1.19** (§3.6/§3.7 + §9 append-only entry): sandbox-both-methods correction + the override model; `probe-sf-api-key-auth.mjs` header scrubbed ("no sandbox api_key endpoint" → sandbox-provable); Day-54 append-only annotations on `decision_aqib_api_key_auth_header_verified.md` (rides the plan-PR) and `plans/day-53-sf-apikey-production-auth-lane.md` §1.
6. **Runbook** — `memory/runbooks/day-54-demo-bistro-apikey-proof.md`: Love's exact clicks + the proof sequence + rollback (plan §6).

## §5 Tests (RED-first)

Unit: service fn (gate / validation / no-op / clear+audit), resolver effective-method selection. Real-Postgres integration (extends the discriminated-union spec's harness; migration 0030 applied by `setup-test-db.sh`):
1. Flipped + re-credentialed merchant resolves `api_key` (apiKey/secretKey from the new vault pair).
2. Flipped + NOT re-credentialed merchant throws `CredentialError` (`credentials_not_configured`) — the fail-loud pin.
3. Untouched sibling on the same region still resolves `oauth` with its original credentials.

## §6 Proof staging (NO live execution tonight)

Runbook only. Proof = Love flips Demo Bistro + enters the two sandbox Client Credentials via the admin screen → `loginApiKey` 200 against sandbox wire → one authenticated read call → refresh-wire observation (probe step from #380) ⇒ **Q4 closes on sandbox evidence; the production probe gate inherits the verified shape.** Rollback: flip Demo Bistro back to oauth (clears the api_key pair), re-enter the OAuth sandbox credentials, session cache invalidated — back on the proven path in two admin actions.

## §7 Hard lines

- Nothing executes against live config tonight: no migration apply, no region/merchant change, nothing on the mpl tenant or UAT data. Tomorrow's UAT runs the proven OAuth path regardless of this lane.
- Production regions untouched (already `api_key`; ruling 3 needs nothing).
- No bulk flip tooling (ruling 5 keeps siblings manual-and-later; building bulk now would be gold-plating).
