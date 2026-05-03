-- =============================================================================
-- supabase/migrations/0013_sf_integration_required_fields.sql
-- =============================================================================
-- Day 8 / D8-2: heaviest schema commit of pilot to date. Three logical
-- sections in one migration, all driven by SuiteFleet integration
-- requirements surfaced through Aqib's Group-1 confirmations and the
-- live webhook capture (post-Day-7-close) — see
-- memory/followup_c3_deferred_day8.md and
-- memory/followup_webhook_auth_architecture.md.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- =============================================================================
-- Section 1: consignees.district  — required by SF LocationPostPayloadDto
-- =============================================================================
-- Aqib Group-1: SF mandates BOTH `district` AND `city` on every
-- consignee location payload. The codebase already carries the field
-- name `district` on the DeliveryAddress contract (no rename needed);
-- the schema is what's missing. Without this column the cron's
-- pre-push payload-build step has no source for the field, and SF
-- rejects every push with a validation error.
--
-- Backfill strategy: placeholder ('UNKNOWN') for existing rows, then
-- SET NOT NULL. Future-Claude reading this:
--   - Existing pilot-tenant consignees may carry no real district info
--     out-of-band. Operators re-input via CSV re-upload (Day 7-9 CSV
--     flow) post-pilot-launch.
--   - 'UNKNOWN' is a sentinel value — application layer should reject
--     pushing a task to SF when consignee.district = 'UNKNOWN' (next-
--     up D8-4 cron-service guard).
--   - Forward-only: a future migration cannot drop the column without
--     a rebuild; chose placeholder backfill over staged-nullable to
--     keep the schema invariant in one PR.
-- =============================================================================

ALTER TABLE consignees ADD COLUMN district text;

UPDATE consignees SET district = 'UNKNOWN' WHERE district IS NULL;

ALTER TABLE consignees ALTER COLUMN district SET NOT NULL;


-- =============================================================================
-- Section 2: tenants.suitefleet_customer_code  — merchant scoping key
-- =============================================================================
-- Live webhook capture confirms SF identifies each pilot merchant via
-- a `customer.code` field (e.g. "TBC" for Tabchilli) on every task
-- create POST. Without it, SF can't scope the create to the right
-- merchant. The cron's payload-build (D8-4) reads this column per-
-- tenant and passes it as `customer.code` on every push.
--
-- Nullability: column is added NULLABLE in this migration. Backfill
-- happens out-of-band on production via operator-side UPDATE, ONE
-- ROW PER PILOT TENANT:
--
--   UPDATE tenants SET suitefleet_customer_code = 'TBC' WHERE slug = '<tabchilli-slug>';
--   UPDATE tenants SET suitefleet_customer_code = '<code>' WHERE slug = '<merchant-2-slug>';
--   UPDATE tenants SET suitefleet_customer_code = '<code>' WHERE slug = '<merchant-3-slug>';
--
-- Codes for merchants 2 and 3 are pending from Love (TBC for Tabchilli
-- is the only one currently known). SET NOT NULL lands in a follow-up
-- migration once all three pilot tenants are backfilled and the
-- production state is known-good.
--
-- D8-4 cron-service guard: the per-tenant push code MUST fail-closed
-- if suitefleet_customer_code IS NULL — emit a `task.push_failed` audit
-- event with reason='missing_customer_code', skip the push, leave the
-- task for the next cron pass. Better than pushing without the field
-- and getting a SF rejection downstream.
-- =============================================================================

ALTER TABLE tenants ADD COLUMN suitefleet_customer_code text;


-- =============================================================================
-- Section 3: tenant_suitefleet_webhook_credentials  — inbound webhook auth
-- =============================================================================
-- Live webhook capture confirms SF auth scheme: `clientid` +
-- `clientsecret` lowercase HTTP headers (NOT Authorization/Bearer/HMAC),
-- per-merchant credentials, static shared-secret pair on every request.
-- One credential pair per tenant — tenant_id is the PRIMARY KEY,
-- enforcing the 1:1 relationship at the schema layer.
--
-- Defence-in-depth posture:
--   - tenant_id is the PK and FK to tenants(id). NOT a denormalised
--     column alongside a separate FK — the row IS the tenant fact, same
--     posture as task_generation_runs (0012). NO *_assert_tenant_match
--     trigger needed; there is no parent FK whose tenant_id this row
--     could disagree with. Confirmed by Love (Day-8 D8-2 PK-only
--     posture call).
--   - RLS ENABLE + tenant_isolation policy in the defensive NULLIF form
--     used everywhere else (0001 deviation note). Fail-closed on unset
--     OR cleared session variable.
--   - client_secret_hash stores bcrypt/argon2 hash, NEVER plaintext.
--     Receiver hardening (D8-8) compares incoming secrets via
--     constant-time bcrypt.compare against this hash.
--   - rotated_at supports the rotation-with-grace flow when an operator
--     cycles credentials in the Day-9 admin UI.
--
-- Receiver hardening (D8-8) reads this table to look up the tenant's
-- credential pair on every webhook POST, then constant-time-compares
-- against the request headers. 401 on mismatch + emit `webhook.auth_failed`.
-- =============================================================================

CREATE TABLE tenant_suitefleet_webhook_credentials (
  tenant_id           uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  client_id           text NOT NULL,
  client_secret_hash  text NOT NULL,
  rotated_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenant_suitefleet_webhook_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_suitefleet_webhook_credentials_tenant_isolation
  ON tenant_suitefleet_webhook_credentials
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER tenant_suitefleet_webhook_credentials_set_updated_at
  BEFORE UPDATE ON tenant_suitefleet_webhook_credentials
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
-- 0003 default privileges already cover this; explicit GRANT below is
-- belt-and-braces (and makes this file self-contained for review).
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_suitefleet_webhook_credentials TO planner_app;
