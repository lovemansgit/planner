# Day-27 reconciliation audit input — migrations 0017/0020/0021/0022/0023 schema deltas

**Filed:** Day-27 (15 May 2026), AM.
**Tier:** T1 docs artifact (the audit-input itself); input for the T3 reconciliation lane (step 1 of 4 of the reconciliation lane — schema-delta slice for migrations 0017-0023).
**Status:** AUDIT-ONLY. Does NOT propose, sketch, or draft any reconciliation/fix SQL. If a delta is absent, that's a finding to surface, not a thing to draft remediation for.

**Context.** [memory/audit/day-27-production-schema-audit-findings.md](day-27-production-schema-audit-findings.md) (`d00dc8a`) confirmed production's identity schema is intact (0001 / 0002 / 0003 directly; 0005 / 0013 / 0017 inferred from the `tenants` column shape). This document closes the foundation question raised by the findings memo's §"What the reconciliation plan-PR needs to scope" point 1 for the **schema-delta slice**: migrations 0017, 0020, 0021, 0022, 0023.

Scope ladder of the reconciliation lane (Day-27, T3, 4 steps):
1. **THIS document** — schema-delta audit for 0017/0020/0021/0022/0023 (close question 1).
2. _Pending_ — diagnose why migration 0024 failed.
3. _Pending_ — reconcile two known divergences (`users_set_updated_at` trigger missing; `webhook_events` policy posture).
4. _Pending_ — decide cleanup scope for the 501-orphaned-tenants tech debt.

**Hard constraint:** read-only queries only. Single safe-to-paste block. Per the PR #287 round-2 lesson, no statement in the main block may throw on a partially-applied schema.

---

## Part A — Repo-side expectation

### A.1 0017_tenants_pickup_address.sql

Three nullable text columns added to `tenants`. No backfill, no CHECK, no index, no trigger.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `pickup_address_line` | `text` | YES | none |
| `pickup_address_district` | `text` | YES | none |
| `pickup_address_emirate` | `text` | YES | none |

**Posture check.** Today's findings memo confirmed all three present (audit Q3 surfaced them in the `tenants` column inventory). This pass adds the nullable/no-CHECK/no-default cross-check that today's audit didn't explicitly verify per-column.

### A.2 0020_task_generation_runs_target_date_column_and_unique.sql

Wrapped in BEGIN/COMMIT. Five steps in the migration:

1. `ALTER TABLE task_generation_runs ADD COLUMN target_date date` (initially nullable).
2. Backfill: `UPDATE task_generation_runs SET target_date = ((window_start AT TIME ZONE 'Asia/Dubai')::date + 1) WHERE target_date IS NULL`.
3. Dedup `DELETE FROM task_generation_runs WHERE id IN (...)` removing duplicate (tenant_id, target_date) rows, keeping winner per `MAX(completed_at)` / `MAX(started_at)` policy.
4. `ALTER TABLE task_generation_runs ALTER COLUMN target_date SET NOT NULL`.
5. `CREATE UNIQUE INDEX task_generation_runs_tenant_target_date_unique_idx ON task_generation_runs (tenant_id, target_date)`.

**Expected post-apply state:**
- `task_generation_runs.target_date` column exists, type `date`, NOT NULL, no default.
- Unique index `task_generation_runs_tenant_target_date_unique_idx` on `(tenant_id, target_date)`, marked UNIQUE.
- Pre-existing UNIQUE `(tenant_id, window_start, window_end)` from 0012 retained — both UNIQUEs coexist.

### A.3 0021_tenants_status_archived.sql

- `ALTER TABLE tenants DROP CONSTRAINT tenants_status_check;`
- `ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN ('provisioning','active','suspended','inactive','archived'));` (widens 4 → 5).
- Data: `UPDATE tenants SET status='archived' WHERE slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers') AND status!='archived';` (per the migration, ~377 fixture-pollution rows flipped to archived).

**Expected post-apply state:**
- Constraint name remains `tenants_status_check` (dropped and re-added by same name).
- Constraint definition accepts exactly 5 values: `'provisioning'`, `'active'`, `'suspended'`, `'inactive'`, `'archived'`.
- Production `tenants.status` data: distinct values present should be a subset of these 5; encountering any value outside this set indicates either a constraint divergence or a row written before the widening (unlikely if constraint is current).

### A.4 0022_tasks_webhook_extracted_columns.sql

10 columns added to `tasks`. All nullable, no defaults, no indexes, no triggers, no CHECKs.

| # | Column | Type | Nullable | Default |
|---|---|---|---|---|
| 1 | `pod_photos` | `jsonb` | YES | none |
| 2 | `recipient_name` | `text` | YES | none |
| 3 | `signature` | `text` | YES | none |
| 4 | `consignee_rating` | `smallint` | YES | none |
| 5 | `consignee_comment` | `text` | YES | none |
| 6 | `driver_comment` | `text` | YES | none |
| 7 | `number_of_attempts` | `smallint` | YES | none |
| 8 | `failure_reason_comment` | `text` | YES | none |
| 9 | `completion_latitude` | `numeric` | YES | none |
| 10 | `completion_longitude` | `numeric` | YES | none |

