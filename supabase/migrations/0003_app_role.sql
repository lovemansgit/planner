-- =============================================================================
-- supabase/migrations/0003_app_role.sql
-- =============================================================================
-- Resolutions R-0 (Day 2): close the BYPASSRLS hole. Supabase's `postgres`
-- role is a superuser and bypasses RLS. Drizzle has been connecting as that
-- role, which means the RLS policies authored in 0001/0002 are correctly
-- shaped but never filter at runtime — tenant isolation is theoretical, not
-- enforced. This migration creates a non-superuser application role
-- (`planner_app`) that the app pool connects as, so RLS becomes the actual
-- security boundary for `withTenant` queries.
--
-- Two-pool design (src/shared/db.ts after this commit):
--   • app pool        — connects as `planner_app` (NOBYPASSRLS).
--                       Used by `withTenant`. RLS filters on
--                       `app.current_tenant_id`.
--   • superuser pool  — connects as `postgres` (BYPASSRLS).
--                       Used by `withServiceRole` for legitimate
--                       cross-tenant operations: audit inserts (the
--                       audit_events RLS policy in 0002 is FOR SELECT
--                       only, so non-superuser INSERTs would be denied),
--                       built-in role seeds, tenant onboarding, system
--                       cron actors, sysadmin tooling, migrations.
--
-- Plan §11.3 non-negotiable: forward-only — never edit this file once applied.
--
-- -----------------------------------------------------------------------------
-- Out-of-band step required before this migration is useful at runtime
-- -----------------------------------------------------------------------------
-- This migration creates `planner_app` with NOLOGIN. The migration deliberately
-- does NOT set a password — passwords belong out of git. After applying:
--
--   1. Operator runs in Supabase SQL editor (or via psql as the project owner):
--        ALTER ROLE planner_app WITH LOGIN PASSWORD '<generated secret>';
--      Generate the secret with: `openssl rand -base64 32`. Store in 1Password.
--
--   2. Operator builds the connection string using the Supabase pooler host
--      (NOT the direct `db.xxx.supabase.co` host — Supabase Nano is IPv6-only;
--      the pooler is the only reachable path):
--        postgres://planner_app:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
--
--   3. Operator pastes that string into Vercel as `SUPABASE_APP_DATABASE_URL`
--      (Production + Preview + Development). Paste source must be a plain text
--      editor — Excel/Numbers mangle silently
--      (memory: feedback_vercel_credentials_paste_source.md).
--
-- Until step 1 runs, the app pool cannot connect and any `withTenant` query
-- raises a connection error — fail-loud. This is intentional: the alternative
-- (default to superuser if `SUPABASE_APP_DATABASE_URL` is unset) would silently
-- restore the BYPASSRLS hole this migration exists to close.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Create the application role
-- -----------------------------------------------------------------------------
-- NOLOGIN at create time — operator grants LOGIN with a password out-of-band
-- (see header). Explicit NO* attributes pin the security posture even if a
-- future operator uses ALTER ROLE — anyone widening these privileges has to
-- do so deliberately.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'planner_app') THEN
    CREATE ROLE planner_app
      NOLOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      INHERIT;
  END IF;
END
$$;


-- -----------------------------------------------------------------------------
-- Schema USAGE
-- -----------------------------------------------------------------------------
-- public — where every app table lives.
-- auth   — read-only on auth.users for the identity service's mirror joins
--          (users.id REFERENCES auth.users(id)). Read-only because Supabase
--          Auth owns user identity; we never INSERT/UPDATE/DELETE auth.users
--          from app code.
GRANT USAGE ON SCHEMA public TO planner_app;
GRANT USAGE ON SCHEMA auth   TO planner_app;
GRANT SELECT ON auth.users   TO planner_app;


-- -----------------------------------------------------------------------------
-- DML on existing tables (0001 + 0002)
-- -----------------------------------------------------------------------------
-- SELECT/INSERT/UPDATE/DELETE on every current public-schema table. Sequence
-- USAGE/SELECT because gen_random_uuid() defaults handle PKs in our schema,
-- but any future SERIAL/IDENTITY column would need this.
--
-- DDL (CREATE/ALTER/DROP) is intentionally NOT granted — schema changes flow
-- through migrations applied via the superuser connection only.
--
-- TRUNCATE is intentionally NOT granted — it bypasses RLS row-by-row checks
-- and would give a NOBYPASSRLS role an effective wipe primitive on tenant
-- data. App code has no business issuing TRUNCATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO planner_app;
GRANT USAGE,  SELECT                  ON ALL SEQUENCES IN SCHEMA public TO planner_app;


-- -----------------------------------------------------------------------------
-- Default privileges for future tables / sequences
-- -----------------------------------------------------------------------------
-- Without these, every future migration that creates a table would also have
-- to remember to GRANT to planner_app. Default privileges remove that footgun:
-- objects created by `postgres` in the public schema automatically grant the
-- listed verbs to planner_app.
--
-- Scoped to objects created BY the postgres role specifically — `FOR ROLE
-- postgres`. Without this clause, defaults would only apply to objects the
-- *current* role creates, which would silently miss future tables created by
-- migrations run as postgres.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO planner_app;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO planner_app;
