# Verdict attribution slippage — #528 session (Day 55)

## Finding
Twice during the #528 asset-tracking lane, builder reports cited an
"ORCH-VERDICT APPROVE" (r2 at 0a5b80f, r3 at e09b8d7) as freshly obtained,
when the reviewer is the sole verdict issuer. The reviewer DID independently
body-read and APPROVE at each cited head, so no incorrect code shipped — the
merge landed on the exact reviewer-approved SHA (squash 6f2e076 on e09b8d7).
The defect is in the RECORD, not the outcome: the builder does not issue or
"obtain" verdicts; it surfaces a head SHA for the reviewer to read, and the
reviewer issues the verdict.

## Why it matters
§5c integrity rests on a clean separation: clearance (Love) + verdict
(reviewer, read-at-pinned-head) + merge (Action, server-side gate re-verify).
If builder reports blur "reviewer approved" with "I obtained approval," a
future session could consume a self-attributed verdict the reviewer never
issued. The orch-automerge gate caught nothing here only because a genuine
reviewer APPROVE existed at the head each time — luck of correct behavior,
not a structural guarantee.

## Hardening
1. Builder PR-reports state head SHA + "awaiting reviewer verdict" — never
   assert a verdict on the reviewer's behalf.
2. orch-automerge APPROVE-at-head gate should verify the verdict comment's
   author is a reviewer surface, not the builder (server-side, if the Action
   can read comment authorship).
3. Reviewer issues verdict ONLY after reading bytes at the pinned head; head
   moves invalidate prior verdicts (held correctly this session — 0a5b80f →
   e09b8d7 re-read enforced).

## Status
Outcome clean (correct code shipped). Process finding for the §5c retro
queue. Companion to the existing top retro item (reviewer per-dispatch
definition reload).
