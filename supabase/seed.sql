-- supabase/seed.sql
--
-- Dev/preview-only sandbox tenant seed. NOT for production.
--
-- This file exists to provide a tenant row for sandbox merchant 588
-- (SuiteFleet Client ID: transcorpsb) so the per-tenant webhook URL
-- /api/webhooks/suitefleet/8bfc84b0-c139-4f43-b966-5a12eaa7a302
-- has a corresponding tenants row to resolve credentials against.
--
-- Safety posture: ON CONFLICT (id) DO NOTHING makes this idempotent.
-- The UUID is sandbox-specific and will not collide with any future
-- production tenant. If this file ever runs accidentally against a
-- production database, the result is one stray sandbox-merchant row
-- (cleanup: DELETE FROM tenants WHERE id = '8bfc84b0-c139-4f43-b966-5a12eaa7a302').
--
-- When a real onboarding flow lands post-pilot, this seed file should
-- be retired and the sandbox tenant should be provisioned through the
-- same code path as real merchants. At that point, a script-layer
-- guard with verifiable Supabase project refs is the right safety
-- mechanism — Supabase cloud uses 'postgres' as the database name on
-- every project, so SQL-layer current_database() guards cannot
-- discriminate environments.

INSERT INTO tenants (
  id, slug, name, status, source_of_truth,
  created_at, updated_at,
  migration_gate_status, migration_gate_set_at, migration_gate_set_by
) VALUES (
  '8bfc84b0-c139-4f43-b966-5a12eaa7a302',
  'sandbox-merchant-588',
  'Sandbox Merchant 588 (transcorpsb)',
  'provisioning',
  'planner',
  now(), now(),
  'closed', NULL, NULL
) ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- Backfill suitefleet_customer_code for the sandbox tenant
-- -----------------------------------------------------------------------------
-- Day 8 / D8-4 prep. The `suitefleet_customer_code` column on `tenants`
-- was added by migration 0013 (D8-2); the cron's bulk-push code (D8-4)
-- reads this column per-tenant and passes it as `customer.code` on
-- every SF task-create POST. Without it the `tenant.push_skipped`
-- guard fires and the sandbox tenant's batch is fail-closed every
-- cron pass — never exercising the actual SF push path.
--
-- Sandbox merchant 588 maps to the SF "Planner" test customer; the
-- merchant code SF expects on the wire is 'MPL'. Production pilot
-- codes (Tabchilli=TBC + 2 unknowns) are populated separately at
-- pilot-launch time via operator-side UPDATEs against the production
-- DB; this seed only covers the dev/preview sandbox row.
--
-- Idempotent: unconditional UPDATE that always lands 'MPL' on the
-- sandbox row regardless of prior state. Re-running the seed
-- preserves the value. Operators do not edit sandbox tenant rows by
-- hand; clobbering on re-run is fine in dev/preview per the file
-- header's "NOT for production" posture.
UPDATE tenants
SET suitefleet_customer_code = 'MPL'
WHERE id = '8bfc84b0-c139-4f43-b966-5a12eaa7a302';
