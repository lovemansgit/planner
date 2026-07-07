# STATE — v2.0 session-survival file

_Methodology v2.0 §7. Read first every session (after the date check); rewritten
after every cycle's verify step. Where conversation memory and this file
disagree, this file wins._

## Now
Loop test (methodology v2.0 §11 step 6, Love-ruled 7 Jul 2026): prove the full
loop — brief amendment → STATE.md → check → reviewer → merge gate → notification
— on AC-LOOP-1. Next action: open docs-lane PR, invoke reviewer with PR number.

## Criteria
| AC-id | Check command | Last run | PASS/FAIL | Output path |
|---|---|---|---|---|
| AC-LOOP-1 | `for h in "## Now" "## Criteria" "## Attempts" "## Defaults taken" "## Adds"; do grep -qxF "$h" memory/STATE.md \|\| { echo "FAIL: missing $h"; exit 1; }; done; echo PASS` | 2026-07-07 | PASS | memory/check-runs/AC-LOOP-1-1.txt |

## Attempts
(none — no check has failed yet)

## Defaults taken
- DEFAULT: brief had no runnable criterion for the loop test → drafted AC-LOOP-1
  as the single clarification pass (v2.0 §3), appended to the brief §9 tagged
  DRAFTED-BY-AGENT, pending owner ratification — proceeding against it.

## Adds
- ADD: memory/STATE.md — required by AC-LOOP-1
- ADD: memory/check-runs/AC-LOOP-1-1.txt — required by AC-LOOP-1
