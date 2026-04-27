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
git merge --ff-only origin/main      # fast-forward only — refuse if main has diverged
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

If `git merge --ff-only` fails, `production` has commits `main` does not —
which should never happen except via hotfix. Stop and reconcile before
proceeding (see "Hotfix" below for how the hotfix flow keeps the trees in
sync).

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
git branch -D promote/<YYYY-MM-DD>-<short-summary>
git fetch origin --prune
```

Promotion branches are throwaway — Vercel keeps the deployment record in
its own history.

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
If you merge PR B first, the next promotion PR from `main` will appear to
"undo" the hotfix because `git merge --ff-only` will fail — main lacks the
production-only commit.

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
