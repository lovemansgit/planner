-- 0034_tenants_asset_tracking_flag.sql
-- =============================================================================
-- Day-54 P1 — per-tenant asset-tracking gate (bag-tracking plan PR
-- #502 + Love's STAGED VERIFICATION ruling; PARKS SQL-TO-APPLY for
-- Love's NAMED authorization).
--
-- THE DARK SWITCH. Love's ruling (2026-06-12, staged posture 7b): the
-- flag gates ALL bag-tracking surfaces — even post-merge and
-- post-promote the feature stays dark for every tenant until Love
-- flips it PER TENANT by sentence. Default false, pinned by test
-- (tests/integration/asset-scan-log.spec.ts).
--
--   task_asset_tracking_enabled  the gate. ALL report surfaces, the
--                                30-minute poll, and the nav entries
--                                check it. Mirrors SF's
--                                customer.taskAssetTrackingEnabled
--                                webhook payload field once webhook
--                                sync is wired; until then it changes
--                                ONLY by Love's per-tenant sentence
--                                (builder executes the UPDATE and
--                                states the route).
--   default_task_asset_type      SF's customer.defaultTaskAssetType
--                                mirror (e.g. 'BAGS'); display-only
--                                (column labels say "bags" when BAGS).
--
-- Webhook-derived per the Day-6 finding (every SF webhook payload
-- carries both fields — memory/decision_bag_tracking_mvp.md "Bonus
-- finding"); the webhook write path lands in a follow-up commit and
-- NEVER flips the gate ON by itself while the staged posture holds —
-- it only refreshes default_task_asset_type and logs divergence
-- between SF's flag and ours.

ALTER TABLE tenants
  ADD COLUMN task_asset_tracking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN default_task_asset_type text;
