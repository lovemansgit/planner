---
name: Promotion runbook — local branch-state risk after step 3 (3 May 2026)
description: After executing the documented promote-to-prod procedure, the local working branch sits on `production` (per `git pull origin production` in step 3). Returning to feature work requires explicit `git checkout main && git pull origin main` before branching, OR the new feature branch parents to production and produces SHA divergence from main that surfaces as `mergeable: CONFLICTING` on the PR — blocking CI from firing. Surfaced by the PR #93 → #94 close-and-reopen on Day 9 P4a. Runbook step 5 prescribes `git checkout main` but doesn't call out the branch-state risk explicitly. One-sentence runbook amendment for Day-10 docs-pass batch.
type: project
---

# Promotion runbook — local branch-state risk after step 3

**Surfaced:** 3 May 2026 (Day 9 P4a, PR #93 → #94 close-and-reopen)

---

## What happened

PR #93 (the original D9 P4a `/admin/webhook-config` commit) was opened with `mergeable: CONFLICTING` and `mergeStateStatus: DIRTY`. CI never fired (GitHub Actions skips workflows on conflicting PRs). Symptom looked the same as the ci.yml branch-filter gap from earlier in the day, but the root cause was different.

Investigation: `git log main..HEAD` on the feature branch showed three commits, two of which (`9283f19 promote: 2026-05-03 — D8-8...` and `15c55e4 chore(deploy): trigger Production build...`) were on `production` but not on `main`. The feature branch had been created off `production`, not `main`, so it carried the squashed promotion commit + the R-0-prep direct-push commit as base history.

Where that came from: the promotion procedure execution (PR #91) culminated in `gh pr merge 91 --squash --delete-branch` followed by `git checkout production && git pull origin production` to confirm the merge had landed on production locally. After that, when starting P4a work, `git checkout -b day9/p4a-admin-webhook-config-page` ran while still on production — making the new branch a child of production, not main.

## Why ff-merge attempts on a production-parented feature branch produce conflicts with main

Same root cause as the ff-only finding from earlier (`memory/followup_promotion_runbook_first_execution_findings.md` finding #2): the squashed promotion commit on production has a different SHA from the equivalent content on main (which was assembled from the individual PR commits). When a feature branch parented to production tries to merge into main, git sees:

- production-side commits (`9283f19`, `15c55e4`) that don't exist on main as ancestors
- main-side commits (the individual squash-merges of #87, #88, etc.) that don't exist on production as ancestors

Same trees, different SHAs, divergent histories — git reports the PR as `CONFLICTING`. GitHub Actions' default behaviour on conflicting PRs is to skip workflow runs.

Reconciliation: reset the feature branch to `origin/main` and cherry-pick just the feature commit on top. Force-push the reset (or, when force-push is denied, close the PR and reopen on a fresh branch). Cost: ~5 min + one closed PR + the cognitive overhead of debugging "why isn't CI firing?"

## How the existing runbook addresses this (and where it falls short)

`.github/workflows/promote-to-prod.md` standard-flow step 5 ("Clean up"):

```bash
git checkout main
git branch -D promote/<YYYY-MM-DD>-<short-summary>
git fetch origin --prune
```

The `git checkout main` line is correct in scope (delete the local promote branch, return to main) but it doesn't `git pull origin main` AND it doesn't call out the consequence of skipping it. An operator who's been heads-down in promotion-flow context can easily forget to checkout main before starting the next feature branch.

The hotfix flow has a similar implicit assumption — after the hotfix promotion + the backport-to-main flow, the local branch is in an undefined state depending on which checkout the operator landed on last.

## Recommended one-sentence amendment (Day-10 docs-pass batch)

Add to step 5's "Clean up" block, OR as a footnote at the end of the standard flow:

> *"Important: before starting any new feature branch, run `git checkout main && git pull origin main` even if you think you're already on main. After a promotion, the local working branch is `production` — branching from there parents the new branch to production, which causes `mergeable: CONFLICTING` on the resulting PR + skipped CI runs (see `memory/followup_promotion_runbook_branch_state_risk.md` for the 3 May 2026 incident)."*

Same sentence (or close to) in the hotfix-flow cleanup. Bundle with other Day-10 docs-pass amendments per `memory/followup_d8_2_migration_comment_framing.md`.

## Cross-references

- D9 PR #93 (closed) — the symptom case
- D9 PR #94 — the reopened-on-fresh-branch fix
- `memory/followup_promotion_runbook_first_execution_findings.md` — the ff-only / SHA-divergence findings that share root cause with this risk
- `.github/workflows/promote-to-prod.md` — the runbook this amendment targets
- `memory/followup_d8_2_migration_comment_framing.md` — Day-10 docs-pass companion (other comment-drift items batch with this)
