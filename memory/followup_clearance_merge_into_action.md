---
name: Harden clearance-merges into the orch-automerge Action
description: Post-wave hardening (Love-ruled Day-53, 2026-06-11). Builder clearance-merges of Love-cleared off-allowlist PRs currently run as a temporary builder-side bridge enabled by a permission allow-rule. Fold that execution into the orch-automerge GitHub Action so the builder never holds the merge capability directly and the standing "the Action is the only actor that merges" invariant is fully restored.
type: reference
---

# Harden clearance-merges into the orch-automerge Action

**Filed:** Day-53 (2026-06-11), per Love's Ruling 1 ("File a post-wave hardening
followup: clearance-merges move into the orch-automerge Action so the hard deny
returns").

## The temporary state (what this replaces)

Love authorized **builder clearance-merges** (verbatim "builder to merge",
2026-06-11) so the builder can complete the merge of a PR Love has **explicitly
cleared** but which is off the path-gate allowlist (so the Action's docs-only
auto-merge can't land it). This runs as a **builder-side bridge** under a
permission allow-rule, constrained to four conditions (encoded in
`scripts/orchestration/RUNBOOK.md`): Love explicitly named the PR cleared;
reviewer APPROVE (or a Love-answered Standing-Order-5 directional park); CI green
at the pinned head SHA; route + SHAs reported every time; no promote.

The bridge widens the builder's merge capability beyond the runbook's standing
rule that **the Action is the only actor that merges** (the `gh pr merge` deny in
`.claude/settings.json`). That is acceptable only as a short-lived bridge.

## The hardening (the target state)

Move clearance-merge **execution** into the orch-automerge Action
(`.github/workflows/orch-automerge.yml`) so the builder never holds a direct
merge capability and the standing deny is fully restored.

Sketch (design to be ruled at build time):
- A **Love-clearance signal on the PR** the Action can verify server-side —
  e.g. a dedicated label (`love-cleared`) applied by Love, or a Love-authored
  clearance comment matching a fixed pattern. The signal must be attributable to
  Love, not the builder (the builder must not be able to self-apply it — same
  spirit as the reviewer-verdict gate).
- The Action re-computes the **four conditions** server-side from the trusted
  base copy: the Love-clearance signal is present; an `ORCH-VERDICT: APPROVE` (or
  the runbook's clearance-is-verification equivalent) at the current head; CI
  green; and it records the route + SHAs in the merge commit / a comment.
- For **off-allowlist** PRs the path-gate must be relaxed *only* on a valid
  Love-clearance signal — the allowlist still governs ordinary auto-merge.
- Once shipped, **remove the builder-side allow-rule** so the `gh pr merge` /
  direct-merge deny stands unconditionally again.

## Open questions for the build

- How is the Love-clearance signal made un-spoofable by the builder/subagents?
  (Label-protection / CODEOWNERS / a signed comment?)
- Does the existing reviewer-verdict gate already cover condition (2), or does
  clearance-is-verification (directional parks Love has answered) need its own
  server-side check?
- Promote stays out of scope — clearance-merges never ride a promote.

## Cross-references

- `scripts/orchestration/RUNBOOK.md` — "Builder clearance-merges" clause (the
  temporary bridge this hardens away).
- `.github/workflows/orch-automerge.yml` — the Action this extends.
- `.claude/settings.json` — the `gh pr merge` deny restored once this lands.
