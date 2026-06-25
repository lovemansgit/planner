-- PURGE #661 — STAGE B (SINGLE-FILE VARIANT): ONE read-only query -> ONE restorable artifact.
-- Target DB: qdotjmwqbyzldfuxphei (PROD). READ ONLY — deletes nothing, writes nothing (SELECT only).
-- Captures every row Stage 1/2/3 will delete: all non-canonical regions + the 54 tenants
-- + every FK-child row (full dependency map). Keyed to the literal 54 ids (frozen below), no pattern.
-- Companion to the 23-file stage-b-backup.sql (kept as an alternative). Use EITHER, not both.
--
-- HOW TO RUN (minimal clicks):
--   Query 1 (SUMMARY): run it, then paste the grid back to the agent to sanity-check completeness.
--   Query 2 (ARTIFACT): run it ONCE, then "Download CSV" -> save as
--     memory/handoffs/purge-661-backup-2026-06-25.csv  (this single file IS the rollback artifact).
--
-- ONE-DOWNLOAD FEASIBILITY: yes — Query 2 is a single SELECT, so its result is one grid and
-- "Download CSV" yields one file. CAVEAT: the editor may *display* only the first ~1000 rows, but
-- the CSV export contains ALL rows. After download, confirm the CSV's data-row count equals the
-- SUM of Query 1's counts. (For these fixture tenants the total is expected to be small.)
--
-- RESTORE (break-glass, its own named clear): the 'stmt' column, ordered by restore_seq, is a
-- runnable script — each cell is a complete INSERT that rebuilds the row from JSON via
-- jsonb_populate_record (regions before tenants before children; INSERT is allowed on
-- audit_events + asset_scan_log — their RULE/trigger block only UPDATE/DELETE). Paste the CSV
-- back to the agent to reassemble an ordered .sql, or run the stmt column top-to-bottom.
-- CAVEAT: faithful for text/uuid/timestamptz/numeric/boolean/jsonb/array/null. No bytea columns
-- exist in this set; if one is ever added, review its round-trip before relying on it.
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

-- ===== QUERY 1 — ROW-COUNT SUMMARY (run; paste the grid to the agent) =====
WITH tgt(tenant_id) AS (VALUES
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
    ('cacb9c62-94b0-4944-8553-bd86666f6c30'::uuid)
)
SELECT * FROM (
  SELECT 1 AS restore_seq, 'suitefleet_regions' AS table_name, count(*) AS n FROM suitefleet_regions WHERE client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar')
  UNION ALL
  SELECT 2 AS restore_seq, 'tenants' AS table_name, count(*) AS n FROM tenants WHERE id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 3 AS restore_seq, 'users' AS table_name, count(*) AS n FROM users WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 4 AS restore_seq, 'roles' AS table_name, count(*) AS n FROM roles WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 5 AS restore_seq, 'role_assignments' AS table_name, count(*) AS n FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 6 AS restore_seq, 'api_keys' AS table_name, count(*) AS n FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 7 AS restore_seq, 'task_generation_runs' AS table_name, count(*) AS n FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 8 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS table_name, count(*) AS n FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 9 AS restore_seq, 'webhook_events' AS table_name, count(*) AS n FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 10 AS restore_seq, 'consignees' AS table_name, count(*) AS n FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 11 AS restore_seq, 'addresses' AS table_name, count(*) AS n FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 12 AS restore_seq, 'consignee_crm_events' AS table_name, count(*) AS n FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 13 AS restore_seq, 'subscriptions' AS table_name, count(*) AS n FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_address_rotations' AS table_name, count(*) AS n FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_exceptions' AS table_name, count(*) AS n FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 16 AS restore_seq, 'subscription_materialization' AS table_name, count(*) AS n FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 17 AS restore_seq, 'tasks' AS table_name, count(*) AS n FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 18 AS restore_seq, 'task_packages' AS table_name, count(*) AS n FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 19 AS restore_seq, 'failed_pushes' AS table_name, count(*) AS n FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 20 AS restore_seq, 'asset_tracking_cache' AS table_name, count(*) AS n FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 21 AS restore_seq, 'outbound_push_failures' AS table_name, count(*) AS n FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 22 AS restore_seq, 'asset_scan_log' AS table_name, count(*) AS n FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM tgt)
  UNION ALL
  SELECT 23 AS restore_seq, 'audit_events' AS table_name, count(*) AS n FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM tgt)
) c ORDER BY restore_seq;

-- ===== QUERY 2 — SINGLE-FILE BACKUP ARTIFACT (run once; Download CSV) =====
WITH tgt(tenant_id) AS (VALUES
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
    ('cacb9c62-94b0-4944-8553-bd86666f6c30'::uuid)
)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'suitefleet_regions' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'suitefleet_regions', 'suitefleet_regions', to_jsonb(x)::text) AS stmt
  FROM suitefleet_regions x WHERE x.client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar')   -- 0024:120 — junk regions (parents of tenants); deleted in Stage 3
  UNION ALL
  SELECT 2 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x WHERE x.id IN (SELECT tenant_id FROM tgt)   -- 0001:65 — the 54 target tenants
  UNION ALL
  SELECT 3 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', 'users', to_jsonb(x)::text) AS stmt
  FROM users x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0001:105 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 4 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0001:139 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 5 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0001:193 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 6 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0001:218 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 7 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0012:157 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 8 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0013:148 tenant_id PK -> tenants CASCADE
  UNION ALL
  SELECT 9 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0018:74 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 10 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0004:69 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 11 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0014:124 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 12 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0016:152 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 13 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0009:134 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0014:171 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0015:136 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 16 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0015:212 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 17 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0006:125 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 18 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0007:109 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 19 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0008:139 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 20 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0011:165 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 21 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0023:101 tenant_id -> tenants CASCADE
  UNION ALL
  SELECT 22 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0032:42 tenant_id -> tenants RESTRICT (Blocker B)
  UNION ALL
  SELECT 23 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x WHERE x.tenant_id IN (SELECT tenant_id FROM tgt)   -- 0002:45 tenant_id -> tenants CASCADE (Blocker A — RULE)
) s ORDER BY restore_seq, stmt;
