-- SANDBOX JUNK CLEANUP — SINGLE-FILE BACKUP QUERY (READ ONLY). Target: qdotjmwqbyzldfuxphei (PROD).
-- Emits one INSERT per row for all 1759 junk tenants + every FK-child row, in restore order
-- (tenants first; transcorpsb is KEPT so the FK parent exists). Run with psql -At to bypass the SQL-editor
-- ~1k CSV cap and write ONE runnable restore file:
--   psql "$SUPABASE_DB_URL" -At -f backup-query.sql > sandbox-cleanup-backup-<date>.sql
-- Same frozen predicate as the delete (derived in-DB). See BACKUP-RUNBOOK.md for the full steps.
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT stmt FROM (
  SELECT 1 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', c.cols, c.cols, 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenants'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.id IN (SELECT tenant_id FROM snap)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', c.cols, c.cols, 'users', to_jsonb(x)::text) AS stmt
  FROM users x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', c.cols, c.cols, 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'roles'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', c.cols, c.cols, 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'role_assignments'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', c.cols, c.cols, 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'api_keys'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', c.cols, c.cols, 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_generation_runs'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', c.cols, c.cols, 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tenant_suitefleet_webhook_credentials'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', c.cols, c.cols, 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'webhook_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', c.cols, c.cols, 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignees'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', c.cols, c.cols, 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'addresses'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', c.cols, c.cols, 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'consignee_crm_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', c.cols, c.cols, 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscriptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', c.cols, c.cols, 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_address_rotations'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', c.cols, c.cols, 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_exceptions'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', c.cols, c.cols, 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'subscription_materialization'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', c.cols, c.cols, 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'tasks'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', c.cols, c.cols, 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'task_packages'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', c.cols, c.cols, 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'failed_pushes'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', c.cols, c.cols, 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_tracking_cache'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', c.cols, c.cols, 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'outbound_push_failures'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', c.cols, c.cols, 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'asset_scan_log'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq,
         format('INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', c.cols, c.cols, 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x
  CROSS JOIN LATERAL (SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS cols
                      FROM pg_attribute
                      WHERE attrelid = 'audit_events'::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '') c
  WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0002:45
) s ORDER BY restore_seq, stmt;