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
