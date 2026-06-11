---
name: Auto-pause and bounded-pause now have semantically different "paused" states
description: Day-16 Block 4-C Service B introduced bounded pauseSubscription per brief §3.1.7 (explicit window, task cancellation, end_date extension, auto-resume on schedule). The pre-existing autoPauseSubscriptionForRepeatedFailure (MP-14 emergency-halt) still uses the original status-flip-only semantics via the retained pauseSubscriptionRow helper. Both write subscriptions.status='paused' but have different downstream behaviors. Most consequentially: auto-paused subscriptions will NEVER be auto-resumed because the auto-resume cron's selection SQL filters on subscription_exceptions WHERE type='pause_window' rows that auto-pause does not write. Operator UX surfaces don't distinguish the two pause kinds today.
type: project
---

# Auto-pause vs bounded-pause semantic divergence

**Surfaced:** Day-16 Block 4-C Service B staging.

**Root cause:** Two pause flows now exist in the codebase with different semantics under the same `subscriptions.status='paused'` value:

| Aspect | Bounded pauseSubscription (new) | autoPauseSubscriptionForRepeatedFailure (existing) |
|---|---|---|
| Trigger | Operator-initiated UI | System emergency-halt on repeated SF push failure (MP-14) |
| Window | Explicit pause_start + pause_end | None (open-ended) |
| subscription_exceptions write | INSERT type='pause_window' | None |
| Tasks-in-window cancellation | Bulk UPDATE → CANCELED | None |
| end_date extension | Yes, eligible-day-walk | None |
| Auto-resume eligible | Yes (cron picks up via subscription_exceptions WHERE type='pause_window' AND end_date <= today) | NO — never auto-resumes |
| Manual resume | Manual or auto via /api/cron/auto-resume | Existing resumeSubscription path (now expects pause_window row) — UNTESTED |

**Latent surprise: auto-paused subscriptions are stranded.** The auto-resume cron's selection SQL relies on `subscription_exceptions` rows of `type='pause_window'`. Auto-pause writes only to `subscriptions`, not to `subscription_exceptions`. An auto-paused subscription stays paused forever unless an operator manually resumes it.

**Latent surprise: existing resumeSubscription on an auto-paused subscription.** The new resumeSubscription expects a `subscription_exceptions` pause_window row to anchor the resume (per brief §3.1.7). On an auto-paused subscription with no such row, `findActivePauseWindow` returns null, and resumeSubscription returns `already_active` even though `subscriptions.status='paused'`. The status DOES flip back to 'active' in step 2.e, but the audit metadata is wrong (no correlation to the original pause), and tasks restored count is zero (none to restore — auto-pause never canceled tasks).

**Operator UX gap.** Brief §3.3.5 expects a pause/resume CTA on subscription detail page. Today, an auto-paused subscription will show the same UI as a bounded-paused one. Operator clicking resume gets the "already active"/"resumed silently" path, which works but the audit trail is asymmetric.

**Routing options for Phase 2:**

1. **Converge auto-pause to bounded-pause shape.** Auto-pause writes a subscription_exceptions row of type='pause_window' with end_date set far-future or NULL (open-ended bounded pause). Auto-resume cron skips rows with NULL end_date or end_date in the indefinite future. Operator can manually resume by setting end_date to today.
2. **Add `pause_kind` column to subscriptions.** Distinguish 'bounded' vs 'emergency_halt' explicitly. Auto-resume cron filters on bounded only. Operator UX branches on pause_kind for label + workflow.
3. **Migrate auto-pause to the bounded-pause API.** Refactor autoPauseSubscriptionForRepeatedFailure to call pauseSubscription with a synthetic open-ended window. Cleaner; deprecates pauseSubscriptionRow entirely.

**Decision deferred to post-demo.** May 12 demo doesn't exercise auto-pause; the divergence is a Phase 2 hardening item.

**Cross-references:**

- `src/modules/subscriptions/service.ts` (Block 4-C commit) — new bounded pauseSubscription
- `src/modules/subscriptions/repository.ts:pauseSubscriptionRow` — retained for autoPauseSubscriptionForRepeatedFailure caller
- `src/modules/...autoPauseSubscriptionForRepeatedFailure` — MP-14 emergency-halt (Day-7 / S-7 origin)
- Brief §3.1.7 — bounded pause spec
- Brief §3.3.5 — subscription detail page UX (operator pause/resume CTA)
- `memory/followup_plan_path_drift_subscription_exceptions.md` — sibling Day-16 followup memo capturing other §3-§4 plan-vs-code drifts
