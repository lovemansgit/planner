---
name: Day 14 — tests + PR-open bootstrap handoff
description: Bootstrap doc for the fresh Claude Code session that writes Day-14 cron-decoupling tests (§7.1-§7.4) and opens the code PR. Code is feature-complete on `day14/t3-cron-decoupling-code` (10 commits ahead of main, last commit 72f4735). Tests deferred to a fresh session for context-budget reasons. This doc captures what's done, what's left, and the §11.2 code-PR pre-merge gates.
type: project
---

# Day 14 — tests + PR-open bootstrap

**For:** Fresh Claude Code session picking up Day-14 cron-decoupling tests.
**Repo:** `lovemansgit/planner`
**Read this entire document before responding.**

---

## §1 What's done — code is feature-complete on `day14/t3-cron-decoupling-code`

Branch tip: `72f4735`. 10 commits ahead of `main` (currently `7a07b28`).

| Commit | Scope |
|---|---|
| `de25101` | Phase 1 — reconciliation scan in materialization handler (`listReconciliationCandidatesByTenant` repo function + handler block) |
| `fc172ee` | Phase 2 — bulk INSERT…SELECT with 4-layer COALESCE + §2.2 quarantine counter (`materializeTenant` Phase 2 SQL) |
| `0debab1` | Phase 3 — horizon advance via UPDATE on `subscription_materialization` |
| `31ed37b` | Phase 4 — run-row write with §4.4 5-status branching + stale-running CAS recovery (`writeRunRowPhase4` + migration `0020`) |
| `1af4c05` | Phase 5 — post-commit `batchJSON` enqueue with flowControl + deduplicationId + failureCallback (`enqueueTaskPushBatch` + `.env.example` `QSTASH_FLOW_CONTROL_KEY`) |
| `c3eb995` | Phase 6 — handler-exit summary log + return (materialization handler feature-complete) |
| `7694190` | Queue consumer `/api/queue/push-task` per §5.1 (10-value Outcome enum, two-read guards, pushSingleTask invocation) |
| `08e7543` | Queue failureCallback `/api/queue/push-task-failed` per §5.2 amendment 5 |
| `e5b28a0` | Retirement: `pushTasksForTenant` + cron-loop tests deleted per §1.3 (-1737 lines net) |
| `72f4735` | `scripts/backfill-subscription-materialization.mjs` — one-time bootstrap script |

All 10 commits typecheck-clean and lint-clean. **Zero new tests in this session — tests are this handoff's job.**

### Files added

- `src/modules/task-materialization/dubai-date.ts` — `computeTargetDateInDubai`
- `src/modules/task-materialization/service.ts` — `materializeTenant` (Phases 2-4)
- `src/modules/task-materialization/run-row.ts` — `writeRunRowPhase4` (§4.4 6-branch state machine)
- `src/modules/task-materialization/queue.ts` — `enqueueTaskPushBatch` + `PushTaskPayload` interface
- `src/app/api/queue/push-task/route.ts` — QStash consumer (~280 lines)
- `src/app/api/queue/push-task-failed/route.ts` — failureCallback receiver (~165 lines)
- `supabase/migrations/0020_task_generation_runs_target_date_column_and_unique.sql` — 5-step transactional migration
- `scripts/backfill-subscription-materialization.mjs` — one-time bootstrap

### Files edited

- `src/app/api/cron/generate-tasks/route.ts` — full rewrite (legacy → 6-phase model)
- `src/modules/tasks/types.ts` — `Task.addressId: Uuid | null` added
- `src/modules/tasks/repository.ts` — `listReconciliationCandidatesByTenant` added; `mapTask` populates `addressId`
- `src/shared/tenant-context.ts` — `'queue:push_task'` added to `SystemActor` union
- `src/modules/task-push/service.ts` — `pushTasksForTenant` deleted (1145 → 665 lines)
- `src/modules/task-push/types.ts` — `PushTenantOutcome` deleted
- `src/modules/task-push/index.ts` — exports updated
- `.env.example` — `QSTASH_FLOW_CONTROL_KEY` entry
- `package.json` — `backfill-subscription-materialization` npm script

### Test fixtures touched (just `addressId: null` added)

- `src/modules/tasks/tests/service.spec.ts`
- `tests/unit/push-single-task.spec.ts`

### Files deleted

- `tests/unit/cron-push-rejects-unknown-district.spec.ts`
- `tests/unit/cron-push-rejects-missing-customer-code.spec.ts`
- `tests/unit/cron-push-reconciles-awb-exists.spec.ts`

