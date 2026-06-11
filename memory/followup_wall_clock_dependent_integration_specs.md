---
name: Wall-clock-dependent integration specs — post-demo sweep
description: STUB ONLY. Post-demo discipline lane to grep for integration specs that depend implicitly on CI wall-clock weekday/date without using the options.now injection surface. Filed Day-28 from plan PR #295 §9.3 ruling — out of scope this lane, not actioned.
type: project
---

# Wall-clock-dependent integration specs — post-demo sweep

**Filed:** Day-28 (2026-05-16) — STUB ONLY. Out of scope for the appendWithoutSkip fix lane per plan PR #295 §3.6 ruling on §9.3. **No investigation. No sweep. No follow-on edits.** Filed here so the work is captured but not lost.

## §1 Trigger

The Day-28 appendWithoutSkip fix lane surfaced a class of bug: integration specs that depend implicitly on the CI runner's wall-clock weekday/date without using the service-layer's `options.now` injection surface for time-determinism. The failing test was deterministic on the calendar boundary (Sat/Sun-Dubai for Mon-Fri subscriptions); the spec passed for ~ten days of weekday-Dubai CI runs and flunked four times in a row when CI crossed the Fri-Sat-Dubai boundary.

The risk: other integration specs may have the same implicit calendar coupling. Each one is a deterministic-but-time-bombed CI failure waiting for the right calendar window.

## §2 Scope of the sweep (post-demo)

Search for:

- Integration specs in `tests/integration/**/*.spec.ts` that construct `new Date()` (no argument) and rely on the resulting weekday/date for assertion shape.
- Tests that compute date arithmetic from "real today" without an `options.now` (or equivalent) injection point.
- Tests on service surfaces that accept `options.now` but don't use it (the appendWithoutSkip failing test was exactly this pattern — the injection surface existed; the spec just didn't use it).

For each spec found:

- Determine whether the failure-mode is calendar-deterministic.
- If yes: refactor to use the injection surface OR pin a deterministic clock (e.g. via `vi.useFakeTimers` or service-layer `options.now`) for the assertion-bearing path.
- File a follow-up if the spec uncovers a production-shape bug (per the appendWithoutSkip precedent) versus a pure test-only fix (per the original — falsified — Day-19 framing).

## §3 Sequencing

Post-demo. Not Day-28, not Day-29 (demo + post-demo dust-settling). Earliest reasonable open: Day-31+ when there is genuine slack for a discipline sweep.

This lane has no blockers and no urgency once the appendWithoutSkip fix code-PR lands. It is a hygiene-and-prevention sweep, not a bug fix.

## §4 What NOT to do here

- Do NOT investigate other specs preemptively.
- Do NOT refactor specs that aren't on the lane's path.
- Do NOT cite this memo as justification for unrelated changes.

This is filed-but-deferred. The discipline sweep happens when it is sequenced.

## Cross-references

- [`memory/plans/day-28-appendwithoutskip-weekend-validationerror-fix.md`](plans/day-28-appendwithoutskip-weekend-validationerror-fix.md) §9.3 — the open question that produced this memo.
- [`followup_subscription_exceptions_calendar_flake.md`](followup_subscription_exceptions_calendar_flake.md) (SUPERSEDED) — the original instance of this class.
- [`followup_ci_bypass_justification_requires_confirmed_diagnosis.md`](followup_ci_bypass_justification_requires_confirmed_diagnosis.md) — sibling discipline memo from the same plan-PR §9.2 ruling.
