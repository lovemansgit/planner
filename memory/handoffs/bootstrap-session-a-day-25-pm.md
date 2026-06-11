# Session A — Day-25 PM bootstrap

**Filed:** Day-25 PM (13 May 2026), context-fade handoff at ~40%.
**Read at fresh-session start.**

## Day-25 session state at handoff

- **Main HEAD:** `1c5922f` — `feat(d25-detail): admin merchants detail page + webhook URL surface (T2 code-PR, §3.6 round 2) (#271)`
- **Brief on main:** **v1.13** (landed via #268; previous v1.12 came in via #261 earlier today)
- **CI status on main:** **GREEN** as of last check (post-PR-#269 teardown fix). Both unit + integration pass; Vercel Preview Comments + Production builds successful.
- **Production deploy:** `dpl_DKPTBBapBVpcy4TqKFGiU79sKM8X` (deploy URL `planner-cpvwhy1y4-...`) — promoted to Production today against HEAD `484e2a4`. Canonical alias `planner-olive-sigma.vercel.app`. Auto-promote remains OFF (`followup_vercel_auto_promote_main_to_production.md`); a follow-up Vercel promote against `1c5922f` may be needed if Session B hasn't already run it.

### PRs merged today

**Session A's lane chain (this session):**

| PR | Title | Tier |
|---|---|---|
| [#261](https://github.com/lovemansgit/planner/pull/261) | brief v1.12 amendment — decouple consignee + edit merchant | T1 |
| [#263](https://github.com/lovemansgit/planner/pull/263) | plan: decoupled consignee creation + ad-hoc task | T3 |
| [#266](https://github.com/lovemansgit/planner/pull/266) | code: decoupled consignee creation + ad-hoc task | T3 |
| [#267](https://github.com/lovemansgit/planner/pull/267) | followup memo on T3 plan-then-code branch sequencing | T1 |
| [#269](https://github.com/lovemansgit/planner/pull/269) | integration spec teardowns + tenant-consignees-count phone overlap | T2 |

**Session B's lane chain (parallel session, partial visibility):**

| PR | Title | Tier |
|---|---|---|
| [#262](https://github.com/lovemansgit/planner/pull/262) | plan: edit merchant surface | T3 |
| [#264](https://github.com/lovemansgit/planner/pull/264) | code: Edit Merchant surface | T3 |
| [#268](https://github.com/lovemansgit/planner/pull/268) | §3.6 review-discipline CI gate + brief v1.13 | T1 |
| [#270](https://github.com/lovemansgit/planner/pull/270) | plan: admin merchants detail page + webhook URL surface | T2 |
| [#271](https://github.com/lovemansgit/planner/pull/271) | code: admin merchants detail page + webhook URL surface | T2 |

## Discipline carry-forward (load-bearing for next session)

Each item below has a memo on main. **Read the memo, not just this list.** Order is freshness, newest first.

1. **§7.1 v1.13 CI gate on §3.6** (PR #268, today) — §3.6 review verdicts are now gated on CI green. No verdict-without-CI-check. Filed at `memory/decision_review_discipline_ci_gate.md`. Surfaced after both PR #266 and PR #267 merged with red CI undetected — this rule is the structural fix.

2. **§3.6 plan-then-code branch sequencing fragility** (PR #267, today) — `gh pr merge --delete-branch` on a plan-PR auto-closes the dependent code-PR if the code-branch's base ref is the plan branch. Plan-PR §0 must select sequencing posture (Option A: fork code off main + cherry-pick plan deltas; Option B: plan merges with `--delete-branch=false`). Filed at `memory/followup_t3_plan_code_branch_sequencing.md`.

3. **Audit-rule cascade teardown canonical pattern** (PR #269, today) — `audit_events_no_delete` RULE blocks DELETE FROM tenants whenever child audit_events exist. Canonical teardown pattern is try/catch wrap that swallows the rule-induced failure; test tenants leak but random per-run UUIDs prevent collision. Load-bearing 🔴 header now at the top of `memory/followup_audit_rule_cascade_conflict.md` with copy-paste skeleton + anti-patterns + 8 working-precedent specs. Read at session start before writing any integration spec.

4. **§A audit-event metadataNotes precedence** (Session B's lane today) — captured in PR #268 / #270 / #271 area. Don't have direct visibility; check `memory/` for any new `decision_*` or `followup_*` memo filed alongside brief v1.13. Likely codifies how `metadataNotes` differentiates same-event-type variants for forensic queries.

5. **Day-24 §E shell verification for cross-route-group nav** — adding a nav entry that crosses route groups requires verifying the target route renders under the EXPECTED shell, not just that the route 200s. Standing rule per Day-24 EOD §E. Continues to apply.

6. **Day-23 §F integration spec at PR-open** — every new SQL path lands an integration spec alongside the unit spec at PR-open time, not as follow-up. Standing rule per Day-23 EOD §F. Continues to apply.

## Day-25 product / architecture decisions made (key learnings to carry)

### Decoupled consignee from subscription (brief v1.12, PR #266)

Wizard at `/consignees/new` removed. Flat form (Identity + Address sections, single submit) replaces it. New `createConsignee(ctx, { identity, address })` service writes consignees + addresses atomically (consignee + primary address only — no subscription). Operator lands on `/consignees/[id]` Overview tab where Create-subscription + Add-ad-hoc-task CTAs surface.

New `createAdHocTask` service wraps existing `createTask` with tenant-scoped primary-address pre-resolve + post-commit QStash enqueue (optimistic-ack pattern). `AdHocTaskDialog` modal (hand-rolled, mirrors `MerchantStatusModal`) is the operator surface for one-off task creation. Amber NO TASKS pill on `/consignees` list rows where `taskCount === 0`.

Audit event reuse: `createAdHocTask` emits existing `task.created` (not new `task.ad_hoc.created`); `metadata.created_via='manual_admin'` + `actor_kind='user'` differentiate.

### Edit-merchant surface added (brief v1.12, Session B PR #264)

New `/admin/merchants/[id]/edit` route + `updateMerchant` service + `merchant:update` permission (transcorp-sysadmin only). Slug-change warning dialog. EDIT row action on `/admin/merchants` list.

### Read-only merchant detail page added (Session B PR #271)

New `/admin/merchants/[id]` route (read-only) + webhook URL surface for operator copy-paste during Aqib registration handoff. Companion to the EDIT and ACTIVATE/DEACTIVATE row actions.

### §3.6 round-1 rulings made during my T3 chain (PR #263 → #266)

10 OQs resolved in the plan-PR §3.6 round-1 verdict. Highlights for forward-compat:

- **OQ-1** — Existing `createConsignee` REPLACED (not alongside); brief naming canon wins.
- **OQ-3** — Schema canon `internal_status='CREATED'` for ad-hoc tasks; the v1.12 amendment's `'SCHEDULED'` reference was a prompt typo.
- **OQ-5** — NO TASKS LEFT JOIN + GROUP BY (cheaper at scale than subquery).
- **OQ-10** — Hand-rolled modal pattern (mirrors `MerchantStatusModal`); no Radix Dialog import.

Three FINDINGS (NEEDS-FIX) applied as fix-ups to the plan-PR:

- **F1** — `createAdHocTask` tenant-scoping clarification (primary-address SELECT runs in `withTenant` block before `createTask` delegation which uses `withServiceRole`).
- **F2** — Audit-event reuse decision (above; reuse `task.created` not `task.ad_hoc.created`).
- **F3** — Exact NO TASKS rendering surface enumerated as `ConsigneesTable.tsx` (rows inline, no separate Row component file).

## Production state at handoff

- **Tenants:** MPL=588, DNR=586, FBU=578, Demo Bistro=591 — all on sandbox region (`transcorpsb`) via env-backed credentials. No per-tenant secret in DB yet.
- **Demo Bistro status:** **`active`** (flipped from `provisioning` today; previous bootstrap noted Chapter-2 live-create as the demo narrative, but on-stage state was advanced today during testing).
- **Production deployment:** current with main as of `dpl_DKPTBBapBVpcy4TqKFGiU79sKM8X` (HEAD `484e2a4`). Newer main commits (`1c5922f`) may or may not be promoted — verify with `vercel ls planner --scope=lovemansgits-projects --prod` at session start.
- **Auto-promote:** OFF. Every merge to main needs a manual `vercel promote <dpl-id> --yes --scope=lovemansgits-projects` to land in Production. Inspect-then-promote pattern remains.

## Critical in-flight context

### Brief v1.14 amendment NOT YET DRAFTED

Incoming lane for fresh session: per-merchant SF credentials + multi-region resolver (T3, large surface). Architecture locked, plan-PR scope drafted by reviewer (you). Expect a `===AMENDMENT===` + `===LOG-ENTRY===` block delivered at session start similar to the v1.12 amendment pattern.

### Aqib query pending — BLOCKS code-PR

Aqib (SuiteFleet vendor contact) has been asked about per-merchant SF API Key + Secret Key auth header shape. Love is firing the message. **Reply blocks the code-PR for the next lane.** No code-PR can open until Aqib confirms the auth header convention. T3 plan-PR can still open and self-review §3.6; code-PR holds.

### Next T3 lane — per-merchant SF credentials + multi-region resolver

- Touches `src/modules/credentials/suitefleet-resolver.ts` (post-A1 Day-18 design lives here).
- Brief §3.6 v1.7 amendment is the current architectural model — three identifier layers (region `client_id` env-backed / merchant `customerId` DB-backed / AWB prefix `customer.code` cosmetic). v1.14 will add per-merchant API Key + Secret Key alongside `customerId`.
- AWS Secrets Manager swap (`followup_secrets_manager_swap_critical_path.md`) is a follow-on; v1.14 may or may not include it.
- Expect a plan-PR with 11+ sections similar to Day-14 cron-decoupling. Plan §0 must select sequencing posture (Option A / Option B per `followup_t3_plan_code_branch_sequencing.md`).

## Communication rules (carry forward)

- **Brevity first.** Layman terms for product questions. Senior-dev terms only when implementation-specific.
- **All session prompts in fenced code blocks** with `[Session A]` as the first line. Bootstrap briefs are an exception (verbose context-dump filing).
- **`DECISION NEEDED:`** prefix only for genuine Love calls. Otherwise propose + execute.
- **CI status reported alongside local test signal** per §7.1. Local unit pass is not sufficient evidence — surface the CI verdict from the PR's `gh pr view --json statusCheckRollup` query before claiming "green."
- **PR URLs on their own line near the top** of any response that opens or merges a PR (one-click share for reviewer).
- **Force-push needs pre-authorization** (`feedback_force_push_requires_pre_authorization.md`). If a rebase + force-push becomes necessary during a merge sequence, surface BEFORE acting — even `--force-with-lease`.
- **Parallel sessions use git worktrees** (`feedback_parallel_sessions_use_git_worktree.md`). Never plain `checkout -b` on a busy lane.

## Session-start checklist

When the fresh Session A picks up:

1. Read this brief end-to-end.
2. `git fetch origin && git log --oneline origin/main -10` — verify main HEAD matches `1c5922f` or later.
3. `gh pr list --state=open --repo lovemansgit/planner` — surface any in-flight PRs (Session B may have something open).
4. Read the 6 load-bearing memos enumerated under "Discipline carry-forward." Skim, don't deep-read; the rules are short.
5. Brief v1.13 on main at `memory/PLANNER_PRODUCT_BRIEF.md` — verify version + skim §3.6 + §7.1 (the new CI gate clause).
6. Wait for Love's next-lane prompt before opening any PR. Don't infer the v1.14 amendment from this brief — Love delivers the exact `===AMENDMENT===` block at session start.

---

End of Day-25 PM bootstrap. Standing down to context fade.
