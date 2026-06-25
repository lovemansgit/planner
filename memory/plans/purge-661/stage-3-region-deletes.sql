-- PURGE #661 — STAGE 3: REGION DELETES (one transaction). Target: qdotjmwqbyzldfuxphei (PROD).
-- Authorization: separate named Love clear, AFTER Stage-2 tenant deletes are committed + verified.
-- Deletes ALL non-canonical regions (the 54-tenants' now-unbound regions + the 16 already-unbound).

-- ============================================================
-- STAGE 3 — DRY RUN (ends ROLLBACK)
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

-- GUARD: refuse to delete any non-canonical region that STILL has a bound tenant.
DO $$
DECLARE bound int;
BEGIN
  SELECT count(*) INTO bound
  FROM suitefleet_regions r
  WHERE r.client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar')
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.suitefleet_region_id = r.id);
  IF bound <> 0 THEN RAISE EXCEPTION 'REGION GUARD TRIPPED: % junk region(s) still bound — run Stage 2 first', bound; END IF;
END $$;

DELETE FROM suitefleet_regions WHERE client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');

-- Verify: exactly the 4 canonical regions remain.
SELECT count(*) AS regions_remaining,
       array_agg(client_id ORDER BY client_id) AS client_ids
FROM suitefleet_regions;
-- regions_remaining must be 4; client_ids must be {transcorp,transcorpqatar,transcorpsb,transcorpuae}.

ROLLBACK;

-- ============================================================
-- STAGE 3 — EXECUTE (ends COMMIT — runs ONLY on Love's named clear)
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

-- GUARD: refuse to delete any non-canonical region that STILL has a bound tenant.
DO $$
DECLARE bound int;
BEGIN
  SELECT count(*) INTO bound
  FROM suitefleet_regions r
  WHERE r.client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar')
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.suitefleet_region_id = r.id);
  IF bound <> 0 THEN RAISE EXCEPTION 'REGION GUARD TRIPPED: % junk region(s) still bound — run Stage 2 first', bound; END IF;
END $$;

DELETE FROM suitefleet_regions WHERE client_id NOT IN ('transcorpsb', 'transcorp', 'transcorpuae', 'transcorpqatar');

-- Verify: exactly the 4 canonical regions remain.
SELECT count(*) AS regions_remaining,
       array_agg(client_id ORDER BY client_id) AS client_ids
FROM suitefleet_regions;
-- regions_remaining must be 4; client_ids must be {transcorp,transcorpqatar,transcorpsb,transcorpuae}.

COMMIT;
