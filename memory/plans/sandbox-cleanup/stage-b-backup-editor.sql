-- SANDBOX JUNK CLEANUP — BACKUP via SUPABASE SQL EDITOR (READ ONLY). Target: qdotjmwqbyzldfuxphei (PROD).
-- For Love, entirely in the dashboard SQL editor — no psql, no Terminal, no DB password.
--
-- WHY MANY FILES: the editor caps CSV export at ~1,000 rows; the backup is ~20k rows, so big tables
-- split into 900-row parts. Each query emits one runnable INSERT per row (generated columns such as
-- asset_tracking_cache.awb are omitted — they recompute on restore).
--
-- HOW TO RUN (per block):
--   1) Run QUERY 0 (SIZE CHECK) first. It lists every table's live row count + how many 900-row parts
--      it needs. SKIP any table with rows = 0. If a table's chunks_needed is MORE than the parts
--      provided below for it, STOP and tell the agent.
--   2) For each block below: highlight the whole block -> Run -> "Download CSV" -> save it under the
--      exact name in its "SAVE RESULT AS" label, into  memory/handoffs/sandbox-backup-<date>/ .
--   3) After saving, check the CSV's row count vs QUERY 0. FEWER than expected = it truncated -> STOP
--      and tell the agent. Save files in NN order (parents before children = restore order).
--
-- EXPECTED ROWS PER FILE (cross-check vs Stage-A Query E; grand total ~20k):
--   01_tenants: ~1759 rows (2 files)
--   02_users: expect <900 -> 1 file, or 0 -> skip
--   03_roles: expect <900 -> 1 file, or 0 -> skip
--   04_role_assignments: expect <900 -> 1 file, or 0 -> skip
--   05_api_keys: expect <900 -> 1 file, or 0 -> skip
--   06_task_generation_runs: ~3094 rows (4 files)
--   07_tenant_suitefleet_webhook_credentials: expect <900 -> 1 file, or 0 -> skip
--   08_webhook_events: expect <900 -> 1 file, or 0 -> skip
--   09_consignees: ~1090 rows (2 files)
--   10_addresses: expect <900 -> 1 file, or 0 -> skip
--   11_consignee_crm_events: expect <900 -> 1 file, or 0 -> skip
--   12_subscriptions: expect <900 -> 1 file, or 0 -> skip
--   13_subscription_address_rotations: expect <900 -> 1 file, or 0 -> skip
--   14_subscription_exceptions: expect <900 -> 1 file, or 0 -> skip
--   15_subscription_materialization: expect <900 -> 1 file, or 0 -> skip
--   16_tasks: ~4507 rows (6 files)
--   17_task_packages: expect <900 -> 1 file, or 0 -> skip
--   18_failed_pushes: expect <900 -> 1 file, or 0 -> skip
--   19_asset_tracking_cache: expect <900 -> 1 file, or 0 -> skip
--   20_outbound_push_failures: expect <900 -> 1 file, or 0 -> skip
--   21_asset_scan_log: expect <900 -> 1 file, or 0 -> skip
--   22_audit_events: ~4996 rows (6 files)
--   (Tables not listed: expect <900 -> one file, or 0 -> skip. QUERY 0 is the live authority.)
--
-- RESTORE (break-glass, its own clear — NOT now): run the saved files in NN order. Each file's
-- 'restore_sql' column IS the INSERT statements; to replay in the editor, open the CSV, copy the
-- restore_sql column, paste into a SQL-editor query, Run. Parents insert before children; INSERT is
-- allowed on append-only tables (audit_events / asset_scan_log). Or hand the files to the agent to
-- reassemble one runnable .sql.

-- ============================================================================
-- QUERY 0 — SIZE CHECK (run FIRST; read-only). rows = 0 -> skip; chunks_needed -> # of part files.
-- ============================================================================
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT * FROM (
  SELECT 1 AS nn, 'tenants' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM tenants WHERE id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 2 AS nn, 'users' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM users WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 3 AS nn, 'roles' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM roles WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 4 AS nn, 'role_assignments' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 5 AS nn, 'api_keys' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 6 AS nn, 'task_generation_runs' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 7 AS nn, 'tenant_suitefleet_webhook_credentials' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 8 AS nn, 'webhook_events' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 9 AS nn, 'consignees' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 10 AS nn, 'addresses' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 11 AS nn, 'consignee_crm_events' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 12 AS nn, 'subscriptions' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 13 AS nn, 'subscription_address_rotations' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 14 AS nn, 'subscription_exceptions' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 15 AS nn, 'subscription_materialization' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 16 AS nn, 'tasks' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 17 AS nn, 'task_packages' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 18 AS nn, 'failed_pushes' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 19 AS nn, 'asset_tracking_cache' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 20 AS nn, 'outbound_push_failures' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 21 AS nn, 'asset_scan_log' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM snap)
  UNION ALL
  SELECT 22 AS nn, 'audit_events' AS table_name, count(*) AS rows, ceil(count(*) / 900.0)::int AS chunks_needed FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM snap)
) v ORDER BY nn;

-- >>> SAVE RESULT AS: 01_tenants_part1of2.csv  (part 1/2: rows 1..900)   [0001:65]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS restore_sql
FROM tenants x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 0;

-- >>> SAVE RESULT AS: 01_tenants_part2of2.csv  (part 2/2: rows 901..1800)   [0001:65]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS restore_sql
FROM tenants x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 900;

