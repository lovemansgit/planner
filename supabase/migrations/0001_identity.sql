-- =============================================================================
-- supabase/migrations/0001_identity.sql
-- =============================================================================
-- Plan §11.2 #7: identity tables (tenants, users, roles, role_assignments,
--                api_keys) with RLS enabled before any data lands.
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
-- Resolutions R-3: tenant isolation via the `app.current_tenant_id` Postgres
--                  session variable, set per-transaction by `withTenant` in
--                  src/shared/db.ts.
-- Resolutions R-1: no `permissions` table — the catalogue is the frozen object
--                  in src/modules/identity/permissions.ts. Roles store identity;
--                  role-to-permission mapping is code (Day 2).
-- Seeds: NONE in this migration — schema and RLS only. The four built-in roles
--        and any other reference data land in a later migration.
--
-- =============================================================================
-- DEVIATION NOTE (RLS policy form vs R-3's literal example) — approved by Love
-- in commit 9 prep, 2026-04-26.
-- -----------------------------------------------------------------------------
-- R-3's example writes RLS predicates as:
--     USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
-- This file uses the defensive form everywhere:
--     USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
-- Reasoning:
--   1. The `true` second argument to `current_setting` returns NULL when the
--      variable is not set, instead of raising
--      "unrecognized configuration parameter".
--   2. `NULLIF(..., '')` maps the empty string that `withServiceRole` writes
--      (src/shared/db.ts L84: `set_config('app.current_tenant_id', '', true)`)
--      into NULL, instead of attempting to cast '' to uuid and raising
--      `invalid_text_representation`.
--   3. Combined effect — unset OR cleared session variable evaluates to
--      `tenant_id = NULL`, FALSE under SQL three-valued logic, every row
--      filtered out: fail-closed.
-- This is the same shape of deviation PR #9 made to R-3's `SET LOCAL` example
-- (using `set_config(..., true)` for parameter-bound safety). R-3's intent —
-- correct, defensive tenant isolation — is preserved and strengthened.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- updated_at trigger function
-- -----------------------------------------------------------------------------
-- The DEFAULT now() on updated_at columns only fires on INSERT. To keep the
-- timestamp honest across UPDATEs, attach this trigger to every table that
-- carries an updated_at column. Lives at file scope so 0001 is the canonical
-- home for the function — later migrations reference it without redefining.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
-- Minimum viable shape for commit 9 (per commit-9 prep approval).
-- cutoff_time / T-N / timezone columns land with the subscriptions migration
-- where they belong domain-wise.
CREATE TABLE tenants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'provisioning'
                    CHECK (status IN ('provisioning', 'active', 'suspended', 'inactive')),
  -- Resolutions C-19 / Plan §5.3: per-tenant consignee source-of-truth.
  -- Pilot forces 'planner' for all three merchants; 'suitefleet' is stubbed,
  -- runtime returns 501 in pilot per resolutions §2.10.
  source_of_truth text NOT NULL DEFAULT 'planner'
                    CHECK (source_of_truth IN ('planner', 'suitefleet')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Tenants table is special — the scoping column is `id`, not `tenant_id`.
-- Tenant onboarding (creating a tenant row) runs through `withServiceRole`
-- because no session tenant_id exists yet at that moment.
CREATE POLICY tenants_self_isolation ON tenants
  FOR ALL
  USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- users — mirror of auth.users for joins. Supabase Auth owns identity itself.
-- -----------------------------------------------------------------------------
-- The PK is also the FK to auth.users, with ON DELETE CASCADE so deleting a
-- Supabase Auth user automatically tears down our mirror row + role assignments.
-- email is NOT NULL — every Supabase Auth user has an email by definition,
-- the mirror reflects the invariant.
CREATE TABLE users (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  display_name  text,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_tenant_id_idx ON users (tenant_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_tenant_isolation ON users
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
-- Built-in roles (seeded later, NOT in this commit) carry tenant_id IS NULL —
-- they are visible to every tenant. Custom roles (post-pilot per §13.1) carry
-- tenant_id = <tenant>. Plan §9.1 says `unique(tenant_id, name)`; we use
-- NULLS NOT DISTINCT (Postgres 15+) so there can only be one global row per
-- name — without it, multiple (NULL, 'Tenant Admin') rows would be permitted
-- and the seed script could silently duplicate.
CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_tenant_name_unique UNIQUE NULLS NOT DISTINCT (tenant_id, name),
  CONSTRAINT roles_tenant_slug_unique UNIQUE NULLS NOT DISTINCT (tenant_id, slug)
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- SELECT: tenants see global built-in roles AND their own custom roles.
CREATE POLICY roles_select ON roles
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- INSERT/UPDATE/DELETE: only on the tenant's own custom roles. Built-in roles
-- are managed via `withServiceRole` (which bypasses RLS once the Day-2 db.ts
-- fix lands; see open follow-up "Day-2 RLS BYPASSRLS hole" in project memory).
CREATE POLICY roles_insert ON roles
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY roles_update ON roles
  FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY roles_delete ON roles
  FOR DELETE
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER roles_set_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- role_assignments
-- -----------------------------------------------------------------------------
-- Plan §9.1: unique(user_id, role_id, tenant_id). The C-21 invariant
-- ("at least one Tenant Admin per tenant") is NOT enforced here — it lives in
-- the identity service layer per commit-9 prep approval.
-- No updated_at column — assignments are immutable once created (delete + recreate
-- to change), so no updated_at trigger.
CREATE TABLE role_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_assignments_unique UNIQUE (user_id, role_id, tenant_id)
);

CREATE INDEX role_assignments_user_idx   ON role_assignments (user_id);
CREATE INDEX role_assignments_tenant_idx ON role_assignments (tenant_id);

ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_assignments_tenant_isolation ON role_assignments
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


-- -----------------------------------------------------------------------------
-- api_keys — Plan §7.7 + Resolutions §2.5 (forbidden-permission set enforced
--            at the service layer, not here).
-- -----------------------------------------------------------------------------
-- No updated_at column — api_keys carry distinct lifecycle timestamps
-- (created_at, last_used_at, revoked_at) so a generic updated_at would
-- conflate semantic events. No updated_at trigger.
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  -- argon2id PHC string. Never recoverable. Lookup via secure compare.
  hash            text NOT NULL UNIQUE,
  -- Canonical "resource:action" identifiers per plan §7.3 / resolutions R-1.
  -- Validated at the service layer against the frozen catalogue and the
  -- API_KEY_FORBIDDEN_PERMISSIONS set (resolutions §2.5).
  permissions     text[] NOT NULL DEFAULT '{}'::text[],
  -- Optional CIDR/IP allowlist; NULL means no IP restriction.
  ip_allowlist    inet[],
  -- Optional per-key rate limit, requests-per-minute. NULL = use tenant default.
  rate_limit_rpm  integer,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

CREATE INDEX api_keys_tenant_id_idx ON api_keys (tenant_id);
-- Active-keys partial index speeds up the gateway's "is this key live?" lookup.
CREATE INDEX api_keys_active_idx    ON api_keys (tenant_id) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_tenant_isolation ON api_keys
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
