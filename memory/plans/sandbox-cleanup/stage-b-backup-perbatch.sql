-- SANDBOX JUNK CLEANUP — PER-BATCH BACKUP (READ ONLY). Target: qdotjmwqbyzldfuxphei (PROD).
-- 18 queries, each the same rn-range as the delete batch (same in-DB predicate, identical frozen set).
-- Run each, Download CSV -> memory/handoffs/sandbox-backup-<date>/backup-batch-NNN.csv. Restore: the
-- 'stmt' column ordered by restore_seq is runnable SQL (tenants first; transcorpsb is KEPT so the FK
-- parent exists). The 18 files together are the row-level rollback artifact.
--
-- SCALE CAVEAT: total ~20k rows. If a batch CSV hits the editor's export cap (~1k rows) or any batch is
-- audit_events-heavy, that CSV may truncate. The RECOMMENDED primary rollback artifact at this scale is a
-- Supabase database backup (Dashboard -> Database -> Backups, or confirm PITR covers the window) taken
-- immediately BEFORE the EXECUTE — one click, full fidelity, no row cap. Use these CSVs as the granular
-- secondary. (See plan §5.)
-- Project-ref fingerprint (qdotjmwqbyzldfuxphei) + Sandbox presence. Mismatch = abort, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions WHERE client_id IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');
  IF c <> 4 THEN RAISE EXCEPTION 'FINGERPRINT FAILED: expected 4 canonical regions, found %', c; END IF;
  PERFORM 1 FROM suitefleet_regions WHERE client_id = 'transcorpsb';
  IF NOT FOUND THEN RAISE EXCEPTION 'transcorpsb region missing — STOP'; END IF;
END $$;

-- >>> BATCH 1/18 BACKUP (rn 1..100) — run, Download CSV: backup-batch-001.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 0 AND rn <= 100)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 2/18 BACKUP (rn 101..200) — run, Download CSV: backup-batch-002.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 100 AND rn <= 200)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 3/18 BACKUP (rn 201..300) — run, Download CSV: backup-batch-003.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 200 AND rn <= 300)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 4/18 BACKUP (rn 301..400) — run, Download CSV: backup-batch-004.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 300 AND rn <= 400)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 5/18 BACKUP (rn 401..500) — run, Download CSV: backup-batch-005.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 400 AND rn <= 500)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 6/18 BACKUP (rn 501..600) — run, Download CSV: backup-batch-006.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 500 AND rn <= 600)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 7/18 BACKUP (rn 601..700) — run, Download CSV: backup-batch-007.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 600 AND rn <= 700)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 8/18 BACKUP (rn 701..800) — run, Download CSV: backup-batch-008.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 700 AND rn <= 800)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 9/18 BACKUP (rn 801..900) — run, Download CSV: backup-batch-009.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 800 AND rn <= 900)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 10/18 BACKUP (rn 901..1000) — run, Download CSV: backup-batch-010.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 900 AND rn <= 1000)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 11/18 BACKUP (rn 1001..1100) — run, Download CSV: backup-batch-011.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1000 AND rn <= 1100)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 12/18 BACKUP (rn 1101..1200) — run, Download CSV: backup-batch-012.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1100 AND rn <= 1200)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 13/18 BACKUP (rn 1201..1300) — run, Download CSV: backup-batch-013.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1200 AND rn <= 1300)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 14/18 BACKUP (rn 1301..1400) — run, Download CSV: backup-batch-014.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1300 AND rn <= 1400)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 15/18 BACKUP (rn 1401..1500) — run, Download CSV: backup-batch-015.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1400 AND rn <= 1500)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 16/18 BACKUP (rn 1501..1600) — run, Download CSV: backup-batch-016.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1500 AND rn <= 1600)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 17/18 BACKUP (rn 1601..1700) — run, Download CSV: backup-batch-017.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1600 AND rn <= 1700)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;

-- >>> BATCH 18/18 BACKUP (rn 1701..1759) — run, Download CSV: backup-batch-018.csv
WITH snap AS (
  SELECT t.id AS tenant_id, row_number() OVER (ORDER BY t.id) AS rn
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
),
b AS (SELECT tenant_id FROM snap WHERE rn > 1700 AND rn <= 1759)
SELECT restore_seq, tbl, stmt FROM (
  SELECT 1 AS restore_seq, 'tenants' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM b)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq, 'users' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq, 'roles' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq, 'role_assignments' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq, 'api_keys' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq, 'task_generation_runs' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq, 'tenant_suitefleet_webhook_credentials' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq, 'webhook_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq, 'consignees' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq, 'addresses' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq, 'consignee_crm_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq, 'subscriptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq, 'subscription_address_rotations' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq, 'subscription_exceptions' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq, 'subscription_materialization' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq, 'tasks' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq, 'task_packages' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq, 'failed_pushes' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq, 'asset_tracking_cache' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq, 'outbound_push_failures' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq, 'asset_scan_log' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq, 'audit_events' AS tbl,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM b)   -- 0002:45
) s ORDER BY restore_seq, stmt;
