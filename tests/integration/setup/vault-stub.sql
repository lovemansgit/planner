-- tests/integration/setup/vault-stub.sql
-- =============================================================================
-- CI test stub for Supabase's `vault` schema. Mirrors the auth-stub.sql
-- precedent already in this directory (which stubs `auth.users` for the
-- `users.id REFERENCES auth.users(id)` FK in 0001).
--
-- Vanilla Postgres (the CI postgres:17 service container + local test
-- DBs) does not ship Supabase's vault extension. Production Supabase
-- enables `supabase_vault` (which wraps pgsodium AEAD encryption at
-- rest); the `vault.create_secret` / `.update_secret` functions and
-- the `vault.decrypted_secrets` view sit on top of that encrypted
-- store.
--
-- This stub provides the INTERFACE — not the implementation — so that
-- `src/modules/credentials/vault-store.ts` and the five Vault-touching
-- integration specs in tests/integration/admin-merchants-credentials-*.spec.ts,
-- tests/integration/suitefleet-resolve-credentials*.spec.ts, and
-- tests/integration/suitefleet-push-fail-closed.spec.ts can run
-- unchanged in CI against vanilla Postgres.
--
-- The stub stores plaintext deliberately. pgsodium AEAD encryption at
-- rest is a deployment-time property verified separately by the
-- production `supabase_vault` precondition check (per plan v1.14 §3.1)
-- and is OUT OF SCOPE for code-correctness testing — vault-store.ts
-- treats the layer below as a black box that maps a UUID to a
-- plaintext-on-read.
--
-- READER WARNING: this file does NOT mean "we don't encrypt." The real
-- on-disk encryption happens on production via the real Supabase Vault.
-- This stub emulates only the SQL surface so tests can exercise
-- vault-store.ts unchanged.
--
-- INTERFACE CONTRACT — must match the real Supabase Vault API exactly
-- so vault-store.ts runs unchanged against both stub and real Vault:
--
--   Table: vault.secrets
--     id uuid PK (gen_random_uuid default)
--     name text
--     description text
--     secret text NOT NULL — encrypted in real Vault; plaintext in stub
--     key_id uuid
--     nonce bytea
--     created_at / updated_at timestamptz
--
--   View: vault.decrypted_secrets
--     id, name, description, secret, key_id, nonce, created_at, updated_at,
--     decrypted_secret text — aliases `secret` in stub; AEAD-decrypted
--     via pgsodium in real Vault
--
--   Function: vault.create_secret(
--               new_secret text,
--               new_name text DEFAULT NULL,
--               new_description text DEFAULT ''
--             ) RETURNS uuid
--     Real Vault's signature per Supabase docs; stub matches exactly.
--     vault-store.ts calls the one-arg form; the optional args carry
--     through to keep `SELECT *` shape parity.
--
--   Function: vault.update_secret(
--               secret_id uuid,
--               new_secret text,
--               new_name text DEFAULT NULL,
--               new_description text DEFAULT NULL,
--               new_key_id uuid DEFAULT NULL
--             ) RETURNS void
--     Real Vault's signature per Supabase docs; stub matches exactly.
--     vault-store.ts calls the two-arg form; optional args carry through.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.secrets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text,
  description text,
  secret      text NOT NULL,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT
    id,
    name,
    description,
    secret,
    key_id,
    nonce,
    created_at,
    updated_at,
    secret AS decrypted_secret
  FROM vault.secrets;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret      text,
  new_name        text DEFAULT NULL,
  new_description text DEFAULT ''
) RETURNS uuid AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret)
  VALUES (new_name, new_description, new_secret)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id       uuid,
  new_secret      text,
  new_name        text DEFAULT NULL,
  new_description text DEFAULT NULL,
  new_key_id      uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE vault.secrets
  SET secret      = new_secret,
      name        = COALESCE(new_name, name),
      description = COALESCE(new_description, description),
      key_id      = COALESCE(new_key_id, key_id),
      updated_at  = now()
  WHERE id = secret_id;
END;
$$ LANGUAGE plpgsql;
