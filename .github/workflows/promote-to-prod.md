# Promote to production — manual procedure

> **This is a Markdown doc, not a GitHub Actions workflow.** It lives in
> `.github/workflows/` for proximity to `ci.yml` so reviewers see it next
> to the pipeline that produces the artifact being promoted. GitHub Actions
> ignores `.md` files in this directory — there is no automation triggered
> by this file.

Promotion from `main` → `production` is **deliberately manual**. Every change
to the public Vercel URL passes through a human's hands. See `docs/RUNBOOK.md`
under "Deployment topology" for the rationale and branch model.

---

## Standard promotion (the 90% case)

Use when one or more PRs have landed on `main`, the preview URL has been
validated, and the team is ready to ship.

### 1. Verify `main`'s preview is green and signed off

- GitHub Actions CI on `main` is green (most recent commit).
- Vercel preview deployment for `main` is `Ready`. The URL pattern is
  `planner-git-main-lovemansgits-projects.vercel.app`.
- A human has opened that URL and exercised the changes (the relevant
  `/hello` panels for infra changes, the changed feature for product
  changes).

If any of those is not true, fix before promoting. Promotion is not the
forcing function for validation.

### 2. Open the promotion PR

```bash
git checkout production
git pull origin production
git checkout -b promote/<YYYY-MM-DD>-<short-summary>

# Pre-merge precondition (LOAD-BEARING — see "Why -X theirs" footnote):
git fetch origin
git log origin/main..origin/production --oneline
# Expected: empty, OR only prior squash-merged promotion commits, OR
# the known R-0-prep direct-push commit `15c55e4`. If anything else
# appears (hotfix, divergent work), STOP and surface to a reviewer.

git merge -X theirs origin/main --no-edit  # see "Why -X theirs" footnote below
git push -u origin promote/<YYYY-MM-DD>-<short-summary>
gh pr create --base production --head promote/<YYYY-MM-DD>-<short-summary> \
  --title "promote: <YYYY-MM-DD> — <summary>" \
  --body "$(cat <<EOF
Promotes the following commits from main to production:

\`\`\`
$(git log --oneline production..main)
\`\`\`

## Pre-promotion checklist
- [ ] CI green on main
- [ ] Vercel preview on main URL exercised by a human
- [ ] No open issues blocking promotion
- [ ] Migrations (if any) already applied to production Supabase

## Rollback
- See "Rollback" section below.
EOF
)"
```

The merge produces a merge commit on the local promote branch when
`production` and `main` have diverged in SHA terms (the common case
after any backport-via-PR — see footnote). The merge commit is
ephemeral — it lives on the throwaway promote branch only. Step 3's
squash-merge of the promotion PR collapses everything into a single
clean commit on `production`, preserving the linear-history
requirement on the production branch.

`-X theirs` (the merge strategy option) is required for second-and-
subsequent promotions because file-level add/add conflicts arise on
every file modified by post-promotion main commits — production's
HEAD is a squash-commit and main's HEAD reconstructs the same content
via per-PR squashes plus new feature work. `-X theirs` resolves these
add/adds in main's favor, which is safe by construction when the
precondition check above passes (production has no contradicting work
beyond prior squash-merged promotions or known content-equivalent
direct-push commits). Full reasoning + safety analysis in
`memory/followup_promotion_runbook_addadd_conflict_pattern.md`.

If the merge surfaces conflicts where BOTH halves of the conflict
markers contain non-empty content (i.e. real semantic disagreement,
not the empty-vs-content add/add pattern), `-X theirs` would silently
overwrite production-side changes. Stop and surface to a reviewer
before resolving — this means a backport went sideways or a hotfix
wasn't fully reconciled.

### 3. Review and merge

- Verify the commit list in the PR body matches what was intended.
- Wait for GitHub Actions CI to pass on the promotion PR.
- Merge with **squash** to keep `production`'s history a clean sequence of
  promotion events. The squashed commit message should be the PR title.

### 4. Validate the production deployment

- Vercel comment on the merged PR shows the Production deployment URL.
- Open the public URL (currently `planner-olive-sigma.vercel.app`).
- Run the same exercise that was done on the preview in step 1.
- Watch Sentry for the next 5 minutes. New error volume above baseline =
  pause and investigate before doing more work.

### 5. Clean up

```bash
git checkout main
git pull origin main                             # ← CRITICAL: see note below
git branch -D promote/<YYYY-MM-DD>-<short-summary>
git fetch origin --prune
```

Promotion branches are throwaway — Vercel keeps the deployment record in
its own history.

**Important: before starting any new feature branch, the `git pull origin
main` line above is load-bearing.** After step 3's squash-merge, the local
working branch is `production` (per the `git pull origin production` in
step 4 validation, or by leftover state from this procedure). Branching
from `production` for new feature work parents the branch to production
instead of main, which causes `mergeable: CONFLICTING` on the resulting
PR + skipped CI runs (per the 3 May 2026 PR #93 → #94 close-and-reopen
incident captured in `memory/followup_promotion_runbook_branch_state_risk.md`).
The explicit `git checkout main && git pull origin main` resets local
state to a clean main HEAD before the next feature branch starts.

---

## Hotfix (the 10% case)

Use when production is broken and the fix cannot wait for the normal flow
through `main`.

### 1. Branch from `production`, not `main`

```bash
git checkout production
git pull origin production
git checkout -b hotfix/<YYYY-MM-DD>-<short-summary>
```

This guarantees the hotfix only contains the change being made, not any
in-flight work on `main`.

### 2. Make the smallest possible fix

A hotfix is a tactical patch, not a redesign. Resist scope expansion.

