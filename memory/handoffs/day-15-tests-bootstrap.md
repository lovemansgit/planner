---
name: Day 15 — tests + code PR + part-2 plan + EOD promotion bootstrap
description: Bootstrap doc for the Day-15 fresh Claude Code session. Covers Posture B Stages 1+2 retirement (48h soak gate clears 06:11 +0400 Dubai), §7.1 + §7.3 + §7.4 test drafting on `day14/t3-cron-decoupling-code` (commit 71acf07; §7.2 already landed Day-14 evening), code PR open + merge + migration 0020 production apply + Vercel deploy verification + backfill script run, Day-14 part-2 plan PR (T3 service-layer surface), Day-15 EOD batched promotion. T1 followups deferred from Day-14 evening at §4. Repo state at main `59548c0`, branch tip `71acf07`.
type: project
---

**Outstanding branches:**
- `day14/t3-cron-decoupling-code` (commit `71acf07`, 11 commits ahead of main) — code feature-complete + §7.2 tests landed; awaits §7.1 + §7.3 + §7.4 tests, then PR open
- No other open branches

---

## §3 Day-15 scope

### §3.1 Morning blocks (sequential)

**Block 1 — Posture B Stage 1** (Love instructs; you execute)
- 48h soak gate clears 2026-05-06 06:11 +0400 Dubai
- You run `vercel env rm ALLOW_DEMO_AUTH production` and `vercel env rm ALLOW_DEMO_AUTH preview` on Love's go-ahead
- Verify via `vercel env ls`: ALLOW_DEMO_AUTH absent from both scopes
- Reference: `memory/operational/posture-b-retirement-runbook.md`

**Block 2 — Posture B Stage 2 PR drafts** (post-Stage-1 verification)
- Code-cleanup PR per runbook §6 Q4 default
- Remove `process.env.ALLOW_DEMO_AUTH` runtime gate from `src/shared/request-context.ts` and `src/shared/demo-context.ts`
- T2 — review-then-merge

**Block 3 — §7.1 + §7.3 + §7.4 test drafting on `day14/t3-cron-decoupling-code`**

§7.1 materialization cron tests (~13 plan rows) — DB-fixture-heavy:
- Subs + rotations + exceptions + materialization rows + run-row state machine
- 4 chunking-boundary cases (50/100/250/1001) per §7.1's batchJSON enqueue test (D7-2 rewrite)
- Each message carries deduplicationId: <task_id>, flowControl: { key: <env-var-resolved>, rate: 5, period: '1s' }, failureCallback: ${PUBLIC_BASE_URL}/api/queue/push-task-failed, retries: 3
- Estimated 2.5-3h
- Maps to §11.2 gate 9 + gate 7 partial

§7.3 migration 0020 tests (~6 plan rows) — postgres:17 fixture:
- Backfill correctness (N existing subs → N materialization rows post-migration)
- Dedup winning-row when multiple INSERTs collide on (tenant_id, target_date) UNIQUE
- BEGIN/COMMIT rollback shape
- Dual-UNIQUE preservation (existing (tenant_id, window_start, window_end) UNIQUE retained alongside new (tenant_id, target_date) UNIQUE)
- Estimated 1-1.5h
- Local integration test infra: scripts/setup-test-db.sh handles postgres:17. If local docker isn't available, run integration tests via CI only and surface that to Love.
- Maps to §11.2 gate 7 partial

§7.4 happy-path integration test (10-step E2E):
- Single end-to-end through materialize → batchJSON → push handler with mocked SF adapter
- Cycles: Phase 1 reconcile → Phase 2 bulk INSERT → Phase 3 horizon advance → Phase 4 run-row write → Phase 5 batchJSON enqueue → Phase 6 handler-exit summary; queue consumer at /api/queue/push-task processes message; markTaskPushed lands; assert end state
- Estimated 45m-1h
- Maps to §11.2 gate 7 partial

**Plan drift to fold into tests** (already surfaced Day-14 evening; pin actual code/SDK behavior, not stale plan text):
- §5.5 outcome enum: code emits 11 states, not the plan's 5 (route header explicitly amends)
- §7.2 rows 9+12: SDK returns 403 not 401 on signature failures (standard QStash convention)

If §7.1 / §7.3 / §7.4 tests have similar drift, surface and pin actual behavior; file a T1 plan-sync amendment after all §7 work lands.

### §3.2 Afternoon blocks

