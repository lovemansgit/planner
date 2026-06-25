-- SANDBOX JUNK CLEANUP — STAGE A: AUDIT (READ ONLY — deletes nothing, writes nothing).
-- Target DB: qdotjmwqbyzldfuxphei (PROD). Love runs this FIRST, eyeballs the keep-set,
-- then exports Query D's id column as the frozen target list. The hex-slug pattern proves
-- itself on live data here BEFORE any delete.
--
-- Scope: tenants bound to the CANONICAL Sandbox region transcorpsb (KEPT — no region delete).
-- Junk predicate: slug carries an 8-hex test-isolation run AND is not a genuine-allowlist slug.
--   - hex pattern: un-anchored  [0-9a-f]{8}   (genuine-merchants.ts:75; matched 1,821/1,832 live,
--     the 11 non-matches were exactly the genuine tenants — genuine-merchants.ts:16-17).
--   - real example junk slug shape: 'r3-test-74a6b577-a' / 'det-db4cd52c-full' (the 8-hex run
--     sits mid-slug, hence UN-anchored).
-- Keep-set: everything else on transcorpsb (no 8-hex run, OR a genuine-allowlist slug) — the ~11 real.

-- Project-ref fingerprint pre-flight. Mismatch = STOP, never re-scope.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions
   WHERE client_id IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar');
  IF c <> 4 THEN RAISE EXCEPTION 'FINGERPRINT FAILED: expected 4 canonical regions, found % — wrong DB?', c; END IF;
  PERFORM 1 FROM suitefleet_regions WHERE client_id = 'transcorpsb';
  IF NOT FOUND THEN RAISE EXCEPTION 'transcorpsb (Sandbox) region not found — STOP'; END IF;
END $$;

-- ============================================================================
-- QUERY A — JUNK COUNT (delete candidates): on transcorpsb, hex-matching, not allowlisted.
-- ============================================================================
SELECT count(*) AS junk_count
FROM tenants t
JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb'
  AND t.slug ~ '[0-9a-f]{8}'
  AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers','transcorp',
                     'hem','mlp','demo-bistro','demo-bistro1');
-- (~1,821 expected, stale — this live count is authoritative. Freeze THIS into target_ids.txt.)

-- ============================================================================
-- QUERY B — KEEP COUNT: on transcorpsb, NOT junk (no 8-hex run OR an allowlist slug).
-- ============================================================================
SELECT count(*) AS keep_count
FROM tenants t
JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb'
  AND NOT ( t.slug ~ '[0-9a-f]{8}'
            AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers','transcorp',
                               'hem','mlp','demo-bistro','demo-bistro1') );
-- (~11 expected.) SANITY: QUERY A + QUERY B must equal the total transcorpsb tenant count:
SELECT count(*) AS total_on_transcorpsb
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb';

-- ============================================================================
-- QUERY C — KEEP-SET LIST: every tenant that SURVIVES. Love eyeballs the ~11 real ones are
-- all here BEFORE any delete. The pattern proving itself: nothing real should be missing.
-- ============================================================================
SELECT t.id, t.slug, t.name, t.status, t.created_at,
       (t.slug IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers','transcorp',
                   'hem','mlp','demo-bistro','demo-bistro1')) AS is_allowlisted,
       (t.slug ~ '[0-9a-f]{8}') AS has_hex_run
FROM tenants t
JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id = 'transcorpsb'
  AND NOT ( t.slug ~ '[0-9a-f]{8}'
            AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers','transcorp',
                               'hem','mlp','demo-bistro','demo-bistro1') )
ORDER BY is_allowlisted DESC, t.slug;
-- Eyeball: every real merchant present; no real merchant missing. If a genuine tenant shows
-- has_hex_run = true but is_allowlisted = true, it is kept (allowlist wins) — confirm that is intended.

-- ============================================================================
-- QUERY D — (OBSOLETE) no id export. The ~1,759 ids exceed the SQL-editor CSV export cap, so the
-- frozen set is NOT exported to a literal list. Instead the delete script snapshots the SAME predicate
-- IN-DATABASE at delete time into a TEMP table `_sandbox_junk` and count-guards it == QUERY A's
-- junk_count (baked into the generator as AUDITED_COUNT). The only value to carry forward from Stage A
-- is QUERY A's junk_count (= 1759). Nothing to copy/paste.
-- ============================================================================

-- ============================================================================
-- QUERY E — BACKUP-VOLUME SUMMARY: per-table row counts for the junk set, so Love sizes the
-- backup (single-file vs per-batch) before running it. Read-only.
-- ============================================================================
WITH tgt AS (
  SELECT t.id
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id = 'transcorpsb'
    AND t.slug ~ '[0-9a-f]{8}'
    AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers','transcorp',
                       'hem','mlp','demo-bistro','demo-bistro1')
)
SELECT * FROM (
  SELECT  1 AS seq, 'suitefleet_regions(transcorpsb, KEPT)' AS table_name, 0 AS n  -- region is kept; shown for clarity
  UNION ALL SELECT  2,'tenants',                count(*) FROM tenants WHERE id IN (SELECT id FROM tgt)
  UNION ALL SELECT  3,'users',                  count(*) FROM users WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT  4,'roles',                  count(*) FROM roles WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT  5,'role_assignments',       count(*) FROM role_assignments WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT  6,'api_keys',               count(*) FROM api_keys WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT  7,'task_generation_runs',   count(*) FROM task_generation_runs WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT  8,'tenant_suitefleet_webhook_credentials', count(*) FROM tenant_suitefleet_webhook_credentials WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT  9,'webhook_events',         count(*) FROM webhook_events WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 10,'consignees',             count(*) FROM consignees WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 11,'addresses',              count(*) FROM addresses WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 12,'consignee_crm_events',   count(*) FROM consignee_crm_events WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 13,'subscriptions',          count(*) FROM subscriptions WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 14,'subscription_address_rotations', count(*) FROM subscription_address_rotations WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 15,'subscription_exceptions',count(*) FROM subscription_exceptions WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 16,'subscription_materialization', count(*) FROM subscription_materialization WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 17,'tasks',                  count(*) FROM tasks WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 18,'task_packages',          count(*) FROM task_packages WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 19,'failed_pushes',          count(*) FROM failed_pushes WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 20,'asset_tracking_cache',   count(*) FROM asset_tracking_cache WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 21,'outbound_push_failures', count(*) FROM outbound_push_failures WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 22,'asset_scan_log',         count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT id FROM tgt)
  UNION ALL SELECT 23,'audit_events',           count(*) FROM audit_events WHERE tenant_id IN (SELECT id FROM tgt)
) v ORDER BY seq;
-- SUM(n over seq 2..23) ~= total backup rows. If that total is beyond a comfortable single-CSV
-- export (rule of thumb >~50,000 rows, or the single-file backup query errors/truncates), use
-- the PER-BATCH backup (recommended at this scale) — see the plan §5.
