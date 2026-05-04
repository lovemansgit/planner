---
name: Promotion runbook — rename + -X theirs delete-modify failure mode (4 May 2026)
description: Finding #6 in the branch-model audit corpus. When a queued main-side PR includes file renames (e.g. PR #117's route-group migration moving 4 pages into src/app/(app)/) AND production-side commits since the common ancestor have modified those same files in their pre-rename location (e.g. PR #91/#94/#99 modifications to webhook-config / failed-pushes / consignees / subscriptions pages), the canonical `git merge -X theirs origin/main` resolves the add (new path) cleanly but produces a SILENT delete-modify state on the old path — the squash flattens the rename into delete+add, so git's rename-detection does NOT bridge the move; the delete-modify is resolved by git's default (keep the modified version), leaving production's old-path file in place. Both the old AND new paths end up on the merged tree. Surfaced and reconciled on PR #124 (4 May 2026, fifth-since-R-0-prep promotion). Reproduction signal is the existing post-merge `git diff origin/main..HEAD --stat` check — finding #5's add/add resolution made it empty for #91/#99/#103/#116; finding #6's delete-modify state makes it non-empty.
type: project
---

# Promotion runbook — rename + -X theirs delete-modify failure mode

**Surfaced:** 4 May 2026 (Day 11 EOD batched promotion, fifth-since-R-0-prep — PR #124)
**Position:** Finding #6 in the branch-model audit corpus (5 prior findings; finding #5 in `followup_promotion_runbook_addadd_conflict_pattern.md` is the most directly related).

---

## The pattern

When a queued main-side PR includes `git mv`-style file renames AND production-side commits since the common ancestor have modified those same files at their pre-rename location, the canonical promotion merge produces a tree with BOTH the old AND the new paths.

Concrete example from PR #124's promote branch:

- PR #117 (squashed onto main, 4 May) moved 4 pages into `src/app/(app)/`:
  - `src/app/admin/failed-pushes/{client,page}.tsx` → `src/app/(app)/admin/failed-pushes/{client,page}.tsx`
  - `src/app/admin/webhook-config/{client,page}.tsx` → `src/app/(app)/admin/webhook-config/{client,page}.tsx`
  - `src/app/consignees/page.tsx` → `src/app/(app)/consignees/page.tsx`
  - `src/app/subscriptions/page.tsx` → `src/app/(app)/subscriptions/page.tsx`
- Prior promotions (#91, #99, #103, #116) had squashed onto production a series of commits modifying those same files in their pre-rename locations.
- `git checkout production && git pull && git checkout -b promote/day-11-eod && git merge -X theirs origin/main --no-edit` — the merge succeeded, applied via the 'ort' strategy, no manual conflict resolution surface.
- Post-merge `git diff origin/main..HEAD --stat` showed 6 files: the OLD pre-rename paths, present on the promote branch but absent on `origin/main`. Both old AND new paths existed on the merged tree.

If pushed and merged to production unfixed, Next.js would observe duplicate routes (e.g. `/consignees` resolving to both `src/app/consignees/page.tsx` and `src/app/(app)/consignees/page.tsx`) and either fail at build or render the wrong file at runtime.

## Why `-X theirs` does not handle this

`-X theirs` is a merge-strategy option (`--strategy-option theirs`) that tells the 'ort' merge strategy to favor the **incoming** side on **content conflicts**. It does NOT apply to delete-modify conflicts.

Squash-merging a rename-heavy PR (like #117) flattens the move into the squash commit's diff as a "delete old path + add new path" pair. Git's rename-detection heuristic CAN bridge this when looking at a single commit's diff in isolation, but it does NOT consistently bridge it during a three-way merge where the squash sits as one of the parents.

In the three-way merge against the common ancestor:

- **Old path:** main's squash deleted it; production has modifying commits since the ancestor → **delete-modify conflict**.
- **New path:** main's squash added it; production has nothing → **clean add**, lands.

`-X theirs` resolves the add cleanly. For the delete-modify, git's default behavior (no flag override available with `-X`) is to **keep the modified version** with a warning. That warning is the only signal — the merge succeeds with a non-fast-forward "Auto-merging ..." line for the path, and the file persists in the merge result.

The empirical signal that this happened is the post-merge `git diff origin/main..HEAD --stat` check that finding #5 already mandates as load-bearing. When the runbook follows finding #5's procedure, finding #6's failure makes the diff non-empty — surfacing the bug at the same gate.

## Why this didn't surface on PRs #91 / #99 / #103 / #116

None of those four prior promotions carried a rename-heavy queued PR. The queued PRs since R-0-prep through PR #116 modified files in place; no `git mv`-style migrations.

PR #117's `(app)/` route-group migration is the first rename-heavy PR on this corpus's promotion path. Hence the first appearance of finding #6 on the fifth-since-R-0-prep promotion (PR #124).

## Mitigation — manual cleanup pass

After the canonical `git merge -X theirs origin/main --no-edit` and BEFORE the push, the runbook needs an extra step:

```bash
# Standard amended-runbook flow:
git checkout production && git pull origin production
git checkout -b promote/<YYYY-MM-DD>-<short-summary>
git merge -X theirs origin/main --no-edit

# Existing finding-#5 verification:
git diff origin/main..HEAD --stat

# NEW: if the diff is non-empty AND the offending paths are stale
#      pre-rename locations, file-by-file cleanup. Inspect first —
#      a non-empty diff for non-rename reasons is a separate failure.

git rm <stale-old-path>... [...as many as the diff lists]
git commit -m "promote: drop stale pre-rename paths surfaced by finding #6"

# Re-verify — MUST be empty now:
git diff origin/main..HEAD --stat

# Standard push + PR
git push -u origin promote/<YYYY-MM-DD>-<short-summary>
gh pr create --base production --head promote/<YYYY-MM-DD>-<short-summary> ...
```

The cleanup commit becomes a second commit on the promote branch alongside the merge commit. The squash-merge into production collapses both into one promotion commit — no asymmetry visible to production.

## Inspection discipline (load-bearing — easy to skip)

The non-empty diff after `-X theirs` MUST be inspected before deciding to cleanup. Two distinct non-empty patterns share the same surface signal:

1. **Finding #6 — stale rename old paths.** Files appear on HEAD but not `origin/main`; same content as the pre-rename squash. Cleanup-by-removal is the right resolution.
2. **Anything else (unknown).** A novel pattern. Stop, surface to the reviewer, do not push.

Distinguishing the two is by hand: inspect the offending paths against the rename history of recent main-side PRs (`git log origin/main --oneline | head` + `git show <PR-squash>` for the moves). When the diff names files that map clearly to a known rename, finding #6 applies. Otherwise it's a new failure mode.

## One-paragraph runbook amendment for Day-12 docs-pass

Append to `.github/workflows/promote-to-prod.md` standard-flow alongside the existing finding-#5 amendment:

> *"If the post-merge `git diff origin/main..HEAD --stat` is non-empty AND the offending paths correspond to file moves in a recent main-side squashed PR (rename-heavy queued PRs trigger this), the merge has hit finding #6: `-X theirs` resolves the add cleanly but produces a silent delete-modify state on the pre-rename paths. Resolve via an explicit cleanup commit (`git rm <stale-old-paths>...`) before push. Re-verify the diff is empty after cleanup. See `memory/followup_promotion_rename_delete_modify_pattern.md` for the full pattern + reproduction signal. If the non-empty diff names paths that don't match a known rename, STOP — that's a new failure mode."*

Bundle with any other Day-12 runbook touches.

---

## Cross-references

- `memory/followup_promotion_runbook_addadd_conflict_pattern.md` — finding #5 (add/add pattern; `-X theirs` IS the resolution there)
- `memory/followup_promotion_runbook_first_execution_findings.md` — findings #1, #2, #3 (first-execution structural findings)
- `memory/followup_promotion_runbook_branch_state_risk.md` — finding #4 (post-promotion branch-state risk)
- `memory/followup_branch_model_audit.md` / `memory/followup_branch_model_audit_results.md` — audit corpus this finding extends
- `.github/workflows/promote-to-prod.md` — runbook this amendment targets
- PR #117 — the rename-heavy queued PR that triggered the surface
- PR #124 — the promotion that surfaced finding #6 (this memo's filing PR)
