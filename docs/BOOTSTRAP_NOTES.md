# Bootstrap notes

## Commit-1 direct-push exception (25 April 2026)

Commit `550380a` — the initial Next.js 16 App Router scaffold — was pushed directly to `main` without going through the standard feature-branch + pull-request review cycle. This was a one-time bootstrap exception necessitated by the chicken-and-egg case of an empty repository: GitHub requires a base branch to exist before a pull request can target it, so the very first commit on `main` cannot itself be reviewed via a PR. Branch-protection is permanently PR-required-no-approval. Review pattern: Love + counter-reviewer chat (Claude in claude.ai). No second human reviewer in the loop. From PR #5 onwards, Claude Code executes squash-merges via `gh pr merge --squash --delete-branch` on Love's verbal "proceed to merge" instruction, except for commits 9 (SQL migrations) and 10 (CI integration) where Love merges in browser. This note will be folded into `docs/RUNBOOK.md` under a "Bootstrap exceptions" section when the runbook is written on Day 11 of the sprint.

## Branch model — `main` (preview) + `production` (live) (27 April 2026)

Introduced in R-0-prep, immediately before R-0 (the BYPASSRLS hole closure) merged. Until this change, Vercel's Production Branch was `main` and every merge to `main` rotated the public Vercel URL. R-0 made that risk concrete: the merge would have rotated the database role under live traffic without an observation window. Splitting the branches puts a deliberate human step between integration and production.

- `production` was created off `main` at commit `c213cb2` (Day 1 final state) so the live URL would not see any code change during the R-0-prep cutover.
- `main` continues to receive every PR — nothing routes around it.
- Promotion from `main` → `production` is a tracked PR per the procedure in `.github/workflows/promote-to-prod.md`.
- Vercel reconfiguration (Production Branch dashboard setting) was performed manually; the click-path was captured in the R-0-prep PR description.

For the full topology, branch-protection rules, and promotion + hotfix procedures, see `docs/RUNBOOK.md` ("Deployment topology") and `.github/workflows/promote-to-prod.md`. Both files ship in R-0-prep alongside this note.
