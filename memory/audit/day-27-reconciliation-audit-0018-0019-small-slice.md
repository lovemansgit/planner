# Day-27 reconciliation audit input — migrations 0018/0019 small slice

**Filed:** Day-27 (15 May 2026), late-AM.
**Tier:** T1 docs artifact (the audit file itself); input for the Day-27 reconciliation lane (audit → plan → execute).
**Status:** AUDIT-ONLY. This document does NOT propose, sketch, or draft any reconciliation/fix SQL. Reconciliation is a separate, reviewed plan-PR after Love runs Part B against production.

**Companion audits.** Today's parent audit input lives at [`memory/audit/day-27-production-schema-audit-input.md`](day-27-production-schema-audit-input.md); findings at [`memory/audit/day-27-production-schema-audit-findings.md`](day-27-production-schema-audit-findings.md). Session A is running the parallel reconciliation slices for 0017/0020/0021/0022/0023. This file is the Session B slice covering migrations 0018 and 0019 only.

**Lane context.** The Day-27 Q2 production audit confirmed `public.webhook_events` exists with row counts 155 → 212 (production receives + persists SF webhook events live, with the table populated through normal operation). What that confirmed: the table is **present and writeable**. What it did NOT confirm: the table's **shape** matches what the migration declares. The findings doc §3 surfaced one specific shape concern — the `webhook_events_tenant_isolation` policy is `FOR ALL` (USING + WITH CHECK on both sides), while the intent per the migration header is append-only (`GRANT SELECT, INSERT … no UPDATE, no DELETE`). The findings doc described that as "almost certainly benign … worth flagging in the reconciliation plan to verify the grant state." This audit input is the verification.

**The load-bearing question this audit answers.** RLS policies layer on top of grants — a `FOR ALL` policy can never enable operations the GRANT statement didn't already permit. So the divergence question reduces to whether `planner_app` has **only** SELECT+INSERT on `webhook_events` (the policy breadth is benign — grants are the real gate) or whether `planner_app` ALSO has UPDATE/DELETE (the policy breadth becomes a real divergence — append-only intent is unenforced at the DB layer). Q5 is the load-bearing query.

This audit also covers 0019 (`tasks_internal_status_check` extension to 8 values) as a parallel small-slice verification — the production audit Q2 row counts confirmed `public.tasks` exists, but did not confirm the CHECK constraint shape is current.

---

## Part A — Repo-side expectation

### A.1 0018_webhook_events.sql — expected production shape

#### A.1.1 Table — `public.webhook_events`