**Note.** `completion_latitude` and `completion_longitude` are bare `numeric` (no precision specified) in the migration. The `addresses` table from 0014 uses `numeric(9,6)` for lat/lng — that precision distinction is deliberate; the Q6 query below surfaces the data-type strings as `information_schema.columns.data_type` reports them.

### A.5 0023_outbound_push_failures.sql

Today's findings memo confirmed the table exists (Q2 listed `outbound_push_failures` in the relation inventory). This audit confirms the full shape.

**Expected `outbound_push_failures` shape — 10 columns:**

| # | Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| 2 | `tenant_id` | `uuid` | NO | none | FK → `tenants(id)` ON DELETE CASCADE |
| 3 | `task_id` | `uuid` | NO | none | FK → `tasks(id)` ON DELETE CASCADE |
| 4 | `operation` | `text` | NO | none | CHECK constrained to `('update','cancel','bulk_cancel')` |
| 5 | `correlation_id` | `uuid` | NO | none | — |
| 6 | `failure_reason` | `text` | NO | none | CHECK constrained to `('network','server_5xx','client_4xx','timeout','bulk_partial_failure','unknown')` |
| 7 | `failure_payload` | `jsonb` | YES | none | — |
| 8 | `retry_count` | `integer` | NO | `0` | CHECK `retry_count >= 0` |
| 9 | `created_at` | `timestamptz` | NO | `now()` | — |
| 10 | `resolved_at` | `timestamptz` | YES | none | — |

NO `updated_at` column. NO `set_updated_at` trigger. (Rows are effectively append-only with a `resolved_at` nullable for ops resolution.)

**Expected indexes:**
- `outbound_push_failures_tenant_id_idx (tenant_id)`
- `outbound_push_failures_unresolved_idx (tenant_id, created_at DESC) WHERE resolved_at IS NULL` (partial)
- `outbound_push_failures_task_id_idx (task_id)`

**Expected RLS:**
- RLS enabled.
- Policy `outbound_push_failures_tenant_isolation` FOR ALL.

**Expected function + trigger:**
- Function `outbound_push_failures_assert_tenant_match()` RETURNS trigger (CREATE OR REPLACE). Verifies `outbound_push_failures.tenant_id = parent tasks.tenant_id`; raises on mismatch.
- Trigger `outbound_push_failures_tenant_match` BEFORE INSERT OR UPDATE FOR EACH ROW EXECUTE `outbound_push_failures_assert_tenant_match()`.

**Expected constraints (named):**
- `outbound_push_failures_pkey` (PK on id).
- `outbound_push_failures_tenant_id_fkey` (FK to tenants).
- `outbound_push_failures_task_id_fkey` (FK to tasks).
- Plus the three inline CHECK constraints (operation, failure_reason, retry_count) — Postgres auto-names CHECKs `<table>_<column>_check` when not explicitly named in the migration source; that's the expected pattern.

---

## Part B — Production audit query block (read-only, single safe-to-paste execution)

**Instructions for Love.**

