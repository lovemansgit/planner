---
name: pauseSubscriptionRow repository helper retained but lacks direct unit tests
description: Day-16 Block 4-C Service B retained the existing pauseSubscriptionRow repository helper (sole caller: autoPauseSubscriptionForRepeatedFailure / MP-14 emergency-halt). Original direct unit tests at repository.spec.ts were deleted alongside the now-removed resumeSubscriptionRow tests. Helper is now exercised only indirectly via the auto-pause service test (which mocks at the service entry, not at the repository boundary). Coverage gap exists.
type: project
---

# pauseSubscriptionRow direct-test coverage gap

**Surfaced:** Day-16 Block 4-C Service B staging.

**Drift:** `src/modules/subscriptions/repository.ts:pauseSubscriptionRow` was retained when bounded `pauseSubscription` rewrote in place (Block 4-C). Sole caller is `autoPauseSubscriptionForRepeatedFailure` (MP-14 emergency-halt, Day-7 origin). The helper's original direct unit tests at `subscriptions/tests/repository.spec.ts` were deleted in the Service B commit because they tested signatures incompatible with the new bounded pause shape — but `pauseSubscriptionRow` itself wasn't deleted, leaving direct tests gone but the helper alive.

**Risk:** Repository-layer regressions in `pauseSubscriptionRow` (e.g., RLS bypass, missing tenant_id filter, status-flip race) won't be caught by the auto-pause service test, which mocks at the service entry boundary.

**Why not blocking Service B:** Pre-existing test debt; Block 4-C didn't introduce the gap, just made it visible. Auto-pause flow is an MP-14 emergency-halt path that runs on real merchant data but is not exercised in the May 12 demo posture.

**Fix when ready:**

Add direct unit tests for `pauseSubscriptionRow` at `src/modules/subscriptions/tests/repository.spec.ts` covering:

- Happy path: subscription found, status flipped, paused_at populated
- Not-found: subscription doesn't exist → returns null
- Cross-tenant: subscription in different tenant_id → returns null (RLS)
- Already-paused: idempotent or rejects (whichever the helper currently does)
- Returns the before/after snapshot per the helper's contract

Estimated ~80-120 lines. T1 test-only PR scope.

**Cross-references:**

- `src/modules/subscriptions/repository.ts:pauseSubscriptionRow` — the helper
- `src/modules/...autoPauseSubscriptionForRepeatedFailure` — sole caller (MP-14)
- `memory/followup_auto_pause_vs_bounded_pause_divergence.md` — sibling Day-16 followup memo on the broader auto-pause vs bounded-pause divergence