Per [`supabase/migrations/0018_webhook_events.sql:73-81`](../../supabase/migrations/0018_webhook_events.sql#L73-L81), the table carries exactly **7 columns** in this order:

| # | Column | Type | Nullability | Default |
|---|---|---|---|---|
| 1 | `id` | `uuid` | NOT NULL | `gen_random_uuid()` (PK) |
| 2 | `tenant_id` | `uuid` | NOT NULL | none — FK to `tenants(id) ON DELETE CASCADE` |
| 3 | `suitefleet_task_id` | `text` | NOT NULL | none |
| 4 | `action` | `text` | NOT NULL | none |
| 5 | `event_timestamp` | `timestamptz` | NOT NULL | none |
| 6 | `raw_payload` | `jsonb` | NOT NULL | none |
| 7 | `received_at` | `timestamptz` | NOT NULL | `now()` |

No `updated_at` column by design (append-only; rows are never updated). No CHECK constraints on the table.

#### A.1.2 Indexes — three expected

Per [`0018_webhook_events.sql:84-92`](../../supabase/migrations/0018_webhook_events.sql#L84-L92):

| Index | Type | Columns | Purpose |
|---|---|---|---|
| `webhook_events_dedup_idx` | UNIQUE | `(suitefleet_task_id, action, event_timestamp)` | Webhook dedup anchor per brief §3.1.10 — SF retry on non-2xx lands as a 23505 on the second attempt |
| `webhook_events_tenant_idx` | non-unique | `(tenant_id)` | RLS predicate path |
| `webhook_events_task_idx` | non-unique | `(suitefleet_task_id)` | Operator drill-down — all webhook activity for SF task X |

Plus the implicit primary-key index on `id` (created automatically by `PRIMARY KEY`).

#### A.1.3 Row-level security — enabled, one policy

Per [`0018_webhook_events.sql:94-99`](../../supabase/migrations/0018_webhook_events.sql#L94-L99):

- `ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;` — RLS enabled on the table.
- One policy: `webhook_events_tenant_isolation` — `FOR ALL`, both `USING` and `WITH CHECK` predicates equal to the defensive form `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` (fail-closed on unset; mirrors the form used across every other multi-tenant table from 0001 onward).
- No additional permissive or restrictive policies.

#### A.1.4 GRANTS to `planner_app` — load-bearing for the policy-breadth-vs-grant-tightness question

Per [`0018_webhook_events.sql:103`](../../supabase/migrations/0018_webhook_events.sql#L103):

```sql
GRANT SELECT, INSERT ON webhook_events TO planner_app;
```

Explicitly **NOT** granted: `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`. The migration header comments at lines 27-35 are explicit about why: "Webhook payloads are evidence; mutating them after the fact would defeat the forensic purpose."

**Why this is load-bearing for the Day-27 findings doc §3 concern.** The findings doc flagged that `webhook_events_tenant_isolation` is `FOR ALL` — broader than the append-only intent suggests. RLS policies cannot expand what grants permit; a `FOR ALL` policy on a table where `planner_app` only has SELECT+INSERT is operationally equivalent to a `FOR SELECT, INSERT` policy (the UPDATE/DELETE branches of the policy never get exercised because the grants block those operations before RLS ever runs). The audit must verify production's actual grant posture matches the migration:

- **Tight match (SELECT + INSERT only):** the `FOR ALL` policy is benign. No reconciliation action needed. The migration's intent is enforced — just by the grants, not by the policy shape. This is the predicted outcome per the findings doc.
- **Loose (any of UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER also granted):** the `FOR ALL` policy is a real divergence. Append-only intent is unenforced at the DB layer; `planner_app` could in principle mutate or delete historical webhook rows. Reconciliation plan would need to REVOKE the loose privileges before any policy-tightening.

**Note on the audit_events comparison the migration header makes.** Migration 0018 says the GRANT posture "mirrors audit_events (0002) posture." That comparison is the right one — `audit_events` from 0002 has the same SELECT+INSERT-only grant pattern PLUS database-level `ON UPDATE DO INSTEAD NOTHING` / `ON DELETE DO INSTEAD NOTHING` RULEs as a second defensive layer (see [`memory/followup_audit_rule_cascade_conflict.md`](../followup_audit_rule_cascade_conflict.md) for the load-bearing teardown pattern those RULEs force). `webhook_events` does **not** carry equivalent RULEs — its append-only posture rests entirely on the grant restriction. That is a smaller defensive surface than `audit_events`, and another reason the grant verification matters: there is no second layer to catch a loose grant.

### A.2 0019_tasks_internal_status_skipped.sql — expected production shape

#### A.2.1 Mechanism — DROP+ADD on the CHECK constraint

Per [`supabase/migrations/0019_tasks_internal_status_skipped.sql:43-56`](../../supabase/migrations/0019_tasks_internal_status_skipped.sql#L43-L56). Postgres does not support `ALTER CONSTRAINT` for CHECK constraints, so the canonical pattern is DROP+ADD in the same migration:

```sql
ALTER TABLE tasks
  DROP CONSTRAINT tasks_internal_status_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_internal_status_check
    CHECK (internal_status IN ('CREATED', 'ASSIGNED', 'IN_TRANSIT',
                               'DELIVERED', 'FAILED', 'CANCELED',
                               'ON_HOLD', 'SKIPPED'));
```

#### A.2.2 Expected final constraint shape — 8 values

After migration 0019 applies cleanly, `pg_get_constraintdef(oid)` for `tasks_internal_status_check` should return a string equivalent to:

```
CHECK ((internal_status = ANY (ARRAY['CREATED'::text, 'ASSIGNED'::text, 'IN_TRANSIT'::text, 'DELIVERED'::text, 'FAILED'::text, 'CANCELED'::text, 'ON_HOLD'::text, 'SKIPPED'::text])))
```

(Postgres normalizes `IN (…)` to `= ANY (ARRAY[…])` in `pg_get_constraintdef` output. Whitespace, casts, and ordering of the value list are preserved verbatim from the migration source.)

#### A.2.3 Old constraint shape (DROPped by 0019)

Before 0019 applied, `tasks_internal_status_check` admitted **7 values** (from [`0006_task.sql`](../../supabase/migrations/0006_task.sql)): `CREATED`, `ASSIGNED`, `IN_TRANSIT`, `DELIVERED`, `FAILED`, `CANCELED`, `ON_HOLD`. 0019 adds `SKIPPED` for 8 total.

**Semantic boundary** per [`0019_tasks_internal_status_skipped.sql:17-23`](../../supabase/migrations/0019_tasks_internal_status_skipped.sql#L17-L23) (locked from brief §3.1.1):

- `SKIPPED` — human-driven exception with compensating-date semantics. Service layer (part 2) sets via `addSubscriptionException(type='skip')` on already-materialized tasks. Planner-only state.
- `CANCELED` — terminal stop. Subscription ended, paused via `pause_window` exception, or task cancelled outright.

The two are NOT interchangeable. The audit only confirms the constraint admits both; semantic correctness is enforced by the service layer (out of scope here).

#### A.2.4 What this audit does NOT cover

The migration touches one and only one schema object — `tasks_internal_status_check`. No new column, no new index, no new policy, no new grant, no data backfill (the migration header explicitly notes "No data migration … adding a value to an enum CHECK is non-breaking"). Q6 is therefore the only query needed to characterize 0019's production application state.

---

## Part B — Production audit query block (read-only, single safe paste)

**Instructions for Love.** The block below is a single paste-and-execute. Every statement is read-only and uses only `pg_catalog` / `information_schema` — no statement directly reads any user table, so a missing relation or absent column cannot abort the transaction (the queries either return rows or zero-rows; neither aborts).

There is **no follow-up section** for this audit. The PR #287 round-2 lesson — that any query directly referencing a possibly-absent table or column belongs in a separately-paste section to protect the rest of the transaction — does not apply to this slice because no query here does that. The whole audit is a single paste.

**Before running anything:** confirm the SQL editor URL shows project ref `qdotjmwqbyzldfuxphei`. `current_database()` returns `'postgres'` on every Supabase hosted project and cannot establish project identity — the URL is the only identity check.

```sql
-- =============================================================================
-- Day-27 reconciliation audit — migrations 0018/0019 small slice — READ-ONLY
-- Target: Supabase project qdotjmwqbyzldfuxphei
-- DO NOT run any DDL/DML below this header. Every statement is a SELECT.
-- =============================================================================


-- Q1 — Connection context capture.
--
-- Does NOT establish "is this the pilot DB?" — current_database() returns
-- 'postgres' on every Supabase project. The project identity check is
-- out-of-band (Supabase SQL editor URL must show ref qdotjmwqbyzldfuxphei).
-- This query captures connected role, server version, and timestamp for the
-- audit record only.
SELECT current_database() AS db_name,    -- expected: 'postgres' (does not identify the project)
       current_user      AS connected_role,
       version()         AS pg_version,
       now()             AS query_time;


-- Q2 — webhook_events column inventory.
-- Diffs against Part A.1.1's 7-column expectation. Returns one row per column
-- with its data type, nullability, default, and ordinal position. If the
-- table is absent, zero rows are returned (no error). If columns are present
-- that A.1.1 does not list, that is itself a finding.
SELECT table_name,
       column_name,
       data_type,
       is_nullable,
       column_default,
       character_maximum_length,
       ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'webhook_events'
ORDER BY ordinal_position;


-- Q3 — webhook_events indexes.
-- Diffs against Part A.1.2's expectation: 3 named indexes
-- (webhook_events_dedup_idx UNIQUE, webhook_events_tenant_idx,
-- webhook_events_task_idx) plus the implicit primary-key index on id.
-- pg_get_indexdef returns the verbatim CREATE INDEX statement that would
-- recreate the index; the column list and uniqueness are visible there.
SELECT n.nspname           AS schema,
       c.relname           AS table_name,
       i.relname           AS index_name,
       ix.indisunique      AS is_unique,
       ix.indisprimary     AS is_primary,
       pg_get_indexdef(ix.indexrelid) AS index_definition
FROM pg_index ix
JOIN pg_class c     ON c.oid = ix.indrelid
JOIN pg_class i     ON i.oid = ix.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'webhook_events'
ORDER BY i.relname;


-- Q4 — webhook_events RLS enablement state + every policy on the table.
-- Two-row-set output: pg_class.relrowsecurity establishes whether RLS is
-- enabled at all (A.1.3 expects true); pg_policy enumerates each policy's
-- command scope (polcmd: r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL),
-- permissiveness, and the USING / WITH CHECK expressions. Diffs against
-- A.1.3's single FOR ALL policy expectation.
SELECT 'rls_state' AS row_kind,
       n.nspname              AS schema,
       c.relname              AS table_name,
       c.relrowsecurity::text  AS detail_1,    -- expected: true
       c.relforcerowsecurity::text AS detail_2, -- expected: false (not FORCEd)
       NULL::text             AS detail_3,
       NULL::text             AS detail_4
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'webhook_events'
  AND c.relkind = 'r'
UNION ALL
SELECT 'policy' AS row_kind,
       n.nspname                                AS schema,
       c.relname                                AS table_name,
       p.polname                                AS detail_1,    -- policy name
       p.polcmd::text                           AS detail_2,    -- expected: * (ALL)
       pg_get_expr(p.polqual, p.polrelid)       AS detail_3,    -- USING expression
       pg_get_expr(p.polwithcheck, p.polrelid)  AS detail_4     -- WITH CHECK expression
FROM pg_policy p
JOIN pg_class c     ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'webhook_events'
ORDER BY row_kind, detail_1;


-- Q5 — LOAD-BEARING — webhook_events GRANT inventory for planner_app and
-- every other grantee.
--
-- This is the query that answers the Day-27 findings §3 question:
-- is the FOR ALL policy on webhook_events a real divergence, or benign
-- because the grants are tight?
--
--   - Expected tight match (Part A.1.4): exactly 2 rows for grantee
--     'planner_app' — privilege_type SELECT and privilege_type INSERT.
--     Policy breadth is benign; no reconciliation needed.
--   - Loose divergence: 3+ rows for grantee 'planner_app' including any of
--     UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER. Policy breadth is a
--     real divergence; reconciliation plan must REVOKE before policy-narrowing.
--
-- Grantees other than planner_app (postgres, supabase_admin, authenticator,
-- etc.) are included so the full grant picture is visible — those grants
-- are out-of-band from the migrations but worth seeing in the same pass.
SELECT grantee,
       privilege_type,
       is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'webhook_events'
ORDER BY grantee, privilege_type;


-- Q6 — tasks_internal_status_check constraint definition.
-- Diffs against Part A.2.2's 8-value expectation. pg_get_constraintdef
-- returns the verbatim CHECK clause Postgres reconstructs from the
-- constraint's internal tree — the value list is preserved in source order.
-- If the constraint is absent on production, zero rows are returned (this
-- would mean 0019 never applied, or applied with a different name).
SELECT n.nspname                          AS schema,
       c.relname                          AS table_name,
       con.conname                        AS constraint_name,
       con.contype                        AS contype,  -- expected: 'c' (check)
       pg_get_constraintdef(con.oid)      AS constraint_definition
FROM pg_constraint con
JOIN pg_class c     ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'tasks'
  AND con.conname = 'tasks_internal_status_check';


-- =============================================================================
-- End of audit query block.
--
-- Expected reading order: Q1 (connection context, not project ID) →
-- Q2 (webhook_events columns) → Q3 (webhook_events indexes) →
-- Q4 (webhook_events RLS + policies) → Q5 (webhook_events GRANTS — LOAD-BEARING) →
-- Q6 (tasks_internal_status_check definition).
--
-- Every query uses pg_catalog / information_schema only; no statement reads
-- any user-data table. The block is safe to paste as a single execution.
-- =============================================================================
```

---

## Reading discipline for the reviewer

This document is audit input, not reconciliation. It explicitly does not:

- propose a fix order
- draft any GRANT/REVOKE/ALTER/DROP SQL
- assume Love will find tight grants vs loose grants on Q5

The reconciliation step is the next plan-PR after Love runs Part B and reports back the rows. Per the standing constraint for this lane: no reconciliation SQL is improvised live in the SQL editor.

The most-likely outcome per the findings doc §3 prediction: Q5 returns exactly two rows for grantee `planner_app` (SELECT, INSERT) and the `FOR ALL` policy is confirmed benign — zero reconciliation action for 0018. The most-likely outcome for 0019: Q6 returns one row with `constraint_definition` reflecting the 8-value list; zero reconciliation action. The audit's value is in confirming both predictions (or surfacing a real divergence we didn't anticipate).

---

**End of Day-27 reconciliation audit input — migrations 0018/0019 small slice.**
