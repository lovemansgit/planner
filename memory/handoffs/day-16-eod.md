---
name: Day 16 EOD handoff — Transcorp Subscription Planner pilot
description: 4 PRs merged Day 16 (#156 Day-15 EOD doc T1, #158 branch-protection path-exemption T1, #159 Day-16 plan-sync bundle T1, #160 part-2 service-layer code T3). Headline landing — PR #160 implements merged plan PR #155 across all six service surfaces (A subscription exceptions, B subscription lifecycle bounded pause + auto-resume cron, C consignee CRM transitions matrix, D merchant management, E address rotation + cross-consignee guard, F 11 API routes). 13 commits squashed; +312 unit tests (884 → 1196, +35.3%); 2 new integration spec files (§9.4 happy-path E2E + concurrent-idempotency); first CI run on the branch surfaced 3 pre-existing test-debt drifts in 2 specs (consignees + addresses NOT-NULL columns; tasks NOT-NULL columns; pause-resume manual-resume Dubai-side assertion) all hotfixed in the same PR. Service E rotation repository drift (TypeScript declared id/created_at columns absent from migration 0014) caught + hotfixed Block 4-G before any production caller hit it. Day-15 + Day-16 batched promotion completed (Posture B Stage 2 + part-2 service layer); production lag now 0. First 12:00 UTC cron tick under new materialization handler verified clean (4 of 4 cron-eligible tenants completed; target_date=2026-05-20). Day-17 unblocked; brief §6 day-by-day plan resumes with UI work (per-task timeline + consignee timeline + CRM state UI + address change workflows).
type: project
---

# Day 16 EOD Claude Code session handoff — 6 May 2026 (calendar Day 16 ≈ plan Day 18)

**For:** Fresh Claude Code session picking up from Day 16 close
**Repo:** `lovemansgit/planner`
**Read this entire document before responding.**

---

## §0 Product brief reference (load-bearing)

[`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) is at **v1.3** as of PR #159 (merged Day 16 morning, 07:43 UTC). v1.3's amendment was the `tenants.pickup_address_district`/`pickup_address_emirate` column-name canon alignment per `decision_brief_v1_3_amendment_pickup_address_canon.md`. **No further brief amendments today** — PR #160 implementation respects the existing brief envelope.

**Demo target unchanged: May 12.** Three days remaining (Day 17 → Day 19; demo Day 20 morning).

If this EOD doc conflicts with the brief, **the brief wins**.

---

## §1 Repo state at EOD

```
main HEAD:        061ec5b  feat(part2): T3 — service-layer surface (#160; squash-merge of 13 commits)
Production HEAD:  061ec5b  Day-15 + Day-16 batched promotion completed; 0 commits unpromoted
unit baseline:    1196 (post-merge; pre-Block-4 baseline was 824 at Day-15 EOD; +372 net Day-16 across all PRs)
integration:      21 spec files (was 19 at Day-15 EOD; +2 new from Block 4-G — exception-model-happy-path + concurrent-idempotency)
typecheck:        clean (verified pre-commit on every PR + post-merge)
lint:             clean (verified)
working tree:     clean tracked tree; 12 untracked followup memos pending Day-17 morning plan-sync bundle (see §7.1)
                    — these are the substantive Block 4 + earlier discoveries, deferred per Block 4-D Option 2 ruling
```

**Production lag:** **0 commits.** Both PR #154 (Posture B Stage 2, Day-15 unpromoted at Day-15 EOD time) and PR #160 (today's part-2 service layer) promoted via single `npx vercel promote` against the post-#160-merge build. Production deployment `dpl_EEJtUU9NVjSKZk1p6RF1sjAfpSUc` (alias `planner-olive-sigma.vercel.app`); 3-of-3 post-promote probes green.

**Branches outstanding at EOD:** none. PR #160 merged with `--squash --delete-branch`; the `day16/part-2-code` branch deleted from origin. PR #156, #158, #159 likewise merged with `--delete-branch`.

---

## §2 Day-16 PR ledger (chronological)

4 PRs merged today; 1 experimental PR CLOSED unmerged. Substantive ratio: 1 T3 + 3 T1.

| # | PR | Tier | Scope | Merge SHA | Merged at (UTC) |
|---|---|---|---|---|---|
| D16-1 | [#156](https://github.com/lovemansgit/planner/pull/156) | T1 | chore(memory): T1 — file Day 15 EOD handoff + index Day 15 section in MEMORY.md | `8005198` | 2026-05-06 04:06 |
| D16-2 | [#158](https://github.com/lovemansgit/planner/pull/158) | T1 | chore(infra): T1 — branch-protection path-exemption for docs-only PRs | `da2fb62` | 2026-05-06 07:12 |
| D16-3 | [#159](https://github.com/lovemansgit/planner/pull/159) | T1 | chore(memory): T1 — Day-16 plan-sync bundle (10 items) | `2f17bb3` | 2026-05-06 07:43 |
| D16-4 | [#160](https://github.com/lovemansgit/planner/pull/160) | T3 | feat(part2): T3 — service-layer surface (subscription exceptions + lifecycle + CRM + merchant + addresses + 11 routes) | `061ec5b` | 2026-05-06 17:42 |

**Plus this EOD doc** (T1, opens after surfacing).

PR #157 was an experimental Vercel CANCELED→GitHub-status mapping probe (`experiment(b2)`); CLOSED unmerged per its own "DO NOT MERGE" title — diagnostic-only artifact, not in the substantive ledger.

PR #160 is the headline. 13 commits squashed (the part-2 code PR landing the merged plan PR #155). Single CI iteration cycle from cold-start to green-merge:
- First CI run (run id `25451415056`, 57s integration job): RED with 2 pre-existing integration spec failures (NOT-NULL drift in consignees seed across `service.spec.ts` + `pause-resume.spec.ts`). Block 4-I Option 1 hotfix bundled the consignee + cascading addresses + tasks + assertion fixes into a single follow-up commit `c4598fb`.
- Second CI run (run id `25452277278`, 1m6s integration job): GREEN. All 4 checks pass. Squash-merged immediately.

PR #159 was the Day-16 plan-sync bundle — 10 items consolidating cron-decoupling drift items (§5.5 outcome enum 5→11, §7.2 401→403, §7.1 row 6 forward-override wording) plus Posture B runbook fixes plus 3 ephemeral-script fates plus the Day-16 morning brief amendment v1.3 (pickup_address column-name canon).

PR #158 was the branch-protection path-exemption — adds memory/ + docs/ + *.md path patterns to the bypass list so docs-only T1 PRs auto-merge after lint+typecheck without waiting for the integration suite.

PR #156 was the Day-15 EOD doc itself — lineage marker for this calendar day's work; merged at 04:06 UTC = 08:06 +0400 Dubai (early Day-16 morning).

---

## §3 Substantive code/scope landings — Day 16

### §3.1 PR #160 part-2 service-layer code — fully landed end-to-end

The headline substantive landing of Day 16. Implements merged plan PR #155 (`0d1ce21`, 881 lines / 11 sections) across all six service surfaces (A–F). Per Block 4-F mid-day handoff §2 (`memory/handoffs/day-16-block-4-f-mid.md`) for the per-block breakdown and Block 4-G integration coverage:

**Block 1 — pre-flight foundation (commit `d7fd9e9`):**

§10.5 `buildRequestContext` filter adds `AND tenants.status = 'active'` to `resolveUserContext`'s SELECT. Users on `provisioning`/`suspended`/`inactive` tenants resolve to `null` → `UnauthorizedError` → 401. Plan §5.2.3 verification gate cleared in code; the deactivateMerchant flow now has operator-visible effect via this filter.

**Block 4-B — Service A subscription exceptions (commit `9f576f9`):**

`addSubscriptionException` accepting all 5 type variants per merged plan §3 — `skip` (default, target_date_override, skip_without_append) + `address_override_one_off` + `address_override_forward` + REJECTs at entry for `pause_window` (Service B owns) + `append_without_skip` (dedicated `appendWithoutSkip` entry). Skip-permission split per plan §1 (`subscription:skip` vs `subscription:override_skip_rules`) via `resolveRequiredPermission` input-shape resolver. Wrapper around the Day-13 pure `skip-algorithm.ts:computeCompensatingDate` helper per the followup-memoized path-drift resolution. Sibling-module path `src/modules/subscription-exceptions/` per Day-13 PR #139 convention (NOT the plan's nested `src/modules/subscriptions/exceptions/` — drift captured in `followup_plan_path_drift_subscription_exceptions.md` §1).

**Block 4-C — Service B subscription lifecycle (commit `8b8614b`):**

Bounded `pauseSubscription` per brief §3.1.7 — explicit `pause_start` + `pause_end`, tasks-in-window UPDATE → `CANCELED`, end_date extension via the new pure `computePauseExtensionDate` helper (eligible-day walking, NOT calendar-day add per the path-drift Conflict 5 fix). `resumeSubscription` with `is_auto_resume?: boolean` discriminator — manual path requires `subscription:resume`; auto path runs as `cron:auto_resume` system actor (registered per `tenant-context.ts` SystemActor union). Auto-resume scheduler at `/api/cron/auto-resume` per plan §4.3 Option A (cron-based polling, every */15 minutes per `vercel.json`).

**Block 4-D — Service C + Service D (commits `ffc9943` + `8c52cfb`):**

Service C `changeConsigneeCrmState` extends `src/modules/consignees/service.ts` in-place (NOT a greenfield `crm/` subdir per the plan-path drift sibling). Transitions matrix at `src/modules/consignees/transitions.ts` with `canTransition(from, to, reason)` returning ok / invalid_transition / reactivation_keyword_required. CHURNED→ACTIVE keyword guard per plan §10.4 (case-insensitive substring "reactivation"). Service D `createMerchant` + `listMerchants` + `activateMerchant` + `deactivateMerchant` — greenfield `src/modules/merchants/` module; plan-strict from-states only (provisioning→active, active→inactive); 3 from-state expansions deferred to Phase 2 lifecycle bundle per `followup_merchant_lifecycle_transition_expansion.md`. `merchant.created` audit body — Option C nested `pickup_address: { line, district, emirate }` per registered metadataNotes; plan §2.1 + reviewer Gate 4 inherited drift; **§A REGISTERED-METADATA-WINS discipline rule** established here.

**Block 4-E — Service E address services (commit `92edee6`):**

`changeAddressRotation` at `src/modules/subscription-addresses/service.ts` (greenfield module). Cross-consignee address-ownership validation via shared `findAddressForConsignee` helper — Service A's `address_override_one_off`/`_forward` branches now also call this helper (per §B B1 cross-module integration; the only authorized cross-module internal-helper import in this PR). RLS scopes by `tenant_id` only; the helper catches the cross-consignee-within-same-tenant gap. `subscription.address_override.applied` registered metadataNotes drifts from Service A's actual emit shape — captured in `followup_audit_body_address_override_applied_drift.md` per the asymmetric §A application (when contract is under-specified relative to working code, fix the contract).

**Block 4-F — API routes (commits `5b2d3f2` + `50a6dff` + `6a3f3d1` + `6655276`):**

11 of 11 plan §6.1 routes operational. 9 net-new + 2 inherited from Block 4-C (pause + resume routes shipped with Service B):

1. `POST /api/subscriptions/[id]/skip` ✓
2. `POST /api/subscriptions/[id]/append-without-skip` ✓
3. `POST /api/subscriptions/[id]/pause` ✓ (Block 4-C inherited)
4. `POST /api/subscriptions/[id]/resume` ✓ (Block 4-C inherited)
5. `PATCH /api/subscriptions/[id]/address-rotation` ✓
6. `POST /api/subscriptions/[id]/address-override` ✓ (first codebase use of `z.discriminatedUnion`)
7. `POST /api/consignees/[id]/crm-state` ✓
8. `POST /api/admin/merchants` ✓
9. `GET /api/admin/merchants` ✓
10. `POST /api/admin/merchants/[id]/activate` ✓
11. `POST /api/admin/merchants/[id]/deactivate` ✓

Block 4-F established route-test patterns for the rest of the codebase: `vi.hoisted` for service-fn mocks (avoids TDZ-closure failures inside vi.mock factories), genuine v4-shaped UUIDs in fixtures (Zod 4 `.uuid()` rejects placeholder all-zeros), explicit inline object construction for missing-field tests, `z.discriminatedUnion` for branched body parsing, `z.string().date()` for ISO date validation, `rejectAnyBody` for body-less POST handlers, service-permission resolution staying at service layer (route does NOT pre-resolve).

**Block 4-G — integration coverage + Service E hotfix (commit `34ef963`):**

Two new integration spec files closing plan §9.3 rows 10/11/12 + §9.4 happy-path E2E:

- `tests/integration/exception-model-happy-path.spec.ts` (3 it blocks): §9.4 happy-path E2E with locked plan dates (Mon-Fri end Fri 2026-05-29, skip Wed 2026-05-13, expected new_end_date Mon 2026-06-01). First integration spec in the repo to use `vi.useFakeTimers({ toFake: ['Date'] })` — the `toFake: ['Date']` opt-in is precedent-setting for cron-handoff integration tests where the cron's 14-day horizon math collides with verbatim plan-locked dates. §9.3 row 10 rotation Mon→C cron Layer-3 re-materialization (with Phase-2 deferral preserved on already-materialized rows). §9.3 row 11 address-override one-off cron Layer-1 re-materialization for a future Wed beyond initial 14-day horizon.
- `tests/integration/subscription-exceptions/concurrent-idempotency.spec.ts` (1 it block): plan §9.3 row 12 + plan §7.4 — two parallel `addSubscriptionException` calls with the same idempotency_key resolve to one inserted + one idempotent_replay; same exception_id; one audit pair only. Covers either the SELECT-hit-first path OR the (theoretical) INSERT-23505-race path; FOR UPDATE serialization on the subscription row makes the SELECT-hit-first path dominant in practice.

Bundled Service E rotation repository drift fix in the same Block 4-G commit per reviewer Option 1 ruling: `src/modules/subscription-addresses/repository.ts:164-193` `selectCurrentRotation` was SELECTing `id, weekday, address_id, created_at` from `subscription_address_rotations` but the table per migration 0014 has only 4 columns (subscription_id, tenant_id, weekday, address_id). TypeScript layer was over-declared; mocked-repo unit tests never hit real Postgres so the drift was invisible at unit layer. Hotfix: 5-line repository SELECT trim + 2-field type trim. `service.ts:217-220` rotationsEqual logic only reads `(weekday, addressId)` so the trim is no-callers-affected. `followup_service_e_rotation_repository_drift.md` filed alongside.

**Block 4-I — CI hotfix (commit `c4598fb`):**

First CI run on the branch surfaced 3 pre-existing test-debt drifts that had been masked by the local Supabase environment (which had permissive existing data) but failed strictly on CI's fresh `postgres:17` service container:

1. `tests/integration/subscription-exceptions/service.spec.ts:135` consignees INSERT missing `address_line` + `emirate_or_region` + `district`. Per migration 0004 NOT-NULL constraints. Both columns added with realistic test values.
2. `tests/integration/subscription-exceptions/service.spec.ts:170` addresses INSERT missing `label`. Per migration 0014 NOT-NULL with CHECK `label IN ('home', 'office', 'other')`. Added `label='home'`.
3. `tests/integration/subscriptions/pause-resume.spec.ts:189-200` tasks INSERT missing `delivery_start_time` + `delivery_end_time`. Per migration 0006 NOT-NULL. Added `'09:00'`/`'18:00'` matching this spec's subscriptions seed delivery_window_start/end.
4. `tests/integration/subscriptions/pause-resume.spec.ts:313` manual-resume-past-pauseEnd test's resumeNow value changed `T23:59:00.000Z` → `T18:00:00.000Z` so Dubai-today (UTC+4) stays on pauseEnd day; service computes `actual_resume_date = computeTodayInDubai(now)` which the 23:59 UTC value pushed to pauseEnd + 1, contradicting the assertion at the next line. The 18:00 UTC = 22:00 Dubai keeps Dubai today on pauseEnd, satisfying the assertion's literal intent.

Block 4-I drift cascade was discovered iteratively: consignee fix → addresses + tasks NOT-NULL surface → assertion-bug surface. Per §A discipline, each cascade STOPped and surfaced for reviewer ruling before the next layer of fix. Three reviewer turns total to land all 4 fixes in one commit.

### §3.2 PR #159 plan-sync bundle (10 items)

Filed Day-16 morning before Block 4 began. Consolidates:

1-3. Cron-decoupling §5.5 + §7.2 + §7.1 plan-text amendments (5→11 outcome enum, 401→403 SDK convention, forward-override supersession wording).
4. Posture B runbook §1 P3+P4 occurred_at fix.
5. `posture-b-preflight-probe.mjs` ephemeral → durable header rewrite.
6. `post-deploy-verify.mjs` PROMOTE (durable header retained).
7. `apply-migration-0020.mjs` DELETED (single-use; migration applied + verified).
8. Brief v1.3 `pickup_address_*` column-name canon amendment.
9. Block 4-B+ followup memo lineage marker (the 6 followup memos surfaced during Block 4-B/4-C now indexed).
10. MEMORY.md Day 15 + Day 16 morning section indexing.

### §3.3 PR #158 branch-protection path-exemption

Adds memory/ + docs/ + *.md to the bypass list so docs-only T1 PRs auto-merge after lint+typecheck without waiting for integration. Unblocks fast iteration on EOD docs / followup memos / plan amendments.

### §3.4 PR #156 Day-15 EOD doc

Lineage marker — the day-15-eod.md handoff filed the night before but merged early Day-16 morning via T1 auto-merge.

---

## §4 Operations executed today

### §4.1 Day-15 + Day-16 batched promotion to production

- Triggered post-PR-#160 squash-merge (main HEAD `061ec5b` from 17:42 UTC).
- Source preview: `dpl_GNv4YY9B7a4oEauQSc6aMFhhQjp8` (`planner-2c67bqkq9-lovemansgits-projects.vercel.app`, alias `planner-git-main-lovemansgits-projects.vercel.app`); built 41s post-merge.
- `npx vercel promote https://planner-2c67bqkq9-lovemansgits-projects.vercel.app --yes --scope=team_qL4Wdxz0pjgyg1hWKus2Haj8` (team scope required; without it CLI errors `Deployment belongs to a different team`).
- New production deployment: `dpl_EEJtUU9NVjSKZk1p6RF1sjAfpSUc` at `planner-4gwlh6inc-lovemansgits-projects.vercel.app`. Production alias: `planner-olive-sigma.vercel.app`. Build duration 39s.
- Promote was a re-build (not alias-swap); confirmed via `data-dpl-id` attribute on live `/login` HTML.

### §4.2 Post-promote probes (3 of 3 green)

| Probe | Expected | Actual | Status |
|---|---|---|---|
| `GET /api/cron/generate-tasks` (no cron-secret) | 401 | 401 | ✓ — cron handler live |
| `GET /api/cron/auto-resume` (no cron-secret) | 401 | 401 | ✓ — Service B auto-resume cron live in production |
| `GET /login` | 200 + sign-in form | 200 + `<h1>Sign in</h1>` + email/password LoginForm | ✓ — §10.5 buildRequestContext filter shipped + Posture B Stage 2 cleanup didn't break login |

### §4.3 vercel.json cron entries verified

```
{ "path": "/api/cron/generate-tasks", "schedule": "0 12 * * *" }
{ "path": "/api/cron/auto-resume",    "schedule": "*/15 * * * *" }
```

Materialization cron (existing, established Day-14 cron-decoupling) at 12:00 UTC daily. **NEW auto-resume cron** at every 15 minutes — first cron tick under new handler awaits next */15 mark from EOD-doc filing time.

### §4.4 First 12:00 UTC cron tick under new materialization handler — VERIFIED CLEAN

Day-15 EOD §4.6 deferred verification gate cleared today. Query against production `task_generation_runs` for `started_at` window `[2026-05-06T11:00:00Z, 2026-05-06T13:00:00Z]`:

- **4 rows returned** (matches the cron-eligible-tenant filter — `suitefleet_customer_code IS NOT NULL AND <> ''`).
- **All 4 rows `status='completed'`.** Zero failed, zero capped, zero running.
- **All 4 rows `target_date='2026-05-20'`** = today (2026-05-06) + 14 days; matches plan §3.2 horizon math.
- **All 4 rows `tasks_created=0`** — expected: the established prod 845-consignee subs are already materialized through their respective horizons.
- All 4 rows share `window_start='2026-05-06T12:00:34.924Z'` — confirms a single cron invocation walked the 4 tenants sequentially per the per-tenant loop in `src/app/api/cron/generate-tasks/route.ts:161`.
- **One observation flagged for plan-sync candidate:** `completed_at` was ~6-8ms BEFORE `started_at` for each row, deterministic across all 4 tenants. Cosmetic; not a verification blocker. Captured in `memory/followup_run_row_completed_at_pre_started_at_drift.md` (filed alongside this EOD doc).

### §4.5 PR #160 promotion path

- 12 commits ahead of main at PR open (Block 1 + Block 4-B/C/D/E/F/G commits = 11 substantive + 1 handoff doc commit; Block 4-I added 1 more = 13 total at squash time).
- Squash-merge into `main` via `gh pr merge 160 --squash --delete-branch` after CI green.
- Merge SHA on main: `061ec5b`. New main HEAD on origin.
- Branch `day16/part-2-code` deleted from origin in same operation.

---

## §5 Day-17 plan + carry-forwards

Three-day countdown to demo:

### Day 17 (Sunday May 9, 2026 in plan; calendar today is May 6)

**Morning blocks:**

1. Fresh Claude Code session opens with bootstrap pointer to this Day-16 EOD + the merged plan PR #155 + brief v1.3.
2. T1 plan-sync bundle PR — now **13 items** (12 prior + 1 new run_row drift surfaced today; see §7.1). Files Day-17 morning per the established convention. Auto-mergeable post lint+typecheck per branch-protection path-exemption from PR #158.
3. Verify production state still clean: `gh pr list --state=open --repo lovemansgit/planner` should be empty (PR #160 merged); `npx vercel ls planner --scope=...` shows production matches main HEAD.

**Afternoon + evening blocks (per brief §6 day-by-day plan, Day 17):**

4. **Per-task delivery status timeline implementation PR.** Drawer or detail page surface — Created → Assigned → In transit → Delivered/Failed/Skipped lifecycle from cached webhook events. Per brief §3.3.6.
5. **Consignee timeline view implementation PR.** Tab on consignee detail page OR `/consignees/[id]/timeline` route. Reads from `consignee_timeline_events` view (database view computing chronological CRM + subscription + task events on read). Per brief §3.3.7.
6. **CRM state change UI.** Badge + transition workflow + history. Calls `POST /api/consignees/[id]/crm-state` (operational from PR #160). Per brief §3.3.2 + §3.1.4.
7. **Address change workflows.** One-off + forward-going from popover. Calls `POST /api/subscriptions/[id]/address-override` (operational from PR #160). Per brief §3.3.3.
8. Day-17 EOD batched promotion + EOD doc.

**All Day-17 UI work is now unblocked.** The data-flow foundation (services A-E + 11 routes) is live in production; Day-17 work composes against it.

### Day 18-19 (per [brief §6 day-by-day plan](../PLANNER_PRODUCT_BRIEF.md))

- Day 18: Brand pass + polish + demo data prep + `demo-preflight.sh`.
- Day 19: Pre-demo verification + dry-runs + slide deck.
- Day 20: Demo May 12 morning.

---

## §6 Test count delta vs Day-15

| Surface | Day-15 EOD | Day-16 EOD | Delta |
|---|---|---|---|
| Unit | 824 | 1196 | **+372 (+45.1%)** — Service A 36 + Service B 17 + Service C 40 + transitions 17 + Service D 29 + Service E 23 + skip-algorithm 38 + 9 route-handler files (skip + append + address-rotation + address-override + crm-state + admin merchants × 3 + auto-resume cron) ≈ +200 + boundaries/edges/regression-pins ≈ +172 |
| Integration | 19 | **21** | +2 spec files (exception-model-happy-path 3 it blocks + concurrent-idempotency 1 it block); existing 19 specs all green in CI |
| Typecheck | clean | clean | — |
| Lint | clean | clean | — |
| Spec files (unit) | ~71 | ~80 | +9 (route handlers + Service B/C/D/E modules + transitions) |

The 1196 unit baseline is canonical post-merge; verified twice today (Block 4-G and Block 4-I). Integration test files on disk: 21; of those, 21 pass in CI (single first-CI-run failure was the 2 pre-existing-drift specs which were hotfixed in Block 4-I; second CI run all green).

---

## §7 What's open / pending

| Item | Status | Owner |
|---|---|---|
| Plan-sync bundle T1 PR (13 items) | Awaits drafting in Day-17 morning | Day-17 fresh session |
| Day-17 UI work — per-task timeline + consignee timeline + CRM state UI + address change workflows | Day-17 fresh session unblocked by PR #160 | Day-17 fresh session |
| `subscription.rotation.changed` audit event (§10.6 brief default NO) | No action; default holds; brief §3.1.2 unchanged | n/a |
| `run_row` `completed_at`-pre-`started_at` cosmetic drift | Captured in new followup memo today; plan-sync candidate for Day-17 morning bundle | n/a |
| Phase 2 hardening items (admin middleware, auto-pause divergence, max_skips, configurable cut-off, merchant lifecycle 3 from-state expansion, etc.) | Phase 2 — not in MVP scope; documented in respective followup memos | Phase 2 |
| Service E `findAddressForConsignee` boundary cleanup (cross-module-internal-imports-forbidden rule + the §B B1 ruling carve-out) | Documented in module headers; no further action needed | n/a |

### §7.1 Plan-sync bundle composition (Day-17 morning)

13 items total. 12 carry-forward from Block 4 work + 1 new from today's verification:

**From Block 4-B (Service A, commit `9f576f9`):**
1. `followup_plan_path_drift_subscription_exceptions.md` — 5 sections covering Conflicts 1-5 (module path drift, computeCompensatingDate signature drift, Service B existing-implementation, system actor catalogue, end-date extension arithmetic)
2. `followup_correlation_id_v7_swap.md` — A1 deferral; v4 used; post-demo trigger
3. `followup_marktaskskipped_rowsaffected_disambiguation.md` — webhook-race edge

**From Block 4-C (Service B, commit `8b8614b`):**
4. `followup_auto_pause_vs_bounded_pause_divergence.md` — Phase 2 hardening: auto-pause stranded from auto-resume
5. `followup_pause_subscription_row_direct_test_gap.md` — pre-existing test debt surfaced
6. `followup_push_handler_route_header_undercount.md` — cosmetic 10 → 11 outcome enum count

**From Block 4-D (Service C/D, commits `ffc9943` + `8c52cfb`):**
7. `followup_audit_body_vs_plan_text_drift.md` — `merchant.created` 3-way drift; Option C nested wins per §A
8. `followup_merchant_lifecycle_transition_expansion.md` — Phase 2 lifecycle bundle (3 from-state expansions)

**From Block 4-E (Service E, commit `92edee6`):**
9. `followup_audit_body_address_override_applied_drift.md` — asymmetric §A: fix contract, not code

**From Block 4-F prep (commit `5b2d3f2` predecessor):**
10. `followup_admin_middleware_phase2.md` — brief §3.4 layer-1 gap; 3 compensating defenses
11. `followup_plan_section_6_3_unprocessable_error_drift.md` — 422 row drop; brief §3.1.8 unaffected

**From Block 4-G (committed; the hotfixed bug):**
12. `followup_service_e_rotation_repository_drift.md` — already on main; cited here for plan-sync bundle indexing

**From Day 16 §4.4 verification (today, filed alongside this EOD doc):**
13. `followup_run_row_completed_at_pre_started_at_drift.md` — completed_at ~6-8ms before started_at; deterministic; cosmetic

All 13 file paths live under `memory/`. The 12 prior memos remain untracked on the working tree at PR-open time per Block 4-D Option 2 ruling; the Day-17 plan-sync PR `git add memory/`s them all (plus this run_row memo) in one bundle.

---

## §8 Cross-references

- [PLANNER_PRODUCT_BRIEF.md](../PLANNER_PRODUCT_BRIEF.md) — v1.3 source of truth (PR #159 amendment)
- [memory/plans/day-14-part2-service-layer.md](../plans/day-14-part2-service-layer.md) — merged plan PR #155 (`0d1ce21`); 11 sections; 8 open-q defaults; §10.3 Option A locked; §10.4 CRM matrix locked; §11 12-gate pre-merge checklist all cleared at PR #160 merge
- [memory/plans/day-14-cron-decoupling.md](../plans/day-14-cron-decoupling.md) — merged plan PR #145 (`27c5b8c`); auto-resume cron handler in production now per §4.3 verification
- [memory/handoffs/day-15-eod.md](day-15-eod.md) — predecessor; §4.6 first-cron-tick deferred verification cleared today
- [memory/handoffs/day-16-block-4-mid.md](day-16-block-4-mid.md) — Block 4 mid-day pause (Service A + B done; C/D/E/routes pending)
- [memory/handoffs/day-16-block-4-f-mid.md](day-16-block-4-f-mid.md) — Block 4-F session-pause (all services + routes done; integration coverage + PR open + CI cycle pending)
- PR #156 (Day-15 EOD doc, merged `8005198`)
- PR #158 (branch-protection path-exemption, merged `da2fb62`)
- PR #159 (Day-16 plan-sync bundle, merged `2f17bb3`)
- PR #160 (part-2 service layer, merged `061ec5b`) — 13 commits squashed; 1 CI iteration cycle (Block 4-I hotfix); Block 4-G integration coverage included

---

## §9 Auto-memory governance refs (load-bearing for next session)

- `feedback_t3_plan_prs_need_realtime_review.md` — gated PR #160 review at code-PR open per T3 hard-stop #2; reviewer counter-review Turn A (clean) + Turn B (CI surfacing) + Turn C (cascade ruling) all real-time
- `feedback_claude_code_executes_default.md` — Claude Code executed all promotion steps (vercel promote with team scope, post-promote probes, SQL verification queries) — no Love-action carve-outs needed today
- `feedback_vercel_env_scope_convention.md` — `QSTASH_FLOW_CONTROL_KEY` Production + Preview only posture preserved; no env changes today
- `feedback_always_surface_pr_url.md` — surfaced PR #160 URL on its own line near top of response after `gh pr create`
- `feedback_no_self_tier_escalation.md` — PR #160 was T3 because Love's call (per the original Day-14 part-2 plan tier locking)
- **NEW Block 4-D §A REGISTERED-METADATA-WINS discipline** — registered `metadataNotes` at `audit/event-types.ts` is the contract for audit body shape; plan-text and reviewer rulings subordinate when conflicting with already-shipped registered contracts. Established Day-16 Block 4-D Service C/D Gate 4 ruling (Option C nested wins for `merchant.created`); applied symmetrically to Service A in Block 4-E (asymmetric: fix contract when code is the better reality). Triggered THREE times during Block 4-D/E/F catching real reviewer text-drift; rule active for all future audit-emit drafting.
- **NEW Block 4-D registered-source-vs-reviewer-text rule** — if reviewer drafting text drifts from plan + brief + registered metadataNotes + existing route convention on ANY detail (verb, status code, error class, enum value, body shape, SHA), builder STOPs and surfaces. Triggered Block 4-D Gate 4 (mixed-flat audit body), drafting-order item d (state-machine expansion), Block 4-F §D (PATCH vs POST verb on crm-state), Block 4-G drift cascades (4 distinct surface points), Block 4-I CI fix cascade (3 levels). Reviewer is fallible; registered/shipped contract is not.
- **NEW Block 4-E cross-module-internal-imports-forbidden rule** — shape-overlap alone is not justification for cross-module abstraction. Shared helpers exist for shared security/business invariants only. Two near-identical SELECTs > one premature abstraction. Authorized carve-out at §B B1 for `findAddressForConsignee` (security invariant: cross-consignee address-ownership gate is the same invariant whether called from rotation or address-override).
- **NEW Block 4-G integration-vs-unit coverage discipline** — integration tests against real Postgres are the regression-grade signal for repository-layer schema drift. Mocked-repo unit tests are NOT sufficient. Service E rotation repository drift (TypeScript declared columns absent from migration 0014) was invisible at unit layer (mocked repo); the Block 4-G integration spec at §9.3 row 10 surfaced it on first call against real Postgres. Rule: any new Service module's repository SELECT must execute against real Postgres at least once in the test surface.
- **NEW Block 4-G fake-timers integration-test precedent** — `vi.useFakeTimers({ toFake: ['Date'] })` (Date-only opt-in) is the safe pattern when an integration test needs to time-travel cron clocks while keeping postgres-js connection-timeout setTimeouts real. Established at `tests/integration/exception-model-happy-path.spec.ts` for the §9.4 verbatim-locked-dates case where the cron's 14-day horizon math collides with plan-locked `2026-06-01` future-tail-end materialization assertion.

---

**End of Day 16. Day 17 begins on Love's morning resume command + fresh Claude Code session bootstrap from this EOD doc + the merged plan PR #155 + brief v1.3.**
