---
name: Promotion runbook — first end-to-end execution findings (3 May 2026)
description: First end-to-end exercise of .github/workflows/promote-to-prod.md since R-0-prep (27 April 2026, 6 days prior). Surfaced THREE structural findings — (1) a 6-day SHA divergence on production from a direct-pushed R-0-prep operational commit, (2) ff-only constraint is structurally impossible to satisfy after any backport-via-PR cycle because cherry-pick + squash-merge create permanent SHA divergence even when content is equivalent, (3) ci.yml workflow doesn't trigger on PRs targeting production so production's required-status-checks protection couldn't satisfy. All three fixed in same Day-9 batch (PRs #88, #89, #90, ci.yml-amend). Pattern: R-0-prep introduced the branch model but supporting infrastructure was deferred; first execution surfaces it all at once.
type: project
---

# Promotion runbook — first end-to-end execution findings

**Captured:** 3 May 2026 (Day 9, post-D8-8 promotion-PR attempt)
**Trigger:** Day 9 P9 procedural cleanup — first execution of the documented `.github/workflows/promote-to-prod.md` procedure since R-0-prep (27 April 2026, 6 days prior). The execution surfaced three structural findings that drove an immediate runbook + CI amendment batch.

## The pattern across all three findings

R-0-prep (27 April 2026) introduced the `main` (preview) + `production` (live) branch model and the documented promotion procedure. But the **supporting infrastructure was deferred** — the runbook described an idealised flow, not an executable one given the project's other conventions:

- The runbook prescribed `git merge --ff-only` but didn't account for cherry-pick + squash-merge creating permanent SHA divergence (finding 2)
- The R-0-prep operational commit was direct-pushed to production with no backport plan (finding 1)
- The CI workflow was authored before R-0-prep introduced the production branch and was never updated to fire on PRs targeting it (finding 3)

**This deferred infrastructure work compounded over 6 days of "the runbook is documented; we'll execute it when needed."** First execution surfaced all three findings in sequence, each requiring its own reconciliation T1 PR. Future operators should expect this anti-pattern: long-deferred infrastructure that was "documented but never run" tends to surface multiple gaps on first execution, not one. Plan a buffer of T1 cleanup PRs into the first-execution timeline of any deferred procedure.

---

## Finding 1 — 6-day SHA divergence on production (R-0-prep operational commit)

**State observed at execution start:**
- `production` HEAD: `15c55e4 chore(deploy): trigger Production build after Vercel branch reconfig` (27 April 2026 — R-0-prep era)
- `main` HEAD: `e7bd2e8 D8-8 (T3): SuiteFleet webhook receiver hardening` (3 May 2026)
- `git log production..main`: **75 commits ahead** (Days 2-8 + D8-8)
- `git log main..production`: **1 commit ahead** (the R-0-prep `15c55e4`)

`15c55e4` was an empty commit (no file changes), made directly on `production` at R-0-prep time to force Vercel to rebuild after the branch model reconfiguration. It served its operational purpose, then sat on `production` for 6 days because it was never backported to `main` (no hotfix flow triggered it; it was a one-off direct-push that predated branch-protection lockdown).

## Finding 2 — Path α (cherry-pick to main + ff-only) was structurally wrong

