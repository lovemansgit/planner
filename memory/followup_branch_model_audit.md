---
name: Branch-model audit — Day-10 priority (3 May 2026)
description: Four distinct branch-state-related issues surfaced across Days 8-9, all rooted in incomplete supporting infrastructure for the R-0-prep two-branch model. Audit (not fishing expedition) targets three layers — infrastructure / documentation / operator-mental-model — to confirm the model is fully aligned end-to-end. Decision boundary: R-0-prep stays (Option A/B/C is closed). Audit is procedural cleanup, batched, doesn't block Day-10 substantive work. If audit closes cleanly without surfacing additional issues, that's a clean result not a failure to find.
type: project
---

# Branch-model audit — Day-10 priority

**Captured:** 3 May 2026 (Day 9 EOD)
**Why this exists:** Four distinct branch-state-related issues surfaced across Days 8-9 that share a single root pattern. The model itself (R-0-prep's split between `main` preview and `production` live) is correct and the gate is justified, but supporting infrastructure and operator mental models aren't fully aligned with it. This audit closes that gap before more PRs hit the same friction.

---

## The four surfaced issues

1. **Auto-promote memo misdiagnosis (Day 9 morning).** The Day 8 EOD memo `followup_vercel_auto_promote_main_to_production.md` framed the manual-promote step as an operational gap to fix. Day 9 morning audit (counter-reviewer prompted) revealed the framing was wrong — the production branch exists by design per R-0-prep, and the memo's "Path A" mechanically described undoing R-0-prep without naming it. Resolved Day 9 morning via Option C two-lane policy decision.

2. **R-0-prep infrastructure was incomplete.** R-0-prep introduced the production branch model (27 April 2026) but the supporting infrastructure assumed main-as-production semantics throughout:
   - `ci.yml` workflow filter restricted to `branches: [main]` (didn't trigger on PRs targeting production)
   - Promotion runbook prescribed `git merge --ff-only origin/main` (structurally impossible after any backport-via-PR cycle)
   - SHA divergence between main and production wasn't anticipated at all
   - Direct-push to production was permitted at the time of `15c55e4` (R-0-prep era), creating a 6-day asymmetry that didn't surface until first promotion
   All three discovered + fixed in the Day 9 promotion-PR sequence (PRs #88, #89, #90, #92).

3. **Promotion-procedure-bypass via `vercel promote` (Day 8, three times).** The team used `vercel promote https://<preview-url>` to alias main-built deployments to the production URL three times on Day 8 (D8-4a, β filter, D8-5/D8-6 backend), bypassing the documented promotion-PR workflow entirely. Operating as if main → production was direct, despite the documented split. No PRs targeted production for ~6 days; the R-0-prep procedure was effectively dormant until the Day 9 first execution forced its evaluation.

4. **PR #93 → #94 close-and-reopen on a feature PR (Day 9 P4a).** Feature branch was created off production (left over from the promotion procedure) instead of main, producing `mergeable: CONFLICTING` and skipped CI runs. Symptom looked like the ci.yml branch-filter gap but root cause was the operator-mental-model layer — checking out main before branching wasn't a habit because the two-branch model wasn't yet routine. Captured in `memory/followup_promotion_runbook_branch_state_risk.md`.

## The pattern

Every interaction with the two-branch model has surfaced friction. The model is correct (R-0-prep's gate is justified by the R-0 BYPASSRLS-hole rotation) but supporting infrastructure and operator mental models aren't fully aligned with it. The audit's job is to surface remaining gaps before Day 10's substantive work hits more of them.

---

## Audit scope (three layers, no expansion)

### Infrastructure layer

- **CI workflows scoped correctly?** ci.yml fixed Day 9 (PR #92 added `production` to `pull_request.branches`). Check for any OTHER workflow files in `.github/workflows/` that have similar `branches: [main]`-only scoping that needs production added.
- **Branch protection rules aligned?** Day 9 morning audit set both branches' protection. Re-confirm no drift via `gh api repos/lovemansgit/planner/branches/{main,production}/protection`. Document the intentional divergence (linear-history requirement on production but not main) in the audit findings.
- **Env vars correctly scoped Production + Preview?** Audited Day 9 morning P2 (per `memory/feedback_vercel_env_scope_convention.md`). Re-confirm clean post-D8-8 + P4a work. The new `PUBLIC_BASE_URL` from P4a needs a Vercel scope check in particular.
- **Vercel project config matches documented topology?** Production Branch in Vercel dashboard = `production` per RUNBOOK.md. Auto-promote OFF stays appropriate per Option C decision. Verify via `vercel project ls` + `vercel inspect <production-deployment>` if needed.
- **grep across `.github/`, `docs/`, `scripts/`, `package.json` scripts** for any other "main" references that imply main-as-deployment-target. Possible patterns: hardcoded URLs to `planner-git-main-*.vercel.app`, scripts that assume HEAD on main = HEAD on production, build hooks that fire only on main-merge.

### Documentation layer

- **`docs/RUNBOOK.md` fully describes the two-branch model end-to-end?** Re-read under "Deployment topology" section. Confirm post-Day-9 amendments (ff-only drop, branch-state risk, ci.yml branch-filter fix) are reflected OR queued as docs-pass items.
- **`.github/workflows/promote-to-prod.md` reflects the amended ff-only-dropped flow + new branch-state risk?** Day 9 PR #89 amended the ff-only line; the branch-state risk amendment is queued for Day-10 docs-pass per `memory/followup_promotion_runbook_branch_state_risk.md`. Confirm both land.
- **`docs/BOOTSTRAP_NOTES.md` matches current reality?** R-0-prep notes were correct as of 27 April 2026. Cross-check that no Day-2-to-Day-9 changes have invalidated them.
- **Stale comments in code referencing pre-R-0-prep deployment assumptions?** D8-2 migration comment framing already filed (`memory/followup_d8_2_migration_comment_framing.md`). Sweep for others — particularly in audit_events emit code paths (which were authored when main was the production branch) and any cron / webhook receiver headers that mention "deployed to production via main."

### Operator-mental-model layer

- **Two-lane policy (T1 = Lane 2 no promote, T2/T3 = Lane 1 promotion-PR) documented?** Decided Day 9 morning during the auto-promote audit. Has not been written down in any persistent doc — only lives in this conversation's transcript and the auto-promote memo's amendment trail. Needs a section in RUNBOOK.md or a dedicated file.
- **"After promotion, checkout main before branching" rule documented?** Filed as memo today (`memory/followup_promotion_runbook_branch_state_risk.md`); not yet in the runbook. Day-10 docs-pass amendment.
- **Operator instincts from before R-0-prep that still bias toward main-as-production?** This is the hardest to audit empirically — surfaces only when an operator does something on muscle memory that violates the two-branch model. The first three issues are evidence the bias is real. Mitigation: explicit checkpoint reminders in the runbook + an instinct-reset note in BOOTSTRAP_NOTES.md.

---

## Audit OUT of scope

- **Reopening the Option A/B/C question.** Settled Day 9 morning. R-0-prep stays. The audit is closing remaining alignment gaps within the chosen model, not re-litigating the model.
- **Inventing new problems to find.** The four surfaced issues + the scope above are the corpus. If sweeps return nothing else, that's the answer.
- **Blocking Day 10 substantive work.** This is procedural cleanup, batched. Day 10 P2 (P4b Tier-2 creds) and P3 (D8-10 cascade-cancel) are substantive and should run in parallel with audit cleanup.

---

## Success criteria

- **Clean close:** if the three-layer sweep surfaces no new issues, document that explicitly and close the audit. Empty findings is a valid outcome — it confirms the four-issue corpus was complete and the post-Day-9 fixes are sufficient.
- **Surfaced new issues:** each gets its own followup memo + a recommended fix scope. Bundle Day-10 fixes into a single batched T1 + the docs-pass batch already queued.

---

## Time budget

~30-45 min for the three-layer sweep + write-up. If a single layer's sweep finds something requiring substantive code work, that becomes its own commit and the audit pauses pending sequencing — don't expand the audit scope mid-sweep.

---

## Cross-references

- `memory/followup_vercel_auto_promote_main_to_production.md` — the Day 8 misdiagnosed memo (issue #1)
- `memory/followup_promotion_runbook_first_execution_findings.md` — the three Day 9 findings (issue #2)
- `memory/followup_promotion_runbook_branch_state_risk.md` — the Day 9 P4a finding (issue #4)
- `memory/feedback_vercel_env_scope_convention.md` — env-scope convention to re-verify in infrastructure-layer sweep
- `memory/followup_d8_2_migration_comment_framing.md` — stale-comment finding to bundle in docs-pass
- `memory/followup_env_scope_s3_webhook_archive_prefix.md` — pre-existing env-scope drift to bundle in cleanup
- `docs/RUNBOOK.md` "Deployment topology" — the documentation-layer audit target
- `docs/BOOTSTRAP_NOTES.md` "Branch model" — the documentation-layer audit target
- `.github/workflows/promote-to-prod.md` — the documentation-layer audit target
- `.github/workflows/ci.yml` — the infrastructure-layer audit target (re-verify post-Day-9 amendment)
