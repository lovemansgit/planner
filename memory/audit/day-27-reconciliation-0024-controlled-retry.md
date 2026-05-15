# Day-27 reconciliation audit input — controlled 0024 retry

**Filed:** Day-27 (15 May 2026), AM.
**Tier:** T1 docs (the wrapper artifact); the underlying execution is a controlled re-run of an existing migration body, wrapped in `BEGIN` / `ROLLBACK` so production schema is unchanged regardless of outcome.
**Status:** Wrapper-only. This document does NOT modify migration 0024. It does NOT propose any fix. It exists solely to surface the actual error message (or absence thereof) that stopped 0024's Day-26 attempt.

## Context

Today's audit chain established the production foundation for migration 0024:

- [PR #287 / `fac8dd2`](https://github.com/lovemansgit/planner/pull/287) — audit input block.
- [PR #288 / `d00dc8a`](https://github.com/lovemansgit/planner/pull/288) — audit findings: production's identity schema is intact (21/21 tables, `set_updated_at()` present, `planner_app` role present with LOGIN, Vault `v0.3.1` available). Day-26's "absent identity schema" diagnostic was factually wrong.
- [PR #289 / `8bb63c0`](https://github.com/lovemansgit/planner/pull/289) — reconciliation audit input for 0017/0020/0021/0022/0023 schema deltas (step 1 of 4 of the reconciliation lane).

This document is **step 2 of 4 of the reconciliation lane** — surface the actual 0024 failure error.

**Hard constraint.** Wrapper produces a transaction-wrapped retry of the exact 0024 body verbatim. No fix SQL. No remediation drafted for any failure mode. The wrapper exists to produce a finding (error message + statement context, or absence thereof), nothing more.

---

## Part A — What the retry expects to find

Migration 0024 contains **nine effective statements** (the lane brief's "~12 effective statements" counts the four VALUES rows in the seed INSERT as separate statements; in Postgres they're a single multi-row INSERT). Each is enumerated below in execution order, with the expected outcome against the now-confirmed production state.

1. **`CREATE TABLE suitefleet_regions`** (lines 120–131). New table — six columns + PK + UNIQUE on `client_id` + CHECK on client_id regex (`^[a-z][a-z0-9]*$`) + CHECK on status domain + CHECK on auth_method domain. PR #287's Q2 listed the `public` schema and `suitefleet_regions` was NOT among the 21 existing tables, so first apply — no conflict possible. **Expected: succeeds.**

2. **`CREATE INDEX suitefleet_regions_status_idx`** (lines 133–134). Non-concurrent index on the just-created table. Empty table = no I/O. **Expected: succeeds.**

3. **`INSERT INTO suitefleet_regions ... VALUES (..., ..., ..., ...)`** (lines 153–157). One INSERT, four VALUES rows. Sandbox uses a pinned literal UUID (`11111111-1111-4111-a111-111111111111`); the three production regions use `gen_random_uuid()`. All `client_id` values match the regex; statuses are `'active'`; auth_methods are `'oauth'` (sandbox) and `'api_key'` (three production). No CHECK can fail; new table so no PK or UNIQUE conflict possible. **Expected: succeeds.**

4. **`CREATE TRIGGER suitefleet_regions_set_updated_at`** (lines 166–169). References `set_updated_at()` from 0001. PR #288's findings confirmed `set_updated_at()` exists in `public` (`LANGUAGE plpgsql`, returns trigger). **Expected: succeeds.**

5. **`ALTER TABLE suitefleet_regions ENABLE ROW LEVEL SECURITY`** (line 180). Idempotent DDL; first apply. **Expected: succeeds.**

6. **`GRANT SELECT, INSERT, UPDATE, DELETE ON suitefleet_regions TO planner_app`** (line 190). Requires `planner_app` to exist. PR #288's findings confirmed the role exists with LOGIN, no-bypass-RLS, INHERIT. Note: 0003's `ALTER DEFAULT PRIVILEGES` would have already auto-granted SELECT/INSERT/UPDATE/DELETE on this new table to `planner_app` at CREATE TABLE time; this explicit GRANT is belt-and-braces. The shape matches the inherited default-grant pattern noted on `webhook_events` in the findings memo — not new looseness, just the default that 0003 set up Day-1. **Expected: succeeds.**

7. **`ALTER TABLE tenants ADD COLUMN ...`** (lines 206–210). One ALTER TABLE statement with three ADD COLUMN clauses: `suitefleet_region_id` (FK to `suitefleet_regions(id)` ON DELETE RESTRICT, with literal-UUID DEFAULT), `suitefleet_credential_1_vault_id` (nullable), `suitefleet_credential_2_vault_id` (nullable). The DEFAULT is a UUID literal (not a subquery), so it is a valid Postgres DEFAULT expression — the Day-26 round-2 subquery-DEFAULT bug was caught and corrected at PR #284. Apply path: Postgres scans every existing `tenants` row (558 rows per PR #288's Q10/Q11), populates `suitefleet_region_id` with the DEFAULT UUID, validates the FK constraint per row. The FK target row was inserted by statement 3 (sandbox region with the pinned UUID), so every FK check resolves. **Expected: succeeds.**

8. **`UPDATE tenants SET suitefleet_region_id = (SELECT id FROM suitefleet_regions WHERE client_id = 'transcorpsb') WHERE suitefleet_region_id IS NULL`** (lines 212–214). After statement 7's DEFAULT applied, every `tenants` row has a non-NULL `suitefleet_region_id`. The `IS NULL` guard matches zero rows. **Expected: 0 rows updated; succeeds as semantic no-op.** Structurally a safety net for partial-apply scenarios, not the primary backfill mechanism.

9. **`ALTER TABLE tenants ALTER COLUMN suitefleet_region_id SET NOT NULL`** (lines 216–217). All 558 rows have non-NULL values (set by the DEFAULT in statement 7). The constraint addition will not violate. **Expected: succeeds.**

### Honest verdict on Part A

**All 9 statements look unproblematic given the now-confirmed production state.** No statement has a non-obvious failure mode that today's audit chain (PRs #287 / #288 / #289) did not already account for. If the wrapped retry still throws, the failure is almost certainly transient — lock contention at the time, Vault state, network/connection issue, momentary catalog inconsistency — rather than a structural issue with the migration SQL itself. The transient-failure hypothesis is itself a useful finding for the reconciliation plan-PR.

---

## Part B — Wrapper SQL block for Love to paste

```sql
-- =============================================================================
-- Day-27 controlled retry of migration 0024 — TRANSACTION-WRAPPED
-- READ-ONLY EFFECT: BEGIN...ROLLBACK ensures nothing commits.
-- Target: Supabase project qdotjmwqbyzldfuxphei
-- =============================================================================

BEGIN;

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

ROLLBACK;

-- =============================================================================
-- End of controlled retry block. ROLLBACK is unconditional — production
-- schema is unchanged regardless of whether 0024's statements succeed or fail.
-- =============================================================================
```

---

## Part C — Reading the output

Two possible outcomes when the wrapper block runs:

### Outcome 1 — block executes cleanly through ROLLBACK

Every statement returns success; the final `ROLLBACK;` unwinds the transaction. Production schema is unchanged.

**Finding to report:** *0024 succeeds under wrap.* Implication: Day-26's failure was transient (locks, Vault state, network hiccup, momentary catalog inconsistency). The reconciliation plan-PR can move to scheduling a clean re-apply without further diagnostic work on the migration body itself.

### Outcome 2 — a statement throws an error mid-block

Postgres aborts the transaction at the offending statement (and ROLLBACK becomes implicit from that point — the explicit ROLLBACK at the bottom is a no-op against an already-aborted transaction). The SQL editor surfaces the error message, the line context, and ideally the SQLSTATE code.

**Finding to report verbatim:**
- The full Postgres error message.
- The SQLSTATE / error code (if visible).
- The name of the failing statement (Love can map by message context against the 9 statements in Part A).
- Any HINT or DETAIL the editor shows alongside the error.

These together become the input to step 3 of the reconciliation lane.

### What the wrapper does NOT decide

The wrapper does not propose remediation. If the retry succeeds, the next step is scheduling a clean apply (without the wrapper) — that's a separate reconciliation-plan decision. If the retry fails, the next step is interpreting the error and scoping a fix — also a separate reconciliation-plan decision. The wrapper exists only to surface the actual error message (or its absence).

### Discipline reminder

`ROLLBACK` is unconditional. Production schema does not change either way. The wrapper is safe to run regardless of how the underlying 0024 SQL behaves. The discipline preserved here is *no improvising new SQL* — not *no execution against production*; a controlled retry of an existing migration body with explicit ROLLBACK is the canonical way to surface a previously-thrown error without introducing new schema state.

---

**End of Day-27 reconciliation audit input — controlled 0024 retry (step 2 of 4).**
