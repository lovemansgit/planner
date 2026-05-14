-- =============================================================================
-- 0024_suitefleet_regions_and_per_merchant_credentials.sql — Day 26 / T3
-- =============================================================================
--
-- Brief: PLANNER_PRODUCT_BRIEF.md §3.6 + §3.7 (v1.14 + v1.15 amendments)
-- Plans: memory/plans/day-25-per-merchant-sf-credentials.md (v1.14, in force)
--        memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md
--        (v1.15 overlay — read both together)
--
-- Sub-PR 1 of 3 (schema only). The service layer + resolver +
-- auth-client + admin UI + integration specs land in Sub-PRs 2 and 3.
--
-- Four-layer SF identifier model + region-level auth_method:
--   1. region.client_id     (DB, e.g. transcorpsb)
--   2. region.auth_method   (DB, 'oauth' | 'api_key' — IMMUTABLE post-create)
--   3. tenant.customer_code (DB, numeric merchant id; pre-existing column)
--   4. credential_1 / credential_2 (Supabase Vault — semantics by region.auth_method)
--
-- Vault columns hold:
--   region.auth_method='oauth'   → credential_1=username,   credential_2=password
--   region.auth_method='api_key' → credential_1=api_key,    credential_2=secret_key
--
-- Operators never see "credential_N" — Sub-PR 3's UI labels branch on
-- region.auth_method. The storage column names are intentionally
-- generic so the schema stays auth-method-agnostic. The Sub-PR 2
-- resolver returns a discriminated union typed by auth_method.
--
-- RLS posture for suitefleet_regions: Transcorp-global (no tenant_id).
-- The table enables RLS with NO policies so non-BYPASSRLS callers
-- (planner_app) are denied by default. All region reads/writes route
-- through withServiceRole (BYPASSRLS).
-- =============================================================================
-- Column definitions — suitefleet_regions
-- =============================================================================
--   id uuid:
--     Primary key. Referenced by tenants.suitefleet_region_id (FK).
--
--   client_id text:
--     The SuiteFleet region client identifier (`Clientid` header value
--     on outbound auth/push calls). UNIQUE — one client_id per region.
--     CHECK `^[a-z][a-z0-9]*$` enforces lowercase-alphanumeric starting
--     with a letter, matching SF's documented region naming.
--
--   display_name text:
--     Operator-facing label rendered in the regions list / picker
--     (Sub-PR 3 UI).
--
--   status text CHECK:
--     active | inactive. Deactivating a region makes the resolver
--     fail-closed for tenants still pointing at it — operational
--     kill-switch per brief §3.7.
--
--   auth_method text CHECK:
--     oauth | api_key. IMMUTABLE post-create — updateRegion (Sub-PR 2)
--     omits the field from its Zod schema and rejects mutation
--     attempts. No DEFAULT — every region creation must explicitly
--     select per v1.15 amendment §2.1 (defaulting would silently
--     classify and obscure the operator decision). Sandbox keeps OAuth
--     (preserves the working SF flow); production regions use API Key
--     + Secret Key per SF OpsPortal.
--
--   created_at / updated_at timestamptz:
--     Standard audit timestamps. updated_at maintained by the shared
--     set_updated_at() trigger function (installed in 0001).
-- =============================================================================
-- Column additions — tenants
-- =============================================================================
--   suitefleet_region_id uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT:
--     FK to the region this tenant authenticates through. NOT NULL
--     post-backfill (single-migration per ratified OQ-6). RESTRICT (not
--     SET NULL) because SET NULL would silently break the NOT NULL
--     invariant at runtime; RESTRICT forces an explicit decision before
--     a region can be removed.
--
--     DEFAULT subquery binds new INSERTs to the sandbox region
--     ('transcorpsb'). Sandbox is the safe-default region — every new
--     tenant that does not explicitly choose a region is correctly
--     routed there. This is the same truth the backfill UPDATE
--     encodes, applied to INSERTs going forward. Once Sub-PR 2's
--     createMerchant service supplies a region explicitly the DEFAULT
--     goes dormant; it remains as a defense-in-depth backstop against
--     any tenant-row INSERT path that omits the FK (e.g. test fixtures
--     and seed scripts), and matches production reality.
--
--     OQ-6 edge-case ruling (Day-26): the ratified OQ-6 covered the
--     production mental model (existing tenants get backfilled). It
--     did not address the CI-ephemeral-DB case where this migration
--     runs against zero tenants and downstream integration specs then
--     INSERT tenants that would violate NOT NULL. Adding the DEFAULT
--     preserves OQ-6's single-migration ADD → backfill → SET NOT NULL
--     shape and intent — this is an edge-case clarification, not an
--     OQ-6 override.
--
--   suitefleet_credential_1_vault_id uuid (nullable):
--   suitefleet_credential_2_vault_id uuid (nullable):
--     Supabase Vault UUIDs pointing at pgsodium-AEAD-encrypted plaintext.
--     Generic names per ratified OQ-amend-1 — the auth flavor (username/
--     password vs api_key/secret_key) is interpreted by the parent
--     region.auth_method, not encoded in the column name. Nullable
--     until provisioned via the Sub-PR 3 /admin/merchants/[id]/credentials
--     surface; Sub-PR 2's resolver fails closed when either is NULL.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- suitefleet_regions table
-- -----------------------------------------------------------------------------
CREATE TABLE suitefleet_regions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    text NOT NULL UNIQUE
                 CHECK (client_id ~ '^[a-z][a-z0-9]*$'),
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive')),
  auth_method  text NOT NULL
                 CHECK (auth_method IN ('oauth', 'api_key')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX suitefleet_regions_status_idx
  ON suitefleet_regions (status);


-- -----------------------------------------------------------------------------
-- Seed rows
-- -----------------------------------------------------------------------------
-- Sandbox keeps OAuth (preserves the working SF flow per v1.15).
-- The three production regions ship as api_key per SF OpsPortal.
-- Sub-PR 2's resolver returns a discriminated union typed by auth_method;
-- Sub-PR 2's auth-client login() branches: loginOAuth lives, loginApiKey
-- stubs ConfigurationError until Aqib's header reply lands.
INSERT INTO suitefleet_regions (client_id, display_name, status, auth_method) VALUES
  ('transcorpsb',    'Sandbox',          'active', 'oauth'),
  ('transcorp',      'Transcorp KSA',    'active', 'api_key'),
  ('transcorpuae',   'Transcorp UAE',    'active', 'api_key'),
  ('transcorpqatar', 'Transcorp Qatar',  'active', 'api_key');


-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
-- Match the per-table BEFORE-UPDATE trigger pattern used by tenants /
-- users / roles / role_assignments / api_keys in 0001. The shared
-- set_updated_at() function is installed there.
CREATE TRIGGER suitefleet_regions_set_updated_at
  BEFORE UPDATE ON suitefleet_regions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- RLS — Transcorp-global, deny-by-default
-- -----------------------------------------------------------------------------
-- suitefleet_regions has no tenant_id; it is Transcorp-cross-tenant
-- configuration (per v1.14 plan §2.1). Enable RLS with NO policies so
-- non-BYPASSRLS callers (planner_app) are denied by default. All region
-- reads/writes route through withServiceRole (BYPASSRLS) — the service
-- layer landing in Sub-PR 2 owns the access path.
ALTER TABLE suitefleet_regions ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
-- 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future tables
-- automatically grant CRUD to planner_app. Belt-and-braces explicit
-- GRANT below; RLS (no policies above) still gates effective access for
-- non-BYPASSRLS callers.
GRANT SELECT, INSERT, UPDATE, DELETE ON suitefleet_regions TO planner_app;


-- -----------------------------------------------------------------------------
-- tenants column additions + backfill + NOT NULL
-- -----------------------------------------------------------------------------
-- Single-migration backfill per ratified OQ-6 (tenants is small in
-- production; backfill is microseconds). The UPDATE is idempotent
-- via the IS NULL guard — safe to re-run as a no-op once the column
-- is populated.
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id             uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT
                                                DEFAULT (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb'),
  ADD COLUMN suitefleet_credential_1_vault_id uuid,
  ADD COLUMN suitefleet_credential_2_vault_id uuid;

UPDATE tenants
SET    suitefleet_region_id = (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb')
WHERE  suitefleet_region_id IS NULL;

ALTER TABLE tenants
  ALTER COLUMN suitefleet_region_id SET NOT NULL;
