-- SANDBOX JUNK CLEANUP — EXPECTED BACKUP ROW COUNT (READ ONLY). Target: qdotjmwqbyzldfuxphei (PROD).
-- Run:  psql "$SUPABASE_DB_URL" -At -f backup-rowcount.sql
-- Prints one number = total rows the backup will contain (cross-check vs Stage-A Query E, ~20k).
WITH snap AS (
  SELECT t.id AS tenant_id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
      AND t.slug ~ '[0-9a-f]{8}'
      AND t.slug NOT IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers', 'transcorp', 'hem', 'mlp', 'demo-bistro', 'demo-bistro1')
)
SELECT 0
    + (SELECT count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM users WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM roles WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM role_assignments WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM api_keys WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM webhook_events WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM task_packages WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM failed_pushes WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM snap))
    + (SELECT count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM snap))
  AS expected_backup_rows;