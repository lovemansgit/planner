# Test-Tenant + Junk-Region Purge — PLAN ONLY (Floor 1, LIVE PROD DB)

> **Status:** PLAN DOC ONLY. No query runs, no row is deleted from this PR. Every
> execution stage parks for a named per-stage authorization from Love (Floor 1).
> **Supersedes:** PR #656 (`plan/phase122-region-junk-cleanup`, region-only deletion).
> #656 deleted only the ~48 junk *regions* and named tenant-cleanup as an unowned
> prerequisite. This plan owns that prerequisite: it deletes the junk test *tenants*
> first, then the now-unbound junk regions, reaching exactly 4 regions. On Love's
> ruling, close #656 in favour of this.
>
> **For the executor (Love, via Supabase SQL editor):** every code block below is
> either an AUDIT (read-only), a DRY-RUN (ends in `ROLLBACK` — safe to run freely),
> or an EXECUTE (ends in `COMMIT` — runs only on a named clear after you have seen
> the prior stage's output). Run them top-to-bottom, one stage per named clear.

**Goal:** Permanently delete the junk integration-test tenants and the junk
SuiteFleet regions they are bound to from production, leaving exactly the four
canonical regions and only real/genuine tenants — with a full restorable backup
taken first and a named Love authorization gating every destructive stage.

**Target database:** Supabase project **`qdotjmwqbyzldfuxphei`** (PRODUCTION).
There is no dev/staging (brief §5.1 / §0 environment note). Every stage begins with
a project-ref pre-flight; a mismatch is a hard stop, never a re-scope.

**Mechanism:** Love pastes each reviewed block into the **Supabase SQL editor** and
runs it. Agent direct-pooler `psql` is classifier-blocked (PR #656 D3) and the
`ALTER TABLE … DISABLE RULE` / `SET app.allow_scan_log_delete` statements need the
table-owner/superuser role that the SQL editor's `postgres` session provides and the
pooler role does not. No agent executes any SQL in this plan.

---

## Global Constraints (copied verbatim from the established floors)

- **Floor 1 — Live database changes always park.** "Schema migrations and production
  SQL are never auto-applied. The owner authorizes by named sentence; the executing
  agent states the route used." Here the route is always: *Love runs the reviewed
  block in the Supabase SQL editor.*
- **Per-statement / per-stage authorization.** "the audit (read-only) is one clear;
  the delete is a separate clear after you've seen the audit output." This plan has
  six named clears (Audit → Backup → Child-deletes → Tenant-deletes → Region-deletes
  → final Verify is read-only and needs no clear).
- **Owner park-triggers (Floor 2) — risk to the build is the live one here.** A
  destructive, hard-to-reverse prod-DB state is exactly trigger #1; it parks even
  with agent agreement. That is why every stage is owner-gated and backed up first.
- **Reviewer independence (Floor 1/§4).** This plan is body-read by an *independent*
  reviewer context before its PR is eligible. A sub-agent of the builder can never be
  that reviewer.
- **Keep set is an explicit REAL allowlist, never "looks like a test".** The keep
  predicate is `GENUINE_MERCHANT_SLUGS` (8 slugs, Appendix A) plus canonical-region
  binding. The hex/fixture-prefix patterns are used only as an *eyes-on classifier*
  to flag anything unexpected for individual review — never as the sole basis to
  delete.
- **One transaction per stage, verify-before-commit.** Every destructive stage ships
  as a DRY-RUN block (`ROLLBACK`) and an identical EXECUTE block (`COMMIT`) with
  in-transaction count guards that `RAISE EXCEPTION` (→ auto-rollback) on any
  surprise.

---

## 0. Why this is needed, and exactly what does NOT happen

Integration tests and seed suites run against the single production Supabase. Each
mints a tenant with a random 8-hex slug fragment for isolation, and some call
`createRegion()`. Teardown swallows the FK-`RESTRICT` error and the
`audit_events_no_delete` rule blocks tenant teardown, so junk tenants and junk
regions accumulate (documented in `src/modules/merchants/genuine-merchants.ts:8-17`
and `0032_asset_scan_log.sql:27`).

Love's read-only audit this session established:
- **4 canonical regions** (keep): `transcorpsb` (Sandbox, ~1770 bound), `transcorp`
  (KSA, 8 bound), `transcorpuae` (UAE, 0), `transcorpqatar` (Qatar, 0).
- **~48 junk regions**, each bound to one junk test tenant (fixture prefixes
  `acd-`/`arde-`/`cps-`/`pfc-`/`src-`/`umr-` + 8-hex; names like "ACD Tenant",
  "CPS WithCreds"). **No real merchant is bound to any junk region.**
- **16 unbound junk regions** (deletable without removing any tenant).
- **Ruling:** full test-data purge — delete the junk test tenants AND their junk
  regions, to reach exactly 4 regions.

**This PR executes nothing.** It opens for review only. No tenant_id is enumerated
here from live data (none was read — plan-only). Deliverable #2's literal list is
*produced by the Stage-A audit query* and frozen in the Stage-0 backup for Love's
eyes-on sign-off before any delete. See §6 for the separate, larger ~1770-Sandbox
question, which this plan deliberately does NOT execute.

---

## 1. Dependency map — every FK to `tenants(id)`, delete order, and the two hard blockers

`tenants` is created at `0001_identity.sql:65-78` (PK `id uuid`). Below is every
table that references `tenants(id)` directly, every transitive child, the
`ON DELETE` behaviour of each edge, and the migration `file:line` citation.

### 1.1 Direct children of `tenants(id)` (20 tables)

| Child table | Column | ON DELETE | Cite |
|---|---|---|---|
| `users` | `tenant_id` | CASCADE | 0001:105 |
| `roles` | `tenant_id` | CASCADE | 0001:139 |
| `role_assignments` | `tenant_id` | CASCADE | 0001:193 |
| `api_keys` | `tenant_id` | CASCADE | 0001:218 |
| `audit_events` | `tenant_id` | CASCADE **(blocked by RULE — §1.4)** | 0002:45 |
| `consignees` | `tenant_id` | CASCADE | 0004:69 |
| `tasks` | `tenant_id` | CASCADE | 0006:125 |
| `task_packages` | `tenant_id` | CASCADE | 0007:109 |
| `failed_pushes` | `tenant_id` | CASCADE | 0008:139 |
| `subscriptions` | `tenant_id` | CASCADE | 0009:134 |
| `asset_tracking_cache` | `tenant_id` | CASCADE | 0011:165 |
| `task_generation_runs` | `tenant_id` | CASCADE | 0012:157 |
| `tenant_suitefleet_webhook_credentials` | `tenant_id` (PK) | CASCADE | 0013:148 |
| `addresses` | `tenant_id` | CASCADE | 0014:124 |
| `subscription_address_rotations` | `tenant_id` | CASCADE | 0014:171 |
| `subscription_exceptions` | `tenant_id` | CASCADE | 0015:136 |
| `subscription_materialization` | `tenant_id` | CASCADE | 0015:212 |
| `consignee_crm_events` | `tenant_id` | CASCADE | 0016:152 |
| `webhook_events` | `tenant_id` | CASCADE | 0018:74 |
| `outbound_push_failures` | `tenant_id` | CASCADE | 0023:101 |
| `asset_scan_log` | `tenant_id` | **RESTRICT** **(blocker — §1.4)** | 0032:42 |

### 1.2 Transitive edges (child references a child of `tenants`, not `tenants`)

| Child | Column → Parent | ON DELETE | Cite |
|---|---|---|---|
| `role_assignments` | `user_id` → `users.id` | CASCADE | 0001:190 |
| `role_assignments` | `role_id` → `roles.id` | CASCADE | 0001:191 |
| `task_packages` | `task_id` → `tasks.id` | CASCADE | 0007:108 |
| `failed_pushes` | `task_id` → `tasks.id` | CASCADE | 0008:140 |
| `failed_pushes` | `resolved_by` → `users.id` | SET NULL | 0008:157 |
| `asset_tracking_cache` | `task_id` → `tasks.id` | CASCADE | 0011:147 |
| `outbound_push_failures` | `task_id` → `tasks.id` | CASCADE | 0023:102 |
| `asset_scan_log` | `task_id` → `tasks.id` | **RESTRICT** | 0032:43 |
| `tasks` | `consignee_id` → `consignees.id` | **RESTRICT** | 0006:126 |
| `tasks` | `subscription_id` → `subscriptions.id` | **RESTRICT** | 0010:104 |
| `tasks` | `address_id` → `addresses.id` (nullable) | **RESTRICT** | 0014:203 |
| `addresses` | `consignee_id` → `consignees.id` | CASCADE | 0014:123 |
| `subscription_address_rotations` | `subscription_id` → `subscriptions.id` | CASCADE | 0014:170 |
| `subscription_address_rotations` | `address_id` → `addresses.id` | **RESTRICT** | 0014:173 |
| `subscription_exceptions` | `subscription_id` → `subscriptions.id` | CASCADE | 0015:135 |
| `subscription_exceptions` | `address_override_id` → `addresses.id` (nullable) | **RESTRICT** | 0015:143 |
| `subscription_materialization` | `subscription_id` → `subscriptions.id` | CASCADE | 0015:211 |
| `consignee_crm_events` | `consignee_id` → `consignees.id` | CASCADE | 0016:151 |

The `RESTRICT` edges are why a bare `DELETE FROM tenants` fails: the tenant-level
cascade would try to delete `consignees`/`subscriptions`/`addresses` while `tasks`
still references them. We clear `tasks` (and the two blocker tables) explicitly
first; then the remaining cascades are unobstructed.

### 1.3 Region binding (the reason a junk region cannot be deleted while its tenant lives)

`tenants.suitefleet_region_id uuid NOT NULL REFERENCES suitefleet_regions(id) ON
DELETE RESTRICT` — added at `0024:207-208`, `SET NOT NULL` at `0024:217`. The tenant
is the **child**; the region is the **parent**. Consequences:
- Deleting a **tenant** does NOT touch its region (no upward cascade). The region row
  survives — that is why junk regions persist after a tenant is removed and must be
  deleted in a later, separate stage.
- Deleting a **region** fails with `RESTRICT` while any tenant still points at it.
  So junk regions are deletable only after their bound tenant is gone (Stage 3 after
  Stage 2), or if already unbound (the 16 Query-C rows).

Canonical regions are seeded at `0024:153-157`. `transcorpsb` has the fixed id
`11111111-1111-4111-a111-111111111111`; the other three use `gen_random_uuid()`, so
their ids are unknown statically and MUST be resolved by `client_id` at audit time
(Appendix A). `transcorpsb` is also the column DEFAULT (`0024:208`), i.e. every
tenant created without an explicit region lands on Sandbox — this is the root of the
~1770 Sandbox count discussed in §6.

### 1.4 The two hard blockers (verified against source this session)

**Blocker A — `audit_events_no_delete` RULE** (`0002:89-90`):
```sql
CREATE RULE audit_events_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
```
`DO INSTEAD NOTHING` rewrites the cascade's `DELETE` on `audit_events` into a no-op;
the rows survive, still referencing the soon-deleted tenant, and Postgres raises an
FK violation. **Net effect: `DELETE FROM tenants …` fails whenever the tenant has any
audit events.** Sanctioned escape: disable the rule, delete the rows, re-enable —
inside the same transaction, as the `postgres` (owner) role the SQL editor uses.

**Blocker B — `asset_scan_log` RESTRICT + append-only trigger** (`0032:42-43`,
`0032:89-107`). Both `tenant_id` and `task_id` FKs are `ON DELETE RESTRICT`, and a
`BEFORE DELETE` trigger raises unless the session GUC is set:
```sql
IF COALESCE(current_setting('app.allow_scan_log_delete', true), '') <> 'on' THEN
  RAISE EXCEPTION 'asset_scan_log is append-only: DELETE forbidden outside merchant teardown (id %)', OLD.id;
```
Sanctioned escape: `SET LOCAL app.allow_scan_log_delete = 'on';` then delete the
tenant's scan rows *before* deleting tasks/tenant (the RESTRICT on `task_id` also
anchors `tasks`).

**Non-blockers (confirmed, no DELETE impact):** the five `*_assert_tenant_match`
`BEFORE INSERT OR UPDATE` triggers (0007/0008/0011/0023/0032) do not fire on DELETE;
`webhook_events` is grant-restricted (0018:101) but the `postgres` role bypasses it;
no deferred constraints exist.

### 1.5 Canonical per-tenant teardown order (deepest-leaf-first)

```
A. audit_events        -- DISABLE RULE → DELETE → ENABLE RULE   (Blocker A)
B. asset_scan_log      -- SET LOCAL GUC → DELETE                (Blocker B)
C. tasks               -- explicit; auto-cascades task_packages, failed_pushes,
                       --   asset_tracking_cache, outbound_push_failures;
                       --   nulls failed_pushes.resolved_by (harmless)
D. subscriptions       -- explicit; auto-cascades subscription_address_rotations,
                       --   subscription_exceptions, subscription_materialization
E. consignee_crm_events-- explicit (or rely on consignees cascade)
F. addresses           -- explicit (RESTRICT anchors cleared by C+D)
G. consignees          -- explicit (tasks RESTRICT cleared by C)
H. tenants             -- DELETE; auto-cascades users, roles, role_assignments,
                       --   api_keys, task_generation_runs,
                       --   tenant_suitefleet_webhook_credentials, webhook_events
I. (later stage) the now-unbound junk regions
```

---

## 2. Junk-tenant identification — allowlist, deterministic query, eyes-on classifier

**This plan cannot and does not print literal tenant_ids** — plan-only, no row read.
Deliverable #2 is delivered as (a) the explicit REAL allowlist the targets are
filtered against, and (b) the exact deterministic query that enumerates the target
set. The literal `tenant_id / name / slug / bound region` rows are produced when Love
runs the Stage-A audit query; that output is the eyes-on list Love signs off on and
is frozen in the Stage-0 backup.

### 2.1 The REAL allowlist (keep set) — verbatim from `genuine-merchants.ts:41-50`

```
meal-plan-scheduler   dr-nutrition   fresh-butchers   transcorp
hem                   mlp            demo-bistro      demo-bistro1
```
(8 genuine slugs. The live `[0-9a-f]{8}` filter matched 1,821 of 1,832 tenants; the
11 non-matches were exactly the genuine ones — `genuine-merchants.ts:16-17`.)

### 2.2 Target predicate (DELETE set)

A tenant is a deletion target **iff** it is bound to a **non-canonical region** AND
its slug is **not** in the allowlist. Region-binding is the positive structural
signal (the audit proved no real merchant is on a junk region); the allowlist
exclusion is belt-and-suspenders.

```sql
-- DELIVERABLE #2 — Stage-A enumerating query (READ ONLY).
SELECT t.id            AS tenant_id,
       t.slug,
       t.name,
       t.status,
       r.client_id     AS bound_region_client_id,
       r.id            AS bound_region_id,
       (t.slug ~ '[0-9a-f]{8}')                         AS matches_hex_pattern,
       (t.slug ~ '^(acd|arde|cps|pfc|src|umr)-')        AS matches_fixture_prefix
FROM tenants t
JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
  AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers',
                     'transcorp','hem','mlp','demo-bistro','demo-bistro1')
ORDER BY matches_hex_pattern, matches_fixture_prefix, t.slug;
```

**Eyes-on classifier rule:** any returned row where BOTH `matches_hex_pattern` and
`matches_fixture_prefix` are `false` is an *unexpected* target — Love reviews it
individually and it is excluded from the batch unless explicitly cleared. (Sorted
first by the ORDER BY so anomalies surface at the top.) This is how we honour "key
off an explicit allowlist of what's real, never a looks-like-a-test pattern alone":
nothing is deleted for *matching* a test pattern; it is deleted for being on a junk
region and not allowlisted, with the patterns only flagging surprises.

### 2.3 Junk-region enumeration (for Stage 3)

```sql
-- READ ONLY. All non-canonical regions, with their live bound-tenant count.
SELECT r.id AS region_id, r.client_id, r.display_name, r.status,
       (SELECT count(*) FROM tenants t WHERE t.suitefleet_region_id = r.id) AS bound_tenant_count
FROM suitefleet_regions r
WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
ORDER BY bound_tenant_count DESC, r.client_id;
```
Expected after Stage 2: every junk region's `bound_tenant_count = 0`. Stage 3 refuses
to delete any region whose count is `> 0`.

### 2.4 Defensive completeness check (Stage A)

Confirm the FK map of §1 is exhaustive — that no other table carries tenant data
outside the cascade:
```sql
-- READ ONLY. Any column named tenant_id that the §1 map does not cover is a finding.
SELECT table_name, column_name
FROM information_schema.columns
WHERE column_name = 'tenant_id' AND table_schema = 'public'
ORDER BY table_name;
```
Cross-check the result against §1.1 (21 tables expected: the 20 children +
`asset_scan_log` appears once). Any extra table → STOP and surface, do not proceed.

---

## 3. Ordered delete sequence (one transaction per stage, verify-before-commit)

Each destructive stage is a **DRY-RUN** block (ends `ROLLBACK`) and an identical
**EXECUTE** block (ends `COMMIT`). The only line that differs between them is the
last word. Run DRY-RUN, read the counts, then — on a named clear — run EXECUTE. Both
build the target set from the deterministic predicate into a TEMP TABLE, so the SQL
editor's single-paste execution is self-contained per stage.

Every stage block begins with the **project-ref pre-flight** (§5.1). If it fails the
block aborts before any write.

### 3.1 Stage 1 — child deletes (Blockers A+B + tasks/subscriptions/consignee graph)

```sql
-- ====== STAGE 1: CHILD DELETES — DRY RUN (ends ROLLBACK) ======
BEGIN;

-- Pre-flight fingerprint: 4 canonical regions must exist by client_id, else abort.
DO $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c FROM suitefleet_regions
   WHERE client_id IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar');
  IF c <> 4 THEN RAISE EXCEPTION 'PROJECT-REF FINGERPRINT FAILED: expected 4 canonical regions, found %', c; END IF;
END $$;

-- Materialize the frozen target set.
CREATE TEMP TABLE _targets ON COMMIT DROP AS
SELECT t.id AS tenant_id
FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
  AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers',
                     'transcorp','hem','mlp','demo-bistro','demo-bistro1');

-- SAFETY GUARD: refuse if any target is allowlisted or on a canonical region.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE t.id IN (SELECT tenant_id FROM _targets)
    AND ( t.slug IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers',
                     'transcorp','hem','mlp','demo-bistro','demo-bistro1')
          OR r.client_id IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar') );
  IF bad <> 0 THEN RAISE EXCEPTION 'SAFETY GUARD TRIPPED: % target(s) are allowlisted or canonical-bound', bad; END IF;
END $$;

-- Blocker A: audit_events.
ALTER TABLE audit_events DISABLE RULE audit_events_no_delete;
DELETE FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _targets);
ALTER TABLE audit_events ENABLE RULE audit_events_no_delete;

-- Blocker B: asset_scan_log.
SET LOCAL app.allow_scan_log_delete = 'on';
DELETE FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _targets);

-- Graph: tasks → subscriptions → consignee graph (cascades handle the leaf tables).
DELETE FROM tasks                WHERE tenant_id IN (SELECT tenant_id FROM _targets);
DELETE FROM subscriptions        WHERE tenant_id IN (SELECT tenant_id FROM _targets);
DELETE FROM consignee_crm_events WHERE tenant_id IN (SELECT tenant_id FROM _targets);
DELETE FROM addresses            WHERE tenant_id IN (SELECT tenant_id FROM _targets);
DELETE FROM consignees           WHERE tenant_id IN (SELECT tenant_id FROM _targets);

-- Verify-before-commit: residual child rows for the target set must be zero.
SELECT 'tasks' tbl, count(*) n FROM tasks WHERE tenant_id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions WHERE tenant_id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'consignees', count(*) FROM consignees WHERE tenant_id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'addresses', count(*) FROM addresses WHERE tenant_id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'audit_events', count(*) FROM audit_events WHERE tenant_id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'asset_scan_log', count(*) FROM asset_scan_log WHERE tenant_id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'tenants_still_present', count(*) FROM tenants WHERE id IN (SELECT tenant_id FROM _targets);

ROLLBACK;   -- DRY RUN. Change to COMMIT only on Love's named clear (EXECUTE block).
```
**EXECUTE block:** identical, with the final `ROLLBACK;` replaced by `COMMIT;`. After
EXECUTE, `tenants_still_present` will equal the target count (tenants are removed in
Stage 2); all child counts must be `0`.

> Note: `ALTER TABLE … DISABLE/ENABLE RULE` requires table ownership. The SQL editor's
> `postgres` role owns `public` tables, so this succeeds there. If it raises
> `permission denied`, STOP — do not seek another path; surface for Love (Floor 1).

### 3.2 Stage 2 — tenant deletes

```sql
-- ====== STAGE 2: TENANT DELETES — DRY RUN (ends ROLLBACK) ======
BEGIN;
-- [project-ref fingerprint DO block — identical to Stage 1]
-- [CREATE TEMP TABLE _targets … — identical to Stage 1]
-- [SAFETY GUARD DO block — identical to Stage 1]

DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM _targets);

-- Verify: targets gone; allowlisted + canonical-bound tenants untouched.
SELECT 'targets_remaining' k, count(*) v FROM tenants WHERE id IN (SELECT tenant_id FROM _targets)
UNION ALL SELECT 'allowlisted_present', count(*) FROM tenants
  WHERE slug IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers','transcorp','hem','mlp','demo-bistro','demo-bistro1');

ROLLBACK;   -- DRY RUN. COMMIT only on named clear.
```
`targets_remaining` must be `0`; `allowlisted_present` must equal its pre-run value
(unchanged). EXECUTE = same with `COMMIT;`. The tenant delete auto-cascades the
remaining leaf children (users, roles, role_assignments, api_keys,
task_generation_runs, tenant_suitefleet_webhook_credentials, webhook_events).

### 3.3 Stage 3 — region deletes (now-unbound junk regions)

```sql
-- ====== STAGE 3: REGION DELETES — DRY RUN (ends ROLLBACK) ======
BEGIN;
-- [project-ref fingerprint DO block — identical to Stage 1]

-- GUARD: refuse to delete any region that still has a bound tenant.
DO $$
DECLARE bound int;
BEGIN
  SELECT count(*) INTO bound
  FROM suitefleet_regions r
  WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.suitefleet_region_id = r.id);
  IF bound <> 0 THEN RAISE EXCEPTION 'REGION GUARD TRIPPED: % junk region(s) still have bound tenants', bound; END IF;
END $$;

DELETE FROM suitefleet_regions
WHERE client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar');

-- Verify: exactly the 4 canonical regions remain.
SELECT count(*) AS regions_remaining,
       array_agg(client_id ORDER BY client_id) AS client_ids
FROM suitefleet_regions;

ROLLBACK;   -- DRY RUN. COMMIT only on named clear.
```
`regions_remaining` must be `4`; `client_ids` must equal
`{transcorp,transcorpqatar,transcorpsb,transcorpuae}`. EXECUTE = same with `COMMIT;`.

### 3.4 Final verify (read-only, no clear needed)

```sql
SELECT (SELECT count(*) FROM suitefleet_regions) AS regions,           -- expect 4
       (SELECT count(*) FROM suitefleet_regions
         WHERE client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')) AS junk_regions,  -- expect 0
       (SELECT count(*) FROM tenants t JOIN suitefleet_regions r ON r.id=t.suitefleet_region_id
         WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')) AS tenants_on_junk_regions; -- expect 0
```

---

## 4. Backup (Stage 0) — full dump of every row to be deleted, BEFORE anything runs

Taken **after** Stage A (so the target set is known) and **before** Stage 1. Saved
under `memory/handoffs/purge-backup-2026-06-25/` (one file per table). Because
execution is in the SQL editor, the backup is produced there too: run each `SELECT`
below and use the editor's **Download CSV** to save `<table>.csv`. The junk tenants
are fixture tenants (often near-zero child rows), so volume is expected to be small —
but the Stage-A counts confirm volume before this step; if any table is large, CSV
export still applies.

```sql
-- Rebuild the same target set, then dump each table scoped to it.
-- Run once per table; Download CSV → memory/handoffs/purge-backup-2026-06-25/<table>.csv
WITH tgt AS (
  SELECT t.id FROM tenants t JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
  WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
    AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition','fresh-butchers',
                       'transcorp','hem','mlp','demo-bistro','demo-bistro1')
)
SELECT * FROM tenants WHERE id IN (SELECT id FROM tgt);   -- tenants.csv
-- Repeat the same WITH tgt prefix for each, changing only the final SELECT:
--   audit_events       WHERE tenant_id IN (SELECT id FROM tgt)
--   asset_scan_log     WHERE tenant_id IN (SELECT id FROM tgt)
--   tasks / task_packages / failed_pushes / asset_tracking_cache / outbound_push_failures
--                      WHERE tenant_id IN (SELECT id FROM tgt)
--   subscriptions / subscription_address_rotations / subscription_exceptions /
--   subscription_materialization   WHERE tenant_id IN (SELECT id FROM tgt)
--   consignees / addresses / consignee_crm_events   WHERE tenant_id IN (SELECT id FROM tgt)
--   users / roles / role_assignments / api_keys / task_generation_runs /
--   tenant_suitefleet_webhook_credentials / webhook_events   WHERE tenant_id IN (SELECT id FROM tgt)
-- Plus the junk regions themselves (parents):
SELECT * FROM suitefleet_regions
WHERE client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar');  -- regions.csv
```

**Backup completeness gate:** the row count of each CSV must equal the matching
Stage-A audit count. Love confirms the folder is populated and counts match before
the Stage-1 clear.

### 4.1 Restore path (re-INSERT ordering — PARENT → CHILD, reverse of delete)

CSV preserves every column including the original `uuid` PKs, so FKs reconnect on
re-insert. Restore order:

```
1. suitefleet_regions   (parents of tenants)
2. tenants              (then the leaf children that cascaded out:)
3. users, roles, role_assignments, api_keys, task_generation_runs,
   tenant_suitefleet_webhook_credentials, webhook_events
4. consignees → addresses → consignee_crm_events
5. subscriptions → subscription_address_rotations → subscription_exceptions →
   subscription_materialization
6. tasks → task_packages → failed_pushes → asset_tracking_cache → outbound_push_failures
7. asset_scan_log     -- needs SET LOCAL app.allow_scan_log_delete is NOT required for INSERT;
                      --   the append-only trigger blocks UPDATE/DELETE only, not INSERT.
8. audit_events       -- INSERT is allowed (the rule blocks UPDATE/DELETE only).
```
Re-insert each table with an explicit column list matching the CSV header. Run the
whole restore in one transaction; if any FK fails, the ordering above is wrong for
that row — ROLLBACK and surface. (Restore is itself a Floor-1 action needing its own
named clear if ever invoked.)

### 4.2 Residual note — orphaned Vault secrets (flag, not in scope)

Junk tenants carry `suitefleet_credential_1_vault_id` / `_2_vault_id` (0024) and a
`tenant_suitefleet_webhook_credentials` row (0013) that reference Supabase **Vault**
secrets. Vault has no FK to `tenants`, so deleting a tenant leaves those
`vault.secrets` rows orphaned (harmless — unreferenced). The captured `tenants.csv`
preserves the vault ids for audit. Cleaning orphaned vault secrets is a minor
optional follow-up, NOT part of this purge; flagged for Love's awareness.

---

## 5. Authorization shape (Floor 1 — named per-stage clears)

### 5.1 Project-ref pre-flight (before EVERY stage)

The Supabase SQL editor is bound to the project selected in the dashboard URL. Before
running any block, Love confirms **(1)** the dashboard URL contains
`qdotjmwqbyzldfuxphei`, and **(2)** the in-SQL fingerprint `DO` block (4 canonical
regions by `client_id`) passes — it is embedded at the top of every destructive
block and aborts the transaction on mismatch. The SQL editor has no `\conninfo`
(that is a `psql` meta-command); this fingerprint is its equivalent. **Mismatch =
stop, never re-scope.**

### 5.2 The six clears (each its own named sentence, after Love sees the prior output)

| # | Stage | Type | Love sees before next clear |
|---|---|---|---|
| 1 | **Audit** (§2.2, §2.3, §2.4) | READ ONLY | The full target list + region list + counts + any eyes-on anomalies |
| 2 | **Backup** (§4) | READ ONLY (export) | The populated `purge-backup-2026-06-25/` folder; CSV counts == audit counts |
| 3 | **Child deletes** (§3.1) | DRY-RUN then EXECUTE | DRY-RUN residual-count output (all child counts → 0) |
| 4 | **Tenant deletes** (§3.2) | DRY-RUN then EXECUTE | DRY-RUN: targets_remaining 0, allowlisted unchanged |
| 5 | **Region deletes** (§3.3) | DRY-RUN then EXECUTE | DRY-RUN: regions_remaining 4, client_ids canonical |
| 6 | **Final verify** (§3.4) | READ ONLY | Confirms end state; no further clear |

Each clear is a separate sentence on the record. Agent does not execute; the route is
always "Love runs the reviewed block in the Supabase SQL editor." If any stage's DRY-
RUN output is not exactly as specified, STOP and surface — do not run that EXECUTE.

### 5.3 Reviewer

This plan PR is body-read by an **independent reviewer context** before it is
eligible. No builder sub-agent serves as that reviewer (Floor 1/§4). The reviewer
checks: FK map completeness vs. migrations, the two-blocker handling, the keep-
allowlist correctness, the disjointness proof of §6, the backup completeness gate,
and that nothing executes from the PR.

---

## 6. The ~1770 Sandbox / 8 KSA question (deliverable #6) — answered + second purge flagged

**Does this purge change the Sandbox `transcorpsb` ~1770 count or the KSA `transcorp`
8 count?**

**No — by construction, and the Stage-A audit proves it.** The deletion target set
(§2.2) is defined as *tenants bound to a NON-canonical region*. `transcorpsb` and
`transcorp` are canonical (kept). Therefore the target set is **disjoint** from the
~1770 Sandbox-bound and 8 KSA-bound tenants — deleting the junk-region-bound tenants
removes zero rows from either canonical region's count. Stage A asserts this
explicitly via the SAFETY GUARD (§3.1): any target found on a canonical region aborts
the run. After the purge, `transcorpsb` still shows ~1770 and `transcorp` still shows
8.

**Are the ~1770 / 8 themselves real, or do they include test data?** This is a
**separate, larger purge question — and a real one.** Evidence already in the
codebase: `genuine-merchants.ts:16-17` records that the live `[0-9a-f]{8}` test-slug
filter matched **1,821 of 1,832** tenants, with only **11** genuine. Because
`transcorpsb` is the DEFAULT region for every tenant created without an explicit one
(`0024:208`), that ~1,821-strong test-tenant mass almost certainly sits on
`transcorpsb` — i.e. **the ~1770 Sandbox count is overwhelmingly hex-slug test
tenants**, not real merchants. The F8 read-path filter already hides them, so there
is no display urgency.

**SECOND PURGE QUESTION — FLAGGED, NOT EXECUTED HERE.** Purging the ~1770 Sandbox-
bound hex-slug test tenants is out of this plan's ruled scope ("reach exactly 4
regions" — they sit on a *kept* region, with no junk region to remove). It is a
distinct decision because: (a) far larger blast radius (~1,770 tenants vs ~48); (b)
bigger backup; (c) its keep-set must be the allowlist applied *on the canonical
region* (the 8 genuine slugs, several of which are themselves backfilled onto
`transcorpsb`); (d) it needs its own audit, backup, and named clears. **Recommendation:
rule on it separately; if Love wants it, it gets its own plan PR mirroring this
structure.** Stage A of THIS plan will also surface two confirming numbers for that
decision — the `transcorpsb` total bound count and how many of those match the
hex/allowlist split — so Love can size the second purge precisely:

```sql
-- READ ONLY context for the second-purge decision (run during Stage A).
SELECT r.client_id,
       count(*)                                                        AS bound_total,
       count(*) FILTER (WHERE t.slug ~ '[0-9a-f]{8}'
                          AND t.slug NOT IN ('meal-plan-scheduler','dr-nutrition',
                              'fresh-butchers','transcorp','hem','mlp','demo-bistro','demo-bistro1')) AS hex_test_like,
       count(*) FILTER (WHERE t.slug IN ('meal-plan-scheduler','dr-nutrition',
                          'fresh-butchers','transcorp','hem','mlp','demo-bistro','demo-bistro1'))     AS allowlisted
FROM suitefleet_regions r
LEFT JOIN tenants t ON t.suitefleet_region_id = r.id
WHERE r.client_id IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
GROUP BY r.client_id ORDER BY r.client_id;
```
Also surfaces the KSA-8: if any of the 8 `transcorp`-bound rows are `hex_test_like`,
that is a finding (junk on a canonical region) — Love rules per-row; this plan does
**not** auto-touch them (out of scope: canonical region, no region to free).

---

## 7. Reviewer handoff / STOP

After this plan PR opens, the lane **STOPS**. No query runs, no row is deleted, no
promote. Execution begins only when Love issues the Stage-1 (Audit) clear, and each
subsequent stage waits for its own named clear after Love has seen the prior output.

**Open items for Love's ruling (surface, do not resolve):**
1. Confirm the 8-slug keep allowlist (Appendix A) is complete and current.
2. Confirm "exactly 4 regions" is the end-state target (this plan), and that #656 is
   superseded/closed in favour of it.
3. Decide the **second purge** (§6): purge the ~1770 Sandbox hex-slug test tenants in
   a separate plan, or leave them hidden-by-filter? (Recommendation: separate ruling.)
4. Note the Vault-orphan residual (§4.2): ignore (harmless) or schedule a follow-up?

---

## Appendix A — canonical constants (for the reviewer's cross-check)

- **Canonical region `client_id`s (KEEP):** `transcorpsb`, `transcorp`,
  `transcorpuae`, `transcorpqatar` (seeded `0024:153-157`; `transcorpsb` id fixed at
  `11111111-1111-4111-a111-111111111111`, others `gen_random_uuid()` → resolve by
  `client_id`).
- **Genuine slug allowlist (KEEP):** `meal-plan-scheduler`, `dr-nutrition`,
  `fresh-butchers`, `transcorp`, `hem`, `mlp`, `demo-bistro`, `demo-bistro1`
  (`genuine-merchants.ts:41-50`).
- **Known junk fixture prefixes (classifier only):** `acd-`, `arde-`, `cps-`,
  `pfc-`, `src-`, `umr-` (+ 8-hex). Test-slug pattern: un-anchored `[0-9a-f]{8}`
  (`genuine-merchants.ts:75`).
- **Hard blockers:** `audit_events_no_delete` RULE (`0002:90`); `asset_scan_log`
  RESTRICT + append-only trigger (`0032:42-43`, `0032:95`).
