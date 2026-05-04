-- =============================================================================
-- supabase/migrations/0014_addresses_and_subscription_address_rotations.sql
-- =============================================================================
-- Day 13 / T3 part 1: address-rotation schema. Implements
-- memory/plans/day-13-exception-model-part-1.md §1.3 + §1.4 + §1.3.1.
--
-- Three artifacts in one migration (atomic per the §0.5 split rationale —
-- subscription_address_rotations.address_id FKs into addresses, and
-- tasks.address_id also FKs into addresses; landing them together avoids a
-- transient state where the FK target is missing):
--
--   1. addresses table — per-consignee address book. Replaces the
--      "consignee_addresses table in Phase 2" deferral comment from
--      0004_consignee.sql:5. MVP needs ≥2 addresses per consignee
--      (Home/Office) for the per-weekday rotation in §3.3.1 of the brief.
--   2. subscription_address_rotations table — per-subscription per-weekday
--      address mapping. Missing rows fall back to the consignee's primary
--      address; the generator's COALESCE pattern (deferred to part 2 per
--      plan §2) implements that fallback.
--   3. tasks.address_id column-add (nullable, locked at plan stage per
--      Condition 3 of conditional approval; see plan §1.3.1) — schema
--      dependency for the part-2 generator code that populates it.
--
-- Plan §11.3 non-negotiables (mirrored from 0012 header):
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007/0008/0009/0011/0012.
--
-- -----------------------------------------------------------------------------
-- Why one address has is_primary partial UNIQUE (instead of pulling primary
-- back into consignees as a FK)
-- -----------------------------------------------------------------------------
-- Two competing shapes were considered:
--
--   A. consignees.primary_address_id uuid REFERENCES addresses(id) — primary
--      is named on the consignee row.
--   B. addresses.is_primary boolean + partial UNIQUE — primary is a flag on
--      one address row.
--
-- Shape B wins for three reasons:
--
--   - Avoids the chicken-and-egg circular dependency on insert (consignee
--      and address both want each other's id at create time).
--   - Switching primary is a single UPDATE (flip the flag) instead of two
--      (clear the FK on consignees, set the FK on consignees) — atomic under
--      a single-row UPDATE.
--   - The partial UNIQUE `WHERE is_primary = true` is the schema-layer
--      guarantee of "at most one primary"; the application layer can attempt
--      a flip in a single tx that toggles old primary off then new primary
--      on, with the partial UNIQUE catching the in-flight inconsistency
--      window if the toggle ordering is wrong.
--
-- Plan §1.3 mentions the inline-fields-on-consignees deprecation (Phase 2);
-- that's also a cleaner story for shape B because deprecation is "drop
-- columns from consignees" rather than "promote one column from foreign-key
-- to nothing."
--
-- -----------------------------------------------------------------------------
-- Why subscription_address_rotations.address_id is ON DELETE RESTRICT (not
-- CASCADE)
-- -----------------------------------------------------------------------------
-- Deleting an address that's actively rotating into a subscription is the
-- kind of operator action that should be loud, not silent. Cascade would
-- mean a deleted address silently un-rotates the subscription onto the
-- primary fallback — operator-visible only at the next materialization,
-- and the audit trail shows "address deleted" without any subscription
-- impact captured.
--
-- ON DELETE RESTRICT forces the operator to enumerate references first
-- (Phase 2 UI: "this address is in use by N subscriptions; remove rotations
-- before deleting"). The same posture applies to tasks.address_id below
-- (RESTRICT, not CASCADE).
--
-- -----------------------------------------------------------------------------
-- tasks.address_id nullability (locked at plan stage per Condition 3)
-- -----------------------------------------------------------------------------
-- Locked nullable. Reasons in plan §1.3.1:
--   - Existing 845+ demo rows have no address_id to backfill.
--   - Brief never declares NOT NULL — making it NOT NULL is plan-side
--     overreach.
--   - Service layer (part 2) handles missing-address validation when
--     materializing new tasks.
--   - Phase 2 promotes to NOT NULL via single-statement
--     `ALTER TABLE … SET NOT NULL` after backfill validates 100% population.
--
-- Backfill: NONE in part 1. Generator code (part 2) populates address_id
-- on new INSERTs; existing rows stay NULL until Phase-2 backfill sweeps.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
-- addresses:
--   1. addresses_tenant_idx (tenant_id) — RLS predicate path + tenant-list scans.
--   2. addresses_consignee_idx (consignee_id) — per-consignee address book lookup.
--   3. addresses_one_primary_per_consignee_idx — partial UNIQUE WHERE is_primary
--      = true; the schema-layer at-most-one-primary guarantee.
--
-- subscription_address_rotations:
--   1. subscription_address_rotations_sub_weekday_idx — UNIQUE (subscription_id,
--      weekday); the schema-layer at-most-one-rotation-per-weekday-per-sub
--      guarantee. Also serves the generator's lookup by (sub, weekday).
--   2. subscription_address_rotations_tenant_idx (tenant_id) — RLS predicate.
--
-- tasks.address_id:
--   1. tasks_address_idx (address_id) — supports the Phase-2 "is this address
--      referenced by historical tasks?" enumeration query for delete-address UI.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future
-- tables created by `postgres` automatically grant CRUD to `planner_app`.
-- Explicit GRANTs below are belt-and-braces.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. addresses
-- -----------------------------------------------------------------------------

CREATE TABLE addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consignee_id  uuid NOT NULL REFERENCES consignees(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label         text NOT NULL,
  is_primary    boolean NOT NULL DEFAULT false,
  line          text NOT NULL,
  district      text NOT NULL,
  emirate       text NOT NULL,
  lat           numeric(9, 6),
  lng           numeric(9, 6),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT addresses_label_check
    CHECK (label IN ('home', 'office', 'other'))
);

CREATE INDEX addresses_tenant_idx
  ON addresses (tenant_id);

CREATE INDEX addresses_consignee_idx
  ON addresses (consignee_id);

-- At-most-one-primary-per-consignee. Partial UNIQUE.
CREATE UNIQUE INDEX addresses_one_primary_per_consignee_idx
  ON addresses (consignee_id) WHERE is_primary = true;

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY addresses_tenant_isolation ON addresses
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER addresses_set_updated_at
  BEFORE UPDATE ON addresses
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON addresses TO planner_app;


-- -----------------------------------------------------------------------------
-- 2. subscription_address_rotations
-- -----------------------------------------------------------------------------

CREATE TABLE subscription_address_rotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  weekday         int  NOT NULL,
  address_id      uuid NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,

  CONSTRAINT subscription_address_rotations_weekday_check
    CHECK (weekday BETWEEN 1 AND 7)
);

-- At-most-one-rotation-per-weekday-per-subscription. UNIQUE.
CREATE UNIQUE INDEX subscription_address_rotations_sub_weekday_idx
  ON subscription_address_rotations (subscription_id, weekday);

CREATE INDEX subscription_address_rotations_tenant_idx
  ON subscription_address_rotations (tenant_id);

ALTER TABLE subscription_address_rotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_address_rotations_tenant_isolation ON subscription_address_rotations
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_address_rotations TO planner_app;


-- -----------------------------------------------------------------------------
-- 3. tasks.address_id (nullable, ON DELETE RESTRICT)
-- -----------------------------------------------------------------------------
-- Schema-only column-add. No backfill. Generator code (part 2) populates
-- this column on new INSERTs.

ALTER TABLE tasks
  ADD COLUMN address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT;

CREATE INDEX tasks_address_idx
  ON tasks (address_id);
