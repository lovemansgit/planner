-- =============================================================================
-- supabase/migrations/0010_task_subscription_link.sql
-- =============================================================================
-- Day 6 / S-2: link tasks to subscriptions with FK + CHECK invariant.
--
-- Closes the Day-5 deferred decision (per the 0006_task.sql header note on
-- subscription_id: "Bare uuid column with no FK constraint. The
-- subscriptions table lands in Day 6's migration; adding the FK now would
-- require the referenced table to exist. A follow-up migration adds
-- REFERENCES subscriptions(id) ON DELETE SET NULL once the parent table
-- is in place.").
--
-- This migration:
--   1. ADD COLUMN tasks.created_via — closed-vocab marker
--      ('subscription' | 'migration_import' | 'manual_admin') with default
--      'subscription' (the production cron path)
--   2. UPDATE backfill — existing tasks (subscription_id IS NULL by
--      construction; the column was bare uuid before this migration) get
--      created_via = 'manual_admin' so they satisfy the composite CHECK
--   3. ADD CONSTRAINT tasks_subscription_id_fk — FK with ON DELETE SET NULL
--   4. ADD CONSTRAINT tasks_creation_source_invariant — composite CHECK
--      tying subscription_id presence to created_via='subscription'
--   5. CREATE INDEX tasks_subscription_id_idx — partial, for the cron's
--      "find tasks for this subscription" query
--
-- Forward-only. No down-migration. ON DELETE SET NULL on the FK + the
-- composite CHECK creates an emergent behaviour: deleting a subscription
-- with task children fails (the cascade-set-null would set subscription_id
-- to NULL on rows whose created_via='subscription', violating the CHECK).
-- Per the design intent in brief §6.5 / §10 — subscription lifecycle
-- terminus is `status = 'ended'`, not row deletion. This emergent block
-- on subscription deletion is a feature, not a bug. The integration test
-- subscription-link-invariant.spec.ts pins the empirical behaviour.
--
-- -----------------------------------------------------------------------------
-- Why split the CHECK from the column-level CHECK on created_via
-- -----------------------------------------------------------------------------
-- created_via has TWO CHECKs:
--   (a) value-domain — column-level inline CHECK that the value is in
--       ('subscription', 'migration_import', 'manual_admin')
--   (b) composite invariant — table-level CHECK tying value to subscription_id
--
-- Splitting gives better diagnostic messages: a violation reports the
-- specific failing constraint by name. Same convention as 0009_subscription.sql.
--
-- -----------------------------------------------------------------------------
-- Index strategy
-- -----------------------------------------------------------------------------
-- Partial index on tasks(subscription_id) WHERE subscription_id IS NOT NULL.
--
-- Use case: the Day-7+ cron's "find tasks for subscription S that already
-- exist" lookup (idempotency check before generating tomorrow's task).
-- Partial because non-subscription tasks (created_via != 'subscription')
-- have NULL subscription_id by the composite CHECK; indexing those nulls
-- would bloat the index without serving any lookup. Same pattern as
-- 0006's tasks_external_id_idx.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. ADD COLUMN created_via with column-level value-domain CHECK
-- -----------------------------------------------------------------------------
-- DEFAULT 'subscription' encodes the production-path assumption: tasks
-- created by the Day-7 cron are subscription-driven. Ad-hoc / migration
-- callers must explicitly set the column to 'manual_admin' or
-- 'migration_import'.
ALTER TABLE tasks
  ADD COLUMN created_via text NOT NULL DEFAULT 'subscription'
    CHECK (created_via IN ('subscription', 'migration_import', 'manual_admin'));


-- -----------------------------------------------------------------------------
-- 2. Backfill existing rows
-- -----------------------------------------------------------------------------
-- Every existing task row has subscription_id IS NULL by construction
-- (the column was bare nullable uuid with no production caller writing
-- to it before S-2). The composite CHECK we're about to add requires
-- non-subscription rows to have subscription_id IS NULL. Mark them
-- 'manual_admin' so they pass.
UPDATE tasks SET created_via = 'manual_admin' WHERE subscription_id IS NULL;


-- -----------------------------------------------------------------------------
-- 3. ADD CONSTRAINT tasks_subscription_id_fk — ON DELETE SET NULL
-- -----------------------------------------------------------------------------
-- ON DELETE SET NULL was the brief's literal choice ("historical tasks
-- should survive a subscription delete"). In practice, combined with
-- the composite CHECK below, this means subscription deletion fails
-- when the subscription has tasks with created_via='subscription' —
-- the cascade-set-null violates the CHECK and PostgreSQL aborts the
-- DELETE. This matches the intended lifecycle (subscriptions go to
-- status='ended', not row deletion). Pinned in
-- subscription-link-invariant.spec.ts.
ALTER TABLE tasks
  ADD CONSTRAINT tasks_subscription_id_fk
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;


-- -----------------------------------------------------------------------------
-- 4. ADD CONSTRAINT tasks_creation_source_invariant — composite CHECK
-- -----------------------------------------------------------------------------
-- subscription tasks MUST have a subscription_id; non-subscription tasks
-- MUST NOT. Makes "why is subscription_id NULL?" answerable: read
-- created_via.
ALTER TABLE tasks
  ADD CONSTRAINT tasks_creation_source_invariant
    CHECK (
      (created_via = 'subscription'  AND subscription_id IS NOT NULL)
      OR (created_via != 'subscription' AND subscription_id IS NULL)
    );


-- -----------------------------------------------------------------------------
-- 5. Partial index for cron lookup
-- -----------------------------------------------------------------------------
CREATE INDEX tasks_subscription_id_idx ON tasks (subscription_id)
  WHERE subscription_id IS NOT NULL;
