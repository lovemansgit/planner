---
name: Promotion runbook — add/add conflict pattern on second-and-subsequent promotions (3 May 2026)
description: Finding #5 in the branch-model audit corpus. Plain `git merge origin/main` (per the Day-9 amended runbook) handles SHA divergence at the commit level but produces add/add conflicts at the file level on every file modified by post-promotion main commits. Production HEAD is a squash-commit; main HEAD has the same content reconstructed via per-PR squashes plus subsequent feature work; git can't auto-resolve. Reconciliation is `git merge -X theirs origin/main` — safe by construction when the precondition `git log origin/main..origin/production` returns only prior squash-merged promotions (or content-equivalent direct-push commits like the R-0-prep one). Surfaced + reconciled on the second end-to-end runbook execution (3 May 2026 EOD batched promotion).
type: project
---

# Promotion runbook — add/add conflict pattern on second-and-subsequent promotions

**Surfaced:** 3 May 2026 (Day 9 EOD batched promotion — second end-to-end runbook execution since R-0-prep)
**Position:** Finding #5 in the branch-model audit corpus (4 prior findings in `memory/followup_branch_model_audit.md`).

---

## The pattern

After the first squash-merged promotion (PR #91 → `9283f19` on production, 3 May 2026 morning), production's HEAD is a **single squash-commit** containing the entire merged tree at promotion-time. Main meanwhile has the same content reconstructed across per-PR squash-merges (`#86`, `#87`, ..., `#92`) PLUS subsequent feature work (`#94` P4a, `#95` Day-9 memos, `#96` D8-4b, `#97` EOD doc).

When the second promotion attempt runs `git merge origin/main` from a promote branch parented to production, git sees:

- **Production-side (HEAD):** the squash's tree state, with no per-PR commit history
- **Main-side (origin/main):** the per-PR commits as distinct, including new commits touching files the squash already covered

For every file modified by post-promotion main commits (P4a touched `roles.ts`, `permissions.ts`, `permissions.spec.ts`; D8-4b touched `task-push/service.ts`, `cron-push-reconciles-awb-exists.spec.ts`; etc.), git produces an **add/add conflict** because the histories diverge at the file level — the same file content exists on both sides for the pre-promotion portion, plus differing additions on each side.

The Day-9 amended runbook's *"plain merge handles SHA divergence"* claim was structurally **incomplete**: it handles divergence at the commit level (no fast-forward needed) but doesn't anticipate file-level add/add conflicts on second-and-subsequent promotions.

## Why `-X theirs` is the correct resolution

`-X theirs` (the merge strategy option, equivalent to `git merge --strategy-option theirs`) tells git to favor the **incoming** side on add/add and content conflicts. In the promotion context:

- Incoming = `origin/main` = the merge SOURCE (the new content being promoted)
- Local = `HEAD` (the promote branch parented to `production`) = the merge TARGET

By construction, **production's HEAD does not contain any work main lacks** beyond the prior squash-merge commits whose content is reconstructed on main via per-PR squashes. Verified empirically by the precondition check below. Therefore `-X theirs` is **safe**: it can't silently overwrite work because production has no contradicting feature work.

The result is a merge commit on the promote branch where every file matches `origin/main` exactly. The squash-merge of the promotion PR then collapses everything into a single new commit on production.

## Precondition check (LOAD-BEARING)

Before running `git merge -X theirs origin/main`, run:

```bash
git fetch origin
git log origin/main..origin/production --oneline
```

Expected output: empty, OR only the following classes of commits:
1. **Prior squash-merged promotion commits** (`promote: <date> — <summary> (#XX)`) — their content is reconstructed on main via the per-PR squashes that were promoted
2. **R-0-prep era direct-push commits** (`15c55e4` is the only one as of Day 9; if a future direct-push appears, audit before continuing)

If the output contains anything else — a hotfix that wasn't backported, a manual direct-push during incident response, divergent feature work — `-X theirs` is **NOT safe** and would silently overwrite that production-only content. **Stop and surface to a reviewer before resolving.**

This precondition is the reason `-X theirs` is safe in the post-Day-9 architecture — branch protection on production blocks force-push and direct-push, so the only paths to production-only commits are (a) prior promotions, (b) R-0-prep era artifacts, (c) hotfixes via the documented hotfix flow (which require a parallel backport-to-main PR per the runbook). Cases (a) and (b) are content-equivalent on main; case (c) — if executed properly — also lands content-equivalent on main. Anything else is a procedure violation worth surfacing.

## Procedure for a second-or-subsequent promotion

```bash
# Pre-check (LOAD-BEARING — see above)
git fetch origin
git log origin/main..origin/production --oneline
# Verify output matches expected classes above. If not, STOP.

# Standard amended runbook flow:
git checkout production
git pull origin production
git checkout -b promote/<YYYY-MM-DD>-<short-summary>
git merge -X theirs origin/main --no-edit       # Note: -X theirs, not plain merge

# Standard verification (load-bearing on every promotion):
git diff origin/main..HEAD --stat                # Expected: empty (zero files differ)

git push -u origin promote/<YYYY-MM-DD>-<short-summary>
gh pr create --base production --head promote/<YYYY-MM-DD>-<short-summary> ...
```

The `--no-edit` flag suppresses the merge-commit-message editor (uses git's default).

## One-paragraph runbook amendment for Day-10 docs-pass

Append to `.github/workflows/promote-to-prod.md` standard-flow step 2 + the existing "Why not `--ff-only`" footnote:

> *"On second-and-subsequent promotions, `git merge origin/main` produces add/add conflicts on every file modified by post-promotion main commits. This is expected — production's HEAD is a squash-commit and main's HEAD reconstructs the same content via per-PR squashes plus new work. Use `git merge -X theirs origin/main` instead, after verifying the precondition `git log origin/main..origin/production` returns only prior squash-merged promotion commits or known content-equivalent direct-push commits (R-0-prep `15c55e4` is the only such case as of Day 9). The verification confirms `-X theirs` won't silently overwrite production-only work. See `memory/followup_promotion_runbook_addadd_conflict_pattern.md` (finding #5 in the branch-model audit corpus) for the full pattern + safety reasoning."*

Bundle with the other Day-10 docs-pass amendments per `memory/followup_promotion_runbook_branch_state_risk.md` and `memory/followup_d8_2_migration_comment_framing.md`.

---

## Cross-references

- D9 PR #97 / EOD batched promotion — the second end-to-end runbook execution that surfaced this finding
- `memory/followup_promotion_runbook_first_execution_findings.md` — findings #1, #2, #3 (the first-execution structural findings)
- `memory/followup_promotion_runbook_branch_state_risk.md` — finding #4 (PR #93 → #94 close-and-reopen)
- `memory/followup_branch_model_audit.md` — Day-10 P1 audit corpus (this finding is #5; bring into the audit's "infrastructure layer" findings)
- `.github/workflows/promote-to-prod.md` — runbook this amendment targets
- `memory/handoffs/day-9-eod.md` §4.3 — pace observation on first-execution findings; the Day-9 EOD-batched-promotion second-execution finding follows the same pattern (deferred infrastructure compounds; first-and-subsequent executions surface gaps in burst rather than gradually)