**Block 4 — Code PR opens**
- PR body: §11.2 9-gate checklist with each gate's evidence (test files, commit references)
- Gate 1: migration 0015 status (already applied per Day-14 EOD §4.1)
- Gate 2: `export const maxDuration = 300;` present (covered by §7.2 row 1 test)
- Gate 3: coupled-deploy verified (PR contains migration 0020 + handler rewrite together)
- Gate 4: stale-running CAS predicate present (covered by §7.5 row 1, deferred per merged plan; address via inline code review)
- Gate 5: demo timeline (within 5-day buffer; surface to Love)
- Gate 6: QSTASH_FLOW_CONTROL_KEY env-var configured (✅ DONE Day-14 evening per §11.2 row 6)
- Gate 7: §7 test coverage (819 + §7.1 + §7.3 + §7.4 deltas)
- Gate 8: §5.5 observability surface (covered by §7.2 row 10)
- Gate 9: §7.1 enqueue test asserts batchJSON shape (covered by §7.1 row D7-2)
- T3 hard-stop #2 — verification-only counter-review since plan-stage and implementation already counter-reviewed

**Block 5 — Code PR merges** (Love instructs)
- You run `gh pr merge <N> --squash --delete-branch`
- Branch protection bypass via `--admin` if Vercel-preview gate is the only blocker (per §10.6 watch-item from Day-14 EOD)

**Block 6 — Migration 0020 production application**
- You run `supabase db push` (or `psql $PROD_URL -f supabase/migrations/0020_*.sql`) on Love's go-ahead
- Coupled-deploy callout per merged plan §4.2 amendment 4: migration 0020 must land in same Vercel deploy window as the new handler — migration-only deploy without handler swap = production cron breaks at next tick (NOT NULL on `target_date` breaks legacy `task-generation/service.ts:223` INSERT path)

**Block 7 — Vercel deploy + verification**
- Confirm new handler is live via probe of `/api/cron/generate-tasks` route shape

**Block 8 — Backfill script run**
- You run `npm run backfill-subscription-materialization -- --yes=true` on Love's go-ahead
- Smoke-tested dry-run at Day 14 close: 860 active subs / 0 existing materialization rows

**Block 9 — Day-14 part-2 plan PR drafts**
- T3 plan PR for service-layer surface: addSubscriptionException with all override variants, pauseSubscription bounded, resumeSubscription with auto-resume scheduler, changeConsigneeCrmState, createMerchant + activate/deactivate, appendWithoutSkip, address rotation + override services
- Sequenced AFTER cron-decoupling lands per merged plan §8.1

### §3.3 Evening blocks

**Block 10 — Day-15 EOD batched promotion**
- 17 commits behind production at Day-14 close + whatever lands today
- You run `git checkout production && git merge main && git push` (or runbook's exact incantation per `followup_promotion_runbook_first_execution_findings.md` + add/add conflict pattern + `-X theirs` finding)
- Love approves promotion

**Block 11 — Day-15 EOD doc** + project-file refresh

---

## §4 T1 followups deferred from Day-14 evening

File these tomorrow as a small bundle PR:

1. **Plan-sync amendment** — reconcile `memory/plans/day-14-cron-decoupling.md` §5.5 (5-outcome enum → 11) and §7.2 rows 9+12 (401 → 403) against actual code/SDK behavior
2. **Server-only mock convention memo** — capture the new test pattern (mocking `server-only` to no-op in route handler tests) so future test sessions don't re-derive
3. **Branch protection vs docs-only PRs** — refine rules per §10.6 watch-item (path-based exemption for `memory/**`, `docs/**`, `*.md` changes); 30-min look in a quiet pocket

Sequence: file these AFTER §7.1 + §7.3 + §7.4 tests land so any additional plan drift from those sections folds into the same plan-sync amendment.

---

## §5 Communication contract with Love

- Brevity is the contract — no padding, no option menus unless a genuine call is required
- Builder prompts always in fenced code blocks under "PASTE TO CLAUDE CODE:" header (Love copy-pastes from reviewer to you; reviewer's prompts come pre-formatted)
- Load-bearing reasoning included; explanatory framing omitted
- "DECISION NEEDED:" label only for genuine decisions Love must make
- Schema/wire/security/audit decisions get full friction; editorial polish gets lighter touch

---

## §6 Reviewer pairing

Love runs a parallel reviewer session on claude.ai. Reviewer:
- Counter-reviews substantive PRs (T2 verify-at-open, T3 hard-stop twice — at plan and at code)
- Drafts builder prompts for Love to paste back to you
- Maintains institutional memory across session boundaries

You do NOT counter-review your own work; reviewer holds that role. You execute, surface diffs/output for review, wait for approve, then commit/push/merge.

---

## §7 First-action checklist for fresh session

When Love sends first instruction:

1. Confirm bootstrap reading complete (5 files in §0 absorbed)
2. Surface current git state: `git checkout main && git pull && git status` then `git log -1 --oneline` (expect `59548c0`); `git checkout day14/t3-cron-decoupling-code && git pull` then `git log -1 --oneline` (expect `71acf07`); `git checkout main`
3. Acknowledge per brief §10 protocol
4. Stand by for Love's first move (likely: run Posture B Stage 1, OR start §7.1 test drafting, OR something Love decides)

**Do NOT begin substantive work without Love's first instruction.** First-action is bootstrap absorption + git state surface only.

---

**End of Day-15 bootstrap.**
