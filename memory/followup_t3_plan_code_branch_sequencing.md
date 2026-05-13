# T3 plan-then-code branch sequencing — fragility + prescriptions

**Filed:** Day-25 PM (13 May 2026), post merge of PR #266
**Trigger incident:** Day-25 decoupled-consignee lane (PR #263 plan, PR #265 code)
**Severity:** Procedural — recoverable, no data lost. Costs ~5 minutes of recovery + a force-push hook denial + one new PR number to reissue an already-approved diff.

## What happened

The Day-25 T3 lane followed the documented plan-then-code chain:

1. Code branch `day25/decouple-consignee-code` was created off `day25/decouple-consignee-plan` so the code-PR's diff would be purely code (plan content sitting in parent).
2. PR #263 (plan) opened against `main`.
3. PR #265 (code) opened against `day25/decouple-consignee-plan`.
4. Love approved both at §3.6 round-1 (plan) and §3.6 round-2 (code).
5. Merge directive: "Plan first, code second."
6. `gh pr merge 263 --squash --delete-branch` succeeded.
7. **Fragility surfaced:** `--delete-branch` removed `day25/decouple-consignee-plan` from origin. GitHub auto-closed PR #265 because its **base ref no longer existed**. State went from `OPEN` → `CLOSED` with `mergeStateStatus: DIRTY`.
8. `gh pr reopen 265` failed: *"Could not open the pull request."* GitHub does not permit reopening when the base ref is missing.
9. `gh pr edit 265 --base main` failed: *"Cannot change the base branch of a closed pull request."*
10. Rebasing the code branch onto main and force-pushing would have re-opened a clean path — but force-push is hook-blocked per `feedback_force_push_requires_pre_authorization.md`, and the merge directive did not explicitly cover the force-push step.
11. **Recovery taken:** rebased the code commit onto main locally, pushed as a new branch name (`day25/decouple-consignee-code-rebased`) — a normal push, no force needed — and opened **PR #266** with the byte-identical code commit. Love confirmed pre-existence of the audit-event reuse footer in the original commit `5bf9ce2`, then issued a fresh merge directive for #266. Merged at `e2aca95`.

The original code-PR #265 remains in the GitHub record as **closed-unmerged** for audit-trail purposes, with a one-line cross-reference pointing at #266 as the successor.

## Root cause

Two `gh pr merge` defaults compose poorly for the T3 plan-then-code chain:

- `--delete-branch` is the conventional cleanup flag (no orphan branches accumulate).
- When the deleted branch is the **base** of a still-open PR, GitHub auto-closes the dependent PR with no recovery path.

The chain is fragile because the code-PR's base ref is the plan branch — necessary for the "diff is purely code" property, but it makes plan-merge cleanup destructive to the dependent.

## Prescriptions for future T3 lanes

Plan-PR §0 sequencing should call out the fragility AND prescribe one of:

### Option A (preferred when plan content is small) — fork code off main + cherry-pick plan deltas

- Code branch is created off `main`, not off the plan branch.
- Plan deltas (the markdown plan doc, decision-memo footers, etc.) are cherry-picked into the code branch.
- Plan-PR diff: just the plan doc.
- Code-PR diff: code + cherry-picked plan deltas.
- Merge order: plan first, then code. Both `--delete-branch` operations are safe — neither branch is parent to the other.
- Trade-off: plan deltas appear in both PR diffs, but the duplication is small (typically 1-2 markdown files) and reviewers see exactly what lands in main.

### Option B (preferred when plan deltas are large or many) — preserve plan branch mergeability

- Plan-PR merges with **`--delete-branch=false`**.
- Code-PR can be merged or rebased afterwards without losing its base ref.
- Plan branch deletion happens manually AFTER the code-PR lands (or never, if the team is okay with branch accumulation).
- Trade-off: one extra cleanup step; some risk of forgetting to delete the plan branch.

### Mechanical guards (orthogonal to A vs B)

- Plan-PR descriptions should include a checklist item: "If using base-ref chaining (Option B): merge plan with `--delete-branch=false`."
- Code-PR descriptions should include: "Base ref is `<plan-branch>` — preserve it through merge OR rebase code branch onto main pre-merge."
- Force-push pre-authorization should be sought up-front in the merge directive when Option A is not in play. Wording template: *"Authorize rebasing the code branch onto main and force-pushing (with `--force-with-lease`) immediately after the plan merge if `--delete-branch` is desired on the plan."*

## What goes in next T3 plan-PR

Plan-PR template §0 (Sequencing) should add a subsection:

```
### §0.x Branch sequencing posture

Choose ONE:
- [ ] Option A: code branch forked off `main`, plan deltas cherry-picked.
- [ ] Option B: code branch forked off plan branch; plan-PR merges with
      `--delete-branch=false` to preserve dependent code-PR mergeability.

If Option B is selected without the `--delete-branch=false` flag, the
agent surfaces this back to the reviewer pre-merge to avoid the Day-25
PR-#265 fragility.
```

## Open

- Should this be promoted from "followup memo" to a `decision_*.md` filing once observed twice? — Yes, if a second incident occurs. One-off is procedural; two-off is a convention.
- Should `gh pr merge` invocations in operator runbooks include explicit `--delete-branch=false` defaults when the merging PR is a `plan(*)` commit? — Worth considering for the runbook; deferred to next runbook revision.
