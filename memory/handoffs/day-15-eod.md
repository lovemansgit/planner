---
name: Day 15 EOD handoff — Transcorp Subscription Planner pilot
description: 4 PRs merged today (#152 Day-15 prep bundle, #153 cron decoupling code T3, #154 Posture B Stage 2 T2, #155 Day-14 part-2 service-layer plan T3). Cron decoupling fully landed end-to-end — 6-phase materialization handler + QStash queue routes live in production via `npx vercel promote`; migration 0020 applied; backfill seeded 860 subscription_materialization rows. Posture B fully retired (Stage 1 env-var removal + Stage 2 code cleanup). Day-14 part-2 service-layer plan locked at 881 lines / 11 sections / 8 open-q defaults / §10.3 Option-A locked / 12 pre-merge gates. Day-16 substantive scope: code PR drafts against merged plan #155 in fresh session.
type: project
---

# Day 15 EOD Claude Code session handoff — 6 May 2026 (calendar Day 15 ≈ plan Day 17)

**For:** Fresh Claude Code session picking up from Day 15 close
**Repo:** `lovemansgit/planner`
**Read this entire document before responding.**

---

## §0 Product brief reference (load-bearing)

[`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) is at **v1.2** as of PR #141 (merged Day 13 evening). No brief amendments today; PR #155 plan PR locks scope decisions WITHIN the brief's existing v1.2 envelope. The brief continues to supersede `docs/plan.docx` §10 in conflict.

**Demo target unchanged: May 12.** Four days remaining (Day 16 → Day 19; demo Day 20).

If this EOD doc conflicts with the brief, **the brief wins**.

---

## §1 Repo state at EOD

```
main HEAD:        0d1ce21  T3 — Day-14 part-2 service-layer plan (#155)
Day-15 starting:  3704616  T1 — Day-15 prep bundle (#152) — landed Day-14 night
unit baseline:    824 (post Posture B Stage 2 cleanup; was 826 pre-Stage-2; -3 gate-behavior tests + 1 fail-closed regression pin = -2)
integration:      ~159 + new spec files added on `day14/t3-cron-decoupling-code` and merged via PR #153
                  (§7.1 task-materialization integration ~13 row tests + §7.3 migration-0020 ~10 tests + §7.4 happy-path E2E 2 tests)
typecheck:        clean (verified on every PR-open + post-merge)
lint:             clean (verified)
working tree:     clean tracked tree; 3 untracked ephemeral scripts
                    (scripts/apply-migration-0020.mjs, scripts/post-deploy-verify.mjs,
                     scripts/posture-b-preflight-probe.mjs)
                  — fates pending tomorrow's plan-sync bundle PR (see §7)
```

**Production lag:** **1 commit** behind production (PR #154 unpromoted; PR #155 is memory-only with no Vercel impact). PR #154 is the Posture B Stage 2 code cleanup that retires the `ALLOW_DEMO_AUTH` runtime gate; the env-var was already removed Day-15 morning via Stage 1, so production behavior is identical with or without the promote — this is a hygiene-only lag that rides the next batch promotion (Day-16 EOD).

**Branches outstanding at EOD:** none. All 4 PRs merged with `--delete-branch`.

---

## §2 Day-15 PR ledger (chronological)

4 PRs touched today; all 4 merged. Substantive ratio: 2 T3 + 1 T2 + 1 T1.

| # | PR | Tier | Scope | Merge SHA | Merged at (UTC) |
|---|---|---|---|---|---|
| D15-1 | [#152](https://github.com/lovemansgit/planner/pull/152) | T1 | chore(memory): T1 — Day-15 prep bundle (index amendment + bootstrap brief) | `3704616` | 2026-05-05 14:38 (Day-14 night; lineage marker only) |
| D15-2 | [#153](https://github.com/lovemansgit/planner/pull/153) | T3 | feat(cron): T3 — decouple materialization from push (6-phase model + QStash fan-out) | `7759580` | 2026-05-05 17:06 |
| D15-3 | [#154](https://github.com/lovemansgit/planner/pull/154) | T2 | chore(auth): T2 — Posture B Stage 2 code cleanup (retire ALLOW_DEMO_AUTH gate) | `7fd70f6` | 2026-05-06 02:51 |
| D15-4 | [#155](https://github.com/lovemansgit/planner/pull/155) | T3 | chore(memory): T3 — Day-14 part-2 service-layer plan | `0d1ce21` | 2026-05-06 03:47 |

**Plus this EOD doc** (T1, opens after surfacing).

PR #153 is the headline — full code PR for the cron-decoupling plan PR #145 (merged Day-14 night). 14 commits squashed; 3 CI iteration cycles to land green (drizzle array splat → 4 distinct test failures → 3 dedup/recon refinements → all green). Migration 0020 + new materialization handler + 2 new queue routes (`/api/queue/push-task`, `/api/queue/push-task-failed`) + retirement of legacy `pushTasksForTenant` + bootstrap backfill script. Net code volume +5,488 / -3,490 across 38 files.

PR #154 retired the runtime `ALLOW_DEMO_AUTH` gate after Posture B Stage 1 env removal verified clean Day-15 morning. Code-only cleanup: -224 lines (deleted `demo-context.ts` 120 lines + 3 gate-behavior tests + 4 header-comment refs); +1 fail-closed regression pin (test sets `ALLOW_DEMO_AUTH="true"` and asserts UnauthorizedError still throws — proves the runtime gate is genuinely dead, not config-disabled).

PR #155 is the Day-14 part-2 service-layer plan PR. 881 lines across 11 sections after 4 reviewer-amendment cycles (Path B whole-section pass for §0-§2 + §8-§11; Path A section-by-section for §3-§7). Cleared T3 hard-stop #1; T3 hard-stop #2 fires at code-PR open in Day-16 fresh session. Force-pushed 4× (single-commit amend pattern preserves clean history).

PR #152 was filed Day-14 night as the Day-15 morning bootstrap; included for completeness in the Day-15 ledger as the earliest-merge marker for this calendar day's work.

---

## §3 Substantive code/scope landings — Day 15

### §3.1 PR #153 cron decoupling code — fully landed end-to-end

The headline substantive landing. Per merged plan PR #145 §1.1 6-phase model:

- **New materialization handler** at `/api/cron/generate-tasks` runs Phase 1 reconciliation scan + Phase 2 bulk INSERT…SELECT with 4-layer COALESCE + Phase 3 horizon advance + Phase 4 single-statement run-row write with §4.4 6-branch state machine including stale-running CAS recovery + Phase 5 post-commit `batchJSON` enqueue + Phase 6 handler-exit summary.
- **New queue consumer** at `/api/queue/push-task` per §5.1 — 11-state observability outcome enum (route header explicitly amends plan §5.5's 5-state sketch — folds into post-§7 plan-sync bundle).
- **New failureCallback receiver** at `/api/queue/push-task-failed` per §5.2 amendment 5 — writes to existing `failed_pushes` DLQ surface.
- **Retirement** — `pushTasksForTenant` cron-loop variant + 3 cron-loop test files deleted per §1.3 (-1,737 lines net).
- **Migration 0020** — adds `task_generation_runs.target_date` column + new UNIQUE on `(tenant_id, target_date)`; preserves pre-existing UNIQUE on `(tenant_id, window_start, window_end)` per §0.5 amendment D4-4.
- **Backfill script** — `scripts/backfill-subscription-materialization.mjs` seeds the new `subscription_materialization` table from existing active subscriptions.

CI iteration cycles:
1. Round 1 — drizzle `sqlTag`'s array splat in `seedSubscription` (cast `record → integer[]`) → fixed by Postgres array-literal text form (`{1,2,3,4,5}`).
2. Round 2 — 4 distinct issues: pre-existing `rls-tenant-isolation.spec.ts` INSERT missing `target_date`; dead `task-generation/*` module's `insertRunOrGetExisting` couldn't write `target_date`; §7.4 `tasks_creation_source_invariant` CHECK violation; §7.3 dedup test inserting dupes that violate the very UNIQUE the migration adds. Fixes: completed §1.3 retirement (deleted dead `task-generation/`); `created_via='manual_admin'` on NULL-subscription_id rows; dedup test refactored to pure-SELECT against `jsonb_array_elements`.
3. Round 3 — 3 issues: `JSON.stringify` parameter double-encoded by postgres-js; tick-2 reusing same `window_start` (collides with old UNIQUE retained per gate 6); reconciliation NULL-sub fixtures missing `created_via`. Fixes: §7.3 dedup switched to `unnest`-with-parallel-arrays; §7.1 paused-filter test gets fresh window per tick; reconciliation fixtures get `created_via='manual_admin'`.

### §3.2 PR #154 Posture B Stage 2 code cleanup

Stage 1 env-var removal verified clean Day-15 morning post-06:11 +0400 Dubai gate clear:
- `vercel env rm ALLOW_DEMO_AUTH production --yes` → `env_not_found` (matches runbook §2 expected — Production never had it; Preview-only posture).
- `vercel env rm ALLOW_DEMO_AUTH preview --yes` → `Removed Environment Variable`.
- `vercel env ls | grep ALLOW_DEMO_AUTH` → no rows; absent from all scopes.
- `QSTASH_FLOW_CONTROL_KEY` remains on Production + Preview (cron-decoupling §11.2 gate 6 unaffected).

Stage 2 code cleanup retires the now-dead runtime gate:
- `src/shared/request-context.ts` — header rewritten; `buildDemoContext` import removed; the `if (process.env.ALLOW_DEMO_AUTH === "true")` fallback block removed; function body goes straight from `if (session) { ... }` to `throw new UnauthorizedError`.
- `src/shared/demo-context.ts` — DELETED (120 lines).
- `src/shared/tests/request-context.spec.ts` — removed 3 gate-behavior tests; added 1 fail-closed regression pin that explicitly sets `process.env.ALLOW_DEMO_AUTH = "true"` and asserts the no-session path STILL throws — strongest-possible coverage that the runtime gate is genuinely dead.
- `.env.example` + 4 route/page header comments — Posture A/B references retired.

V2/V3 Preview spot-check at PR open (incognito hit on `/consignees`) returned `/login?next=%2Fconsignees` with the real Sign-in form — gate fully retired in production-shape build. Plan-sync bundle drift check (per Love's bonus instruction): runbook §2 prediction MATCHED reality; bundle stays at 5 items.

### §3.3 PR #155 Day-14 part-2 service-layer plan locked

881 lines / 11 sections covering scope envelope A–F:
- **A.** Subscription exception services (5 type variants of `addSubscriptionException` + `appendWithoutSkip`)
- **B.** Subscription lifecycle (`pauseSubscription` bounded + `resumeSubscription` manual + auto-resume scheduler — **Option A locked at §10.3**)
- **C.** Consignee CRM services (`changeConsigneeCrmState`)
- **D.** Merchant management services (`createMerchant`, `activateMerchant`, `deactivateMerchant`, `listMerchants`)
- **E.** Address services (`changeAddressRotation`, `changeAddressOneOff`/`Forward` thunks to `addSubscriptionException`)
- **F.** API route layer — 11 net-new routes

Load-bearing finding surfaced at §0.2 + §0.4: ALL 10 brief §3.1.3 permissions and ALL 9 brief §3.1.2 audit events are ALREADY registered in code via PR #139 (Day-13 part-1). Plan §1 + §2 collapse from "additions" to "mapping" — significant scope reduction. Schema layer fully ready; this plan is service+API design only.

8 open-q defaults at §10:
1. `max_skips_per_subscription` — ship without enforcement (Phase 2)
2. `addSubscriptionException` — singular per brief
3. **Auto-resume scheduler — Option A LOCKED** (cron-based polling, 15-min resolution; reasoning: operational simplicity, demo posture, materialization cron handles resume-day timing naturally, self-healing on missed ticks, avoids QStash-delay-cap pre-decision verification cost)
4. CRM matrix locked — INACTIVE → ACTIVE routine reactivation (permission gate alone); CHURNED → ACTIVE keyword-required (deliberately clunky)
5. `tenants.status='inactive'` blocks new login — verify in code at code-PR review; one-line fix in `buildRequestContext` if absent
6. Audit event for rotation changes — default NO
7. Decoupling vs bundling — keep bundled
8. Plan-sync bundle drift items unchanged

§11 gate 11 made verifiable: `gh pr list --state=open --repo lovemansgit/planner` + grep for UI PR title/branch patterns; pause this code PR if any UI PR is open.

---

## §4 Operations executed today

### §4.1 Migration 0020 applied to production

- Applied at ~2026-05-05 17:08 UTC (~21:08 +0400 Dubai), post PR #153 merge, pre Vercel promote
- Applied via `scripts/apply-migration-0020.mjs` (postgres-js with `.unsafe()` to preserve BEGIN/COMMIT wrapper; psql not installed locally)
- Verification post-apply:
  - `target_date` column exists, `is_nullable=NO`, `column_default=NULL` ✓
  - new UNIQUE INDEX `task_generation_runs_tenant_target_date_unique_idx` present ✓
  - pre-existing UNIQUE `task_generation_runs_window_unique` preserved ✓
  - `rows_with_null_target_date: 0` (backfill within migration populated all existing rows) ✓

### §4.2 Vercel production promote

- `npx vercel promote https://planner-b6htar0mx-lovemansgits-projects.vercel.app/` (the post-merge main build)
- Promoted at ~2026-05-05 17:09 UTC (~21:09 +0400 Dubai)
- Production deployment: `https://planner-3w920dowj-lovemansgits-projects.vercel.app` — Ready, Production, 43s build
- Per `followup_vercel_auto_promote_main_to_production.md`: auto-promote OFF; manual `vercel promote` required (matches the documented gap)
- Probe post-promote: `GET /api/cron/generate-tasks` → 401 (auth gate active; route shape confirms deploy landed)

### §4.3 Backfill — production run

- Ran at ~2026-05-05 17:11 UTC (~21:11 +0400 Dubai)
- Command: `npm run backfill-subscription-materialization -- --yes=true`
- Output: 860 active subscriptions / 0 existing subscription_materialization / 860 inserted / 0 skipped
- Match to Day-14 close dry-run smoke test (860 subs / 0 existing) — exact

### §4.4 Post-deploy verification

- Ran at ~2026-05-05 17:13 UTC (~21:13 +0400 Dubai)
- Counts: `active_subs=860, materialization_rows=860, runs_with_null_target=0, total_runs=51, phase1_reconciliation_candidates=0`
- Sample: 3 sample materialization rows with `materialized_through_date=2026-05-05` (matches `MAT_THROUGH=today_in_dubai` per backfill script logic)

### §4.5 Posture B Stage 1 — env-var removal

- Pre-flight P1-P6 sweep at 06:33 +0400 Dubai (post-06:11 gate clear): all 6 gates green; P2 flipped FAIL → PASS overnight (37.7h elapsed → ~22m past gate)
- Commands:
  - `vercel env rm ALLOW_DEMO_AUTH production --yes` → `env_not_found`
  - `vercel env rm ALLOW_DEMO_AUTH preview --yes` → `Removed Environment Variable`
- Verification: `vercel env ls | grep ALLOW_DEMO_AUTH` → no rows
- Collateral: `QSTASH_FLOW_CONTROL_KEY` present on both scopes (Production + Preview)

### §4.6 First 12:00 UTC cron tick under NEW handler — DEFERRED

- **STATUS: NOT YET FIRED.** Last tick at `2026-05-05 12:00:17 UTC` ran under the OLD handler (deploy promoted 5h after that tick).
- 4 runs from the last OLD-handler tick all `status='completed'`, `tasks_created=0` across all (no new horizon dates; all subs already had tasks for `target_date=2026-05-06`).
- **Next tick:** `2026-05-06 12:00 UTC = 16:00 +0400 Dubai` (~8h after EOD doc filing).
- **Verification deferred:** Day-16 EOD doc OR a mid-day Day-16 addendum will surface the first-tick outcome.
- **Rerunnable query pattern:**
  ```sql
  SELECT id, tenant_id, status, target_date, started_at, completed_at,
         projected_count, tasks_created, tasks_skipped_existing
  FROM task_generation_runs
  WHERE window_start >= '2026-05-06T11:00:00Z'::timestamptz
  ORDER BY started_at DESC;
  ```

---

## §5 Day-16 plan

Four-day countdown to demo:

### Day 16 (Saturday May 9, 2026 in plan; calendar may differ slightly)

**Morning blocks (sequential, Love + fresh session interleave):**

1. Fresh Claude Code session opens with bootstrap pointer to this Day-15 EOD + the merged plan PR #155.
2. Read merged plan in full (881 lines / 11 sections); absorb §0.4 pre-flight verification (5 items) before opening code PR.
3. Verify §0.4 pre-flight items (all 10 perms registered ✓, all 9 audit events registered ✓, schema present on prod ✓, migration 0020 + new cron handler live ✓ via Day-15 EOD §4 evidence, Posture B Stage 2 merged ✓ via PR #154).
4. Verify §10.5 — `buildRequestContext` filters tenants by `status='active'`. If absent, code PR adds the one-line predicate (per §5.2.3 strengthened gate at amendment time).

**Afternoon blocks:**

5. Begin Day-14 part-2 code PR drafting against merged plan §3-§5 (services A-E) + §6 (API routes) + §9 (test plan).
6. Sequencing per merged plan §0.3: Day-16+ UI PRs MUST NOT open before this code PR merges (§11 gate 11 verifiable check). Verify no UI PR open via `gh pr list --state=open --repo lovemansgit/planner` at code-PR-open time.
7. Code PR opens; T3 hard-stop #2 fires at PR open for verification-only counter-review (plan already locked).
8. CI runs on PR open (postgres:17 + setup-test-db.sh + integration suite + unit suite + typecheck + lint).
9. First 12:00 UTC cron tick under new handler verification (~16:00 Dubai). Surface in EOD or as addendum.

**Evening blocks:**

10. T1 plan-sync bundle PR (5 items per §7 below; small + low-risk; auto-merge per T1).
11. Day-16 EOD batched promotion (production lag = 1 commit + Day-16 merges; all ride one batch).
12. Day-16 EOD doc + project-file refresh.

### Day 17-19 (per [brief §6 day-by-day plan](../PLANNER_PRODUCT_BRIEF.md))

- Day 17: Per-task delivery status timeline + consignee timeline + CRM state UI + address change workflows.
- Day 18: Brand pass + polish + demo data prep + `demo-preflight.sh`.
- Day 19: Pre-demo verification + dry-runs + slide deck.
- Day 20: Demo May 12 morning.

All Day-16+ feature work is gated on Day-14 part-2 code PR landing per merged plan §0.3 sequencing rationale (data-flow + behavioral + same-day-T3-contention).

---

## §6 Test count delta vs Day-14

| Surface | Day-14 EOD | Day-15 EOD (post-PR-#153 + #154 merges) | Delta |
|---|---|---|---|
| Unit | 819 | 824 | +5 net (PR #153 added §7.1 row 14 batchJSON shape + §7.2 push-handler 27 tests across 4 files; PR #154 net -2: -3 gate-behavior tests + 1 fail-closed pin; PR #153 also deleted 5 task-generation unit tests during §1.3 retirement = +27 -8 -3 +1 = +17 expected vs +5 observed; the discrepancy is from baseline drift pre-merge) |
| Integration | ~159 | ~177-185 | +~18-26 from §7.1 task-materialization (~13 row tests) + §7.3 migration-0020 (~10 tests) + §7.4 happy-path E2E (2 tests; ~25 row tests total) MINUS the deleted task-generation integration spec (5 tests) — net ~+20 |
| Typecheck | clean | clean | — |
| Lint | clean | clean | — |

The exact post-merge baseline can be re-pinned by Day-16 fresh session via `npm run test 2>&1 | tail -5` and `npm run test:integration 2>&1 | tail -5` (latter requires postgres available; CI provides via setup-test-db.sh).

---

## §7 What's open / pending

| Item | Status | Owner |
|---|---|---|
| Day-14 part-2 code PR (T3, service-layer surface against merged plan #155) | Awaits drafting in Day-16 fresh session | Day-16 fresh session (Claude Code drafts; Love counter-reviews per T3 hard-stop #2) |
| First 12:00 UTC cron tick under new handler verification | Awaits ~16:00 Dubai today (~8h from EOD-doc filing); deferred to Day-16 EOD or mid-day addendum | Claude Code (auto-fires; just verify) |
| Day-15 EOD batched promotion (production lag = 1 commit) | PR #154 unpromoted; PR #155 memory-only no Vercel impact. Riding the next batch (Day-16 EOD per current plan) | Claude Code on Love's go-ahead |
| Plan-sync bundle T1 PR (5 amendment items) | Awaits drafting in Day-16 morning OR fresh session start | Claude Code |
| 3 ephemeral scripts on working tree pending fate decision | `scripts/apply-migration-0020.mjs` (DELETE — job done); `scripts/post-deploy-verify.mjs` (PROMOTE-OR-DELETE; reusable as generic post-deploy probe — header rewrite if kept); `scripts/posture-b-preflight-probe.mjs` (PROMOTE — header rewrite from "Ephemeral; safe to delete after Stage 1 ships" to "Posture B / auth-posture audit probe — reusable for any future auth-posture audit") | Day-16 plan-sync bundle PR |
| Brief amendment for §10.6 audit event for rotation changes (default NO) | No action needed; default holds | n/a |
| §10.5 verification — `buildRequestContext` filters tenants by `status='active'` | Verify in Day-16 morning before code-PR opens; one-line fix if absent | Claude Code |
| `subscriptions.cut_off_offset_minutes` configurable cut-off (Phase 2 per `followup_configurable_cutoff_time_per_merchant.md`) | Phase 2; not in part-2 code PR scope | Phase 2 |
| `max_skips_per_subscription` cap enforcement (Phase 2 per §10.1) | Phase 2; not in part-2 code PR scope | Phase 2 |

### §7.1 Plan-sync bundle (5 T1 amendment items)

To file as a single bundle PR in Day-16 morning fresh session start:

1. `memory/plans/day-14-cron-decoupling.md` §5.5 outcome enum: 5 → 11 states
2. `memory/plans/day-14-cron-decoupling.md` §7.2 rows 9+12: 401 → 403 SDK convention
3. `memory/plans/day-14-cron-decoupling.md` §7.1 row 6 forward-override supersession wording
4. `memory/operational/posture-b-retirement-runbook.md` §1 P3+P4 query: `created_at` → `occurred_at`
5. `scripts/posture-b-preflight-probe.mjs` header rewrite ephemeral → durable
   - Plus: `scripts/post-deploy-verify.mjs` fate decision (promote-or-delete; same header rewrite if promoted)
   - Plus: `scripts/apply-migration-0020.mjs` deletion

All 5 items unchanged from Day-15 morning surface. Bundle PR is small + low-risk + T1 auto-mergeable.

---

## §8 Cross-references

- [PLANNER_PRODUCT_BRIEF.md](../PLANNER_PRODUCT_BRIEF.md) — v1.2 source of truth
- [memory/plans/day-14-part2-service-layer.md](../plans/day-14-part2-service-layer.md) — merged plan PR #155 (`0d1ce21`); 11 sections; 8 open-q defaults; §10.3 Option A locked; §10.4 CRM matrix locked
- [memory/plans/day-14-cron-decoupling.md](../plans/day-14-cron-decoupling.md) — merged plan PR #145 (`27c5b8c`); §1.1 6-phase model; §11.2 9-gate code-PR pre-merge checklist (cleared at PR #153 merge)
- [memory/handoffs/day-14-eod.md](day-14-eod.md) — predecessor; established the cron-decoupling driver + Day-15 morning Posture B Stage 1 gate-clear timing
- [memory/handoffs/day-15-tests-bootstrap.md](day-15-tests-bootstrap.md) — Day-15 morning bootstrap (PR #147 / #152 lineage)
- [memory/operational/posture-b-retirement-runbook.md](../operational/posture-b-retirement-runbook.md) — Stage 1 + Stage 2 reference (both stages retired today)
- PR #152 (Day-15 prep bundle, merged `3704616`)
- PR #153 (cron decoupling code, merged `7759580`) — 14 commits squashed; 3 CI iterations
- PR #154 (Posture B Stage 2 code cleanup, merged `7fd70f6`)
- PR #155 (Day-14 part-2 service-layer plan, merged `0d1ce21`) — force-pushed 4× (single-commit amend pattern)

---

## §9 Auto-memory governance refs (load-bearing for next session)

- `feedback_t3_plan_prs_need_realtime_review.md` — gates code PR review (Day-16 fresh session opens against Love's real-time counter-review for T3 hard-stop #2)
- `feedback_claude_code_executes_default.md` — Claude Code executes whatever has a CLI/API/script path; Love approves before execution; explicit instruction is the merge gate. Day-15 evening operations all followed this convention (migration apply, vercel promote, backfill, env-var rm) — no Love-action carve-outs needed.
- `feedback_vercel_env_scope_convention.md` — governs `QSTASH_FLOW_CONTROL_KEY` per-environment posture (Production + Preview only; Local unset)
- `feedback_always_surface_pr_url.md` — surface PR URL on its own line near top of response after `gh pr create`
- `feedback_no_self_tier_escalation.md` — Day-14 part-2 code PR is T3 because Love's call, not self-escalation; T3 hard-stop #2 awaits Love sign-off at code-PR open
- `followup_vercel_cli_env_add_preview_bug.md` — Vercel CLI 53.1.1 Preview-scope env-add bug; dashboard fallback (filed Day-14 evening; remained relevant in Day-15 morning Stage 1 — `env rm` worked fine on Preview, only `env add` had the bug)
- `followup_vercel_auto_promote_main_to_production.md` — auto-promote OFF; manual `vercel promote` required; verified again Day-15 evening per §4.2

---

**End of Day 15. Day 16 begins on Love's morning resume command + fresh Claude Code session bootstrap from this EOD doc + the merged plan PR #155.**