**Initial reconciliation strategy (Path α):** cherry-pick `15c55e4` to `main` as a T1 backport (PR #88 → squashed at `a1d88be`), expecting `git merge --ff-only origin/main` to satisfy on the next attempt.

**Empirical result (probed on a throwaway `__test-ff-only-feasibility` branch):**
```
fatal: Not possible to fast-forward, aborting.
```

**Root cause:** Cherry-pick produces a NEW commit SHA on the backport branch (≠ the source `15c55e4` on production). Squash-merge of the backport PR creates ANOTHER new SHA on `main` (`a1d88be`). Result:
- `production`: ...c213cb2 → 15c55e4
- `main`: ...c213cb2 → ...75 commits... → a1d88be

`15c55e4` and `a1d88be` are **content-equivalent** (same author/date/message, both empty) but **SHA-divergent**. `git merge --ff-only` requires SHA-ancestor relationship, not content equivalence. The constraint cannot satisfy.

This is general — not a one-off — because:
- Cherry-pick + squash-merge ALWAYS produces SHA divergence
- The runbook prescribes cherry-pick for backports (hotfix flow PR B)
- The project convention is squash-merge everywhere
- Therefore: ff-only on the local prepare step can never satisfy after ANY backport-via-PR cycle

## Finding 3 — ci.yml branch-filter excluded production PRs

**Surfaced after the runbook amendment landed and the promote branch was pushed.** PR #91 (the actual promotion PR, base=production) showed only Vercel checks; the `lint + typecheck + test (unit)` check that production's required-status-checks protection demands never fired.

**Root cause:** `.github/workflows/ci.yml` (authored at PR #12, Day 1, before R-0-prep introduced the production branch model) had:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

The `pull_request.branches: [main]` filter restricts the workflow to PRs targeting `main`. PRs targeting `production` (i.e. all promotion PRs) are excluded — the workflow simply doesn't run.

But production branch protection (audit §4) requires both `Vercel` and `lint + typecheck + test (unit)` to be green. With the second check never firing, the promotion PR cannot satisfy protection. Squash-merge would be blocked.

**Fix landed:** add `production` to the `pull_request.branches` filter in the same Day-9 batch as this memo amendment. `push.branches` stays main-only because production never receives direct pushes (PR-merge only).

```yaml
on:
  pull_request:
    branches: [main, production]   # added: production
  push:
    branches: [main]
```

After the amendment merged to main, GitHub Actions re-evaluated checks on PR #91 — the workflow fired retroactively (no re-push needed; new workflow versions apply to existing open PRs).

**Why this matters generally:** any GitHub Actions workflow that gates a non-default branch's merges via required-status-checks must also be triggered for PRs targeting that branch. The pattern's symptom — "PR shows pending forever" — is hard to debug by reading the PR; you have to inspect the workflow file to see why it never started. Future runbook amendments adding new long-lived branches should sweep the workflow files at the same time.

## Why three rejected options were rejected

- **Path β — Force-push reset on `production` back to common ancestor `c213cb2`:** blocked by `allow_force_pushes: false` on production branch protection (per audit §4 of the auto-promote audit). Even if unblocked: highest-risk git operation; bad precedent for a first-execution.
- **Path γ — Use plain `git merge` (deviate from runbook silently):** rejected because deviating from a documented procedure on its first execution sets a freelancing precedent; the runbook should match the executed procedure, not the other way around.
- **Path δ — Defer the promotion indefinitely:** non-viable; D8-8 + 75 days of work need to land in production.

## Path C (chosen) — runbook amendment + executed-as-amended

Selected because the ff-only constraint was structurally broken from R-0-prep onward — the runbook was written before the squash-merge convention's interaction with cherry-pick was understood. Amending the runbook on first execution is the right moment; better than landing a deviation now and amending later.

**Runbook amendment landed:** PR #89, squash-merged at `c19691d`.

Three changes in the runbook:
1. Standard-flow step 2: `git merge --ff-only origin/main` → `git merge origin/main`
2. Hotfix-flow note: reframed to describe the merge-commit-on-promote-branch outcome rather than the (impossible) ff-only failure
3. New "Why not `--ff-only`" footnote citing this finding + cross-references

**No change to production branch protection.** Linear-history requirement on production is preserved by the **squash-merge of the promotion PR** (step 3), NOT by ff-only on the promote branch. These are independent mechanisms; the audit explicitly verified this in the discussion that drove Path C selection.

## What future operators should expect

When executing the documented procedure for any future promotion:

1. **Inspect `git log main..production` BEFORE running the local prepare step.** A non-empty list means SHA divergence exists. This is normal post-backport-via-PR. The amended runbook handles it via plain merge.
2. **The local promote branch will carry a merge commit.** This is ephemeral — the throwaway promote branch lives only until step 3's squash-merge collapses everything into a single clean commit on `production`.
3. **Do NOT attempt to force-push production to "fix" SHA divergence.** Branch protection blocks it (correctly). The squash-merge of the promotion PR achieves the same clean-history outcome without force-push risk.
4. **Real content conflicts (file edits in both trees) ARE worth surfacing.** The amended runbook calls these out as a stop-and-reconcile case distinct from harmless SHA divergence.

## Cross-references

- `.github/workflows/promote-to-prod.md` — the runbook, post-amendment (PR #89)
- `.github/workflows/ci.yml` — CI workflow, post-amendment (this PR)
- D8-8 PR #86 — the substantive PR that needed promoting and surfaced the divergence problem
- Backport PR #88 — Path α attempt; merged but did not resolve ff-only as expected
- Runbook amendment PR #89 — Path C reconciliation for findings 1+2
- ci.yml amendment + this memo append — Path A reconciliation for finding 3
- The 3 May 2026 promotion PR #91 — first execution of the amended procedure
- `docs/RUNBOOK.md` "Deployment topology" — branch model rationale (R-0-prep, 27 April 2026)
- `memory/followup_vercel_auto_promote_main_to_production.md` (audit findings) — adjacent: branch-model audit that established Option C two-lane policy
