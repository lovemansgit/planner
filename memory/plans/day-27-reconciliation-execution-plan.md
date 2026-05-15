# Day-27 reconciliation execution plan (T3, step 3 of 4 of reconciliation lane)

**Filed:** Day-27 (15 May 2026), AM.
**Tier:** T3 plan-PR (the plan artifact is T1 docs; the lane it describes is T3 schema + production-state).
**Status:** PLAN. Reviewed before execution. No production change happens until the §3.6 review completes and Love is cleared to run.

> **Hard constraint up front.** No improvisation. Every statement Love will paste into the production SQL editor (project `qdotjmwqbyzldfuxphei`) is enumerated below, in order, with its pre-checks, expected outcomes, post-checks, and rollback path. The reviewer (Love) §3.6-clears each step in advance; nothing is invented at execution time.

---

## §1 — Lane summary + entry conditions

**What shipped to enable this plan:**

| PR | SHA | Tier | Artifact |
|---|---|---|---|
| [#287](https://github.com/lovemansgit/planner/pull/287) | `fac8dd2` | T1 | Audit input block (Q1–Q15 + 3 follow-up queries) |
| [#288](https://github.com/lovemansgit/planner/pull/288) | `d00dc8a` | T1 | Audit findings — production identity schema is intact; Day-26 diagnostic factually wrong on every claim |
| [#289](https://github.com/lovemansgit/planner/pull/289) | `8bb63c0` | T1 | Reconciliation audit input — 0017/0020/0021/0022/0023 schema-delta slice |
| [#290](https://github.com/lovemansgit/planner/pull/290) | `47a2119` | T1 | Session B's parallel audit input — 0018/0019 small slice |
| [#291](https://github.com/lovemansgit/planner/pull/291) | `47780e1` | T1 | Controlled 0024 retry wrapper (BEGIN/<verbatim>/ROLLBACK), byte-identical splice md5=`bf7bd1c6c0cc30cae625e58e928c80d4` |

**Production state this plan assumes (authoritative sources):**

- Production matches repo migration history for `0001`–`0023` with **three identified divergences only** (per PR #288 audit findings):
  1. `users_set_updated_at` trigger missing (everything else from `0001` present).
  2. `webhook_events_tenant_isolation` policy is `FOR ALL` instead of narrower.
  3. `planner_app` has UPDATE+DELETE grants on `webhook_events` that the migration intent says should not be there.
- **PR #291's controlled retry of migration 0024 under `BEGIN`/`ROLLBACK` wrap succeeded cleanly.** No statement threw. Day-26's failure was transient (lock, Vault state, network hiccup, momentary catalog inconsistency). Migration 0024 will now apply against the live database.
- Code on `main` is at `47780e1` (or later by execution time). Production currently serves `6c637f4` (Day-25 PM-late promote; 6 Day-26 commits ahead held at the §F gate, plus today's docs-only commits which do not affect runtime).

**Today's demo deadline.** The plan goal is to bring production into the v1.15-intended architecture before tomorrow's demo: 0024 applied, three divergences reconciled (potentially more from §2's sweep), Day-26 bundle promoted, credentials provisioned on sandbox-region tenants, smoke-test green.

---

## §2 — GRANT sweep sub-audit (run FIRST, before any execution)

**Why this exists.** Today's audit findings (PR #288) noted that `planner_app` has UPDATE+DELETE on `webhook_events` even though migration 0018 was written to grant only SELECT+INSERT. The hypothesis is that `0003_app_role.sql` line 104 — `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO planner_app;` — explicitly grants all four operations on every table that existed at the time 0003 ran (which includes `audit_events` from 0002), and 0003 line 120's `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO planner_app` auto-grants the same broad set on every future public-schema table. This means **any migration that explicitly grants narrow grants (like 0018) needs an explicit REVOKE to enforce the narrowness** — without the REVOKE, the broad default-grant still applies.

**The §2 sweep verifies the hypothesis across all 22 public-schema tables.** Its output determines the scope of §4(b)'s REVOKE work — possibly more than just `webhook_events`.

### §2 Part A — Repo-declared intended grants per table

Grepping all 23 migrations for `GRANT` / `REVOKE` / `ALTER DEFAULT PRIVILEGES`, the repo intent breaks down as follows:

| # | Table | Source migration | Repo-declared GRANT shape | RULE blocking UPDATE/DELETE? |
|---|---|---|---|---|
| 1 | `tenants` | 0001 | broad (from 0003 line 104) | no |
| 2 | `users` | 0001 | broad (from 0003 line 104) | no |
| 3 | `roles` | 0001 | broad (from 0003 line 104) | no |
| 4 | `role_assignments` | 0001 | broad (from 0003 line 104) | no |
| 5 | `api_keys` | 0001 | broad (from 0003 line 104) | no |
| 6 | `audit_events` | 0002 | **narrow intent** — table is append-only by design + RULE; but 0003 line 104 explicitly grants broad on all existing public tables, so the actual grant ends up broad | **YES** (`audit_events_no_update`, `audit_events_no_delete`) — RULE protects against UPDATE/DELETE at DB layer regardless of grant shape |
| 7 | `consignees` | 0004 | broad (explicit GRANT in 0004 line 104) | no |
| 8 | `tasks` | 0006 | broad (explicit GRANT in 0006 line 184) | no |
| 9 | `task_packages` | 0007 | broad (explicit GRANT in 0007 line 187) | no |
| 10 | `failed_pushes` | 0008 | broad (explicit GRANT in 0008 line 238) | no |
| 11 | `subscriptions` | 0009 | broad (explicit GRANT in 0009 line 189) | no |
| 12 | `asset_tracking_cache` | 0011 | broad (explicit GRANT in 0011 line 245) | no |
| 13 | `task_generation_runs` | 0012 | broad (explicit GRANT in 0012 line 238) | no |
| 14 | `tenant_suitefleet_webhook_credentials` | 0013 | broad (explicit GRANT in 0013 line 175) | no |
| 15 | `addresses` | 0014 | broad (explicit GRANT in 0014 line 161) | no |
| 16 | `subscription_address_rotations` | 0014 | broad (explicit GRANT in 0014 line 193) | no |
| 17 | `subscription_exceptions` | 0015 | broad (explicit GRANT in 0015 line 203) | no |
| 18 | `subscription_materialization` | 0015 | broad (explicit GRANT in 0015 line 230) | no |
| 19 | `consignee_crm_events` | 0016 | broad (explicit GRANT in 0016 line 196) | no |
| 20 | `webhook_events` | 0018 | **narrow intent** — `GRANT SELECT, INSERT ON webhook_events TO planner_app` (0018 line 101); no REVOKE of the default-grant UPDATE/DELETE | **NO** — this is the one today's audit flagged |
| 21 | `outbound_push_failures` | 0023 | broad (explicit GRANT in 0023 line 184) | no |
| 22 | `suitefleet_regions` | 0024 (post-§3) | broad (explicit GRANT in 0024 line 190) | no |

**Plus one view:**
- `consignee_timeline_events` (0016) — `GRANT SELECT` only (0016 line 256). This is correct by design (a view, read-only).

### §2 Part B — Read-only SQL block to run against production

```sql
-- =============================================================================
-- §2 GRANT sweep — every public-schema table's planner_app grants
-- READ-ONLY. Single safe-to-paste execution. Target: qdotjmwqbyzldfuxphei
-- =============================================================================


-- Q2.1 — Every base table in public and the planner_app grants attached.
-- Tables with no grants attached for planner_app will appear with NULL in
-- the planner_app_grants column. Diff this output against §2 Part A's
-- expected column to surface tables where the actual grant shape diverges
-- from the migration intent.
SELECT t.table_name,
       string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type)
         AS planner_app_grants
FROM information_schema.tables t
LEFT JOIN information_schema.role_table_grants g
       ON g.table_schema = t.table_schema
      AND g.table_name = t.table_name
      AND g.grantee    = 'planner_app'
WHERE t.table_schema = 'public'
  AND t.table_type   = 'BASE TABLE'
GROUP BY t.table_name
ORDER BY t.table_name;


-- Q2.2 — Every RULE on every public table that blocks UPDATE or DELETE.
-- audit_events expected to show the _no_update + _no_delete RULEs from 0002.
-- Any other table appearing here is an unexpected RULE — surface to reviewer.
SELECT c.relname  AS table_name,
       r.rulename AS rule_name,
       CASE r.ev_type
            WHEN '2' THEN 'UPDATE'
            WHEN '4' THEN 'DELETE'
       END        AS rule_event
FROM pg_rewrite r
JOIN pg_class c     ON c.oid = r.ev_class
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname  = 'public'
  AND r.rulename != '_RETURN'
  AND r.ev_type IN ('2','4')
ORDER BY c.relname, r.rulename;


-- Q2.3 — Same grant view for the public-schema view (consignee_timeline_events).
-- Expected: planner_app has SELECT only. UPDATE / INSERT / DELETE on a
-- security_invoker view should not appear.
SELECT g.table_name,
       string_agg(g.privilege_type, ', ' ORDER BY g.privilege_type)
         AS planner_app_grants
FROM information_schema.role_table_grants g
WHERE g.table_schema = 'public'
  AND g.grantee     = 'planner_app'
  AND g.table_name  = 'consignee_timeline_events'
GROUP BY g.table_name;


-- =============================================================================
-- End of §2 sweep. Surface Q2.1/Q2.2/Q2.3 output to reviewer BEFORE §4(b)
-- executes. The sweep's REVOKE scope is determined by which tables show
-- UPDATE+DELETE grants without a covering RULE (per Part A's column).
-- =============================================================================
```

### §2 — Expected output interpretation

Based on Part A's analysis, the sweep is **predicted** to surface:
- **21 broad rows** in Q2.1 (every table with `DELETE, INSERT, SELECT, UPDATE`).
- **2 RULE rows** in Q2.2 (`audit_events_no_update`, `audit_events_no_delete` — the only expected RULEs).
- **1 SELECT-only row** in Q2.3 (`consignee_timeline_events`).

**Divergence shape — predicted, to be confirmed by the sweep:**
- `audit_events`: grants are likely broad, but RULE in Q2.2 covers UPDATE+DELETE — operationally inert divergence.
- `webhook_events`: grants are broad per today's findings, and NO covering RULE — operationally meaningful divergence (the one already known).

If Q2.1 reveals additional tables with the narrow-intent / broad-actual pattern, the §4(b) REVOKE list expands. The reviewer rules on scope.

---

## §3 — Migration 0024 application

The un-wrapped application of 0024. Same SQL body as PR #291's wrapper, but without the `BEGIN`/`ROLLBACK` frame. Production state change: creates `suitefleet_regions` table (4 seed rows) + index + RLS + trigger + GRANT, adds 3 columns to `tenants`, backfills, sets `suitefleet_region_id` NOT NULL.

### §3 Pre-checks (run BEFORE the execution block)

```sql
-- §3.PRE.1 — suitefleet_regions table does not yet exist.
-- Expected: 0 rows. Non-zero = the table already exists somehow; STOP.
SELECT count(*) AS suitefleet_regions_exists
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'suitefleet_regions';


-- §3.PRE.2 — tenants does not yet have suitefleet_region_id column.
-- Expected: 0 rows. Non-zero = partial-apply state from somewhere; STOP and
-- consult reviewer before proceeding.
SELECT count(*) AS column_exists
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'tenants'
  AND column_name  = 'suitefleet_region_id';


-- §3.PRE.3 — tenants row count sanity check.
-- Expected: 558 (per PR #288's Q11), possibly a few more if demo prep added
-- tenants between audit time and execution. Any value < 558 is unexpected
-- shrinkage; STOP and consult reviewer.
SELECT count(*) AS tenant_row_count FROM public.tenants;
```

If any pre-check is unexpected → STOP. Do not proceed to the execution block. Surface to reviewer.

### §3 Execution block (verbatim 0024 body, byte-identical to source on main)

```sql
-- =============================================================================
-- §3 EXECUTION — un-wrapped application of migration 0024
-- THIS BLOCK COMMITS. Production schema changes after a successful run.
-- =============================================================================

-- =============================================================================
-- 0024_suitefleet_regions_and_per_merchant_credentials.sql — Day 26 / T3
-- =============================================================================
--
-- Brief: PLANNER_PRODUCT_BRIEF.md §3.6 + §3.7 (v1.14 + v1.15 amendments)
-- Plans: memory/plans/day-25-per-merchant-sf-credentials.md (v1.14, in force)
--        memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md
--        (v1.15 overlay — read both together)
--
-- Sub-PR 1 of 3 (schema only). The service layer + resolver +
-- auth-client + admin UI + integration specs land in Sub-PRs 2 and 3.
--
-- Four-layer SF identifier model + region-level auth_method:
--   1. region.client_id     (DB, e.g. transcorpsb)
--   2. region.auth_method   (DB, 'oauth' | 'api_key' — IMMUTABLE post-create)
--   3. tenant.customer_code (DB, numeric merchant id; pre-existing column)
--   4. credential_1 / credential_2 (Supabase Vault — semantics by region.auth_method)
--
-- Vault columns hold:
--   region.auth_method='oauth'   → credential_1=username,   credential_2=password
--   region.auth_method='api_key' → credential_1=api_key,    credential_2=secret_key
--
-- Operators never see "credential_N" — Sub-PR 3's UI labels branch on
-- region.auth_method. The storage column names are intentionally
-- generic so the schema stays auth-method-agnostic. The Sub-PR 2
-- resolver returns a discriminated union typed by auth_method.
--
-- RLS posture for suitefleet_regions: Transcorp-global (no tenant_id).
-- The table enables RLS with NO policies so non-BYPASSRLS callers
-- (planner_app) are denied by default. All region reads/writes route
-- through withServiceRole (BYPASSRLS).
-- =============================================================================
-- Column definitions — suitefleet_regions
-- =============================================================================
--   id uuid:
--     Primary key. Referenced by tenants.suitefleet_region_id (FK).
--
--   client_id text:
--     The SuiteFleet region client identifier (`Clientid` header value
--     on outbound auth/push calls). UNIQUE — one client_id per region.
--     CHECK `^[a-z][a-z0-9]*$` enforces lowercase-alphanumeric starting
--     with a letter, matching SF's documented region naming.
--
--   display_name text:
--     Operator-facing label rendered in the regions list / picker
--     (Sub-PR 3 UI).
--
--   status text CHECK:
--     active | inactive. Deactivating a region makes the resolver
--     fail-closed for tenants still pointing at it — operational
--     kill-switch per brief §3.7.
--
--   auth_method text CHECK:
--     oauth | api_key. IMMUTABLE post-create — updateRegion (Sub-PR 2)
--     omits the field from its Zod schema and rejects mutation
--     attempts. No DEFAULT — every region creation must explicitly
--     select per v1.15 amendment §2.1 (defaulting would silently
--     classify and obscure the operator decision). Sandbox keeps OAuth
--     (preserves the working SF flow); production regions use API Key
--     + Secret Key per SF OpsPortal.
--
--   created_at / updated_at timestamptz:
--     Standard audit timestamps. updated_at maintained by the shared
--     set_updated_at() trigger function (installed in 0001).
-- =============================================================================
-- Column additions — tenants
-- =============================================================================
--   suitefleet_region_id uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT:
--     FK to the region this tenant authenticates through. NOT NULL
--     post-backfill (single-migration per ratified OQ-6). RESTRICT (not
--     SET NULL) because SET NULL would silently break the NOT NULL
--     invariant at runtime; RESTRICT forces an explicit decision before
--     a region can be removed.
--
--     DEFAULT literal binds new INSERTs to the sandbox region
--     ('transcorpsb'). Sandbox is the safe-default region — every new
--     tenant that does not explicitly choose a region is correctly
--     routed there. This is the same truth the backfill UPDATE
--     encodes, applied to INSERTs going forward. Once Sub-PR 2's
--     createMerchant service supplies a region explicitly the DEFAULT
--     goes dormant; it remains as a defense-in-depth backstop against
--     any tenant-row INSERT path that omits the FK (e.g. test fixtures
--     and seed scripts), and matches production reality.
--
--     CORRECTION TRAIL (Day-26 PR #284 round 2): an earlier draft of
--     this migration encoded the same default as a subquery DEFAULT —
--     DEFAULT (SELECT id FROM suitefleet_regions WHERE client_id =
--     'transcorpsb'). Postgres rejects that form structurally:
--     `cannot use subquery in DEFAULT expression` (DEFAULT expressions
--     must be non-volatile and cannot reference other tables). The
--     pinned-UUID literal below is the Postgres-valid form of the same
--     intent — the sandbox region row is seeded with the same
--     deliberately-shaped UUID literal at the suitefleet_regions seed
--     INSERT (see comment there), and this DEFAULT clause points at
--     that literal. Semantics + OQ-6 edge-case rationale are unchanged.
--
--     OQ-6 edge-case ruling (Day-26): the ratified OQ-6 covered the
--     production mental model (existing tenants get backfilled). It
--     did not address the CI-ephemeral-DB case where this migration
--     runs against zero tenants and downstream integration specs then
--     INSERT tenants that would violate NOT NULL. Adding the DEFAULT
--     preserves OQ-6's single-migration ADD → backfill → SET NOT NULL
--     shape and intent — this is an edge-case clarification, not an
--     OQ-6 override.
--
--   suitefleet_credential_1_vault_id uuid (nullable):
--   suitefleet_credential_2_vault_id uuid (nullable):
--     Supabase Vault UUIDs pointing at pgsodium-AEAD-encrypted plaintext.
--     Generic names per ratified OQ-amend-1 — the auth flavor (username/
--     password vs api_key/secret_key) is interpreted by the parent
--     region.auth_method, not encoded in the column name. Nullable
--     until provisioned via the Sub-PR 3 /admin/merchants/[id]/credentials
--     surface; Sub-PR 2's resolver fails closed when either is NULL.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- suitefleet_regions table
-- -----------------------------------------------------------------------------
CREATE TABLE suitefleet_regions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    text NOT NULL UNIQUE
                 CHECK (client_id ~ '^[a-z][a-z0-9]*$'),
  display_name text NOT NULL,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive')),
  auth_method  text NOT NULL
                 CHECK (auth_method IN ('oauth', 'api_key')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX suitefleet_regions_status_idx
  ON suitefleet_regions (status);


-- -----------------------------------------------------------------------------
-- Seed rows
-- -----------------------------------------------------------------------------
-- Sandbox keeps OAuth (preserves the working SF flow per v1.15).
-- The three production regions ship as api_key per SF OpsPortal.
-- Sub-PR 2's resolver returns a discriminated union typed by auth_method;
-- Sub-PR 2's auth-client login() branches: loginOAuth lives, loginApiKey
-- stubs ConfigurationError until Aqib's header reply lands.
--
-- Sandbox row uses a PINNED v4-shaped UUID literal — the same literal
-- is referenced as the DEFAULT on tenants.suitefleet_region_id below.
-- A subquery DEFAULT (the more natural form) is structurally invalid
-- in Postgres (`cannot use subquery in DEFAULT expression`), so the
-- two sites are bound by a shared literal instead. The other three
-- regions use gen_random_uuid() — only sandbox needs a pinned ID
-- because only sandbox is the DEFAULT target.
INSERT INTO suitefleet_regions (id, client_id, display_name, status, auth_method) VALUES
  ('11111111-1111-4111-a111-111111111111'::uuid, 'transcorpsb',    'Sandbox',          'active', 'oauth'),
  (gen_random_uuid(),                            'transcorp',      'Transcorp KSA',    'active', 'api_key'),
  (gen_random_uuid(),                            'transcorpuae',   'Transcorp UAE',    'active', 'api_key'),
  (gen_random_uuid(),                            'transcorpqatar', 'Transcorp Qatar',  'active', 'api_key');


-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
-- Match the per-table BEFORE-UPDATE trigger pattern used by tenants /
-- users / roles / role_assignments / api_keys in 0001. The shared
-- set_updated_at() function is installed there.
CREATE TRIGGER suitefleet_regions_set_updated_at
  BEFORE UPDATE ON suitefleet_regions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- RLS — Transcorp-global, deny-by-default
-- -----------------------------------------------------------------------------
-- suitefleet_regions has no tenant_id; it is Transcorp-cross-tenant
-- configuration (per v1.14 plan §2.1). Enable RLS with NO policies so
-- non-BYPASSRLS callers (planner_app) are denied by default. All region
-- reads/writes route through withServiceRole (BYPASSRLS) — the service
-- layer landing in Sub-PR 2 owns the access path.
ALTER TABLE suitefleet_regions ENABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- GRANT to the application role
-- -----------------------------------------------------------------------------
-- 0003_app_role.sql installs ALTER DEFAULT PRIVILEGES so future tables
-- automatically grant CRUD to planner_app. Belt-and-braces explicit
-- GRANT below; RLS (no policies above) still gates effective access for
-- non-BYPASSRLS callers.
GRANT SELECT, INSERT, UPDATE, DELETE ON suitefleet_regions TO planner_app;


-- -----------------------------------------------------------------------------
-- tenants column additions + backfill + NOT NULL
-- -----------------------------------------------------------------------------
-- Single-migration backfill per ratified OQ-6 (tenants is small in
-- production; backfill is microseconds). The UPDATE is idempotent
-- via the IS NULL guard — safe to re-run as a no-op once the column
-- is populated.
-- DEFAULT is a literal v4-shaped UUID matching the pinned sandbox row
-- seeded above. Bound by shared literal because Postgres rejects
-- subquery DEFAULTs (`cannot use subquery in DEFAULT expression`).
-- Both sites must move in lockstep if the sandbox UUID ever rotates;
-- in practice it does not — the seeded row stays put for the lifetime
-- of the column.
ALTER TABLE tenants
  ADD COLUMN suitefleet_region_id             uuid REFERENCES suitefleet_regions(id) ON DELETE RESTRICT
                                                DEFAULT '11111111-1111-4111-a111-111111111111'::uuid,
  ADD COLUMN suitefleet_credential_1_vault_id uuid,
  ADD COLUMN suitefleet_credential_2_vault_id uuid;

UPDATE tenants
SET    suitefleet_region_id = (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb')
WHERE  suitefleet_region_id IS NULL;

ALTER TABLE tenants
  ALTER COLUMN suitefleet_region_id SET NOT NULL;

-- =============================================================================
-- End of §3 execution block. Run §3 post-checks immediately after.
-- =============================================================================
```

### §3 Post-checks (run IMMEDIATELY after the execution block)

```sql
-- §3.POST.1 — suitefleet_regions has the 4 seed rows with the right shape.
-- Expected: 4 rows. transcorp/api_key/active, transcorpqatar/api_key/active,
-- transcorpsb/oauth/active, transcorpuae/api_key/active. Sandbox row's id
-- must be exactly the pinned UUID.
SELECT id, client_id, display_name, status, auth_method
FROM public.suitefleet_regions
ORDER BY client_id;


-- §3.POST.2 — tenants has the 3 new columns with the right nullability.
-- Expected: 3 rows. suitefleet_region_id is_nullable='NO'; the two vault
-- columns is_nullable='YES'.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'tenants'
  AND column_name IN ('suitefleet_region_id',
                      'suitefleet_credential_1_vault_id',
                      'suitefleet_credential_2_vault_id')
ORDER BY column_name;


-- §3.POST.3 — every tenant row has a non-NULL suitefleet_region_id.
-- Expected: 0. Non-zero = the SET NOT NULL step should have failed but
-- somehow didn't — corrupted state, STOP and consult reviewer.
SELECT count(*) AS null_count
FROM public.tenants
WHERE suitefleet_region_id IS NULL;


-- §3.POST.4 — every tenant points at a valid region (FK integrity sanity).
-- Expected: 0. Non-zero = FK violation; STOP.
SELECT count(*) AS orphan_count
FROM public.tenants t
LEFT JOIN public.suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.id IS NULL;
```

If any post-check is red → STOP. Execute §3 Rollback (below). Then surface to reviewer with the failing query + output.

### §3 Rollback path (execute ONLY if a post-check fails)

Postgres reverses 0024's effects via the inverse DDL sequence. Order matters: drop `tenants` columns first (which drops the FK to `suitefleet_regions`), then drop the table (which cascades the trigger, index, RLS, and grant).

```sql
-- =============================================================================
-- §3 ROLLBACK — execute ONLY if §3 post-checks fail.
-- Restores production to its pre-§3 state.
-- =============================================================================
BEGIN;

ALTER TABLE public.tenants DROP COLUMN suitefleet_credential_2_vault_id;
ALTER TABLE public.tenants DROP COLUMN suitefleet_credential_1_vault_id;
ALTER TABLE public.tenants DROP COLUMN suitefleet_region_id;
DROP TABLE public.suitefleet_regions;

COMMIT;
```

After rollback, re-run §3 pre-checks to confirm production is back to pre-0024 state.

---

## §4 — Divergence reconciliation

Three known divergences (audit findings PR #288), plus potentially more identified by §2's sweep. Each item has pre-check / statement / post-check / rollback.

### §4(a) — `users_set_updated_at` trigger missing

The trigger is supposed to attach to `public.users` via 0001 lines 122–125 but did not survive on production. Fix is one CREATE TRIGGER statement, identical to 0001's source.

#### Pre-check

```sql
SELECT count(*) AS trigger_exists
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'users'
  AND t.tgname  = 'users_set_updated_at'
  AND NOT t.tgisinternal;
-- Expected: 0 (trigger absent, matching today's finding).
```

#### Statement

```sql
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
```

#### Post-check

Same query as pre-check. **Expected: 1.**

#### Rollback

```sql
DROP TRIGGER users_set_updated_at ON public.users;
```

---

### §4(b) — GRANT REVOKEs for narrow-intent tables

**Scope is determined by §2's sweep output.** The known minimum scope is `webhook_events` (today's finding). The likely-additional scope is `audit_events` (predicted broad-actual / narrow-intent + RULE-protected). The reviewer rules on whether to REVOKE on `audit_events` too — it is operationally inert given the RULE, but architecturally cleaner if grants match intent.

#### §4(b) — `webhook_events` (always in scope)

##### Pre-check

```sql
SELECT table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee      = 'planner_app'
  AND table_name   = 'webhook_events'
GROUP BY table_name;
-- Expected: SELECT, INSERT, UPDATE, DELETE (per today's finding + §2 sweep).
```

##### Statement

```sql
REVOKE UPDATE, DELETE ON public.webhook_events FROM planner_app;
```

##### Post-check

Same query as pre-check. **Expected: `SELECT, INSERT` only.**

##### Rollback

```sql
GRANT UPDATE, DELETE ON public.webhook_events TO planner_app;
```

#### §4(b) — `audit_events` (in scope IF reviewer rules to include)

If §2's sweep confirms broad grants on `audit_events` (predicted), the reviewer rules on whether to include this REVOKE. Architecturally cleaner; operationally inert (the RULE from 0002 already blocks UPDATE/DELETE at DB layer).

##### Pre-check

```sql
SELECT table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS grants
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee      = 'planner_app'
  AND table_name   = 'audit_events'
GROUP BY table_name;
-- Expected: SELECT, INSERT, UPDATE, DELETE (predicted by §2 sweep).
```

##### Statement (IF reviewer rules to include)

```sql
REVOKE UPDATE, DELETE ON public.audit_events FROM planner_app;
```

##### Post-check / Rollback

Same shape as the `webhook_events` case above.

#### §4(b) — additional tables from §2 sweep (if any)

Per-table application of the same pre/exec/post/rollback shape. Scope determined by sweep output. The reviewer rules.

#### §4(b) — Defensive-depth option (CREATE RULE on webhook_events)

**§3.6 decision: surface, do not pre-decide.** Mirroring `audit_events`'s 0002 RULE pattern, defensive depth for `webhook_events` would add:

```sql
-- DEFENSIVE DEPTH (reviewer decides include vs defer):
CREATE RULE webhook_events_no_update AS ON UPDATE TO public.webhook_events DO INSTEAD NOTHING;
CREATE RULE webhook_events_no_delete AS ON DELETE TO public.webhook_events DO INSTEAD NOTHING;
```

Trade-offs:
- **Include now.** Belt-and-braces — grants + RULE both block. Matches 0002 pattern. Adds DB-layer enforcement against future GRANT regressions.
- **Defer.** Post-§4(b)(webhook_events), grants alone fully gate UPDATE/DELETE. Adding RULEs is purely defensive depth, not closing a real exposure. Adding RULEs also adds the same cascade-conflict footprint that `followup_audit_rule_cascade_conflict.md` documents (cascading deletes from parent `tenants` would need the canonical try/catch teardown — but `webhook_events.tenant_id` cascades from tenants, same as `audit_events`).

If included, the equivalent ROLLBACK is `DROP RULE webhook_events_no_update ON public.webhook_events; DROP RULE webhook_events_no_delete ON public.webhook_events;`.

---

### §4(c) — `webhook_events` policy narrowing

The policy `webhook_events_tenant_isolation` is `FOR ALL` on production; the migration intent (per 0018 line 101's narrow GRANT) is that only SELECT and INSERT need a policy. After §4(b) revokes UPDATE+DELETE grants, the policy breadth becomes operationally inert (grants gate before RLS in Postgres's permission model). But narrowing the policy to match intent is still architecturally cleaner.

**§3.6 decision: surface, do not pre-decide.** Trade-offs:

- **Include now.** Policy posture matches migration intent + RLS scope is precise. Cost: DROP+CREATE POLICY (Postgres has no `ALTER POLICY` for command-scope changes). Two policies replace one.
- **Defer.** After §4(b) revokes UPDATE/DELETE, the FOR ALL policy can never gate writes that grants don't already block. Divergence is functionally closed without policy work.

#### Pre-check

```sql
SELECT p.polname AS policy_name,
       p.polcmd  AS for_command  -- *=ALL, r=SELECT, a=INSERT, w=UPDATE, d=DELETE
FROM pg_policy p
JOIN pg_class  c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname  = 'public'
  AND c.relname  = 'webhook_events'
  AND p.polname  = 'webhook_events_tenant_isolation';
-- Expected: 1 row, polcmd = '*' (FOR ALL).
```

#### Statement (IF reviewer rules to include)

```sql
DROP POLICY webhook_events_tenant_isolation ON public.webhook_events;

CREATE POLICY webhook_events_tenant_select ON public.webhook_events
  FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY webhook_events_tenant_insert ON public.webhook_events
  FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

Note: the predicate uses the same defensive `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` form as `0001`'s tenant-isolation policies — fail-closed on unset session variable.

#### Post-check

```sql
SELECT p.polname AS policy_name,
       p.polcmd  AS for_command
FROM pg_policy p
JOIN pg_class  c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'webhook_events'
ORDER BY p.polname;
-- Expected: 2 rows: webhook_events_tenant_insert (polcmd='a'),
-- webhook_events_tenant_select (polcmd='r').
```

#### Rollback

```sql
DROP POLICY webhook_events_tenant_insert ON public.webhook_events;
DROP POLICY webhook_events_tenant_select ON public.webhook_events;

CREATE POLICY webhook_events_tenant_isolation ON public.webhook_events
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

---

## §5 — Sequencing (Session A endorsement of user-recommended sequence)

The user-proposed sequence is correct as-is. Verified: no step's pre-check depends on something that an earlier step inadvertently breaks.

| Step | Action | Why this position |
|---|---|---|
| 1 | Run §2 GRANT sweep (Q2.1, Q2.2, Q2.3). Surface output to reviewer. | Read-only; must precede §4(b) to scope its REVOKE list. |
| 2 | Run §3 pre-checks. Confirm all green. | Last sanity gate before mutating production. |
| 3 | Execute §3 (un-wrapped 0024). | Highest-risk operation; do first with rollback path ready so if it fails, mop-up has minimal complexity. |
| 4 | Run §3 post-checks. If red, execute §3 Rollback; STOP and surface to reviewer. If green, continue. | Pre-§4 sanity. §3 either fully applies (continue) or fully rolls back (re-run pre-checks, then STOP). |
| 5 | Run §4(a) trigger pre-check / CREATE TRIGGER / post-check. | Tiny, low-risk, no dependencies. |
| 6 | Run §4(b) REVOKE(s) per the §2 sweep output. Per-table pre/exec/post. | Sweep scoped before this; can't be moved earlier. |
| 7 | Run §4(c) policy narrowing pre-check / DROP+CREATE / post-check — IF reviewer ruled to include. | Last because it's the most cosmetic; deferring it is a clean fallback if anything went wrong upstream. |
| 8 | Surface "production schema reconciled" to reviewer with the full pre/exec/post output. | Reviewer is the next §3.6 gate. |
| 9 | Reviewer §3.6-clears the Vercel promote. | Independent decision — schema reconciled ≠ ready-to-promote. |
| 10 | Promote main HEAD to production via Vercel. | §6. |
| 11 | Smoke-test the credentials flow on a sandbox tenant. | §7. |

**No reorder warranted.** Cross-step dependency check: §3 doesn't touch `webhook_events`, `users`, or grants → §4 is unaffected by §3's outcome. §4(a) only adds a trigger → §4(b) and §4(c) unaffected. §4(b) REVOKEs grants → §4(c)'s policy narrowing operates on RLS, orthogonal to grants. §4(c) DROP+CREATE POLICY → no downstream step depends on the FOR ALL form being in place.

---

## §6 — Vercel promotion (step 4 of 4 of the reconciliation lane)

After §5 step 9's §3.6 clearance, promote `main` (will be `47780e1` or later by execution time) to production. The project's standing rule (per `followup_vercel_auto_promote_main_to_production.md`) is manual promotion via the inspect-then-promote pattern.

### Pre-promote inspection

```bash
# List the recent main-branch deployments for the project.
vercel ls --scope=lovemansgits-projects | head -20

# Identify the latest deployment built from main HEAD (47780e1 or later).
# The deployment URL will look like dpl_<id>-lovemansgits-projects or
# planner-<hash>-lovemansgits-projects.vercel.app — capture the canonical
# deployment URL (NOT the alias).

# Inspect the candidate deployment to verify it built from the right SHA
# and has GREEN status.
vercel inspect <deployment-url> --scope=lovemansgits-projects
```

**Reviewer §3.6 gate:** confirm the inspect output shows:
- `state: READY` (not BUILDING / ERROR / CANCELED).
- `target: production` is NOT yet set (this is a preview build awaiting promotion).
- The git SHA matches the intended `main` HEAD.
- Build logs are clean — no warnings about missing env vars, broken builds, etc.

### Promote

```bash
vercel promote <deployment-url> --scope=lovemansgits-projects
```

**Post-promote verification:**

```bash
# Confirm the alias planner-olive-sigma.vercel.app now points at the new deployment.
vercel ls --scope=lovemansgits-projects | head -5
```

The production alias should now resolve to the new deployment ID. Capture the new `dpl_*` ID for the audit record (Day-N EOD doc).

### Rollback path (promotion-only)

If the post-promote smoke (§7) reveals a regression, the rollback is to re-promote the previous deployment:

```bash
# Previous production deployment was dpl_29fxudjgb-lovemansgits-projects
# (built from main HEAD 6c637f4 — promoted Day-25 PM-late).
vercel promote dpl_29fxudjgb-lovemansgits-projects --scope=lovemansgits-projects
```

A promotion rollback does NOT undo schema changes from §3 / §4. Schema-side rollback would use the §3 Rollback block — but at that point, code on production no longer expects the post-§3 columns, so reverting BOTH schema and code is the safest path. Reviewer rules on whether to roll back schema alongside the deployment.

---

## §7 — Post-promotion smoke test scope

Not detailed SQL. The checklist of what Love verifies after promotion:

- [ ] **Application loads.** `https://planner-olive-sigma.vercel.app` returns 200 (or 307 to /login for unauthenticated user — that's expected).
- [ ] **Login works.** Auth flow completes successfully for at least one test user.
- [ ] **Admin surface — regions list.** `/admin/regions` renders the 4 seed regions: Sandbox (oauth), Transcorp KSA (api_key), Transcorp UAE (api_key), Transcorp Qatar (api_key). Auth Method badge column visible. DEACTIVATE row action gated on `status='active'`.
- [ ] **Admin surface — merchant edit.** `/admin/merchants/[id]/edit` for a sandbox-region tenant renders without 500. Region picker shows the 4 regions (filtered by `onlyActive=true`); default value reflects the tenant's `suitefleet_region_id`.
- [ ] **Credentials provisioning — sandbox tenant (OAuth path, live).** `/admin/merchants/[id]/credentials` for a sandbox-region tenant: submit Username/Password fields → SET button → success. Verify `tenants.suitefleet_credential_1_vault_id` and `_2_vault_id` are now non-NULL via a read-only SQL query. **This is the live integration test.**
- [ ] **Credentials provisioning — production-region tenant (API Key path, stub).** `/admin/merchants/[id]/credentials` for a transcorp/transcorpuae/transcorpqatar tenant: submit attempt → expect `ConfigurationError` (HTTP 503) per the Aqib-pending stub. **This failure is expected, not a regression** — the api_key path is blocked on Aqib's auth-header reply (`followup` per `MEMORY-followup-current.md`).
- [ ] **Live demo flow rehearsal — sandbox.** End-to-end: create a merchant on sandbox region → provision OAuth credentials → create a consignee → create a subscription → confirm task generation happens → push to SF sandbox returns 2xx.

**Reporting back:** Love reports green/red for each checklist item, plus the new production deployment ID (`dpl_*`), plus the post-§3 / post-§4 SQL outputs from §5 step 8.

---

## §8 — Hard constraints + discipline reminders

1. **No improvisation.** Every statement in §2/§3/§4/§6 is reviewed before execution. Nothing is invented at execution time. The standing constraint from the audit-input PR (#287) — "no reconciliation SQL improvised live in the SQL editor" — extends to this plan-PR: this plan IS the reconciliation SQL, reviewed in advance.
2. **§2 GRANT sweep output is surfaced to reviewer BEFORE §4(b) executes.** The sweep may expand §4(b)'s REVOKE scope beyond `webhook_events`. The reviewer rules on whether to include each additional table.
3. **Rollback paths are non-optional.** Every §3 / §4 statement has its rollback documented in this plan. If any post-check fails, STOP and execute that step's rollback. Surface to reviewer before proceeding. Do not invent a "creative recovery" at execution time.
4. **§3.6 decisions in this plan, surfaced not pre-decided:**
   - §4(b) `audit_events` REVOKE scope — include now or defer.
   - §4(b) defensive-depth RULEs on `webhook_events` — include now or defer.
   - §4(c) `webhook_events` policy narrowing — include now or defer.
   - §6 promotion-rollback schema-side scope — schema rollback alongside deployment rollback?
5. **Aqib API-key auth-header reply remains pending.** Production-region (`transcorp` / `transcorpuae` / `transcorpqatar`) api_key credentials cannot be provisioned today regardless of how the rest of this plan goes. Sandbox-region (`transcorpsb`) credentials work via OAuth and are the live integration path for tomorrow's demo. Live-added merchants in the demo go on sandbox; that's a demo-narrative decision, not a plan constraint.
6. **The credentials lane code on `main` at `47780e1` is correctly written.** Today's audit chain established the code is sound; this plan brings production into the state the code expects. The reverse posture (rewrite code to match a partially-applied schema) is explicitly NOT considered.
7. **Tomorrow's demo deadline is the forcing function.** This plan exists to bring production to the v1.15-intended state before tomorrow. Anything that could be deferred to post-demo (e.g., the 501-orphaned-tenants integration-test residue cleanup, the SQ §3.6-deferred items above) is left for a separate lane.

---

**End of Day-27 reconciliation execution plan (step 3 of 4).**
