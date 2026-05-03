---
name: Promotion runbook — first end-to-end execution findings (3 May 2026)
description: First end-to-end exercise of .github/workflows/promote-to-prod.md since R-0-prep (27 April 2026, 6 days prior). Surfaced two structural findings — (1) a 6-day SHA divergence on production from a direct-pushed R-0-prep operational commit, (2) ff-only constraint is structurally impossible to satisfy after any backport-via-PR cycle because cherry-pick + squash-merge create permanent SHA divergence even when content is equivalent. Runbook amended in same Day-9 batch (PR #89); cherry-pick approach (Path α) was structurally wrong; production branch protection unchanged. Future operators should expect plain-merge in the local prepare step.
type: project
---

# Promotion runbook — first end-to-end execution findings

**Captured:** 3 May 2026 (Day 9, post-D8-8 promotion-PR attempt)
**Trigger:** Day 9 P9 procedural cleanup — first execution of the documented `.github/workflows/promote-to-prod.md` procedure since R-0-prep (27 April 2026, 6 days prior). The execution surfaced two structural findings that drove an immediate runbook amendment.

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
- D8-8 PR #86 — the substantive PR that needed promoting and surfaced the divergence problem
- Backport PR #88 — Path α attempt; merged but did not resolve ff-only as expected
- Runbook amendment PR #89 — Path C reconciliation
- The 3 May 2026 promotion PR (open at hard-stop at this memo's filing) — first execution of the amended procedure
- `docs/RUNBOOK.md` "Deployment topology" — branch model rationale (R-0-prep, 27 April 2026)
- `memory/followup_vercel_auto_promote_main_to_production.md` (audit findings) — adjacent: branch-model audit that established Option C two-lane policy
