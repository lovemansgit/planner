-- tests/integration/setup/auth-stub.sql
-- =============================================================================
-- Minimal stub for Supabase's `auth` schema, used in CI and local integration
-- testing against a vanilla Postgres container (where the real `auth` schema
-- is not provided by the platform).
--
-- The application's `users` table in 0001_identity.sql defines:
--     id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
-- That FK requires `auth.users` to exist before 0001 can apply. In Supabase
-- production / preview projects the real `auth.users` is provided by GoTrue
-- and carries the full Supabase Auth schema. In a vanilla Postgres test
-- container there is no GoTrue, so we create just enough columns to satisfy
-- the FK and any test inserts.
--
-- This stub is INTENTIONALLY minimal — it does NOT recreate the full GoTrue
-- shape. Tests that rely on GoTrue-specific columns (encrypted_password,
-- email_confirmed_at, etc.) belong in a different layer of testing.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);
