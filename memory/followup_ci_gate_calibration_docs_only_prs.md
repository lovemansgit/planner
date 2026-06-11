---
name: §7.1 CI gate calibration — docs-only plan-PRs
description: Day-25 refinement on the brief v1.13 §7.1 CI status gate. Plan-PR docs-only PRs do NOT require CI-green-before-§3.6-clearance; CI must clear green BEFORE merge. Surfaced via PR #270 (admin-merchants-detail plan-PR) §3.6 round 1 ruling.
type: feedback
---

# §7.1 CI gate calibration — docs-only plan-PRs

**Effective date:** Day 25 (13 May 2026), surfaced during PR #270
§3.6 round 1 verdict.
**Filed:** Day 25 evening, ride-along with the code-PR for the
admin merchants detail surface.

## §1. The refinement

Brief v1.13 §7.1 codified the CI status gate: "Reviewer must check
the PR's CI run status before clearing the §3.6 verdict. CI red is a
blocker." That rule is load-bearing for **code-PRs** where the PR
has a code surface that CI can meaningfully verify.

For **docs-only plan-PRs** — single markdown files under
`memory/plans/` or `memory/` — the rule applies asymmetrically:

- **Before §3.6 clearance:** CI state does NOT block the verdict.
  A plan-PR with PENDING CI can clear §3.6 round 1 on its content
  (plan compliance, scope clarity, OQ resolution, architectural
  decisions). The plan content is what's being reviewed; CI for a
  markdown file is mostly a "did Vercel preview render OK" signal,
  not a load-bearing correctness signal.
- **Before merge:** CI must still clear green. Plan-PRs go through
  the same `gh pr merge --squash` path as any PR; an UNSTABLE state
  at merge time still triggers the §5 exception-path discussion. The
  difference is purely about the §3.6 clearance gate timing.

## §2. Why the asymmetry

A docs-only PR has no .ts touched, so:
- `lint + typecheck + test (unit)` reduces to a no-op verification
  (no code changed; outcome is "main's state" pinned to the docs SHA).
- `test (integration)` similarly reflects main's state, not the PR's
  delta.
- `Vercel` deploys the markdown render preview, which is a "did the
  markdown render" signal, not a "is the change correct" signal.

The plan's correctness is verified by reading the plan, not by CI.
Requiring CI-green BEFORE §3.6 clearance on a docs-only PR adds
~2-3 min wall-clock latency between push + reviewer engagement, with
zero correctness value added.

For code-PRs the calculus is opposite: CI catches column-name drift,
integration spec failures, type-check ripple, lint regressions —
real correctness signals the reviewer can't catch from reading the
diff alone. CI-green-before-§3.6 stays load-bearing for code surface.

## §3. Operational rules

### §3.1 Detection

A PR is "docs-only" iff:
- All changed files match `*.md` (Markdown).
- AND no file under `src/`, `tests/`, `supabase/migrations/`,
  `scripts/`, `package.json`, `tsconfig.json`, or any other code/config
  surface is touched.

`git diff --name-only main..HEAD` is the canonical check.

### §3.2 Builder responsibility

Surface CI state in the PR-open message per the §7.1 format
unchanged. If docs-only:

> CI status: PENDING (docs-only PR — §7.1 calibration applies; CI
> not load-bearing for §3.6 clearance). Local tests: N/A. Markdown
> render + cross-references visually verified.

Reviewer reads the calibration phrase and proceeds with §3.6
content review without waiting for CI.

### §3.3 Reviewer responsibility

For docs-only PRs:
- Clear §3.6 on content alone if the plan / memo / brief amendment
  is sound.
- Confirm CI is green before authorising the merge. The reviewer's
  verdict message can read "APPROVED pending CI green" — once CI
  settles, the merge proceeds.

For code-PRs: rule unchanged. CI must be green BEFORE §3.6
clearance.

### §3.4 Mixed PRs

A PR that touches code AND docs is a code-PR for §3.6 purposes —
the code surface needs CI verification before §3.6 clearance. The
docs-only carve-out applies ONLY when the diff is genuinely
markdown-only.

## §4. Forward-link

This refinement applies retroactively to PR #270 (admin-merchants-detail
plan-PR, merged `ad3bb3a` Day-25 evening). The plan-PR cleared §3.6
round 1 on content alone; CI was PENDING at clearance and PASSED at
merge time. The discipline note surfaced via this memo + reviewer
verdict so the convention is recorded for future docs-only plan-PRs.

Brief §7.1 codification stays as-is — the calibration is a
clarification on the gate's timing for docs-only PRs, not a change
to the load-bearing CI gate for code-PRs. A future brief amendment
may inline this refinement into §7.1 if the discipline holds across
more docs-only PRs; for now this followup memo is the canonical
reference.