-- >>> SAVE RESULT AS: 02_users.csv   [0001:105]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS restore_sql
FROM users x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 03_roles.csv   [0001:139]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS restore_sql
FROM roles x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 04_role_assignments.csv   [0001:193]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS restore_sql
FROM role_assignments x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 05_api_keys.csv   [0001:218]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS restore_sql
FROM api_keys x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 06_task_generation_runs_part1of4.csv  (part 1/4: rows 1..900)   [0012:157]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS restore_sql
FROM task_generation_runs x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 0;

-- >>> SAVE RESULT AS: 06_task_generation_runs_part2of4.csv  (part 2/4: rows 901..1800)   [0012:157]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS restore_sql
FROM task_generation_runs x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 900;

-- >>> SAVE RESULT AS: 06_task_generation_runs_part3of4.csv  (part 3/4: rows 1801..2700)   [0012:157]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS restore_sql
FROM task_generation_runs x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 1800;

-- >>> SAVE RESULT AS: 06_task_generation_runs_part4of4.csv  (part 4/4: rows 2701..3600)   [0012:157]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS restore_sql
FROM task_generation_runs x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 2700;

-- >>> SAVE RESULT AS: 07_tenant_suitefleet_webhook_credentials.csv   [0013:148]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS restore_sql
FROM tenant_suitefleet_webhook_credentials x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 08_webhook_events.csv   [0018:74]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS restore_sql
FROM webhook_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 09_consignees_part1of2.csv  (part 1/2: rows 1..900)   [0004:69]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS restore_sql
FROM consignees x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 0;

-- >>> SAVE RESULT AS: 09_consignees_part2of2.csv  (part 2/2: rows 901..1800)   [0004:69]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS restore_sql
FROM consignees x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 900;

-- >>> SAVE RESULT AS: 10_addresses.csv   [0014:124]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS restore_sql
FROM addresses x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 11_consignee_crm_events.csv   [0016:152]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS restore_sql
FROM consignee_crm_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 12_subscriptions.csv   [0009:134]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS restore_sql
FROM subscriptions x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 13_subscription_address_rotations.csv   [0014:171]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS restore_sql
FROM subscription_address_rotations x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 14_subscription_exceptions.csv   [0015:136]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS restore_sql
FROM subscription_exceptions x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 15_subscription_materialization.csv   [0015:212]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS restore_sql
FROM subscription_materialization x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 16_tasks_part1of6.csv  (part 1/6: rows 1..900)   [0006:125]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS restore_sql
FROM tasks x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 0;

-- >>> SAVE RESULT AS: 16_tasks_part2of6.csv  (part 2/6: rows 901..1800)   [0006:125]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS restore_sql
FROM tasks x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 900;

-- >>> SAVE RESULT AS: 16_tasks_part3of6.csv  (part 3/6: rows 1801..2700)   [0006:125]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS restore_sql
FROM tasks x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 1800;

-- >>> SAVE RESULT AS: 16_tasks_part4of6.csv  (part 4/6: rows 2701..3600)   [0006:125]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS restore_sql
FROM tasks x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 2700;

-- >>> SAVE RESULT AS: 16_tasks_part5of6.csv  (part 5/6: rows 3601..4500)   [0006:125]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS restore_sql
FROM tasks x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 3600;

-- >>> SAVE RESULT AS: 16_tasks_part6of6.csv  (part 6/6: rows 4501..5400)   [0006:125]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS restore_sql
FROM tasks x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 4500;

-- >>> SAVE RESULT AS: 17_task_packages.csv   [0007:109]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS restore_sql
FROM task_packages x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 18_failed_pushes.csv   [0008:139]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS restore_sql
FROM failed_pushes x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 19_asset_tracking_cache.csv   [0011:165]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS restore_sql
FROM asset_tracking_cache x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 20_outbound_push_failures.csv   [0023:101]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS restore_sql
FROM outbound_push_failures x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 21_asset_scan_log.csv   [0032:42]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS restore_sql
FROM asset_scan_log x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap);

-- >>> SAVE RESULT AS: 22_audit_events_part1of6.csv  (part 1/6: rows 1..900)   [0002:45]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS restore_sql
FROM audit_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 0;

-- >>> SAVE RESULT AS: 22_audit_events_part2of6.csv  (part 2/6: rows 901..1800)   [0002:45]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS restore_sql
FROM audit_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 900;

-- >>> SAVE RESULT AS: 22_audit_events_part3of6.csv  (part 3/6: rows 1801..2700)   [0002:45]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS restore_sql
FROM audit_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 1800;

-- >>> SAVE RESULT AS: 22_audit_events_part4of6.csv  (part 4/6: rows 2701..3600)   [0002:45]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS restore_sql
FROM audit_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 2700;

-- >>> SAVE RESULT AS: 22_audit_events_part5of6.csv  (part 5/6: rows 3601..4500)   [0002:45]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS restore_sql
FROM audit_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 3600;

-- >>> SAVE RESULT AS: 22_audit_events_part6of6.csv  (part 6/6: rows 4501..5400)   [0002:45]
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
              'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS restore_sql
FROM audit_events x
CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
WHERE x.tenant_id IN (SELECT tenant_id FROM snap)
ORDER BY x.id LIMIT 900 OFFSET 4500;
