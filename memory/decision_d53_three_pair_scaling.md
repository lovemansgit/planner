# Day-53 ruling — scaling to three builder pairs (2026-06-11)

**Filed:** Day-53 (11 Jun 2026), Session C first PR (T1 docs lane). Repo record of Love's scaling ruling, encoded verbatim per the dispatch.

## The ruling, verbatim

> "Love directs scaling to three builder pairs. Rules: (1) every dispatch carries an explicit do-not-touch list naming the other lanes' territories; (2) one EOD owner per day — Session A by convention, others feed it; (3) product-brief version bumps are assigned by the reviewer surface in each dispatch, never self-assigned. Confirmed by Love, 2026-06-11."

## What this changes

The Shape-3 orchestration (`memory/decision_workflow_autonomy_single_checkin.md`, runbook at `scripts/orchestration/RUNBOOK.md`) was built and proven on a single builder+reviewer pair, then run as two pairs (Sessions A and B) on Day-52/53. This ruling scales the model to **three concurrent builder pairs** (Sessions A, B, C), each its own two-party seam, with three coordination rules layered on top:

1. **Explicit do-not-touch lists.** Every dispatch names the other lanes' territories (routes, modules, data) that the receiving session must not modify. Lane isolation is declared up front in the dispatch, not inferred by the builder.
2. **One EOD owner per day.** Session A owns the day's EOD record by convention; Sessions B and C feed their closing state to Session A instead of filing their own EOD docs. One canonical closing record per day.
3. **Brief version bumps are dispatch-assigned.** When a lane's work requires a `PLANNER_PRODUCT_BRIEF.md` version bump, the assignment comes from the reviewer surface in that lane's dispatch. A builder never self-assigns a brief bump — this prevents two lanes racing the same version number (the §9 amendment log is append-only per `memory/feedback_brief_amendment_log_append_only.md`).

Per-pair mechanics are unchanged: the two-party seam stays permanent per pair, the path gate + merge Action + park labels + Love-triggers all apply to each pair independently, and parallel sessions isolate via `git worktree` (standing convention per `memory/feedback_parallel_sessions_use_git_worktree.md`).

## Runbook sync required (flagged)

`scripts/orchestration/RUNBOOK.md` needs these same three rules folded in — it currently documents only the per-pair flow and says nothing about multi-pair coordination. That edit is **off the docs allowlist** (`scripts/**` fails `path-gate.sh`), so it cannot ride this memo's docs-lane PR: it PARKS as its own one-line PR, opened alongside this memo per the dispatch.
