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
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenants', 'tenants', to_jsonb(x)::text) AS stmt
  FROM tenants x WHERE x.id IN (SELECT tenant_id FROM snap)   -- 0001:65
  UNION ALL
  SELECT 2 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'users', 'users', to_jsonb(x)::text) AS stmt
  FROM users x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:105
  UNION ALL
  SELECT 3 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'roles', 'roles', to_jsonb(x)::text) AS stmt
  FROM roles x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:139
  UNION ALL
  SELECT 4 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'role_assignments', 'role_assignments', to_jsonb(x)::text) AS stmt
  FROM role_assignments x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:193
  UNION ALL
  SELECT 5 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'api_keys', 'api_keys', to_jsonb(x)::text) AS stmt
  FROM api_keys x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0001:218
  UNION ALL
  SELECT 6 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_generation_runs', 'task_generation_runs', to_jsonb(x)::text) AS stmt
  FROM task_generation_runs x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0012:157
  UNION ALL
  SELECT 7 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tenant_suitefleet_webhook_credentials', 'tenant_suitefleet_webhook_credentials', to_jsonb(x)::text) AS stmt
  FROM tenant_suitefleet_webhook_credentials x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0013:148
  UNION ALL
  SELECT 8 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'webhook_events', 'webhook_events', to_jsonb(x)::text) AS stmt
  FROM webhook_events x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0018:74
  UNION ALL
  SELECT 9 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignees', 'consignees', to_jsonb(x)::text) AS stmt
  FROM consignees x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0004:69
  UNION ALL
  SELECT 10 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'addresses', 'addresses', to_jsonb(x)::text) AS stmt
  FROM addresses x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0014:124
  UNION ALL
  SELECT 11 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'consignee_crm_events', 'consignee_crm_events', to_jsonb(x)::text) AS stmt
  FROM consignee_crm_events x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0016:152
  UNION ALL
  SELECT 12 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscriptions', 'subscriptions', to_jsonb(x)::text) AS stmt
  FROM subscriptions x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0009:134
  UNION ALL
  SELECT 13 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_address_rotations', 'subscription_address_rotations', to_jsonb(x)::text) AS stmt
  FROM subscription_address_rotations x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0014:171
  UNION ALL
  SELECT 14 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_exceptions', 'subscription_exceptions', to_jsonb(x)::text) AS stmt
  FROM subscription_exceptions x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0015:136
  UNION ALL
  SELECT 15 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'subscription_materialization', 'subscription_materialization', to_jsonb(x)::text) AS stmt
  FROM subscription_materialization x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0015:212
  UNION ALL
  SELECT 16 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'tasks', 'tasks', to_jsonb(x)::text) AS stmt
  FROM tasks x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0006:125
  UNION ALL
  SELECT 17 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'task_packages', 'task_packages', to_jsonb(x)::text) AS stmt
  FROM task_packages x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0007:109
  UNION ALL
  SELECT 18 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'failed_pushes', 'failed_pushes', to_jsonb(x)::text) AS stmt
  FROM failed_pushes x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0008:139
  UNION ALL
  SELECT 19 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_tracking_cache', 'asset_tracking_cache', to_jsonb(x)::text) AS stmt
  FROM asset_tracking_cache x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0011:165
  UNION ALL
  SELECT 20 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'outbound_push_failures', 'outbound_push_failures', to_jsonb(x)::text) AS stmt
  FROM outbound_push_failures x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0023:101
  UNION ALL
  SELECT 21 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'asset_scan_log', 'asset_scan_log', to_jsonb(x)::text) AS stmt
  FROM asset_scan_log x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0032:42
  UNION ALL
  SELECT 22 AS restore_seq,
         format('INSERT INTO %I SELECT * FROM jsonb_populate_record(NULL::%I, %L::jsonb);',
                'audit_events', 'audit_events', to_jsonb(x)::text) AS stmt
  FROM audit_events x WHERE x.tenant_id IN (SELECT tenant_id FROM snap)   -- 0002:45
) s ORDER BY restore_seq, stmt;