1. **Before running anything**, confirm the Supabase SQL-editor URL shows project ref `qdotjmwqbyzldfuxphei`. `current_database()` returns `'postgres'` on every Supabase project and cannot establish project identity (same discipline as PR #287's Q1).
2. Paste the entire block below as a single SQL-editor execution. Every statement is read-only (`information_schema` / `pg_catalog`); every statement is guaranteed not to throw on a partially-applied schema — missing tables/columns return zero rows rather than erroring. The only data-table queries (Q5) read `public.tenants`, whose existence is established by today's findings memo.

```sql
-- =============================================================================
-- Day-27 reconciliation audit — migrations 0017/0020/0021/0022/0023 schema deltas
-- READ-ONLY. Single safe-to-paste block. Target: project qdotjmwqbyzldfuxphei
-- =============================================================================


-- Q1 — 0017: tenants pickup_address_* columns.
-- Confirms presence + nullable=YES + no default on all three. Returns 0-3
-- rows depending on what exists; 3 expected, anything less = divergence.
SELECT column_name,
       data_type,
       is_nullable,
       column_default,
       character_maximum_length,
       ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenants'
  AND column_name IN ('pickup_address_line','pickup_address_district','pickup_address_emirate')
ORDER BY column_name;


-- Q2 — 0020: task_generation_runs.target_date column.
-- Expected: column exists, data_type='date', is_nullable='NO'. Zero rows
-- means the column is absent (= migration not applied or step 1 only).
SELECT column_name,
       data_type,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'task_generation_runs'
  AND column_name = 'target_date';


-- Q3 — 0020: unique index task_generation_runs_tenant_target_date_unique_idx.
-- Confirms the UNIQUE on (tenant_id, target_date) and that the older UNIQUE
-- on (tenant_id, window_start, window_end) from 0012 still coexists.
-- pg_indexes is a catalog view — never throws on missing relations.
SELECT schemaname,
       tablename,
       indexname,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'task_generation_runs'
  AND indexname IN ('task_generation_runs_tenant_target_date_unique_idx',
                    'task_generation_runs_window_unique')
ORDER BY indexname;


-- Q4 — 0021: tenants_status_check definition.
-- pg_get_constraintdef returns the exact CHECK predicate. Expected to
-- include all 5 values: provisioning, active, suspended, inactive,
-- archived. If only 4 values appear (no 'archived'), 0021 did not apply.
-- If the constraint is absent entirely, 0001's original CHECK was dropped
-- without replacement — separate divergence.
SELECT con.conname              AS constraint_name,
       con.contype              AS type,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c     ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'tenants'
  AND con.conname = 'tenants_status_check';


-- Q5 — 0021: distinct status values currently present in production tenants.
-- Corroboration: the constraint should accept the values that actually
-- exist on production. Any value outside the 5-element expected set is a
-- finding. (Safe: today's audit established public.tenants has 558 rows
-- and a status column.)
SELECT status,
       count(*) AS row_count
FROM public.tenants
GROUP BY status
ORDER BY row_count DESC;


-- Q6 — 0022: 10 webhook-extracted columns on tasks.
-- Each expected nullable text/jsonb/smallint/numeric. Zero rows = entire
-- 0022 absent; partial result = partial apply (= an apply that was
-- interrupted, which would itself be a useful finding).
SELECT column_name,
       data_type,
       is_nullable,
       column_default,
       numeric_precision,
       numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tasks'
  AND column_name IN ('pod_photos','recipient_name','signature',
                      'consignee_rating','consignee_comment','driver_comment',
                      'number_of_attempts','failure_reason_comment',
                      'completion_latitude','completion_longitude')
ORDER BY column_name;


-- Q7 — 0023: outbound_push_failures full column inventory.
-- Today's findings memo confirmed the table exists. This pass confirms
-- full 10-column shape with types + nullability + defaults.
SELECT column_name,
       data_type,
       is_nullable,
       column_default,
       ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'outbound_push_failures'
ORDER BY ordinal_position;


-- Q8 — 0023: every CONSTRAINT on outbound_push_failures, with the definition
-- string of each. Surfaces the operation CHECK, the failure_reason CHECK,
-- the retry_count >= 0 CHECK, the two FKs, and the PK. Zero rows = table
-- absent (would contradict today's finding) or constraints were dropped.
SELECT con.conname              AS constraint_name,
       con.contype              AS type,  -- p=PK, f=FK, c=CHECK, u=UNIQUE
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c     ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'outbound_push_failures'
ORDER BY con.contype, con.conname;


-- Q9 — 0023: every TRIGGER on outbound_push_failures.
-- Expected: outbound_push_failures_tenant_match, BEFORE INSERT OR UPDATE,
-- calling outbound_push_failures_assert_tenant_match(). No set_updated_at
-- trigger (no updated_at column).
SELECT t.tgname                  AS trigger_name,
       pg_get_triggerdef(t.oid)  AS trigger_definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND c.relname = 'outbound_push_failures'
ORDER BY t.tgname;


-- Q10 — 0023: tenant-match function existence + signature.
-- Confirms outbound_push_failures_assert_tenant_match() exists and returns
-- trigger. Zero rows = function absent (trigger from Q9 would then be
-- broken-by-reference if it exists — surface as a finding).
SELECT n.nspname  AS schema,
       p.proname  AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS return_type,
       l.lanname  AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l  ON l.oid = p.prolang
WHERE p.proname = 'outbound_push_failures_assert_tenant_match';


-- Q11 — 0023: indexes on outbound_push_failures.
-- Expected three: tenant_id_idx, unresolved_idx (partial), task_id_idx.
SELECT indexname,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'outbound_push_failures'
ORDER BY indexname;


-- =============================================================================
-- End of audit query block.
-- Reading order: Q1 (0017 columns) → Q2+Q3 (0020 column+index) → Q4+Q5
-- (0021 constraint+data) → Q6 (0022 ×10 columns) → Q7-Q11 (0023 full shape).
-- Every query is catalog-only and cannot throw on a partially-applied
-- schema; missing objects return zero rows.
-- =============================================================================
```

---

## Reading discipline for the reviewer

Audit input only. This document does NOT:
- propose a fix for any divergence
- draft CREATE/ALTER/DROP SQL
- assume what Love will find when running Part B
- prejudge whether 0017–0023 are fully or partially applied — every claim is binary per the catalog reading

The next step (T3 reconciliation lane step 2) is contingent on the output from Part B. Per the standing hard constraint: no reconciliation SQL is improvised live in the SQL editor.

---

**End of Day-27 reconciliation audit input — schema-delta slice for 0017/0020/0021/0022/0023.**
