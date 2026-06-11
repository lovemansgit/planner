-- =============================================================================
-- 0030_tenants_suitefleet_auth_method_override.sql
-- Day-54 — per-merchant SF auth-method override (sandbox api_key enablement)
-- per plan memory/plans/day-54-sandbox-apikey-method-switch.md §2 + §4.1,
-- under Love's 2026-06-11 correction (memory/decision_d53_night_sandbox_apikey_lane.md):
-- SuiteFleet accepts BOTH auth methods on ALL tenants, sandbox included.
-- =============================================================================
--
-- One nullable column on tenants:
--
--   suitefleet_auth_method_override text NULL
--     CHECK (suitefleet_auth_method_override IN ('oauth', 'api_key'))
--
--   NULL      → the merchant uses its REGION's auth_method (the v1.15
--               default; every existing merchant stays exactly where it
--               is — no backfill, no behavior change on apply).
--   non-NULL  → the merchant's EFFECTIVE method overrides the region's.
--               The resolver computes COALESCE(override, region.auth_method)
--               and interprets the vault credential pair accordingly
--               (oauth → username/password; api_key → apiKey/secretKey).
--
-- The override is written ONLY by setMerchantAuthMethodOverride
-- (credentials service), which clears BOTH vault credential columns in
-- the same transaction whenever the effective method changes — a
-- flipped-but-not-re-credentialed merchant fails LOUD on outbound
-- (resolver 'credentials_not_configured' CredentialError → failed-push
-- visibility), never misreading the old pair under the new semantics.
--
-- Region rows are untouched: suitefleet_regions.auth_method remains
-- IMMUTABLE post-create (v1.15 §2.1). The override is the per-merchant
-- exception, audited via the new credentials.method_changed event.
--
-- No data migration. Purely additive; instant on any row count.

ALTER TABLE tenants
  ADD COLUMN suitefleet_auth_method_override text
    CHECK (suitefleet_auth_method_override IN ('oauth', 'api_key'));

COMMENT ON COLUMN tenants.suitefleet_auth_method_override IS
  'Per-merchant SF auth-method override (Day-54). NULL = use region auth_method. Written only by setMerchantAuthMethodOverride, which clears the vault credential pair on change so half-switched merchants fail loud.';