(All tested the retiring `pushTasksForTenant`. Per-message variant is covered by §7.2 push-handler tests in this handoff's scope.)

---

## §2 What's left — tests §7.1-§7.4

Per the merged plan at [`memory/plans/day-14-cron-decoupling.md`](../plans/day-14-cron-decoupling.md) §7 (re-architected post-amendments). Section breakdown:

### §7.1 Materialization cron tests (~13 row tests)

Targets `src/modules/task-materialization/service.ts` + the cron route handler. Plan §7.1 enumerates:

- Happy path (5 subs Mon-Fri × 2 weeks)
- Skip exception (skip on Wed week 1)
- Pause_window (paused for week 1)
- Address rotation (Mon→home, Tue→office, fallback)
- Address_override_one_off (single-day override; rotation/primary for other dates)
- Address_override_forward + supersession (two-step: first override → second supersedes from Fri)
- Append_without_skip (operator extends end_date; tail-end materializes with rotation/primary)
- Null-address quarantine (no rotation, no primary, no override → counter incremented)
- Horizon cap at S.end_date (3-day-runway sub gets capped horizon)
- Paused filter (status='paused' sub doesn't advance)
- Phase 1 reconciliation (load-bearing; pre-existing null rows re-enqueued)
- Run-row UNIQUE conflict — happy-status branches (5 status values per §4.4)
- Run-row UNIQUE conflict — stale-running CAS recovery (load-bearing)
- Materialization enqueues via batchJSON (chunking boundaries N ∈ {50, 100, 250, 1001})

### §7.2 Push handler tests (~12 row tests)

Targets `src/app/api/queue/push-task/route.ts`. Plan §7.2 enumerates:

- `maxDuration` build-time check (CI grep test for `export const maxDuration = 300`)
- Happy path (success outcome, sf_latency_ms log)
- `pushSingleTask` invocation (mock-spy asserting handler calls pushSingleTask, NOT adapter)
- Tenant-scoping mismatch (400 + log + Sentry)
- `address_id` null guard (400 + Sentry-capture `push.address_id_null`)
- Already-pushed skip (Layer 2 idempotency pre-check)
- AwbExists reconcile (Layer 3 idempotency)
- Transient 5xx → throws (QStash retries)
- Signature gate (missing/invalid → 401)
- 10-value Outcome enum strict-check
- failureCallback handler — happy path (writes failed_pushes via existing repo)
- failureCallback handler — signature gate

### §7.3 Migration `0020` test (~6 row tests)

Targets `supabase/migrations/0020_*.sql`. Integration tests against postgres:17 fixture per `scripts/setup-test-db.sh:58`. Plan §7.3 enumerates:

- Backfill correctness for canonical 12:00 UTC tick (AT TIME ZONE form)
- DST-boundary backfill (defensive — Dubai is constant UTC+4 but documents we considered DST)
- Dedup with winning-row policy (5 dupe rows → keep MAX(completed_at) preferred, else MAX(started_at))
- target_date column-add + NOT NULL promotion (induce backfill-skip row, assert step 4 fails AND wrapper rolls all)
- BEGIN/COMMIT wrapper rollback (induce mid-migration failure, assert table state unchanged)
- Pre-existing UNIQUE preserved (old `(tenant_id, window_start, window_end)` UNIQUE from 0012 still enforced)
- New UNIQUE catches dupe (verified via INSERT × 2 → 23505)

### §7.4 Integration test — happy path (~10 steps)

Single end-to-end test exercising full ingress → queue → egress against mocked SF adapter. Plan §7.4 enumerates the 10-step procedure.

**§7.5 (edge-case integration tests, 6 rows) is OUT OF SCOPE for this handoff** per the §7.5 split — those are heavier integration tests for "integration-only schedule, not every PR." Defer to post-merge follow-up.

---

## §3 Pre-PR-open verification + the §11.2 code-PR pre-merge gates

Per [merged plan §11.2](../plans/day-14-cron-decoupling.md), the code PR has 9 pre-merge gates. Status of each at this handoff time:

| # | Gate | Status |
|---|---|---|
| 1 | Migration 0015 application status confirmed (subscription_materialization on prod) | ✅ Applied 2026-05-05 12:16 +04:00 (PR #144 prep step). Verified via `SELECT to_regclass('public.subscription_materialization')` → `subscription_materialization`. |
| 2 | `export const maxDuration = 300;` declaration in `/api/queue/push-task/route.ts` | ✅ Present. Test §7.2 row 1 (build-time grep) needed. |
| 3 | Coupled deploy unit verified (migration 0020 + handler in same PR) | ✅ Both in branch `day14/t3-cron-decoupling-code`. |
| 4 | Stale-running CAS predicate present in code | ✅ `run-row.ts` `WHERE id = $stale_id AND started_at = $original_stale_started_at RETURNING id`. Test §7.5 row 1 deferred to follow-up. |
| 5 | Demo dependency tracking | ✅ Day 14 morning — implementation finished within plan-PR's 5-day buffer. Day-14 part-2 plan PR can open after this code PR merges. |
| 6 | `QSTASH_FLOW_CONTROL_KEY` env-var per environment | ⚠️ **Love manual step pre-merge.** Set Production = `'sf-push-global-mvp'`, Preview = `'sf-push-global-preview'`, Local unset. Verify Vercel UI before merge. |
| 7 | §7 test coverage | ⏳ **THIS HANDOFF'S SCOPE.** §7.1-§7.4 must land before PR open. |
| 8 | §5.5 observability surface present | ✅ Per-handler structured log emits all 4 fields. Test §7.2 enum-strict-check needed. |
| 9 | §7.1 enqueue-test specifics with chunking-boundary parameter assertions | ⏳ **THIS HANDOFF'S SCOPE.** Tested at N ∈ {50, 100, 250, 1001}. |

**Gate 6 (Vercel env-var) is the only Love-action gate** — set the values before merging. Everything else is in-code or test-time.

---

## §4 Plan §0.6 QStash quota verification

Plan §0.6 amendment locks: Love confirms current Upstash plan tier in dashboard before code PR opens; if free tier, upgrade to pay-as-you-go. Projected throughput at full demo volume ~1,000 messages/day; PAYG ~$0.01-$0.30/month. **Status: Love verifies Vercel-side; not blocking code/tests.**

---

## §5 Sequencing for code-PR open + merge + deploy

Per plan §3.1 + §3.4 + §11.2 row 1 + 6:

1. Fresh session writes §7.1-§7.4 tests on `day14/t3-cron-decoupling-code`. Pushes test commits.
2. CI (`scripts/setup-test-db.sh:58` glob auto-applies migration 0020) runs unit + integration tests on the branch.
3. Love verifies §11.2 row 6 (`QSTASH_FLOW_CONTROL_KEY` env-var Production + Preview scopes set).
4. Love verifies §0.6 (QStash plan tier on Upstash dashboard; upgrade to PAYG if needed).
5. Fresh session opens code PR with the §11.2 9-gate checklist as PR body. Surface URL to Love.
6. Love counter-reviews against §11.2 (T3 hard-stop #2 — verification-only).
7. Love merges via `gh pr merge --squash --delete-branch`.
8. **POST-MERGE — Love runs `npm run backfill-subscription-materialization -- --yes=true` against production** (per §3.3 sequencing — bootstraps the table the first cron tick will read). Smoke-tested dry-run pre-merge confirms 860 active subs / 0 existing materialization rows.
9. Vercel auto-deploys main; new materialization handler is live for the next 12:00 UTC cron tick.

**Operational mitigation per §3.4 amendment 7: Love avoids deploys within ±10 minutes of 12:00 UTC** to prevent cron-tick / deploy-swap collision.

---

## §6 PR description template

```markdown
## Summary

T3 code PR for the Day-14 cron materialization↔push decoupling, implementing the merged plan at memory/plans/day-14-cron-decoupling.md (PR #145, merged 27c5b8c). Materialization handler is feature-complete via the 6-phase model; queue-side handlers (`/api/queue/push-task` per §5.1, `/api/queue/push-task-failed` per §5.2 amendment 5) consume the QStash messages.

10 commits across the materialization handler rewrite, two new queue routes, retirement of the legacy push-loop, migration 0020 (`(tenant_id, target_date)` UNIQUE), the bootstrap backfill script, and §7 tests.

T3 hard-stops:
- (a) Plan PR #145 — merged.
- (b) **THIS PR** — verification-only counter-review against §11.2 9 gates.

## §11.2 code-PR pre-merge checklist

(Copy from plan §11.2 — all 9 gates with status indicators per §3 of the handoff doc.)

## Brief reference

PR implements the brief's §3.1.5 14-day rolling horizon + §3.3.6 integration-honesty contract surface. No brief amendments in this PR (subscriptions.status casing fixed by PR #146).

## Post-merge sequencing

(Copy §5 of the handoff doc.)

## Test plan

(Cross-reference §7.1-§7.4 test count + §7.5 deferred to follow-up.)
```

---

## §7 Cross-references

- [memory/plans/day-14-cron-decoupling.md](../plans/day-14-cron-decoupling.md) — merged plan (PR #145, 27c5b8c)
- [memory/handoffs/day-13-eod.md](day-13-eod.md) — predecessor; established the cron-decoupling driver
- [memory/decision_brief_v1_2_amendments_d13_part1.md](../decision_brief_v1_2_amendments_d13_part1.md) — `tasks.pushed_to_external_at` brief amendment
- PR #145 (plan, merged `27c5b8c`)
- PR #146 (status casing fix, merged `7a07b28`)
- PR #144 (Posture B P5 query fix from same review window)
- Branch `day14/t3-cron-decoupling-code` tip `72f4735`

---

## §8 Auto-memory governance refs (load-bearing for review process)

Per merged plan §10.e:
- `feedback_t3_plan_prs_need_realtime_review.md` — gates T3 code PR review
- `feedback_claude_code_executes_default.md` — assigns Love as Vercel UI executor (env vars, manual deploy promotion)
- `feedback_vercel_env_scope_convention.md` — governs `QSTASH_FLOW_CONTROL_KEY` per-environment posture (gate 6)
- `feedback_always_surface_pr_url.md` — surface PR URL on its own line near top of response after `gh pr create`

---

**End of handoff.** Fresh session: write §7.1-§7.4 tests, open the PR via `gh pr create` with the §6 template, surface URL.
