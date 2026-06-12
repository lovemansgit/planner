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

- ~~How is the Love-clearance signal made un-spoofable by the builder/subagents?
  (Label-protection / CODEOWNERS / a signed comment?)~~ **RESOLVED BY RULING
  (Day-54, 2026-06-12) — see Resolution below.**
- Does the existing reviewer-verdict gate already cover condition (2), or does
  clearance-is-verification (directional parks Love has answered) need its own
  server-side check?
- Promote stays out of scope — clearance-merges never ride a promote.

## Resolution — shared-identity signal (Day-54, 2026-06-12, Love-ruled)

Open question 1 (un-spoofable Love-clearance signal) is **resolved by ruling**,
not by a technical control. Love ruled that **attribution-by-GitHub-identity is
not a goal**: the `love-cleared` label is now agent-appliable (allow-rule in
`.claude/settings.json`, landed on `main` at `14709c0`), and authorization rests
on **Love's recorded clearance sentence in the reviewer chat**, never on who
applied the label. No Love-side act will ever back the label.

**Compensating control (standing audit):** every `love-cleared` merge is
reconciled against Love's recorded sentences at each claude.ai check-in; a merge
with no matching recorded sentence is surfaced to Love immediately. Filed as a
standing audit in `scripts/orchestration/RUNBOOK.md`.

**Status: resolved by ruling — revisit post-UAT.** If UAT surfaces a need for
un-spoofable attribution (e.g. multiple non-Love operators), reopen with the
label-protection / second-identity options above. Ruling of record:
`memory/decision_d54_love_cleared_allow_rule.md`.

## Cross-references

- `scripts/orchestration/RUNBOOK.md` — "Builder clearance-merges" clause (the
  temporary bridge this hardens away).
- `.github/workflows/orch-automerge.yml` — the Action this extends.
- `.claude/settings.json` — the `gh pr merge` deny restored once this lands.

---

## SUPERSEDED IN PART — Love's ruling, 2026-06-12 (append-only annotation)

The hardening SHIPPED (#440, merged `63fa74e`; wait-not-park conformance #452
cleared by Love the same day). The open attribution question is now RULED,
twice, superseding the label-protection direction:

1. First ruling (AM dispatch): "attribution by label-protection — no second
   identity." Settings deny lines were drafted and Love applied them in the
   main checkout.
2. Final ruling (same day, supersedes 1 — verbatim): **"I dont want such
   blockers... I approve and code executes."** The settings edit was reverted
   on this authorization and the label-protection denies are RETIRED. The
   builder is the sanctioned applier of `love-cleared` when, and only when,
   Love's clearance sentence is quoted verbatim on the PR; the permission
   classifier is the standing backstop against unquoted self-application.
   Standing semantics live in `scripts/orchestration/RUNBOOK.md` ("Clearance
   execution").

The "remove the builder-side allow-rule" target state in §"The hardening"
above is superseded accordingly: no allow-rule existed to remove (the bridge
was classifier behavior), and the deny-restoration is deferred to
MVP-FINALIZED per Love's same-day scope ruling on the settings paste.
