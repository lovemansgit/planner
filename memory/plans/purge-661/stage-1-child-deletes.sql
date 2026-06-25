-- PURGE #661 — STAGE 1: CHILD DELETES (one transaction). Target: qdotjmwqbyzldfuxphei (PROD).
-- Authorization: separate named Love clear, AFTER Stage-B backup is fully saved.
-- Run the DRY-RUN block first, read the verify output, THEN the EXECUTE block on clear.

-- ============================================================
-- STAGE 1 — DRY RUN (ends ROLLBACK — changes NOTHING)
-- ============================================================
BEGIN;

-- Project-ref fingerprint pre-flight (qdotjmwqbyzldfuxphei). Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions
   WHERE client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');
  IF c <> 4 THEN
    RAISE EXCEPTION 'PROJECT-REF FINGERPRINT FAILED: expected 4 canonical regions, found % — STOP, wrong DB or drift', c;
  END IF;
END $$;

-- Seed the AUTHORITATIVE target set from the literal Stage-A id list (no pattern).
CREATE TEMP TABLE _purge_targets (tenant_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_targets (tenant_id) VALUES
    ('4a0cc2d9-c683-40fa-8cc0-12f1ad1ddf1b'::uuid),
    ('cdd95e8a-b5e6-4861-b19d-3cd92f6b04d9'::uuid),
    ('ed5d5d4d-7c2d-4ea4-9694-ec97931d169f'::uuid),
    ('da52a275-9400-4332-8990-cdd3394d7df5'::uuid),
    ('8e4f013b-e710-4303-adb4-fc5b538b5afc'::uuid),
    ('a9c3703e-4ebe-4c2c-a1e9-46c23b95bcd7'::uuid),
    ('0ae10727-2d28-403c-80fb-2b33e6f6ddea'::uuid),
    ('a07091e4-522f-45c8-9693-ef1128f466d5'::uuid),
    ('a1604e6a-c330-4331-a536-7e655fa4311a'::uuid),
    ('d6aaa464-a845-435b-bc3c-d7dc88489d86'::uuid),
    ('5316e279-b908-4774-9432-298c326438fd'::uuid),
    ('85a28635-3b78-455d-a431-4796afbb916b'::uuid),
    ('67e60381-b6be-4015-87b4-623a919e04a2'::uuid),
    ('2bf91498-7378-47f2-8946-f1b48c81257c'::uuid),
    ('5d4cc356-4b71-4511-bd7d-b600b4588edf'::uuid),
    ('97f79e8a-c515-4b72-81bc-167595c393b2'::uuid),
    ('fb4f0ede-9085-49b5-9053-279f115624d1'::uuid),
    ('d733b5ec-abcf-4764-86f0-2cfaa38db530'::uuid),
    ('e706cda5-7e69-46ff-abfd-b59d5b4480eb'::uuid),
    ('468d69c2-d5f1-4665-b3cf-9f7eac7b3cee'::uuid),
    ('33196097-cd28-4996-9111-1a7655bc4371'::uuid),
    ('f660d0d5-ad75-4c65-b64c-68c0efb9f586'::uuid),
    ('2268b44a-be48-410a-8541-02955a04cf1f'::uuid),
    ('dccc1e44-6807-425e-949e-f39c32e249a4'::uuid),
    ('f8c1ad1f-62dd-48a1-b2e7-c19a30a32071'::uuid),
    ('ca503081-fa2a-4850-897d-5b70fe10bfba'::uuid),
    ('30c77726-3350-4855-9e6f-65fa0971c57c'::uuid),
    ('e314ea24-7128-4caf-866f-26cd1e46c440'::uuid),
    ('82fde736-bef9-4fe4-991f-96a7ec740fc8'::uuid),
    ('d99138ea-0d6a-4e90-bca5-f4e390322477'::uuid),
    ('1d9583d4-e83c-4b3e-acb7-fd0b53ccc189'::uuid),
    ('780140de-0648-4dc4-8d66-f3d400029f39'::uuid),
    ('956bf9af-a034-40f2-8818-69aeef5eda54'::uuid),
    ('1e638746-eb75-4db9-af96-f941bedd1a63'::uuid),
    ('2d87bae2-916c-45f5-b5a2-cbd0538091e5'::uuid),
    ('d3bb2988-51fc-4887-8080-e2b256cef54c'::uuid),
    ('5943b8e0-1675-4415-9374-54ce6d392bcb'::uuid),
    ('510180d6-57ce-4ec2-87c3-be94a039a06d'::uuid),
    ('aa40de6f-91ba-4b9f-8ae9-44812ae96aa0'::uuid),
    ('d8dea240-47e0-4b11-8927-840ba6476fc6'::uuid),
    ('ecd23830-4cb6-484e-91f5-279ce7bee3fe'::uuid),
    ('5f1d924f-7fd0-4243-b4c8-a7a25ac6151e'::uuid),
    ('ba33b974-1e08-4092-a3f5-3d456174c5b9'::uuid),
    ('600bd2f8-6bb7-49e3-90c5-814befa66672'::uuid),
    ('4d5124b1-5e85-46bd-8cc3-6e4bc194a594'::uuid),
    ('5b59b1a8-f19c-46a9-8e83-84c2b75af02d'::uuid),
    ('38cb2d11-6fe6-4cd7-ac33-b9f4ac9b52d9'::uuid),
    ('44a78e59-6bd8-4644-8705-8f22856796b3'::uuid),
    ('f1daceca-5783-49c7-9b11-e478d759e27d'::uuid),
    ('d8c9dbad-87ef-4b80-8fb5-a149a66da668'::uuid),
    ('0e6c4b05-ec2d-4f3a-9ccf-bcbd6363ebdc'::uuid),
    ('f31e69db-b4a1-4f2c-b9b2-6e8e5757c68d'::uuid),
    ('b0bc3ac5-ead4-4e9a-9ac5-9409c6e1f6c9'::uuid),
    ('cacb9c62-94b0-4944-8553-bd86666f6c30'::uuid);

-- Guard: exactly 54 targets AND all 54 still present as tenants.
DO $$
DECLARE n int; m int;
BEGIN
  SELECT count(*) INTO n FROM _purge_targets;
  IF n <> 54 THEN RAISE EXCEPTION 'target count is % (expected 54)', n; END IF;
  SELECT count(*) INTO m FROM tenants WHERE id IN (SELECT tenant_id FROM _purge_targets);
  IF m <> 54 THEN RAISE EXCEPTION 'only %/54 target tenants present — typo or already-deleted; STOP', m; END IF;
END $$;

-- SAFETY GUARD: refuse if ANY target is allowlisted-genuine OR bound to a canonical region.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE t.id IN (SELECT tenant_id FROM _purge_targets)
    AND ( t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
          OR r.client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar') );
  IF bad <> 0 THEN RAISE EXCEPTION 'SAFETY GUARD TRIPPED: % target(s) are genuine/canonical — STOP', bad; END IF;
END $$;

-- Informational: surface predicate drift since Stage-A (does NOT change scope).
DO $$
DECLARE live int;
BEGIN
  SELECT count(*) INTO live
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar')
    AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1');
  IF live <> 54 THEN
    RAISE NOTICE 'NOTE: live junk-tenant predicate now matches % (Stage-A froze 54). Acting ONLY on the frozen 54; review the delta separately.', live;
  END IF;
END $$;

-- Blocker A — audit_events_no_delete RULE (0002:90): disable -> delete -> re-enable.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;

-- Blocker B — asset_scan_log RESTRICT + append-only trigger (0032:42-43,95): GUC escape.
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);

-- Graph deletes (child -> parent). Cascades clear task_packages / failed_pushes /
-- asset_tracking_cache / outbound_push_failures (via tasks) and the subscription_* children.
DELETE FROM tasks                WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
-- task_generation_runs (0012:157): tenant-direct CASCADE, no task FK, leaf -> independent order.
-- Made EXPLICIT (was previously removed only by the Stage-2 tenant cascade; every-row-verified).
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM subscriptions        WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM addresses            WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM consignees           WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);

