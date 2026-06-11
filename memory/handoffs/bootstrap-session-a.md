---
name: Session A pre-A1-code-PR bootstrap (Day 18, post-compact)
description: Fresh Session A resume context for A1 code-PR work (SuiteFleet customer_id per-tenant resolver swap). A1 plan-PR #187 merged at e99681f. Code-PR is the next substantive work; T3 second hard-stop applies at code-PR open. Reviewer (this session) is fresh-context-A2-counter-reviewer holding §3.1-§3.6 discipline rules from Reviewer A's Day-18 handoff.
type: project
---

# Session A bootstrap — pre-A1-code-PR (Day 18, post-compact)

## §1 Read-first orientation

You are Session A, the architectural lane in the parallel-session pattern.
Session B operates the UI lane in a separate worktree at `~/work/planner-b`.
This session was just compacted to preserve context budget for the heavy
A1 code-PR work.

**Repo HEAD at compact time:** `e99681f` (post-PR-#187-merge to main).
**Worktree:** main worktree at `/Users/lovemans/Code/planner`. Branch: main.
**Reviewer:** fresh-context counter-reviewer (Reviewer B in Reviewer A's handoff
parlance), in claude.ai. Holding Reviewer A's §3.1-§3.6 discipline rules
(ground in data, verify shipped contracts, bidirectional info flow, registered-
ruling survey, trust user architectural context, post-draft re-review).

**First action on resume:** read this file in full, then read the four files
listed in §2 below. Then the A1 code-PR prompt the reviewer will paste next.

## §2 Required reads on resume

1. **`memory/PLANNER_PRODUCT_BRIEF.md`** — current at v1.6, scheduled v1.7
   bump in A1 code-PR per §5.2 of plan. Read in full.
2. **`memory/plans/day-18-a1-customer-id-resolver-swap.md`** — A1 plan-PR
   contents, merged at `e99681f`. This is the plan you're about to implement.
   Read in full.
3. **`memory/followup_per_tenant_merchant_id_routing.md`** — root-cause memo
   that led to A1. The architectural correction (regional `client_id`,
   per-merchant `customerId`, AWB-prefix `customer.code`) is canonical.
4. **`memory/MEMORY.md`** — Day-17 entries through Day-18 entries.
   Provides cross-references for the four memo amendments bundled in A1.

Optional (read on-demand if implementation surfaces a question):
- `memory/handoffs/day-17-eod.md` — Day-17 substantive landings
- `memory/followup_migration_0013_customer_code_comment_amendment.md` — bundled in A1 §5.1
- `memory/decision_mvp_shared_suitefleet_credentials.md` — bundled in A1 §5.3 amendment
- `memory/followup_secrets_manager_swap_critical_path.md` — bundled in A1 §5.3 amendment

## §3 Architectural ground-truth (locked, do not re-litigate)

Three SuiteFleet identifier layers, established Day 18 morning by Love:

| Layer | Identifier | Example | Scope |
|---|---|---|---|
| Region | `client_id` (env-backed) | `transcorpsb` (sandbox), `transcorpuae` (UAE), `transcorpqatar` (Qatar) | Per region; shared across merchants in that region |
| Merchant | `customerId` (numeric, DB-backed post-A1) | 588 (MPL), 586 (DNR), 578 (FBU) | Per merchant within a region; routes tasks to correct SF merchant |
| AWB prefix | `customer.code` (alphanumeric) | MPL, DNR, FBU | Cosmetic; AWB prefix only; NO routing role |

**Reviewer A's Day-18 handoff §6.1 framing of A1 as "customer.code wire-body
threading" is WRONG.** A1 is "make `customerId` per-tenant by reading from
DB instead of env." Wire body shape is unchanged. No `customer` object added.

If anything in your absorbed context says A1 threads `customer.code`, ignore
it; the plan-PR is the canonical scope.

## §4 A1 plan-PR §6 gate checklist (load-bearing for code-PR)

The 18 gates from the plan (post-fixup) are the mandatory pre-merge checklist
for the code-PR. Read the full table in `memory/plans/day-18-a1-customer-id-resolver-swap.md`
§6. Highlights:

- Gate 3 (load-bearing pin): Resolver returns DISTINCT customerId per tenant.
  This is the test that catches the entire bug class A1 fixes.
- Gate 4 (load-bearing pin): The existing test "returns identical credentials
  for different tenant ids" must be INVERTED to "returns DIFFERENT credentials."
  The original test was a regression marker for the bug; the inverted test
  is the load-bearing diagnostic for the fix.
- Gate 7-8: Task-push guard removal + cron tenant-walk error handler shape.
  Both require call-stack tracing during implementation; document findings
  in PR description.
- Gates 9-13: Five docs/memo bundled-scope items (migration 0013 comment +
  brief §3.6 + 2 Day-10 memo amendments + new decision file + index update).
  All in one PR.
- Gate 17-18 (split per fixup `829fee6`): Vercel promote to Production
  followed by post-promote smoke against three demo tenants verifying each
  lands in the correct SF merchant per SF console.

## §5 Discipline rules to hold (from Reviewer A handoff §3)

- **§3.1 — ground in data, not hypothesis.** Before stating any hypothesis
  about why something failed, walk through what existing data says.
- **§3.2 — verify shipped contracts before drafting.** Survey the codebase
  before naming a regex / type / status enum / schema / validation rule.
  30 seconds of grep eliminates a class of error.
- **§3.3 — bidirectional information flow with reviewer.** When you resolve
  a blocker for the reviewer, surface back proactively. Don't make reviewer
  ask.
- **§3.4 — survey registered metadata before drafting.** Before adding new
  audit events / permissions / status transitions, survey what's already
  registered in `src/modules/audit/event-types.ts`, `permissions.ts`, etc.
- **§3.5 — trust Love's architectural context.** When Love states a fact
  about how Transcorp's production systems work, that's ground truth.
- **§3.6 — post-draft re-review.** Every plan-PR / EOD doc / structured
  artifact gets a deliberate re-review pass before delivery. Cross-reference
  every factual claim against actual conversation/repo state.

## §6 What's known about the code-PR scope (from plan-PR + surveys)

The code-PR will touch these files (verified via Day-18 surveys):

**Runtime code:**
- `src/modules/credentials/suitefleet-resolver.ts` — REWRITE the function
  body. Mirror `suitefleet-webhook-resolver.ts` house style: `withServiceRole`
  + `sqlTag` SELECT from `tenants` keyed by `tenantId`. Throw `CredentialError`
  on tenant-not-found, NULL/empty/non-numeric/non-positive customer_code.
- `src/modules/task-push/service.ts:364-394` — REMOVE the "skip quietly"
  guard. Document call-stack trace in code comments at removal site (per
  plan §2.5).

**Tests:**
- `src/modules/credentials/tests/suitefleet-resolver.spec.ts` — REWRITE
  ~16 cases per plan §3.1. Replace env-injection seam with DB tx mock.
  Invert the "identical credentials per tenant" test. Add 7 new throw-on-
  missing cases.
- `tests/integration/suitefleet-resolver-per-tenant.spec.ts` — NEW FILE.
  Five cases per plan §3.2. Real-Postgres integration.

**Migration comment (no schema change):**
- `supabase/migrations/0013_sf_integration_required_fields.sql` Section 2
  comment (lines 46-72) — REWRITE per plan §5.1. Use the §5 "Amendment
  shape" template from `followup_migration_0013_customer_code_comment_amendment.md`
  but update for Option A (resolver throws) framing.

**Brief + memos:**
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.6 — REWRITE per plan §5.2. Bump
  v1.6 → v1.7. New row in §9 amendment log.
- `memory/decision_mvp_shared_suitefleet_credentials.md` — ADD prominent
  amendment header per plan §5.3.
- `memory/followup_secrets_manager_swap_critical_path.md` — REFRAME swap
  scope per plan §5.3.
- `memory/decision_brief_v1_7_amendment_sf_identifier_model.md` — NEW FILE
  per plan §5.4.
- `memory/MEMORY.md` — ADD Day-18 A1 entry per plan §5.5.

**Test fixtures:**
- Wherever test fixtures populate the `tenants` table — verify
  `suitefleet_customer_code` is populated with 588/586/578 for the three
  demo tenants per plan §3.5. If unset, seed it.

## §7 Coordination with Session B

Session B is concurrently working on the test-tenants cleanup PR (377
fixture rows soft-archived to a new `'archived'` status enum value).
Session B's plan-PR may be in flight or merged by the time you resume.

**Coordination point (per Session B's plan §6):** A1's resolver throws
on alphanumeric `customer_code` values. Six `bg4g-*` rows in Session B's
to-be-archived set have alphanumeric customer_codes (e.g. `'E2E-745f38ea'`).
After Session B's cleanup ships, those rows have `status='archived'`. If
the cron tenant-walk filters by status, A1's resolver never sees the
alphanumeric values for archived rows. If the cron walks all rows, Session B's
PR adds the status filter.

**For your code-PR:** verify the cron tenant-walk SELECT filters by status
during the Gate 8 verification. Surface the finding in the code-PR
description. If Session B's PR has already shipped the filter, no further
action. If not, document the dependency.

## §8 Per-call worktree pattern (unchanged)

You operate in the main worktree at `/Users/lovemans/Code/planner`.
Session B operates in `~/work/planner-b`. Your bash calls don't need
the `cd` chain that Session B's do.

For the code-PR branch:
1. `git -C /Users/lovemans/Code/planner pull origin main --ff-only`
   (sync to e99681f or whatever main is when you resume)
2. `git -C /Users/lovemans/Code/planner checkout -b day18/a1-customer-id-resolver-swap-code`
3. Implement per §6 above
4. Counter-review by reviewer (this session) at code-PR open

## §9 What NOT to do

- Don't begin code work until reviewer surfaces the code-PR prompt
- Don't bundle additional scope items beyond plan §5.1-§5.5
- Don't add `customer` object to wire body (per §3 of this bootstrap)
- Don't skip the `tsc --noEmit` check after touching `SuiteFleetCredentials`
  type — the type's `customerId: number` shape stays unchanged but call-site
  surface should be re-verified
- Don't mark the day closed; that's Love's call after every gate clears

## §10 Session B parallel coordination protocol

If Session B surfaces a question that affects A1 architectural shape (e.g.
a status enum value that breaks A1's resolver query), surface that to the
reviewer immediately. Do NOT wait for Session B's PR to merge before
flagging. The reviewer relays bidirectionally per §3.3.

## §11 First-turn protocol on resume

After reading this bootstrap + the four files in §2:

1. Confirm absorption with a single line: "Bootstrap absorbed. Main HEAD
   verified at <SHA>. Ready for A1 code-PR prompt."
2. Verify main HEAD by running `git -C /Users/lovemans/Code/planner rev-parse main`
3. If HEAD is not e99681f, surface the actual HEAD — Session B's PR may
   have merged, advancing main. That's not a problem; just a coordination
   note for the reviewer.
4. Stand by for the code-PR prompt.

DO NOT begin any code work, file edits, or PR creation in your first turn
post-resume. Reviewer surfaces the code-PR prompt after Session B's
test-tenants plan-PR is in counter-review or merged.
