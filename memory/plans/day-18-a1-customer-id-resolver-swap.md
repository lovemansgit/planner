# Day-18 A1 — SuiteFleet customer_id per-tenant resolver swap (PLAN)

**Tier:** T3 (auth/credential surface; integration-critical adapter path)
**Filed:** Day 18, 8 May 2026
**Brief reference:** §3.6 (SuiteFleet credential decision; needs amendment per this PR)
**Cross-references:**
- `memory/followup_per_tenant_merchant_id_routing.md` (root-cause memo; supersedes this PR's framing where conflicting)
- `memory/followup_migration_0013_customer_code_comment_amendment.md` (bundled into this PR)
- `memory/decision_mvp_shared_suitefleet_credentials.md` (amended by this PR)
- `memory/followup_secrets_manager_swap_critical_path.md` (amended by this PR)

---

## §0 Scope-correction header (read first)

Reviewer A's Day-18 handoff §6.1 framed A1 as "customer.code wire-body
threading." Architectural ground-truth correction from Love (Day 18 morning):

- `customerId` (numeric: 588/586/578) is the primary unique merchant
  identifier on the SuiteFleet send side. This is what routes tasks to
  the correct merchant.
- `customer.code` (alphanumeric: MPL/FBU/DNR) is purely an AWB prefix.
  No functional role beyond that.

A1 is therefore NOT "thread customer.code into wire body." A1 is "make
`customerId` per-tenant by reading from DB instead of env." Wire body
shape is unchanged. No `customer` object added.

This scope correction also corrects two Day-10 memos which framed
shared-customer-588 as Path-B sandbox-share (it's neither — it's a
genuine bug where the resolver ignores tenantId). Memo amendments
bundled into this PR.

## §1 The bug

`tenants.suitefleet_customer_code` column stores the numeric merchant ID
per tenant: 588 (MPL), 586 (DNR), 578 (FBU). Verified Day 18 morning
against SF admin panel; data correction landed via SQL editor.

`src/modules/credentials/suitefleet-resolver.ts:35-88` accepts
`tenantId: Uuid` but ignores it. Reads `SUITEFLEET_SANDBOX_CUSTOMER_ID`
from env (single value: 588) for every tenant. Result: every Planner
tenant's tasks invoice as merchant 588 in SF regardless of which tenant
pushed them. DNR (586) and FBU (578) show zero activity in SF console.

**Demo-blocking:** panel asking for SF console proof of multi-tenancy
sees one merchant with all activity, not three.

## §2 The fix

Single-file runtime change: `src/modules/credentials/suitefleet-resolver.ts`.

### §2.1 Resolver swap

Replace env read of `SUITEFLEET_SANDBOX_CUSTOMER_ID` with a DB read of
`tenants.suitefleet_customer_code` keyed by `tenantId`. Use the existing
house-style pattern: `withServiceRole` + `sqlTag` parameterized SELECT.
Mirror `suitefleet-webhook-resolver.ts` structure (same module,
established pattern).

Parse the result column (text type in DB) to integer matching today's
return shape `customerId: number`. Reject non-positive-integer values
with `CredentialError` (matching existing env-resolver shape).

### §2.2 Behavior on missing customer_code — THROW (locked)

If the tenant row exists but `suitefleet_customer_code` is NULL or
empty: throw `CredentialError` with reason `missing_customer_code`.

If the tenant row doesn't exist at all: throw `CredentialError` with
reason `tenant_not_found`.

This is Option A from reviewer's Day-18 design call: missing
customer_code is a misconfiguration, not a normal lifecycle state.
Loud-fail on every cron pass surfaces provisioning gaps quickly.

### §2.3 Region credentials stay env-backed

`username` / `password` / `clientId` continue to read from env
(`SUITEFLEET_SANDBOX_USERNAME`, `_PASSWORD`, `_CLIENT_ID`). These are
region-scoped credentials per `followup_per_tenant_merchant_id_routing.md`
§1 — sandbox region uses `transcorpsb`, future UAE region will use
`transcorpuae`, etc. All merchants within a region share these.

This PR does NOT touch region credentials. Phase 2 work for regional
expansion stays in `followup_secrets_manager_swap_critical_path.md`.

### §2.4 Type stays `number`

`SuiteFleetCredentials.customerId: number` is unchanged. Today's
column data (588/586/578) parses cleanly to integer. If a future
region introduces alphanumeric merchant IDs, that's a Phase 2 type
widening with its own migration. Out of A1 scope.

### §2.5 Task-push guard removed

`src/modules/task-push/service.ts:364-394` currently does a "skip
quietly" guard: SELECT customer_code, return `tenant_skipped` if NULL.

With Option A locked, this guard can never reach its skip branch —
the resolver throws upstream. Remove the guard entirely. Dead code is
worse than no code; the resolver-throws contract is the single source
of truth for "this tenant isn't push-ready."

The push-failures audit row written by the surrounding push handler
already captures `CredentialError` thrown from resolver calls. No new
audit-event vocabulary needed.

Verify before removing: trace the call stack from cron entry to
resolver, confirm the resolver IS called upstream of every site that
uses customer_code. Document the call-stack trace in code comments at
the removal site. If the trace surfaces a path where customer_code is
read WITHOUT going through the resolver, surface back to reviewer
before removing — that's a planning gap.

### §2.6 Cron error budget

With loud-fail enabled, a misconfigured tenant produces one
`CredentialError` per cron pass (every 4h, current cron cadence). The
error MUST land at tenant-walk level, NOT per-task — catching at
per-task level would produce N errors for N tasks for a single
misconfigured tenant. The cron's tenant loop catches the resolver
exception, writes ONE `task_push_failures` row with
reason='missing_customer_code', moves to next tenant.

Verify the cron's tenant-walk error handler shape. If the existing
shape catches per-task instead of per-tenant, the plan needs to
address that boundary. If verified clean, document the path in the
implementation PR's description.

## §3 Test plan

### §3.1 Unit tests — `suitefleet-resolver.spec.ts` rewrite

Existing 16 cases need partial rewrite. Surveyed structure:

| Existing describe block | Existing cases | Action |
|---|---|---|
| happy path | 5 | Rewrite — env-injection seam → DB tx mock |
| missing env vars | 6 | Reduce to 3 — only username/password/clientId stay env-backed; customerId env-missing case removed (column-missing replaces it) |
| customerId parsing | 4 | Rewrite — column-value parsing instead of env-string parsing |
| async signature contract | 1 | Keep |

Net delta: 16 cases → ~16-18 cases after rewrite.

Critical case flips:
- "returns identical credentials for different tenant ids" — INVERT to
  "returns DIFFERENT credentials for different tenant ids." This pin is
  the load-bearing diagnostic for the swap landing correctly.
- "returns the four-field SuiteFleet credential shape" — keep, but
  drop the env-injection seam in favor of DB tx mock.

New cases to add:
- "throws CredentialError when tenant row not found"
- "throws CredentialError when suitefleet_customer_code is NULL"
- "throws CredentialError when suitefleet_customer_code is empty string"
- "throws CredentialError when suitefleet_customer_code is whitespace-only"
- "throws CredentialError when suitefleet_customer_code is non-numeric"
- "throws CredentialError when suitefleet_customer_code is zero"
- "throws CredentialError when suitefleet_customer_code is negative"

Test infrastructure: mock `withServiceRole` + drizzle tx pattern. If
existing tests in this module don't already mock `withServiceRole`,
adopt the mock pattern from `suitefleet-webhook-resolver.spec.ts` (or
equivalent existing webhook-resolver tests).

### §3.2 Integration tests — new spec file

New file: `tests/integration/suitefleet-resolver-per-tenant.spec.ts`.

Real-Postgres test (Drizzle test infra, RLS bypassed via `planner_app`
service role per existing pattern). Cases:

1. Three seeded tenants with distinct customer_codes (588/586/578) —
   resolver returns three distinct `customerId` values.
2. Tenant with NULL customer_code — resolver throws CredentialError.
3. Tenant with empty-string customer_code — resolver throws.
4. Tenant that doesn't exist — resolver throws with `tenant_not_found`.
5. Tenant in `provisioning` status with valid customer_code — resolver
   returns it (status doesn't gate the resolver).

This is the load-bearing per-tenant-distinct integration pin.

### §3.3 Sandbox roundtrip test — verify or skip

`tests/sandbox/suitefleet-roundtrip.spec.ts` and
`tests/sandbox/last-mile-adapter-roundtrip.spec.ts` exist (per survey).
These hit live SF sandbox.

Verify whether either test exercises the resolver path with multiple
tenants. If yes, ensure they continue to pass post-swap (they should —
sandbox-588 still resolves to 588 if the sandbox tenant's
customer_code is 588 in the test DB).

If the existing sandbox tests exercise only single-tenant flows,
DON'T add a new sandbox roundtrip case in this PR. Sandbox tests are
costly to run; per-tenant verification belongs in the integration test
above. Sandbox case stays single-tenant.

### §3.4 Token-cache test — no change expected

Token cache keyed by tenantId already (per survey). Cache continues to
work correctly: each tenantId gets its own cache slot, each slot now
holds a session JWT minted from per-tenant credentials.

No new token-cache test required. Existing tests should pass unchanged.
Verify: run the existing token-cache test suite post-swap; report if
anything turns red.

### §3.5 Test-tenant fixtures

Three demo tenants must exist in test DB with correct customer_codes
for the integration tests in §3.2. Existing fixture infrastructure
will need verification — do today's test fixtures populate
suitefleet_customer_code at all, or is the column unset in test data?

If unset: bootstrap fixture seeds with 588/586/578 for the three demo
tenants. If already set with placeholder values: update to canonical
588/586/578.

This is a fixture hygiene step bundled into the test PR.

## §4 Out of scope (explicit)

- **createBulk / updateTask / reschedule adapter functions** — survey
  confirmed these don't exist in `task-client.ts` or `LastMileAdapter`.
  Building them is net-new adapter surface, not customer_id threading.
  Separate plan-PR if/when needed for MVP.
- **Webhook receiver per-tenant routing** — `followup_per_tenant_merchant_id_routing.md`
  §5.2 lists this as Day-18 work. Stays in A2 scope (or a separate
  follow-up after A2). NOT in this PR.
- **Secrets Manager swap (regional credentials)** — stays in
  `followup_secrets_manager_swap_critical_path.md`. NOT in this PR.
- **`SUITEFLEET_SANDBOX_CUSTOMER_ID` env-var Vercel cleanup** —
  resolver no longer reads it post-merge, but env stays in Vercel until
  soaked. Cleanup PR in Day 19+ once swap proven in production. Tracked
  as a follow-up memo in the implementation PR.
- **Probe scripts (`scripts/sandbox-smoke-*.mjs`)** — out-of-band tools,
  not in cron path. Continue to read env directly. Optional Phase 2
  cleanup, not in this PR.
- **`tenants.suitefleet_customer_code` column rename** — column name
  is misleading (stores numeric customerId, name says "code") but
  forward-only migrations rule + churn cost = no rename. Migration
  0013 comment amendment in §5.1 calls this out for future readers.

## §5 Bundled scope

This is a T3 PR with bundled documentation/memo work because all four
documents are wrong about the same thing (customer_code's role). Fix
them all in one PR for closure rather than leaving stale framings on
disk.

### §5.1 Migration 0013 comment amendment

`supabase/migrations/0013_sf_integration_required_fields.sql` Section 2
comment (lines 46-72) is misleading per
`followup_migration_0013_customer_code_comment_amendment.md`. Rewrite
to reflect actual role: "stores numeric merchant identifier; threaded
into the resolver as customerId; column name 'code' is historical and
does NOT refer to SF's customer.code AWB prefix."

Comment-only edit; no schema change. Forward-only rule guards SQL
statement edits, not header text.

Use the §5 "Amendment shape" template from
`followup_migration_0013_customer_code_comment_amendment.md` as a
starting point, but update it to reflect Option A (resolver throws)
instead of the original "cron-gate" framing — the resolver-throws
contract supersedes the cron-gate framing.

### §5.2 Brief §3.6 amendment

Current §3.6 says: "Single shared SF sandbox credential across all
tenants. Hardcoded customer.code = 588."

Replace with: "SF credentials are region-scoped (`transcorpsb` for
sandbox; `transcorpuae` and `transcorpqatar` for future regional
deployments). All merchants within a region share that region's
`username` / `password` / `clientId` env-backed credentials. Each
tenant's `customerId` (numeric merchant identifier: 588/586/578 in
sandbox) is read from `tenants.suitefleet_customer_code` via the
per-tenant resolver. Wire body carries `customerId` (numeric) only;
`customer.code` (alphanumeric: MPL/FBU/DNR) is an AWB prefix and
plays no role in routing."

Update Phase 2 list (§4): drop "per-tenant SF credential isolation"
(was incorrectly framed); replace with "regional credential expansion
(UAE/Qatar onboarding)."

Demo Q&A rehearsal block updated to match
`followup_per_tenant_merchant_id_routing.md` §3 framing:

> "SF `client_id` is region-scoped — sandbox, UAE, Qatar each have
> their own. All merchants within a region share that credential and
> route tasks via `customerId` in the wire body. Three demo merchants
> share `transcorpsb` because they're all sandbox-region. The resolver
> threads each tenant's `customerId` (588/586/578) into every
> `createTask` call so SF invoices each merchant correctly."

Brief version bumps v1.6 → v1.7. New row in §9 amendment log:

| v1.7 | 8 May 2026 (Day 18) | §3.6 rewritten to reflect actual SF identifier model: region-scoped client_id (env), per-merchant customerId (DB), customer.code is AWB prefix only. Filed at `memory/decision_brief_v1_7_amendment_sf_identifier_model.md` (this plan-PR creates that decision file as part of bundled scope). |

### §5.3 Day-10 memo amendments

**`memory/decision_mvp_shared_suitefleet_credentials.md`:** Add
prominent header at top of file noting the decision was based on
incorrect architectural framing. Original decision text preserved as
historical context. Amendment header references this PR.

Specifically: §3 ("Static-code finding that unblocked Path B") is
preserved as accurate-at-the-time observation but flagged: the wire
body genuinely doesn't carry `customer.code`, but the conclusion
"sandbox-share is acceptable for demo" was based on the wrong reason.
Real reason it's been working: `customerId=588` was the routing key
all along, not `customer.code`.

**`memory/followup_secrets_manager_swap_critical_path.md`:** Reframe
swap scope. The swap is no longer "per-tenant credential isolation."
It's "regional credential expansion" — adding `transcorpuae` and
`transcorpqatar` env-or-secrets-manager entries when those regions
onboard, and continuing to use the per-tenant resolver from this PR
to read each tenant's customerId from DB.

The "every tenant authenticates as merchant 588" line in §1 is
misleading — accurate read post-A1 is "every tenant within sandbox
region authenticates with shared `transcorpsb` region credentials AND
threads its own customerId from DB." Rewrite §1 + §5.

### §5.4 New decision file

Create `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`
capturing the architectural correction:

- Three identifier layers (region client_id / merchant customerId /
  AWB prefix customer.code) — table from
  `followup_per_tenant_merchant_id_routing.md` §1
- Original Day-10 framing was wrong (per-tenant credentials post-pilot
  hardening was a misread of SF data model)
- Correct architecture: per-region credentials + per-merchant
  customerId routing
- Day-18 fix landed via this PR

### §5.5 Index update

Add a Day-18 entry to `memory/MEMORY-index.md` under the existing Day-18 section. The bullet text below uses a path-relative link because `MEMORY-index.md` lives at `memory/MEMORY-index.md` — `plans/day-18-...` resolves correctly from that file.

Bullet to add:

Day-18 A1 — customer_id resolver swap — committed via this plan-PR alongside §5.1-§5.4 bundled amendments


NOTE: this bullet text goes into `memory/MEMORY-index.md` only. Do NOT use this exact relative path in any PR description or other location — it only resolves when sibling to `plans/`.

## §6 Pre-merge verification gates (T3 hard-stop checklist)

This plan-PR opens. Reviewer counter-reviews plan-PR. After plan-PR
merges, code-PR opens. Reviewer counter-reviews code-PR. Code-PR merges
only after every gate below clears.

| # | Gate | Verifier | Notes |
|---|---|---|---|
| 1 | Resolver throws on tenant-not-found | unit test | §3.1 |
| 2 | Resolver throws on customer_code NULL/empty/non-numeric/non-positive | unit tests | §3.1 |
| 3 | Resolver returns distinct customerId per tenant — load-bearing pin | unit + integration | §3.1, §3.2 |
| 4 | Existing identical-creds-per-tenant test INVERTED | unit test | §3.1 |
| 5 | Token cache continues to work post-swap | existing test pass | §3.4 |
| 6 | Sandbox roundtrip continues to pass | existing sandbox test pass | §3.3 |
| 7 | Task-push guard removed; call-stack trace documented at removal site | code review | §2.5 |
| 8 | Cron tenant-walk error handler catches resolver exceptions per-tenant, NOT per-task | code review | §2.6 |
| 9 | Migration 0013 comment amended | docs review | §5.1 |
| 10 | Brief §3.6 amended; v1.7 bumped; amendment log updated | docs review | §5.2 |
| 11 | Two Day-10 memos amended with correction headers | docs review | §5.3 |
| 12 | New decision file filed | docs review | §5.4 |
| 13 | Index updated | docs review | §5.5 |
| 14 | Test fixtures populate customer_code for three demo tenants | code review | §3.5 |
| 15 | `SUITEFLEET_SANDBOX_CUSTOMER_ID` env var still present in Vercel (deprecation deferred) | manual verify | §4 |
| 16 | typecheck + lint clean | CI | standard |
| 17 | `vercel promote` to Production executed; production HEAD updated to A1 code-PR merge SHA | manual deploy | post-merge |
| 18 | Production smoke post-Production-promote: trigger createTask on each of three demo tenants; verify each lands in correct SF merchant per SF console | manual smoke | post-deploy |

## §7 Risks + rollback

**Single-file runtime change.** Risk surface: contained to
`suitefleet-resolver.ts` swap + `task-push/service.ts` guard removal.

**Test pins both directions.** The "distinct credentials per tenant"
integration pin (§3.2 case 1) catches a regression where the resolver
silently re-reads env. The "throws on missing" cases catch a
regression where the resolver returns stale env values for missing
column data.

**Rollback path:** `git revert` of the code commit. Resolver returns
to env-backed shape; all three tenants resume sharing customerId=588
in SF (the original bug). No data loss; no schema change to undo.

**Rollback verification:** revert in a Preview deployment first;
confirm resolver returns to env-backed shape; confirm cron continues
to push (against single SF merchant 588). Production rollback only
after Preview verifies.

**Brittleness flag:** the `tenants.suitefleet_customer_code` column
name remains misleading (stores numeric customerId, name says "code").
Future engineer reading the column without context will assume it
holds customer.code AWB prefix. Migration 0013 comment amendment
(§5.1) is the mitigation; column rename is a Phase 2 forward-only
migration tracked separately.

## §8 Sequencing

1. **This plan-PR opens** → reviewer counter-review at plan-PR open
   (T3 first hard-stop)
2. **Plan-PR merges** after reviewer approves
3. **Code-PR opens** on a fresh branch `day18/a1-customer-id-resolver-swap-code`
   off main HEAD post-plan-PR-merge → reviewer counter-review at
   code-PR open (T3 second hard-stop)
4. **Code-PR merges** after every gate in §6 clears
5. **Production smoke** post-deploy (gate 17)
6. **A2 (webhook handler 3-layer) plan-PR** opens after A1 code-PR
   merged — sequential, not bundled, per Day-18 handoff §7

## §9 Effort estimate

- Plan-PR: this file. ~30-45 min including reviewer's §3.6 re-review.
- Code-PR: ~3-4 hr including test rewrite, guard removal, bundled docs.
- Total A1 wall-clock: ~4-5 hr from plan-PR open to code-PR merge.