### 3. Open TWO PRs in parallel

- **PR A — to `production`** for the immediate fix:
  ```bash
  gh pr create --base production --head hotfix/<YYYY-MM-DD>-<short-summary> \
    --title "hotfix: <one-line description>" \
    --body "<root cause + scope of fix + Sentry/log link>"
  ```
- **PR B — to `main`** for the same change, so `main` and `production` re-converge:
  ```bash
  git checkout main
  git pull origin main
  git checkout -b backport/<YYYY-MM-DD>-<short-summary>
  git cherry-pick <hotfix-commit-sha>
  git push -u origin backport/<YYYY-MM-DD>-<short-summary>
  gh pr create --base main --head backport/<YYYY-MM-DD>-<short-summary> \
    --title "backport: <same one-line>" \
    --body "Backports hotfix #<PR A number> from production to main."
  ```

Merge PR A first (production gets the fix), then PR B (main re-converges).
PR B's cherry-pick + squash-merge to `main` produces a content-equivalent
but SHA-divergent commit relative to PR A on `production` — the next
promotion PR's local prepare step will surface that divergence as a
merge commit on the promote branch (see "Why not ff-only" footnote).
That's expected; the squash-merge of the promotion PR collapses it away.

### 4. Validate, then audit

Same Sentry watch as standard promotion. After the smoke clears, write a
post-incident note (informal — not a full retro): what broke, what was
shipped, what the standard-flow miss was that let this need a hotfix in
the first place.

---

## Rollback

Vercel keeps every deployment. If the most recent production deployment is
bad and there is no obvious code fix:

1. Vercel dashboard → Project → Deployments → find the last known-good
   Production deployment → click `⋮` → **Promote to Production**.

2. Open a follow-up PR to `production` that reverts the bad commit so the
   git tree matches what's serving traffic. Without this step, the next
   promotion PR will silently re-introduce the rolled-back code.

3. Backport the revert to `main` (same two-PR pattern as Hotfix).

Rolling back is fast (Vercel re-promotion is seconds). The slow part is
reconciling git state — do not skip it.

---

## Footnote — Why `-X theirs` on the local prepare step

**Captured 3 May 2026 (Day 9 EOD second-promotion finding #5).**

Plain `git merge origin/main` (the prior amendment from Day 9 morning) handles SHA divergence at the **commit** level (no fast-forward needed) but produces add/add conflicts at the **file** level on every file modified by post-promotion main commits. Production's HEAD is a squash-commit; main's HEAD reconstructs the same content via per-PR squashes plus new feature work; git can't auto-resolve.

`-X theirs` tells git to favor the **incoming** side on add/add conflicts. In the promotion context, incoming = `origin/main` = the new content being promoted. By construction (verified by the precondition check), production has no contradicting work beyond prior squash-merged promotions or known content-equivalent direct-push commits — so `-X theirs` can't silently overwrite anything because there's nothing to overwrite.

**Precondition (LOAD-BEARING):** `git log origin/main..origin/production --oneline` must return empty, OR only prior squash-merged promotion commits (`promote: <date> — ... (#XX)`), OR known content-equivalent direct-push commits (the R-0-prep `15c55e4` is the only such commit as of Day 9). If the output contains anything else — a hotfix that wasn't backported, a manual direct-push during incident response, divergent feature work — `-X theirs` is **NOT safe** and would silently overwrite production-only content. Stop and surface before resolving.

The squash-merge of the promotion PR (step 3) collapses everything (the per-PR commits, the merge commit, all add/add resolutions) into a single clean commit on `production`. Linear-history protection on production is preserved by the squash, NOT by ff-only on the promote branch — these are independent mechanisms.

Full pattern + safety reasoning in `memory/followup_promotion_runbook_addadd_conflict_pattern.md`.

---

## Footnote — Why not `--ff-only` on the local prepare step

**Captured 3 May 2026 (Day 9 D8-8 promotion-PR first-execution finding).**

Earlier versions of this runbook prescribed `git merge --ff-only origin/main`
in the standard-promotion local prepare step. Empirically, that constraint
is structurally impossible to satisfy after any backport-via-PR cycle:

- Cherry-pick (the runbook's prescribed backport mechanism) creates a
  NEW commit SHA on the backport branch, distinct from the original
  source commit's SHA on `production`.
- Squash-merge of the backport PR (project convention) creates ANOTHER
  new SHA on `main`.
- Result: `main` and `production` carry content-equivalent but
  SHA-divergent commits. `git merge --ff-only` requires SHA-ancestor
  relationship, not content equivalence — so it refuses.

The same drift compounds with any direct-push to `production` that
predates branch protection (the 27 April 2026 R-0-prep
`chore(deploy): trigger Production build` commit was the first such
case to surface).

Plain `git merge` on the local promote branch handles SHA divergence
cleanly: the merge commit reconciles the two trees, then step 3's
squash-merge of the promotion PR collapses the merge commit (and all
intermediate commits) into a single squash-commit on `production`.
**Production's linear-history protection is preserved by the squash,
not by `--ff-only` on the promote branch — these are independent.**

Branch protection on `production` is unchanged: linear-history
requirement still enforces clean history at the squash-merge layer.

Cross-references:
- `memory/followup_promotion_runbook_first_execution_findings.md` — the
  3 May 2026 finding that drove this amendment
- D8-8 PR #86 — the substantive PR that needed promoting and surfaced
  the divergence problem on its first end-to-end run since R-0-prep
- `docs/RUNBOOK.md` "Deployment topology" — branch model rationale
  (R-0-prep, 27 April 2026)
