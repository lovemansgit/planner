---
name: §3.6 review discipline — CI status gate
description: Day-25 process amendment locking CI status verification into the §3.6 hard-stop review checklist (plan-PR + code-PR rounds). Closes the gap that let PR #264 clear two §3.6 rounds on a CI-red main.
type: feedback
---

# §3.6 review discipline — CI status gate

**Effective date:** Day 25 (13 May 2026)
**Filed:** Day 25 evening, post PR #264 merge
**Tier:** T1 — process / docs

## §1. The gap

Both §3.6 review rounds on PR #264 (Edit Merchant code-PR) cleared
"APPROVED" without checking CI status. Plan compliance was clean;
local test signal was green; reviewer (this thread per autonomous-mode
contract) verdict was "stand down at pre-merge for Love's button."

CI was UNSTABLE at PR-open. The integration job had been failing on
main for ≥5 consecutive commits (identity-create-user-flow.spec.ts +
identity-disable-enable-flow.spec.ts trip the `audit_events_no_delete`
RULE × tenant CASCADE conflict on their afterAll DELETEs). My new
spec ALSO failed at first push for the same reason; a single try-catch
fixup commit (`88bffa4`) cleared my spec but left the two pre-existing
failures intact at merge.

Neither §3.6 round caught the CI state. The merge landed on UNSTABLE
CI after Love's explicit "Proceed to merge" authorization. No harm
done in this instance — the failures are pre-existing main-side
breakage, not introduced by PR #264 — but the discipline gap is real:
**a §3.6 verdict should be a complete go/no-go signal, and CI status
is part of go/no-go.**

## §2. The rule

§3.6 reviews — plan-PR round 1 AND code-PR round 2, reviewer AND
self-review — **include CI status verification.** Failing or red CI on
a PR is a §3.6 blocker, regardless of plan compliance or local test
signal.

This applies to:
- Plan-PR (round 1) — must have green CI before §3.6 clearance.
- Code-PR (round 2) — must have green CI before §3.6 clearance.
- Reviewer counter-review — must verify CI before clearing verdict.
- Self-review — same check before declaring "stand down at pre-merge."

Local test signal (e.g., "1905 unit tests pass, tsc clean") is a
necessary but not sufficient condition. CI catches things local can't:
integration specs against real Postgres, RLS isolation under real
session contexts, type-check against fresh node_modules, environment
parity issues, parallel-spec interaction effects.

## §3. Builder responsibility

When opening a PR for §3.6 review, surface CI status in the PR-open
message alongside local test signal. Required format:

> CI status: <PASS | FAIL | UNSTABLE | PENDING>. Local tests: <count>
> passing, tsc <green | red>.

If CI is red or UNSTABLE at PR-open, surface that prominently in the
SAME message — not in a follow-up, not buried in the PR body. The
reviewer must see CI state clearly, not infer it from absence.

If CI is PENDING at PR-open (jobs still running), say so and wait for
settled state before declaring §3.6 round complete. Don't surface a
"ready for review" signal while CI is in flight.

## §4. Reviewer responsibility

Before clearing the §3.6 verdict (either round), verify the PR's CI
state on the head SHA. The `gh pr checks <PR#>` command is the
canonical check; `gh pr view <PR#> --json mergeStateStatus` is the
TL;DR (CLEAN / UNSTABLE / BLOCKED / DIRTY).

**Decision matrix:**

| CI state | Plan-compliance state | Verdict |
|---|---|---|
| PASS | clean | clear §3.6, stand down pre-merge |
| PASS | findings | surface findings, hold |
| FAIL or UNSTABLE | clean | do NOT clear — surface CI failure to Love |
| FAIL or UNSTABLE | findings | hold on both axes |
| PENDING | any | wait for settled, re-check |

**Surfacing failures:** if CI is red, the verdict message to Love
must include:
- Which job(s) failed
- Whether the failure is in the PR's surface or pre-existing on main
- The minimum diagnostic + repro signal

## §5. Exception path — pre-existing main failures

A demonstrably pre-existing CI failure on main (verifiable via
`gh run list --branch main`) does NOT introduce new failure surface
in the PR under review. In that case, the reviewer MAY clear §3.6
with an explicit caveat IF a parallel fix-PR for the pre-existing
failure is in flight.

If no parallel fix-PR exists, the discipline is **fix-first**:
- The reviewer surfaces the pre-existing failure to Love
- A new T1 or T2 fix-PR opens BEFORE the current PR merges
- The fix-PR may share a branch with the current PR's fixup commits
  (one-shot landing) OR sequence ahead of it

The justification: a CI-red main blocks every PR's "is this clean?"
signal. Each accumulated failure compounds the noise. Fix-first
discipline keeps main green as the load-bearing signal it needs to be.

PR #264 hit this exception path implicitly — the two
`identity-*-flow.spec.ts` failures are pre-existing main-side
breakage. The fix-PR for those was not in flight at PR #264 merge
time; Love merged with awareness of the state. Going forward, a
fix-PR is queued (Session A working in parallel on the
`audit_events_no_delete` × CASCADE teardown pattern).

## §6. No --admin bypass without explicit authorization

`gh pr merge --admin` bypasses required checks. **Do not use without
explicit Love authorization** ("merge it anyway", "force merge", "use
admin" — verbatim, not inferred).

The default merge mode is `--squash` against settled CI. If CI is red
and Love wants to merge anyway, the authorization must be explicit
in-thread; the merge command then uses `--admin --squash` together,
with the authorization quoted in the PR comment for audit trail.

## §7. Sequencing in §3.6 self-review

When acting as both builder and self-reviewer (e.g., autonomous-mode
or when Love is offline), the §3.6 round looks like:

1. Push final commit
2. Wait for CI to settle (use `gh pr checks <PR#> --watch` or
   `ScheduleWakeup` for ~2-3 min on integration tests)
3. Read CI state — `gh pr view <PR#> --json mergeStateStatus`
4. Surface CI state + plan-compliance state in the same message
5. Declare verdict per §4 decision matrix
6. If clear → stand down pre-merge for Love's button
7. If not clear → surface failure + recommended path

Skipping step 2 (waiting for CI) is the gap that produced this memo.

## §8. Forward-link

The audit-rule teardown bug class (Day-2 `audit_events_no_delete` RULE
× CASCADE conflict from `memory/followup_audit_rule_cascade_conflict.md`)
is the underlying cause of the pre-existing failures Session A is
fixing in parallel. That PR will green main; this memo locks the
discipline so the next CI-red surface gets caught at §3.6 review, not
at merge time.

## §9. PRs in scope

- **PR #266** (this memo + brief §7.1 + MEMORY.md row) — T1 docs lane
  for the discipline change.
- **Session A parallel fix-PR** (Day 25) — substantive fix for the
  audit-rule teardown bug class. Greens the two pre-existing
  integration failures.
