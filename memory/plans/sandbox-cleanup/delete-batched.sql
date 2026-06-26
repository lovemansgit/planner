-- SANDBOX JUNK CLEANUP — BATCHED DELETE (committed frozen table). Target: qdotjmwqbyzldfuxphei (PROD).
-- 1759 junk tenants on transcorpsb (KEPT region), 18 batches of <= 100. No region delete.
--
-- EDITOR-SAFE DESIGN: each section freezes the junk set into a NORMAL table _sandbox_junk_frozen and
-- COMMITs it BEFORE the batches, so it survives the per-batch ROLLBACKs (a TEMP table did not — the
-- editor wraps the script in one implicit transaction, so batch 1's ROLLBACK unwound it -> 42P01). The
-- freeze guard (== 1759) runs ONCE before any delete, so DRY-RUN and EXECUTE use the IDENTICAL frozen
-- set and the dry-run faithfully predicts the execute. Batches consume disjoint rn-ranges of the static
-- frozen table (deletes never shrink it). Watch the NOTICE lines for per-batch verify.
--
-- HOW TO RUN: paste and Run the DRY-RUN SECTION as ONE block; confirm every "BATCH k/18 verified: 0
-- residual" NOTICE and that nothing errored. Then, on Love's named clear, paste and Run the EXECUTE
-- SECTION as ONE block. Each section creates + drops its own _sandbox_junk_frozen.
-- If a section ABORTS mid-run, the helper table may remain — clean it with:
--   DROP TABLE IF EXISTS _sandbox_junk_frozen;
-- DRY-RUN is data-safe: it commits/drops only the helper table (net nothing) and rolls back ALL deletes.
-- If EXECUTE is interrupted, committed batches stand (junk; safe partial). To resume: re-audit the now-
-- smaller junk_count and regenerate (the == 1759 freeze guard will intentionally abort a stale re-run).

-- ############################################################
-- # DRY-RUN SECTION  (every batch ends ROLLBACK — changes NOTHING)
-- ############################################################
-- Clean any leftover from a prior aborted run, then freeze the junk set (derived ONCE; not a live
-- pattern per batch). rn = stable ORDER BY id for deterministic, disjoint batch ranges.
DROP TABLE IF EXISTS _sandbox_junk_frozen;
CREATE TABLE _sandbox_junk_frozen (tenant_id uuid PRIMARY KEY, rn int);
INSERT INTO _sandbox_junk_frozen (tenant_id, rn)
SELECT t.id, row_number() OVER (ORDER BY t.id)
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1');

-- Project-ref fingerprint (qdotjmwqbyzldfuxphei) + Sandbox presence. Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions WHERE client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');
  IF c <> 4 THEN RAISE EXCEPTION 'FINGERPRINT FAILED: expected 4 canonical regions, found %', c; END IF;
  PERFORM 1 FROM suitefleet_regions WHERE client_id = 'transcorpsb';
  IF NOT FOUND THEN RAISE EXCEPTION 'transcorpsb region missing — STOP'; END IF;
END $$;

-- FREEZE GUARD: frozen set size MUST equal the Stage-A audited junk_count (1759). Runs ONCE,
-- before any delete -> valid in BOTH dry-run and execute. If the live count drifted, abort.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _sandbox_junk_frozen;
  IF n <> 1759 THEN
    RAISE EXCEPTION 'FREEZE GUARD: frozen set has % rows, expected audited 1759 — re-audit, do NOT proceed', n;
  END IF;
END $$;

-- SCOPE FENCE: every frozen id is on transcorpsb + has an 8-hex run + is NOT allowlisted.
-- (Tautological vs the predicate above — defense in depth; the 11 keep-set can never be here.)
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t
  WHERE t.id IN (SELECT tenant_id FROM _sandbox_junk_frozen)
    AND ( t.suitefleet_region_id <> (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb')
          OR t.slug !~ '[0-9a-f]{8}'
          OR t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1') );
  IF bad <> 0 THEN RAISE EXCEPTION 'SCOPE FENCE: % frozen id(s) off-Sandbox / non-hex(keep-set) / allowlisted — STOP', bad; END IF;
END $$;

-- Persist the validated frozen set so the per-batch ROLLBACKs below cannot unwind it (the core editor
-- fix). In a wrapping editor this COMMIT commits the leading statements; in an auto-commit editor it is a
-- harmless "no transaction in progress" notice. Either way _sandbox_junk_frozen is committed here.
COMMIT;

-- ===== BATCH 1/18  (rn 1..100, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 1 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 1/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 2/18  (rn 101..200, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 2 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 2/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 3/18  (rn 201..300, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 3 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 3/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 4/18  (rn 301..400, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 4 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 4/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 5/18  (rn 401..500, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 5 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 5/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 6/18  (rn 501..600, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 6 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 6/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 7/18  (rn 601..700, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 7 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 7/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 8/18  (rn 701..800, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 8 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 8/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 9/18  (rn 801..900, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 9 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 9/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 10/18  (rn 901..1000, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 10 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 10/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 11/18  (rn 1001..1100, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 11 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 11/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 12/18  (rn 1101..1200, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 12 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 12/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 13/18  (rn 1201..1300, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 13 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 13/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 14/18  (rn 1301..1400, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 14 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 14/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 15/18  (rn 1401..1500, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 15 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 15/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 16/18  (rn 1501..1600, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 16 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 16/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 17/18  (rn 1601..1700, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 17 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 17/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
ROLLBACK;

-- ===== BATCH 18/18  (rn 1701..1759, 59 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 18 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 18/18 verified: 0 residual (tenant + all FK children), % tenants', 59;
END $$;
ROLLBACK;

-- CLEANUP: drop the frozen helper table. If the script ABORTED at a batch above, this line may not have
-- run — then run it manually to clean up:  DROP TABLE IF EXISTS _sandbox_junk_frozen;
DROP TABLE IF EXISTS _sandbox_junk_frozen;

-- ############################################################
-- # EXECUTE SECTION  (every batch ends COMMIT — runs ONLY on Love's named clear)
-- ############################################################
-- Clean any leftover from a prior aborted run, then freeze the junk set (derived ONCE; not a live
-- pattern per batch). rn = stable ORDER BY id for deterministic, disjoint batch ranges.
DROP TABLE IF EXISTS _sandbox_junk_frozen;
CREATE TABLE _sandbox_junk_frozen (tenant_id uuid PRIMARY KEY, rn int);
INSERT INTO _sandbox_junk_frozen (tenant_id, rn)
SELECT t.id, row_number() OVER (ORDER BY t.id)
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1');

-- Project-ref fingerprint (qdotjmwqbyzldfuxphei) + Sandbox presence. Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions WHERE client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');
  IF c <> 4 THEN RAISE EXCEPTION 'FINGERPRINT FAILED: expected 4 canonical regions, found %', c; END IF;
  PERFORM 1 FROM suitefleet_regions WHERE client_id = 'transcorpsb';
  IF NOT FOUND THEN RAISE EXCEPTION 'transcorpsb region missing — STOP'; END IF;
END $$;

-- FREEZE GUARD: frozen set size MUST equal the Stage-A audited junk_count (1759). Runs ONCE,
-- before any delete -> valid in BOTH dry-run and execute. If the live count drifted, abort.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _sandbox_junk_frozen;
  IF n <> 1759 THEN
    RAISE EXCEPTION 'FREEZE GUARD: frozen set has % rows, expected audited 1759 — re-audit, do NOT proceed', n;
  END IF;
END $$;

-- SCOPE FENCE: every frozen id is on transcorpsb + has an 8-hex run + is NOT allowlisted.
-- (Tautological vs the predicate above — defense in depth; the 11 keep-set can never be here.)
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t
  WHERE t.id IN (SELECT tenant_id FROM _sandbox_junk_frozen)
    AND ( t.suitefleet_region_id <> (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb')
          OR t.slug !~ '[0-9a-f]{8}'
          OR t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1') );
  IF bad <> 0 THEN RAISE EXCEPTION 'SCOPE FENCE: % frozen id(s) off-Sandbox / non-hex(keep-set) / allowlisted — STOP', bad; END IF;
END $$;

-- Persist the validated frozen set so the per-batch ROLLBACKs below cannot unwind it (the core editor
-- fix). In a wrapping editor this COMMIT commits the leading statements; in an auto-commit editor it is a
-- harmless "no transaction in progress" notice. Either way _sandbox_junk_frozen is committed here.
COMMIT;

-- ===== BATCH 1/18  (rn 1..100, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 0 AND rn <= 100))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 1 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 1/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 2/18  (rn 101..200, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 100 AND rn <= 200))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 2 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 2/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 3/18  (rn 201..300, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 200 AND rn <= 300))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 3 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 3/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 4/18  (rn 301..400, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 300 AND rn <= 400))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 4 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 4/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 5/18  (rn 401..500, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 400 AND rn <= 500))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 5 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 5/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 6/18  (rn 501..600, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 500 AND rn <= 600))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 6 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 6/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 7/18  (rn 601..700, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 600 AND rn <= 700))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 7 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 7/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 8/18  (rn 701..800, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 700 AND rn <= 800))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 8 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 8/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 9/18  (rn 801..900, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 800 AND rn <= 900))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 9 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 9/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 10/18  (rn 901..1000, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 900 AND rn <= 1000))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 10 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 10/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 11/18  (rn 1001..1100, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1000 AND rn <= 1100))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 11 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 11/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 12/18  (rn 1101..1200, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1100 AND rn <= 1200))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 12 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 12/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 13/18  (rn 1201..1300, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1200 AND rn <= 1300))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 13 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 13/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 14/18  (rn 1301..1400, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1300 AND rn <= 1400))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 14 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 14/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 15/18  (rn 1401..1500, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1400 AND rn <= 1500))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 15 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 15/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 16/18  (rn 1501..1600, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1500 AND rn <= 1600))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 16 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 16/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 17/18  (rn 1601..1700, 100 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1600 AND rn <= 1700))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 17 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 17/18 verified: 0 residual (tenant + all FK children), % tenants', 100;
END $$;
COMMIT;

-- ===== BATCH 18/18  (rn 1701..1759, 59 tenants) =====
BEGIN;
-- Blocker A: disable audit_events_no_delete RULE for the batch (covers the explicit audit delete AND
-- the tenant-delete CASCADE probe — the #661 Stage-2 XX000 lesson). Re-enabled before COMMIT/ROLLBACK.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
-- Blocker B: asset_scan_log append-only GUC escape (harmless if 0 rows).
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;
-- Per-batch verify (every-row-verified): tenant + all 22 FK-child tables must be 0 for this rn-range.
DO $$
DECLARE residual bigint;
BEGIN
  SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _sandbox_junk_frozen WHERE rn > 1700 AND rn <= 1759))
  INTO residual;
  IF residual <> 0 THEN RAISE EXCEPTION 'BATCH 18 VERIFY: % residual row(s) — STOP', residual; END IF;
  RAISE NOTICE 'BATCH 18/18 verified: 0 residual (tenant + all FK children), % tenants', 59;
END $$;
COMMIT;

-- FINAL VERIFY: zero junk tenants remain on transcorpsb.
SELECT count(*) AS junk_tenants_remaining
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1');
-- Expected 0.

-- CLEANUP: drop the frozen helper table. If the script ABORTED at a batch above, this line may not have
-- run — then run it manually to clean up:  DROP TABLE IF EXISTS _sandbox_junk_frozen;
DROP TABLE IF EXISTS _sandbox_junk_frozen;
