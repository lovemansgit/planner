-- 0033_asset_tracking_state_sorted.sql
-- =============================================================================
-- Day-54 P1 — extend asset_tracking_cache's state CHECK to the
-- vendor-CONFIRMED complete 5-state enum (bag-tracking plan PR #502;
-- PARKS SQL-TO-APPLY for Love's NAMED authorization).
--
-- Aqib's answer (2026-06-12, on the record via Love): the state enum
-- is COMPLETE at Collected / Received / Sorted / EnRoute / Returned —
-- nothing else. Wire form: COLLECTED / RECEIVED / SORTED / EN_ROUTE /
-- RETURNED. The 0011 CHECK pinned the doc-derived four (Option A —
-- restrictive until vendor confirms); SF's own report screens show the
-- Sorted column the original doc sample omitted, and the vendor has
-- now confirmed. This freezes the CHECK at exactly the confirmed five.
--
-- States outside the five keep today's posture: the client-side parse
-- rejects them (ValidationError → error queue), and this CHECK is the
-- schema backstop.
--
-- Additive-only: existing rows all hold values inside the new set, so
-- the constraint re-add validates without a table rewrite.

ALTER TABLE asset_tracking_cache
  DROP CONSTRAINT asset_tracking_cache_state_check;

ALTER TABLE asset_tracking_cache
  ADD CONSTRAINT asset_tracking_cache_state_check
  CHECK (state IN ('COLLECTED', 'EN_ROUTE', 'RECEIVED', 'RETURNED', 'SORTED'));
