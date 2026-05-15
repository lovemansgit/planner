# Day-26 EOD

Filed: 2026-05-14 (PM-late). Full-day arc; consolidates Session A work
landed across the day. Inbound counterpart is the Day-26 AM bootstrap
brief + the Day-26 PM context-fade handoff; this is the outbound EOD
covering Day-26 from the Day-25 EOD handoff through to the end-of-day
production-cutover stop.

## §A — Final state at sign-off

- **Main HEAD**: `6392431` — `feat(d26): per-merchant SF credentials — admin UI (T3, Sub-PR 3 of 3) (#286)`
- **Production**: `https://planner-olive-sigma.vercel.app` served by
  `dpl_29fxudjgb-lovemansgits-projects` (built from main HEAD `6c637f4`,
  promoted Day-25 PM-late). **PRODUCTION UNCHANGED Day-26** — nothing
  promoted today. The Day-26 main movement (6 commits ahead) is held
  pending the load-bearing item below.
- **Brief on main**: **v1.15** (no amendment today; the Day-25 churn
  closed at v1.15 PM-late).
- **Demo blockers**: 0 (post-pilot foundation-building posture).
- **Demo distance**: post-demo (May 12 internal CAIO + May 18 external
  prospect both shipped earlier in the calendar). Day-26 work is
  foundation-building toward Phase 2 production cutover; the load-
  bearing item below is the gate to that cutover.

## §B — PRs landed Day-26

Six PRs across Session A's day-long lane. Day-26 was a single-session
day (Session B stood down post-Day-25 EOD; resumes Day-27+).