-- Verify-before-commit: every child table must be 0 for the target set;
-- tenants themselves remain (deleted in Stage 2).
SELECT 'audit_events'   AS tbl, count(*) AS n FROM audit_events   WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'asset_scan_log', count(*) FROM asset_scan_log   WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'tasks',          count(*) FROM tasks            WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'task_packages',  count(*) FROM task_packages    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'failed_pushes',  count(*) FROM failed_pushes    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'asset_tracking_cache', count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'outbound_push_failures', count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'task_generation_runs', count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscriptions',  count(*) FROM subscriptions    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_address_rotations', count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_exceptions', count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_materialization', count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'consignee_crm_events', count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'addresses',      count(*) FROM addresses        WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'consignees',     count(*) FROM consignees       WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'tenants_remaining', count(*) FROM tenants       WHERE id        IN (SELECT tenant_id FROM _purge_targets);
-- All child rows must read 0; tenants_remaining must read 54.

ROLLBACK;

-- ============================================================
-- STAGE 1 — EXECUTE (ends COMMIT — runs ONLY on Love's named clear)
-- ============================================================
BEGIN;

-- Project-ref fingerprint pre-flight (qdotjmwqbyzldfuxphei). Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions
   WHERE client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');
  IF c <> 4 THEN
    RAISE EXCEPTION 'PROJECT-REF FINGERPRINT FAILED: expected 4 canonical regions, found % — STOP, wrong DB or drift', c;
  END IF;
END $$;

-- Seed the AUTHORITATIVE target set from the literal Stage-A id list (no pattern).
CREATE TEMP TABLE _purge_targets (tenant_id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_targets (tenant_id) VALUES
    ('4a0cc2d9-c683-40fa-8cc0-12f1ad1ddf1b'::uuid),
    ('cdd95e8a-b5e6-4861-b19d-3cd92f6b04d9'::uuid),
    ('ed5d5d4d-7c2d-4ea4-9694-ec97931d169f'::uuid),
    ('da52a275-9400-4332-8990-cdd3394d7df5'::uuid),
    ('8e4f013b-e710-4303-adb4-fc5b538b5afc'::uuid),
    ('a9c3703e-4ebe-4c2c-a1e9-46c23b95bcd7'::uuid),
    ('0ae10727-2d28-403c-80fb-2b33e6f6ddea'::uuid),
    ('a07091e4-522f-45c8-9693-ef1128f466d5'::uuid),
    ('a1604e6a-c330-4331-a536-7e655fa4311a'::uuid),
    ('d6aaa464-a845-435b-bc3c-d7dc88489d86'::uuid),
    ('5316e279-b908-4774-9432-298c326438fd'::uuid),
    ('85a28635-3b78-455d-a431-4796afbb916b'::uuid),
    ('67e60381-b6be-4015-87b4-623a919e04a2'::uuid),
    ('2bf91498-7378-47f2-8946-f1b48c81257c'::uuid),
    ('5d4cc356-4b71-4511-bd7d-b600b4588edf'::uuid),
    ('97f79e8a-c515-4b72-81bc-167595c393b2'::uuid),
    ('fb4f0ede-9085-49b5-9053-279f115624d1'::uuid),
    ('d733b5ec-abcf-4764-86f0-2cfaa38db530'::uuid),
    ('e706cda5-7e69-46ff-abfd-b59d5b4480eb'::uuid),
    ('468d69c2-d5f1-4665-b3cf-9f7eac7b3cee'::uuid),
    ('33196097-cd28-4996-9111-1a7655bc4371'::uuid),
    ('f660d0d5-ad75-4c65-b64c-68c0efb9f586'::uuid),
    ('2268b44a-be48-410a-8541-02955a04cf1f'::uuid),
    ('dccc1e44-6807-425e-949e-f39c32e249a4'::uuid),
    ('f8c1ad1f-62dd-48a1-b2e7-c19a30a32071'::uuid),
    ('ca503081-fa2a-4850-897d-5b70fe10bfba'::uuid),
    ('30c77726-3350-4855-9e6f-65fa0971c57c'::uuid),
    ('e314ea24-7128-4caf-866f-26cd1e46c440'::uuid),
    ('82fde736-bef9-4fe4-991f-96a7ec740fc8'::uuid),
    ('d99138ea-0d6a-4e90-bca5-f4e390322477'::uuid),
    ('1d9583d4-e83c-4b3e-acb7-fd0b53ccc189'::uuid),
    ('780140de-0648-4dc4-8d66-f3d400029f39'::uuid),
    ('956bf9af-a034-40f2-8818-69aeef5eda54'::uuid),
    ('1e638746-eb75-4db9-af96-f941bedd1a63'::uuid),
    ('2d87bae2-916c-45f5-b5a2-cbd0538091e5'::uuid),
    ('d3bb2988-51fc-4887-8080-e2b256cef54c'::uuid),
    ('5943b8e0-1675-4415-9374-54ce6d392bcb'::uuid),
    ('510180d6-57ce-4ec2-87c3-be94a039a06d'::uuid),
    ('aa40de6f-91ba-4b9f-8ae9-44812ae96aa0'::uuid),
    ('d8dea240-47e0-4b11-8927-840ba6476fc6'::uuid),
    ('ecd23830-4cb6-484e-91f5-279ce7bee3fe'::uuid),
    ('5f1d924f-7fd0-4243-b4c8-a7a25ac6151e'::uuid),
    ('ba33b974-1e08-4092-a3f5-3d456174c5b9'::uuid),
    ('600bd2f8-6bb7-49e3-90c5-814befa66672'::uuid),
    ('4d5124b1-5e85-46bd-8cc3-6e4bc194a594'::uuid),
    ('5b59b1a8-f19c-46a9-8e83-84c2b75af02d'::uuid),
    ('38cb2d11-6fe6-4cd7-ac33-b9f4ac9b52d9'::uuid),
    ('44a78e59-6bd8-4644-8705-8f22856796b3'::uuid),
    ('f1daceca-5783-49c7-9b11-e478d759e27d'::uuid),
    ('d8c9dbad-87ef-4b80-8fb5-a149a66da668'::uuid),
    ('0e6c4b05-ec2d-4f3a-9ccf-bcbd6363ebdc'::uuid),
    ('f31e69db-b4a1-4f2c-b9b2-6e8e5757c68d'::uuid),
    ('b0bc3ac5-ead4-4e9a-9ac5-9409c6e1f6c9'::uuid),
    ('cacb9c62-94b0-4944-8553-bd86666f6c30'::uuid);

-- Guard: exactly 54 targets AND all 54 still present as tenants.
DO $$
DECLARE n int; m int;
BEGIN
  SELECT count(*) INTO n FROM _purge_targets;
  IF n <> 54 THEN RAISE EXCEPTION 'target count is % (expected 54)', n; END IF;
  SELECT count(*) INTO m FROM tenants WHERE id IN (SELECT tenant_id FROM _purge_targets);
  IF m <> 54 THEN RAISE EXCEPTION 'only %/54 target tenants present — typo or already-deleted; STOP', m; END IF;
END $$;

-- SAFETY GUARD: refuse if ANY target is allowlisted-genuine OR bound to a canonical region.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE t.id IN (SELECT tenant_id FROM _purge_targets)
    AND ( t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
          OR r.client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar') );
  IF bad <> 0 THEN RAISE EXCEPTION 'SAFETY GUARD TRIPPED: % target(s) are genuine/canonical — STOP', bad; END IF;
END $$;

-- Informational: surface predicate drift since Stage-A (does NOT change scope).
DO $$
DECLARE live int;
BEGIN
  SELECT count(*) INTO live
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar')
    AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1');
  IF live <> 54 THEN
    RAISE NOTICE 'NOTE: live junk-tenant predicate now matches % (Stage-A froze 54). Acting ONLY on the frozen 54; review the delta separately.', live;
  END IF;
END $$;

-- Blocker A — audit_events_no_delete RULE (0002:90): disable -> delete -> re-enable.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;

-- Blocker B — asset_scan_log RESTRICT + append-only trigger (0032:42-43,95): GUC escape.
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);

-- Graph deletes (child -> parent). Cascades clear task_packages / failed_pushes /
-- asset_tracking_cache / outbound_push_failures (via tasks) and the subscription_* children.
DELETE FROM tasks                WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
-- task_generation_runs (0012:157): tenant-direct CASCADE, no task FK, leaf -> independent order.
-- Made EXPLICIT (was previously removed only by the Stage-2 tenant cascade; every-row-verified).
DELETE FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM subscriptions        WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM addresses            WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);
DELETE FROM consignees           WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets);

-- Verify-before-commit: every child table must be 0 for the target set;
-- tenants themselves remain (deleted in Stage 2).
SELECT 'audit_events'   AS tbl, count(*) AS n FROM audit_events   WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'asset_scan_log', count(*) FROM asset_scan_log   WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'tasks',          count(*) FROM tasks            WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'task_packages',  count(*) FROM task_packages    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'failed_pushes',  count(*) FROM failed_pushes    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'asset_tracking_cache', count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'outbound_push_failures', count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'task_generation_runs', count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscriptions',  count(*) FROM subscriptions    WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_address_rotations', count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_exceptions', count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'subscription_materialization', count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'consignee_crm_events', count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'addresses',      count(*) FROM addresses        WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'consignees',     count(*) FROM consignees       WHERE tenant_id IN (SELECT tenant_id FROM _purge_targets)
UNION ALL SELECT 'tenants_remaining', count(*) FROM tenants       WHERE id        IN (SELECT tenant_id FROM _purge_targets);
-- All child rows must read 0; tenants_remaining must read 54.

COMMIT;
