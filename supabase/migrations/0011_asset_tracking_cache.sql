-- =============================================================================
-- supabase/migrations/0011_asset_tracking_cache.sql
-- =============================================================================
-- Day 6 / B-1: asset_tracking_cache — local cache of SuiteFleet's
-- task-asset-tracking records (one row per package). Drives the read-
-- through cache + 5-minute TTL described in
-- memory/decision_bag_tracking_mvp.md and the column shape in
-- memory/followup_suitefleet_asset_tracking_api.md.
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive
--   `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`
-- shape used in 0001/0002/0004/0005/0006/0007. See deviation note in 0001 header.
--
-- -----------------------------------------------------------------------------
-- Why a cache table at all (instead of read-through-only)
-- -----------------------------------------------------------------------------
-- SF's `task-asset-tracking` endpoint is the authoritative source. A pure
-- read-through model (GET on every UI render) would hammer SF's rate limit
-- and create operator-visible latency on every dashboard refresh. The
-- hybrid model is: keep a local cache, refresh on TTL miss or webhook
-- event, serve UI reads from the cache. See decision memo for the load
-- math and TTL rationale.
--
-- -----------------------------------------------------------------------------
-- One row per PACKAGE (not per task)
-- -----------------------------------------------------------------------------
-- A single AWB with N packages returns N tracking records from SF. Each
-- has its own `id`, `trackingId` (`<awb>-<index>`), `state`, photo log,
-- and recipient signature blocks. The cache models this 1:1 — the unique
-- key is `tracking_id`. See followup_suitefleet_asset_tracking_api.md
-- "Cardinality" section.
--
-- "Bag tracking" is the operational nickname; SF's API surface is
-- asset-typed. `BAGS` is the only observed value today; `BOX`,
-- `PALLET`, `CONTAINER` are documented as future possibilities. The
-- `type` CHECK is restrictive ({BAGS}) for now; a future migration
-- widens the set when those types appear.
--
-- -----------------------------------------------------------------------------
-- Why denormalised tenant_id (and the matching trigger)
-- -----------------------------------------------------------------------------
-- Same precedent as task_packages (0007) and failed_pushes (0008): RLS
-- predicate stays uniform (`tenant_id = current_tenant`) instead of
-- reaching across tables, and the application layer keeps consistency by
-- always inserting `cache.tenant_id = parent task's tenant_id`.
--
-- The schema-layer enforcement is a BEFORE INSERT OR UPDATE trigger
-- (`asset_tracking_cache_assert_tenant_match`) that asserts
-- `cache.tenant_id = parent task's tenant_id`. The trigger fires under
-- BYPASSRLS callers (e.g. `withServiceRole`), closing the leak vector
-- where a buggy service-role caller could insert a mismatched row.
--
-- -----------------------------------------------------------------------------
-- task_id (uuid FK) AND task_id_external (bigint, SF taskId)
-- -----------------------------------------------------------------------------
-- The B-1 column spec lists `task_id_external` (SF's integer task id)
-- but no internal FK. Adding `task_id uuid NOT NULL REFERENCES tasks(id)`
-- is structural — the tenant-match trigger's parent-tenant lookup needs
-- a stable FK target.
--
-- Why we cannot FK directly to `tasks.external_id`:
--   - `tasks.external_id` is `text` (per 0006), not bigint.
--   - It does not carry a UNIQUE constraint (only a partial index for
--     lookup performance).
--   - A FK requires a UNIQUE / PK target, so direct FK to external_id
--     would force adding UNIQUE — coupling 0006 to this migration's
--     needs is the wrong direction (later table changing earlier).
--
-- Both columns are NOT NULL. The application writes them atomically
-- (cache writes happen during webhook ingestion or read-through GET,
-- after a `SELECT id, tenant_id FROM tasks WHERE external_id = ...`
-- lookup) so divergence between `task_id_external` and the parent's
-- `tasks.external_id::bigint` should not happen. We do not enforce
-- that secondary consistency at the schema layer — adds no defence-in-
-- depth value beyond what the tenant-match trigger already provides.
--
-- -----------------------------------------------------------------------------
-- State enum: 4 values from doc §6.2
-- -----------------------------------------------------------------------------
-- COLLECTED — courier has the asset
-- EN_ROUTE  — asset moving from origin to destination
-- RECEIVED  — handed off at destination
-- RETURNED  — asset came back (returned-to-sender or recovery flow)
--
-- CHECK is restrictive (Option A from B-1 review). Surfacing SF enum-
-- gaps as visible CHECK violations beats silently caching unknown
-- values. The webhook ingestion + cache-write paths (B-2) wrap inserts
-- in structured error handling so a CHECK violation logs to an error
-- queue instead of crashing the handler. CREATED / DELIVERED /
-- CANCELLED are hypothesised but not confirmed; vendor question 1 in
-- followup_suitefleet_asset_tracking_api.md.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
--   1. UNIQUE (tracking_id) — primary lookup key
--   2. (tenant_id, awb)     — supports the `?awbs=<AWB>` cache lookup
--                              ("does this tenant have any cached
--                              packages on this AWB?"), the read-
--                              through service path
--   3. (tenant_id, task_id) — supports the consignee-detail / dashboard
--                              "show all assets on this task" path
--
-- The PRIMARY KEY on id covers single-row lookups; the FK constraints
-- (task_id, tenant_id) create implicit secondary indexes for CASCADE.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future
-- tables created by `postgres` automatically grant CRUD to
-- `planner_app`. Explicit GRANT below is belt-and-braces.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- `awb` as a GENERATED column (defence in depth)
-- -----------------------------------------------------------------------------
-- `awb` is derived from `tracking_id` by stripping the trailing
-- `-<index>` segment (per the SF doc: trackingId format `<awb>-<index>`).
-- Two ways the invariant could be enforced:
--   (a) Application code computes both, schema trusts.
--   (b) Schema computes `awb` from `tracking_id` via a STORED generated
--       column; application code cannot override.
--
-- We pick (b). The application surface still exposes `awb` for query
-- convenience (the `?awbs=<AWB>` lookup is the canonical access pattern),
-- but the cache cannot drift from the trackingId that produced it. A
-- repository write only specifies `tracking_id`; Postgres derives `awb`
-- on commit. This closes the "future writer accidentally splits the
-- two values" defence-in-depth gap surfaced in B-1 review.
--
-- Regex breakdown — `^(.+)-[^-]+$`:
--   - Anchors at start and end.
--   - `.+` greedy capture group (the AWB prefix).
--   - `-[^-]+$` matches the trailing `-<index>` (no embedded dash).
--   - For "MPS-98410409-1" → captures "MPS-98410409".
--   - For "no-dash-suffix" (no trailing -<index>) → no match → returns NULL.
--
-- The companion CHECK on tracking_id pins the format invariant: any
-- trackingId without a `-<index>` suffix is rejected at write time, so
-- the generated column is always non-null. NOT NULL on the generated
-- column is structurally enforced; we declare it explicitly for clarity.

CREATE TABLE asset_tracking_cache (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_id_external       bigint NOT NULL,
  external_record_id     bigint NOT NULL,
  tracking_id            text NOT NULL,
  awb                    text GENERATED ALWAYS AS
                           (substring(tracking_id from '^(.+)-[^-]+$'))
                           STORED NOT NULL,
  type                   text NOT NULL,
  state                  text NOT NULL,
  photos                 jsonb,
  notes                  text,
  supplementary_quantity integer,
  container_id           bigint,
  collected_by           jsonb,
  enroute_by             jsonb,
  received_by            jsonb,
  returned_by            jsonb,
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  last_synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_tracking_cache_tracking_id_unique UNIQUE (tracking_id),
  CONSTRAINT asset_tracking_cache_tracking_id_format
    CHECK (tracking_id ~ '^.+-[^-]+$'),
  CONSTRAINT asset_tracking_cache_type_check
    CHECK (type IN ('BAGS')),
    -- BOX / PALLET / CONTAINER documented as future possibilities
    -- (vendor question 1); widen this constraint when they appear
    -- empirically in production. Constraint is named so a future ALTER
    -- TABLE … DROP CONSTRAINT can target it directly.
  CONSTRAINT asset_tracking_cache_state_check
    CHECK (state IN ('COLLECTED', 'EN_ROUTE', 'RECEIVED', 'RETURNED'))
);

CREATE INDEX asset_tracking_cache_tenant_awb_idx
  ON asset_tracking_cache (tenant_id, awb);

CREATE INDEX asset_tracking_cache_tenant_task_idx
  ON asset_tracking_cache (tenant_id, task_id);

ALTER TABLE asset_tracking_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_tracking_cache_tenant_isolation ON asset_tracking_cache
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER asset_tracking_cache_set_updated_at
  BEFORE UPDATE ON asset_tracking_cache
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- Schema-layer tenant_id consistency invariant
-- -----------------------------------------------------------------------------
-- Asserts asset_tracking_cache.tenant_id = parent tasks.tenant_id on every
-- INSERT or UPDATE. Fires under BYPASSRLS callers too (triggers run
-- regardless of RLS), so this catches the leak vector that the RLS
-- WITH CHECK on asset_tracking_cache cannot — a withServiceRole caller
-- could otherwise insert a mismatched row because BYPASSRLS skips
-- policy evaluation entirely. Same precedent as
-- task_packages_assert_tenant_match (0007) and
-- failed_pushes_assert_tenant_match (0008).
--
-- The exception type is plain RAISE EXCEPTION — Postgres surfaces it
-- as SQLSTATE P0001 (raise_exception). Application layer treats this
-- as an integrity violation (5xx, not 4xx); should never happen in
-- routine flow because the application also enforces the invariant at
-- the repository layer.
CREATE OR REPLACE FUNCTION asset_tracking_cache_assert_tenant_match()
RETURNS trigger AS $$
DECLARE
  parent_tenant uuid;
BEGIN
  SELECT tenant_id INTO parent_tenant FROM tasks WHERE id = NEW.task_id;
  IF parent_tenant IS NULL THEN
    RAISE EXCEPTION 'asset_tracking_cache.task_id % does not exist', NEW.task_id;
  END IF;
  IF parent_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION
      'asset_tracking_cache.tenant_id % does not match parent task tenant_id %',
      NEW.tenant_id, parent_tenant;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_tracking_cache_tenant_match
  BEFORE INSERT OR UPDATE ON asset_tracking_cache
  FOR EACH ROW
  EXECUTE FUNCTION asset_tracking_cache_assert_tenant_match();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON asset_tracking_cache TO planner_app;