| PR | Slot | Tier | Title |
|---|---|---|---|
| [#282](https://github.com/lovemansgit/planner/pull/282) | AM | T2 | Edit Merchant UI — remove slug-edit capability (slug now set-at-creation only) |
| [#283](https://github.com/lovemansgit/planner/pull/283) | early-PM | T2 | `admin-consignees-count.spec.ts` fixture fix — pre-existing latent RUN_ID-collision flake |
| [#284](https://github.com/lovemansgit/planner/pull/284) | PM | T3 | Per-merchant SF credentials Sub-PR 1 of 3 — migration 0024 + schema |
| [#285](https://github.com/lovemansgit/planner/pull/285) | PM | T3 | Per-merchant SF credentials Sub-PR 2 of 3 — service + resolver + auth-client + 4 audit events + permission + 8 integration specs + vault-stub |
| [#286](https://github.com/lovemansgit/planner/pull/286) | PM-late | T3 | Per-merchant SF credentials Sub-PR 3 of 3 — admin UI (regions list/new/[id] + credentials surface + merchant-detail extensions + region picker on edit) |

The 6th merged change is the Day-25 EOD `MEMORY-followup-current.md`
filing (PR #278 — landed Day-26 morning per Day-25 EOD §F's "post-EOD
work" note; counted in Day-25 §B as ledger discipline, not re-counted
here).

## §C — Lane completed Day-26: per-merchant SF credentials + multi-region resolver + dual-path SF auth

**The substantive arc of Day-26.** Three sub-PRs, Option-A branch
posture (each forked off main + cherry-picked plan deltas; no plan-
branch base-ref chain per `memory/followup_t3_plan_code_branch_sequencing.md`).

### Sub-PR 1 of 3 (PR #284, merge `913361a`)
Migration 0024 — `suitefleet_regions` table + 4 seeded regions
(sandbox=oauth pinned to UUID `11111111-1111-4111-a111-111111111111` +
transcorp/transcorpuae/transcorpqatar=api_key) + 3 `tenants` columns
(`suitefleet_region_id` FK ON DELETE RESTRICT NOT NULL +
`suitefleet_credential_1_vault_id` + `suitefleet_credential_2_vault_id`)
+ DEFAULT literal binding + backfill + SET NOT NULL.

Two discipline events on the way to green:

- **OQ-6 edge-case ruling (Day-26 §3.6 round 1).** Ratified OQ-6 covered
  the production mental model (existing tenants get backfilled). It
  did not address the CI-ephemeral-DB case where the migration runs
  against zero tenants and downstream integration specs then INSERT
  tenants that would violate NOT NULL. Resolution: add a column DEFAULT
  on `tenants.suitefleet_region_id` pointing at the sandbox region row
  so CI / new fixtures land cleanly. Edge-case clarification, NOT an
  OQ-6 override.

- **Round-2 correction — subquery DEFAULT is invalid Postgres.** First
  draft encoded the DEFAULT as `DEFAULT (SELECT id FROM suitefleet_regions
  WHERE client_id = 'transcorpsb')`. Postgres rejects that form
  structurally: `cannot use subquery in DEFAULT expression`. Fix:
  pinned the sandbox region row to a deliberately-shaped UUID literal
  (`11111111-1111-4111-a111-111111111111`) at the seed INSERT and
  referenced the same literal as the column DEFAULT. Both sites move in
  lockstep (in practice, never — the seeded row stays put). Apply step
  is where the truth was — caught at CI apply time, not at plan-write
  time.

### Sub-PR 2 of 3 (PR #285, merge `5f59837`)
Service layer + resolver rewrite + auth-client dual-path + audit events
+ permission + 8 integration specs + test infrastructure.

- `src/modules/credentials/service.ts` — `createRegion` /
  `updateRegion` (Zod `.strict()` rejects `auth_method` mutation per
  IMMUTABLE) / `deactivateRegion` (PLAN-STRICT only active → inactive)
  / `storeSuitefleetCredentials(ctx, tenantId, input, invalidateSession)`
  — DI parameter for cache invalidation closed at the action layer in
  Sub-PR 3.
- `src/modules/credentials/suitefleet-resolver.ts` — rewritten. JOINs
  tenants + suitefleet_regions; fail-closed on NULL Vault UUIDs / region
  inactive / customer_code missing or non-positive-integer. Returns a
  **discriminated union** typed by `auth_method`. Signature kept as
  `(tenantId: Uuid)` not `(ctx, tenantId)` as v1.14 plan §4.1 sketched
  — plan deviation #1, consumed by Sub-PR 3.
- `src/modules/credentials/vault-store.ts` (NEW) — Supabase Vault
  wrapper. Service-role only (Vault decrypted_secrets view restricted).
- `src/modules/integration/last-mile-adapter.ts` — `LastMileAdapter`
  interface gains `invalidateSession(tenantId: Uuid): void`.
- `src/modules/integration/providers/suitefleet/auth-client.ts` —
  `login()` is now an exhaustive switch on `credentials.auth_method`:
  `oauth` → `loginOAuth` (live, sandbox preserved); `api_key` →
  `loginApiKey` (stubbed; throws `ConfigurationError` until Aqib's
  header reply lands); default branch ties to a `never`-typed
  `_exhaustive` so tsc enforces the discriminator coverage.
- `src/modules/identity/permissions.ts` — `region:manage` registered +
  added to `API_KEY_FORBIDDEN_PERMISSIONS`.
- `src/modules/audit/event-types.ts` — 4 new events: `region.created` /
  `region.updated` (FLAT diff per OQ-3) / `region.deactivated` /
  `credentials.set` (SHAPE DIVERGENCE: payload is `{ tenant_id,
  classifier }` only — NO plaintext, NO Vault UUIDs).
- `src/shared/errors.ts` — new `ConfigurationError` class (HTTP 503 at
  the API boundary).
- 8 integration specs in `tests/integration/` (admin-regions-create /
  -deactivate / -auth-method-immutable / admin-merchants-credentials-
  set / -rotate / suitefleet-resolve-credentials / -discriminated-union
  / suitefleet-push-fail-closed). All use the canonical try/catch
  teardown skeleton per `memory/followup_audit_rule_cascade_conflict.md`.
- `tests/integration/setup/vault-stub.sql` (NEW) — stub mirroring real
  Supabase Vault API interface (vault.secrets + vault.decrypted_secrets
  + create_secret / update_secret). Vanilla Postgres CI lacks the
  `supabase_vault` extension; the stub stores plaintext deliberately
  (real on-disk AEAD is a deployment-time property verified separately).
  `scripts/setup-test-db.sh` wires the vault-stub apply step between
  auth-stub and the migrations loop.
- Plan deviation #2: `storeSuitefleetCredentials` takes `invalidateSession`
  as DI parameter — closed at Sub-PR 3's action layer.

### Sub-PR 3 of 3 (PR #286, merge `6392431`)
Admin UI surfaces.

- `/admin/regions` list — alphabetical sort by `display_name` ASC (OQ-7)
  · Auth Method badge column (stone-neutral; neither flavor is "preferred")
  · DEACTIVATE row action gated on `status='active'` (no ACTIVATE
  affordance — reactivation out of v1 scope per Sub-PR 2's
  PLAN-STRICT deactivateRegion).
- `/admin/regions/new` — auth_method radio REQUIRED, NO default.
  Helper copy: "This selection is permanent for this region. Auth
  method cannot be changed after creation."
- `/admin/regions/[id]` — read-only detail. `auth_method` rendered as
  a labelled row with NO mutation affordance (IMMUTABLE per v1.15).
- `/admin/merchants/[id]/credentials` — write-only surface. Field
  labels branch on `region.auth_method` (Username/Password vs API
  Key/Secret Key) per v1.15 amendment §8.1. Submit button: SET vs
  ROTATE based on Vault UUID presence. Rotate gates submit on a
  hand-rolled confirmation modal (per the AdHocTaskDialog /
  MerchantStatusModal precedent — NO Radix Dialog import per v1.14
  plan §8.1); modal copy branches on auth_method per v1.15 amendment
  §8.2. Page MUST NOT fetch `decrypted_secret` — write-only by design
  per brief §3.7. `loadCredentialsPageState` return shape deliberately
  excludes Vault UUIDs (pinned by the spec's write-only-shape test).
- Merchant detail page Routing section — SF region link, auth method
  badge, credentials status badge (green "Configured" / amber
  "Missing") with MANAGE CREDENTIALS link.
- Region picker on `/admin/merchants/[id]/edit` — sourced from
  `listRegions({ onlyActive: true })`. Default value: tenant's current
  `suitefleet_region_id`. Inactive-region edge case handled (sticky
  disabled `<option>` if current is deactivated).
- 🔴 **invalidateSession DI wiring** — the load-bearing carry-forward
  from Sub-PR 2 is verified connected to the real adapter via
  `getSuiteFleetAdapter()`:
  ```typescript
  const adapter = getSuiteFleetAdapter();
  await storeSuitefleetCredentials(ctx, tenantId, input, (tid) => adapter.invalidateSession(tid));
  ```
  Pinned by `tests/integration/admin-merchants-credentials-action-di.spec.ts`
  — spies the real adapter; spec fails if the wiring regresses to a
  no-op.

## §D — Slug-lock ride-along (PR #282 + #283)

Tangential AM lane closing a Day-25 footgun.

- **PR #282 — slug-edit removal.** Edit Merchant UI no longer exposes
  the slug field; slug is now set-at-creation only. Driver: the
  "transcorp" string-literal coupling at `src/modules/identity/service.ts:428`
  + `src/app/(admin)/admin/users/new/page.tsx:40,71` classifies the
  internal-Transcorp tenant vs merchants. A UI-driven slug rename of
  the internal tenant would silently break sysadmin role assignment +
  the user-creation UI's classification. Typo recovery is direct-DB by
  Transcorp staff, deliberately not a UI affordance. Ride-along:
  `memory/followup_internal_tenant_identity_string_literal.md` — T3
  correctness debt (move identity off the string literal to a
  `tenants.is_internal_tenant` flag). Not urgent post-#282; the
  footgun is closed.

- **PR #283 — admin-consignees-count fixture fix.** Pre-existing
  latent fixture-isolation flake: `RUN_ID`-derived phone digits could
  collide with the searchable-name field's `[a-f]` filter under certain
  draws (13.65% failure rate empirically demonstrated via 100K Node
  simulation). Surfaced (not caused) by PR #282's vitest-ordering
  perturbation. Fix: separated `RUN_ID` (hex for slugs/UUIDs) from
  `RUN_TAG` (alphabetic-only `[a-f]`); fixed distinct digit patterns
  on phone. Post-fix failure rate: 0%.

## §E — Database state changes (production)

**Zero data-side changes Day-26.** Migration 0024 was ATTEMPTED via
the Supabase SQL editor at the EOD cutover slot and rolled back
cleanly when it hit the absent identity-schema foundation (see §F).
Production schema is currently UNTOUCHED by the 0024 attempt — every
query after the failed attempt was read-only.

## §F — 🔴 LOAD-BEARING blocker — production identity schema is absent

**The Day-26 production cutover for migration 0024 was attempted and
STOPPED.** Diagnostic queries against production (project
`qdotjmwqbyzldfuxphei`) surfaced that four of five core identity tables
that `supabase/migrations/0001_identity.sql` is supposed to create are
absent on production:

- `set_updated_at()` function: **ABSENT** (0 rows in `pg_proc`)
- Only `updated_at` trigger on the DB: `update_objects_updated_at` on
  the `objects` table — that is Supabase Storage's internal table, not
  ours
- `public.tenants`: **ABSENT** (does not exist in any form — confirmed
  via `pg_class` with no relkind filter)
- `public.roles`: **ABSENT**
- `public.role_assignments`: **ABSENT**
- `public.api_keys`: **ABSENT**
- `public.users`: **EXISTS** as an ordinary table, BUT missing its
  `updated_at` column (repo `0001` line 110 says it should have one)
- `auth.users`: exists — that is Supabase's own auth table, expected,
  irrelevant to this

The 0024 attempt itself rolled back cleanly (Supabase SQL editor wraps
multi-statement pastes in a transaction; it failed on the `CREATE
TRIGGER ... EXECUTE FUNCTION set_updated_at()` line referencing the
absent function and undid everything). Production schema is currently
**UNTOUCHED** by the 0024 attempt — every query after the failed
attempt was read-only.

**Connection to Aqib's Day-26 dry-run findings.** Aqib's dry runs on
Day-26 surfaced: no way to select a tenant (e.g. `transcorpsb` vs
`transcorpuae`) when creating users; a merchant mapped on SuiteFleet by
`customerId` but with no authentication wired (neither OAuth nor Secret
Key); no tasks generating because no authentication was in place. The
credentials lane (Sub-PRs 1–3, merged Day-26) is the CODE fix for that
gap — region selector, per-merchant credentials surface, resolver,
dual-path auth. But the lane's UI and resolver assume the identity
schema exists. If `public.tenants` does not exist on production, there
are no tenant rows to select because there is no tenant table. **The
absent-identity-schema problem and the dry-run failures are the same
problem viewed from two angles.**

Full detail + diagnostic results + proposed audit→plan→execute
sequencing in [memory/followup_production_identity_schema_absent.md](../followup_production_identity_schema_absent.md)
(🔴 LOAD-BEARING — the new load-bearing followup of the lane).

**The Vercel promote of the Day-26 bundle is BLOCKED** until a T3
audit → reconciliation plan-PR → execution sequence completes. NOT to
be improvised live in the SQL editor.

## §G — Discipline learnings logged Day-26

Two institutional artifacts filed today; one load-bearing.

- **🔴 LOAD-BEARING — production identity schema absent** (filed at
  EOD per §F). New load-bearing followup. The Day-25 §D 🔴 LOAD-BEARING
  audit-rule cascade canonical teardown pattern stays in force; this
  one joins it as the second active 🔴 marker. Trigger: cutover
  attempt against production surfaced the schema gap; lane code on
  main is correct but the production substrate is not yet ready to
  receive it.

- **Apply-step is where the truth is** (Day-26 PR #284 round 2,
  re-affirmation). The migration 0024 subquery-DEFAULT bug was caught
  at CI apply time, not at plan-write time. Mandate carried into the
  cutover slot: run the migration locally on both fresh + populated DB
  paths before pushing the fix; treat the SQL editor apply as
  empirical-truth surface, not a courtesy. This was the discipline
  that surfaced §F tonight — running the apply revealed the schema
  gap that no static-analysis pass would have caught.

## §H — Open carry-forwards to Day-27

### 🔴 LOAD-BEARING — production schema reconciliation lane

The Day-26 production cutover hit the absent identity-schema gate (§F).
The Day-27+ Session A first lane is a T3 audit → plan → execute
sequence:

1. **Audit (understand before write).** Establish production's actual
   state and WHY: full `information_schema` dump for the `public`
   schema vs the repo migration ledger (`0001-0023`). Confirm whether
   the queried DB is the pilot DB. Determine why the identity schema
   is absent. Possible explanations — none confirmed: pilot may have
   been running against a different database than the one queried
   tonight; `0001` may never have been applied to this database, or
   applied then partially wiped; environment/configuration issue not
   visible from schema queries.
2. **Reconciliation plan-PR (T3).** How to bring production's schema
   to match the repo migration history — in correct dependency order,
   accounting for `public.users` already existing WITH DATA (cannot
   naively re-run `0001`; it would collide). Reviewed as a plan
   before any SQL runs.
3. **Execution.** A reviewed reconciliation SQL block, run by Love in
   the Supabase SQL editor, verified.
4. **THEN** migration 0024 applies onto a confirmed foundation, and
   the credentials lane promote completes.

**Hard constraint:** No reconciliation SQL is to be pasted into
production live or improvised. This is T3 plan-reviewed work.

### Vercel promote of the Day-26 bundle — BLOCKED

Five Day-26 commits accumulated on main past the current production
HEAD (`6c637f4` → `6392431`):

- `913361a` — Sub-PR 1 migration 0024
- `5f59837` — Sub-PR 2 service layer
- `6392431` — Sub-PR 3 admin UI
- plus the two ride-along T2s (`#282` slug-lock + `#283` fixture fix)
  + the `#278` post-EOD `MEMORY-followup-current.md` filing landed
  Day-26 AM

Production stays on its current deploy (`6c637f4`) until the §F
reconciliation completes. Sub-PR 2/3 runtime code reads identity-schema
columns/tables that are absent on production; promoting before
reconciliation would 500 the operator surface.

### Aqib SF API-key auth-header reply (still pending)

Non-blocking for the lane code (api_key path stubbed with
`ConfigurationError`). Downstream of the schema reconciliation — no
point promoting credentials code until production can receive it.
When the reply lands, a small T2 follow-on PR wires the `loginApiKey`
body + one integration spec; expected ~1 hour of work.

### followup_internal_tenant_identity_string_literal.md (T3, not urgent)

Ride-along memo from PR #282. Correctness debt: move internal-Transcorp-
tenant identity off the "transcorp" string-literal compare at
`src/modules/identity/service.ts:428` to a `tenants.is_internal_tenant`
flag. Post-#282 the slug-edit footgun is closed, so this is not a
live hazard — just architectural cleanup. Sequencing TBD; not urgent.

### Operational

- **`MEMORY.md` index** is current through Day 25; Day-26 entries to be
  added in the bundle this EOD ships in. Carry-over watch-item from
  Day-23 §G / Day-24 §F / Day-25 §F retires with this update.
- **Vercel auto-promote OFF** (`memory/followup_vercel_auto_promote_main_to_production.md`).
  Standing rule: every merge to main requires manual `vercel promote`.
  Followed today (zero promotes — held at the §F gate).

## §I — Brief state

Brief at **v1.15** on main. No amendment Day-26. Day-25's v1.14 + v1.15
amendments were the active brief deltas underlying the Day-26
credentials lane work; both are codified on main and consumed
unchanged by Sub-PRs 1/2/3.

## §J — Memory delta filed Day-26

Three repo memo files + one EOD doc (this file):

- `memory/followup_internal_tenant_identity_string_literal.md` (PR #282
  ride-along) — T3 correctness-debt followup for the "transcorp"
  string-literal internal-tenant identity coupling.
- `memory/handoffs/bootstrap-session-a-day-26-pm.md` (Day-26 PM
  context-fade handoff, filed mid-day before resuming Sub-PR 3).
- 🔴 `memory/followup_production_identity_schema_absent.md` (filed at
  EOD per §F) — the new load-bearing followup.
- `memory/handoffs/day-26-eod.md` (this file).

---

End of Day-26 EOD. Session A standing down. Lane code is COMPLETE +
correct; lane PROMOTE is blocked at the production-schema gate. Day-27
opens with the audit → plan → execute reconciliation lane.
