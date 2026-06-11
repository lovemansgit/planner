---
name: CI-bypass justification requires confirmed diagnosis
description: BINDING institutional discipline filed Day-28. Any `gh pr merge --admin` override OR §7.1 pre-existing-red CI-exception requires the "pre-existing / known / harmless" justification to be confirmed by a SECOND structurally-different diagnostic BEFORE the bypass is authorized. Binds `followup_single_diagnostic_surprise_discipline.md` to the merge-gate-bypass decision.
type: feedback
---

# CI-bypass justification requires confirmed diagnosis

**Filed:** Day-28 (2026-05-16). Code-PR ride-along on the appendWithoutSkip fix lane (plan PR #295). Filed at the request of the reviewer in the #295 §3.6 verdict, escalated from §9.2 of the plan from "noted" to a formal discipline memo.

**Tier:** Institutional-discipline. Same load-bearing posture as [`followup_single_diagnostic_surprise_discipline.md`](followup_single_diagnostic_surprise_discipline.md).

## The rule

**Any `gh pr merge --admin` override, OR any §7.1 pre-existing-red CI-exception, requires the "pre-existing / known / harmless" justification to be confirmed by a SECOND structurally-different diagnostic BEFORE the bypass is authorized.**

The first diagnostic alone — "I read the failing test and it looks pre-existing / it looks like a calendar flake / it looks production-zero-impact" — is not enough. A second diagnostic, structurally different (different signal source, not just a different angle on the same signal), must converge before bypass is authorized.

**Why:** PR #227's Day-21 admin-override + §7.1 acceptance rested on the falsified "production-zero-impact" assertion in [`followup_subscription_exceptions_calendar_flake.md`](followup_subscription_exceptions_calendar_flake.md) (now SUPERSEDED Day-28). That memo was a single confident diagnostic that nobody ever cross-checked with a structurally-different second look. The diagnostic was wrong on two load-bearing claims — the actual mechanism and the production-impact — and the bypass justification inherited both errors. The bug was in production for ~10 days (Day-19 → Day-28) before correct diagnosis.

**How to apply:**

- **When you're about to authorize `--admin` override:** before running the command, ask "what is the second, structurally-different diagnostic that confirms this is pre-existing / known / harmless?" If the answer is "I read the failing test and it matches the memo" — that's still one signal source (the failing test). Acceptable second diagnostics include: CI run history cross-tab vs commit content, git-log for prior introduction of the failing pattern, direct invocation of the production code path that the test exercises, behavioral observation on a deployed environment, an independent code-read by a second reviewer. The same-signal-source rule is what distinguishes "structurally different" from "additional angle."

- **When you're about to accept a §7.1 pre-existing-red exception on a PR:** same rule. The exception is not a free pass; it is a deferred verification. The deferral is permissible only if the "pre-existing / known / harmless" framing survives a structurally-different second look.

- **When the second diagnostic disagrees with the first:** STOP. Do not authorize the bypass. Re-diagnose per [`followup_single_diagnostic_surprise_discipline.md`](followup_single_diagnostic_surprise_discipline.md). Surface the contradiction to the reviewer explicitly.

- **When you're filing a "this is a flake / pre-existing / harmless" followup memo:** the memo itself is a hypothesis, not ground truth. Treat the memo as one diagnostic; require a structurally-different second one before any downstream decision (bypass, CI-exception, sequencing deferral) cites the memo as load-bearing.

## Binding link to `followup_single_diagnostic_surprise_discipline.md`

The single-diagnostic-surprise discipline says: when one diagnostic produces a surprising result that contradicts the priors, the next step is another diagnostic, not a plan/action. This memo extends that rule to the merge-gate-bypass decision class explicitly. "Pre-existing / known / harmless" diagnostics are surprising results in the same sense — they assert that something which *appears* to be a broken gate is *actually* benign. The mode of failure is the same: anchor on the diagnostic, miss the second look, authorize an action that turns out wrong.

The single-diagnostic-surprise memo applied successfully on the Day-27 inbound-webhook diagnosis and on the Day-28 Phase-1 of this very lane. This memo binds that discipline to the bypass-decision surface so future calls don't have to rediscover the link.

## Cross-references

- [Brief §7.1](PLANNER_PRODUCT_BRIEF.md) — review-discipline checklist; the formal `--admin` override pathway. This memo binds.
- [`followup_single_diagnostic_surprise_discipline.md`](followup_single_diagnostic_surprise_discipline.md) — sibling discipline memo, same institutional tier.
- [`followup_subscription_exceptions_calendar_flake.md`](followup_subscription_exceptions_calendar_flake.md) — SUPERSEDED. The falsified-precedent case study.
- [`memory/plans/day-28-appendwithoutskip-weekend-validationerror-fix.md`](plans/day-28-appendwithoutskip-weekend-validationerror-fix.md) — the plan-PR that ratified the diagnosis correction + the §9.2 escalation rule that produced this memo.
- PR #227 (Day-21) — the falsified-precedent merge override. Not to be re-cited as precedent for future overrides; the underlying justification has been falsified.

## What this memo is NOT

- **Not a ban on `--admin` override or §7.1 exception.** Both remain available tools. The memo is a discipline gate, not a removal of the tool.
- **Not retroactive.** Past overrides (incl. PR #227) are not reopened. The rule applies forward from Day-28.
- **Not a synthesis with the brief §7.1 checklist substantively** — it is an additional gate ON the bypass decision specifically, layered on top of the existing checklist. The brief §7.1 still defines the bypass mechanics; this memo defines the proof-of-justification requirement that must be satisfied BEFORE invoking the §7.1 mechanics.
