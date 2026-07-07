# STATE — v2.1 session-survival file

_Methodology v2.1 §7. Read first every session (after the date check); rewritten
after every cycle's verify step. Where conversation memory and this file
disagree, this file wins._

## Now
Methodology canon moved to lovemansgit/methodology (v2.1 @ f15fb13e); this PR
removes the planner mirror and adds memory/POINTER.md (owner-ordered 7 Jul).
Next action: none in flight — next session bootstraps from brief + POINTER.md.

## Criteria
| AC-id | Check command | Last run | PASS/FAIL | Output path |
|---|---|---|---|---|
| AC-LOOP-1 | `for h in "## Now" "## Criteria" "## Attempts" "## Defaults taken" "## Adds"; do grep -qxF "$h" memory/STATE.md \|\| { echo "FAIL: missing $h"; exit 1; }; done; echo PASS` | 2026-07-07 | PASS | memory/check-runs/AC-LOOP-1-3.txt |

## Attempts
(none — no check has failed yet)

## Defaults taken
- DEFAULT: brief had no runnable criterion for the loop test → drafted AC-LOOP-1
  as the single clarification pass (v2.0 §3), appended to the brief §9 tagged
  DRAFTED-BY-AGENT, pending owner ratification — proceeding against it.

## Adds
- ADD: memory/STATE.md — required by AC-LOOP-1
- ADD: memory/check-runs/AC-LOOP-1-1.txt — required by AC-LOOP-1
- ADD: memory/check-runs/AC-LOOP-1-2.txt — required by AC-LOOP-1 (re-run after this cycle's STATE.md rewrite)
- ADD: memory/check-runs/AC-LOOP-1-3.txt — required by AC-LOOP-1 (re-run after this cycle's STATE.md rewrite)
- ADD: memory/POINTER.md — required by owner ruling 7 Jul 2026 (order 1, quoted in the brief §9 pointer entry and the LOVE-RULING comment on its PR); no AC-id — owner-ordered addition
- ADD: memory/followup_methodology_pointer_dangling_refs.md — required by reviewer round-1 item 3 on PR #667 (files the off-allowlist follow-up); no AC-id — review-ordered addition
