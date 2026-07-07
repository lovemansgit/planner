# STATE — v2.0 session-survival file

_Methodology v2.0 §7. Read first every session (after the date check); rewritten
after every cycle's verify step. Where conversation memory and this file
disagree, this file wins._

## Now
Loop test complete (#665 merged); AC-LOOP-1 owner-ratified 7 Jul 2026; v2.0 live
for all load-bearing work. This PR: methodology mirror synced to v2.0 + brief
ratification entry. Next action: none in flight — next session starts from brief.

## Criteria
| AC-id | Check command | Last run | PASS/FAIL | Output path |
|---|---|---|---|---|
| AC-LOOP-1 | `for h in "## Now" "## Criteria" "## Attempts" "## Defaults taken" "## Adds"; do grep -qxF "$h" memory/STATE.md \|\| { echo "FAIL: missing $h"; exit 1; }; done; echo PASS` | 2026-07-07 | PASS | memory/check-runs/AC-LOOP-1-2.txt |

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
