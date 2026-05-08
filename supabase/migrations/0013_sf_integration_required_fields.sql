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
-- Section 2: tenants.suitefleet_customer_code  — per-merchant customerId (DB-backed)
-- =============================================================================
-- THE COLUMN NAME IS HISTORICAL AND MISLEADING. It does NOT store a
-- SuiteFleet `customer.code` AWB-prefix value. It stores the per-merchant
-- numeric `customerId` (588 MPL / 586 DNR / 578 FBU in sandbox), which
-- is the SuiteFleet routing identifier returned by the credential resolver
-- and threaded into every createTask POST as the wire body's `customerId`
-- field.
--
-- Historical framing (now corrected):
--
--   * Day 8 / D8-2 (this migration's authoring): framed the column as
--     the merchant scoping key SF requires in wire body as `customer.code`.
--   * Day 10 (3 May 2026): static analysis surfaced the wire body never
--     carries `customer.code`. The column was reframed as a cron-gate
--     field only — see memory/followup_migration_0013_customer_code_comment_amendment.md.
--   * Day 18 (8 May 2026): A1 architectural correction surfaced the
--     three-identifier-layer model — region `client_id` (env-backed),
--     per-merchant `customerId` (this column, DB-backed), AWB prefix
--     `customer.code` (cosmetic, no routing role). See
--     memory/followup_per_tenant_merchant_id_routing.md and
--     memory/decision_brief_v1_7_amendment_sf_identifier_model.md.
--
-- Resolution path post-A1 (Day 18):
--   src/modules/credentials/suitefleet-resolver.ts reads this column via
--   withServiceRole + sqlTag SELECT keyed by tenant_id, validates against
--   the positive-integer regex /^[1-9]\d*$/, parses to integer, returns
--   as `customerId: number` on SuiteFleetCredentials.
--
-- Validation contract (Option A — resolver throws):
--   - tenant row not found              → CredentialError (tenant_not_found)
--   - column NULL/empty/whitespace-only → CredentialError (missing_customer_code)
--   - column non-positive-integer       → CredentialError (invalid_customer_code)
--   - canonical positive integer        → returned as parsed number
--
-- Three-layer defense-in-depth at runtime (post-A1, intentional —
-- see memory/followup_a1_plan_section_2_5_premise_correction.md):
--   1. β cron filter (list-cron-eligible-tenants.ts:80) excludes tenants
--      where suitefleet_customer_code IS NULL OR ''.
--   2. Per-task race-condition belt (task-push/service.ts:364-394) catches
--      the window where the value was cleared between β enumeration and
--      queue-worker pickup; emits `tenant.push_skipped`.
--   3. Resolver throws at adapter.authenticate — fail-loud for direct
--      probe scripts, future non-cron callers, or any state where the
--      first two layers failed.
--
-- Nullability: column is NULLABLE. SET NOT NULL deferred until every
-- production tenant is backfilled and the production state is known-good.
--
-- Backfill convention (operator-driven, post-onboarding, numeric):
--
--   UPDATE tenants SET suitefleet_customer_code = '588' WHERE slug = 'meal-plan-scheduler';
--   UPDATE tenants SET suitefleet_customer_code = '586' WHERE slug = 'dr-nutrition';
--   UPDATE tenants SET suitefleet_customer_code = '578' WHERE slug = 'fresh-butchers';
--
-- Schema-level column rename to `suitefleet_customer_id` is desirable
-- (column name would align with stored value semantics) but deferred
-- under forward-only-migrations rule + churn cost. This comment is the
-- canonical pointer for future readers.
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
-- Receiver hardening (D8-8) reads this table when a credentials row
-- exists for the tenant (Tier 2 verification). When the row is absent,
-- the receiver falls back to tenant-existence + payload-shape
-- verification only (Tier 1, default for production merchants who
-- don't configure SF webhook credentials per the Day-9 P2 reshape).
-- 401 + audit `webhook.auth_failed` on Tier-2 mismatch only —
-- Tier-1 absence and unknown-tenant probes are silent. See
-- memory/followup_d8_8_webhook_auth_model.md for the auth-model
-- reshape rationale + memory/followup_d8_2_migration_comment_framing.md
-- for the comment-drift finding that triggered this amendment.
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
