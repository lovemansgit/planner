-- =============================================================================
-- supabase/migrations/0004_consignee.sql
-- =============================================================================
-- Day 3 / C-1: consignees table — first domain entity built on the Day-2
-- identity + audit foundation. Single delivery address per row in pilot per
-- the Day-3 brief §5; second-address support comes from a separate
-- consignee_addresses table in Phase 2 (out of pilot scope).
--
-- Plan §11.3 non-negotiables:
--   - RLS enabled on every multi-tenant table BEFORE the table holds data.
--   - Migrations are forward-only — never edit this file once applied.
--
-- RLS policy form: same defensive `NULLIF(current_setting(..., true), '')::uuid`
-- shape used in 0001_identity.sql and 0002_audit.sql. See deviation note in
-- 0001 header for the full reasoning (fail-closed on unset/cleared session
-- variable; no `invalid_text_representation` cast errors against the empty
-- string that `withServiceRole` writes).
--
-- Index strategy:
--   1. (tenant_id)               — list-by-tenant scans (the /consignees page,
--                                  service-layer queries through withTenant).
--   2. (tenant_id, phone)        — supports duplicate-phone detection in the
--                                  bulk-import validation (Day 7-9 CSV flow).
--                                  tenant_id-prefixed because every lookup is
--                                  tenant-scoped under RLS.
--
-- GRANT: 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future tables
-- created by `postgres` automatically grant CRUD to `planner_app`. The
-- explicit GRANT below is belt-and-braces — the migration is self-contained,
-- so anyone reading the file can confirm RLS-enforced access without having
-- to trace back to 0003's defaults.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- consignees
-- -----------------------------------------------------------------------------
-- Address shape (address_line + emirate_or_region) is intentionally minimal.
-- The pilot operates in the UAE; `emirate_or_region` is text rather than an
-- enum because (a) Transcorp may onboard regional merchants outside the UAE
-- post-pilot, and (b) free-form text matches what comes off CSV imports
-- without a normalization step. Validation lives in the service layer.
--
-- external_ref is the consignee's identifier in the merchant's source system
-- (their CRM, an internal id) — captured for round-tripping and reconciliation.
-- Nullable because direct-entry (UI) consignees won't have one.
--
-- notes_internal is for Transcorp-side ops notes; delivery_notes is what
-- shows up to the driver. Splitting them prevents "do not disturb on Friday"
-- ops chatter from leaking onto a route sheet.
--
-- No soft-delete column in this commit — the `consignee:delete` permission
-- maps to a hard DELETE via RLS-scoped DELETE in C-3/C-4. Soft-delete (per
-- the catalogue description) lands when the audit-history view requirements
-- in plan §13.1 firm up. Hard delete now is reversible because the
-- consignee.deleted audit event captures the row's identity and metadata
-- before the DELETE fires (R-4 emit pattern).
CREATE TABLE consignees (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               text NOT NULL,
  phone              text NOT NULL,
  email              text,
  address_line       text NOT NULL,
  emirate_or_region  text NOT NULL,
  delivery_notes     text,
  external_ref       text,
  notes_internal     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consignees_tenant_id_idx    ON consignees (tenant_id);
CREATE INDEX consignees_tenant_phone_idx ON consignees (tenant_id, phone);

ALTER TABLE consignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY consignees_tenant_isolation ON consignees
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE TRIGGER consignees_set_updated_at
  BEFORE UPDATE ON consignees
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
-- 0003 default privileges already cover this for objects created by `postgres`
-- in `public`; the explicit grants are belt-and-braces (and make this file
-- self-contained for review).
GRANT SELECT, INSERT, UPDATE, DELETE ON consignees TO planner_app;
