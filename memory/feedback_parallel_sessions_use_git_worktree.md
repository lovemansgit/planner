---
name: Parallel sessions need git worktrees, not just branches
description: Two-terminal Session A/B splits on the same repo SHARE git HEAD; use `git worktree add` to isolate, never just create branches in the same dir. Also captures the `gh pr merge --delete-branch` brittleness that fires when the local branch is held by a worktree.
type: feedback
---

# Parallel sessions need git worktrees, not just branches

**Surfaced:** Day 17 (7 May 2026), Session B work on PR #175 (tasks page enhancements) — and the post-merge worktree-cleanup runbook for that PR.

## §1 Why branches alone don't isolate parallel sessions

When running parallel Claude Code sessions on the same project (e.g. Session A + Session B working on different features simultaneously in two terminals), giving each session its own branch is **not enough**. Both terminals operate on the same `.git/HEAD`, so `git checkout` from either terminal switches the branch for both — staged changes can land on the wrong branch, working trees collide, and operations like `git checkout` fail when the other session has unstaged WIP on a file the target branch doesn't know about.

Discovered Day 17 during Session B work on PR #175. I created `day17/session-b-tasks-page-enhancements` from main, started editing, then Session A's terminal switched HEAD to their branch (`day17/session-a-crm-state-ui`) and committed `af0c002` on top. My uncommitted edits were still in the working tree but pointed at the wrong branch; trying to `git checkout` back to session-b failed because Session A's WIP on `CrmStateModal.tsx` would be overwritten. A reflexive `git checkout --` to clear their WIP got correctly denied as destruction of work I didn't create.

## §2 How to apply

For any task split into parallel sessions on the same repo:

1. Each session creates a separate worktree up front:
   ```
   git worktree add ../planner-session-b day17/session-b-feature
   ```
2. Run all session-specific commands with `git -C ../planner-session-b ...` (or work entirely from that path; remember `cd` does not persist across Bash tool calls — use absolute `-C` instead).
3. Worktrees share `.git/objects` so commits are cheap, but each has its own `HEAD` and index — branch switches in one don't leak into the other.
4. Cleanup with `git worktree remove ../planner-session-b` after the PR merges.

If you're already mid-flight and discover the shared-HEAD problem, recover by **copying** modified/new files into a fresh worktree (do **not** `git checkout --` to clear the other session's WIP), then committing from the worktree.

## §3 `gh pr merge --delete-branch` + worktree brittleness

When merging a PR whose local branch is checked out in a git worktree (not the main working directory), `gh pr merge --squash --delete-branch` aborts at the local-delete step because the worktree holds the branch, and the abort cancels the subsequent remote-delete operation. The remote branch survives.

Workaround: either remove the worktree before merging, or follow up with `git push origin --delete <branch-name>` after the merge completes. Session B PR #175 hit this and recovered manually.

Future parallel-session work using `git worktree`: budget for the manual remote-delete step in the merge runbook, or set up `git worktree remove` to fire automatically on merge confirmation.
