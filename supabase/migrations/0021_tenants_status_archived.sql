-- =============================================================================
-- supabase/migrations/0021_tenants_status_archived.sql
-- =============================================================================
-- Day-18 / C-cleanup. Adds 'archived' to tenants.status and flips the
-- 377 fixture-pollution rows to it in the same migration so the
-- /admin/merchants list page shows real demo merchants only.
--
-- Allowlist posture (plan-PR §3.2): keep slug IN ('meal-plan-scheduler',
-- 'dr-nutrition', 'fresh-butchers'); archive everything else (including
-- sandbox-merchant-588 per §3.3 — recoverable via the §5.4 snapshot at
-- memory/decision_test_tenants_cleanup_snapshot.md if later identified
-- as load-bearing).
--
-- Audit-silent (plan-PR §3.5): no merchant.archived event registered.
-- This migration filename + commit message are the durable artifact.
-- Per §A registered-metadata-wins, fabricating per-row audit events for
-- ~377 fixture rows that no operator actually acted on would create
-- misleading attribution history.
--
-- Coordinated with PR #186 (admin merchant list page) and PR #187 (A1
-- resolver swap). Atomic bundle: schema + TypeScript union + helper
-- exhaustive switches + repository default-exclude filter all land in
-- one PR because TS exhaustive switches over TenantStatus would fail
-- to compile if these changes split across PRs.
-- =============================================================================

-- Widen the CHECK constraint to admit 'archived' as a fifth value.
-- Constraint name verified at code-PR Checkpoint-1 against the live DB:
-- `tenants_status_check` is the Postgres-auto-generated name for the
-- inline CHECK declared at 0001_identity.sql:69-70.
ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('provisioning', 'active', 'suspended', 'inactive', 'archived'));

-- Flip non-demo rows to 'archived'. Allowlist preserved: demo-three
-- only. sandbox-merchant-588 archived alongside the prefix fixtures
-- (plan-PR §3.3); recovery is via the §5.4 snapshot if reviewer later
-- identifies it as load-bearing.
--
-- Idempotent — re-running this UPDATE is a no-op once rows already
-- carry status='archived' (the `status != 'archived'` clause is the
-- defensive belt; without it the UPDATE would still succeed but would
-- bump updated_at on every re-apply, creating spurious row-version
-- noise).
UPDATE tenants
SET status = 'archived'
WHERE slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers')
  AND status != 'archived';
