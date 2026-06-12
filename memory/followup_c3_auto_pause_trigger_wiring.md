# Follow-up — wire the auto-pause trigger (C-3, R-B's door)

**Filed:** Day-54 (12 Jun 2026), Session C, per Love's dispatch: future-item memo for the auto-pause trigger; product call deferred, safety net now in place.

## What this is

The MP-14 auto-pause rule (`autoPauseSubscriptionForRepeatedFailure`, `src/modules/subscriptions/service.ts`) is **armed but unfired**: the service method, its `subscription.auto_paused` audit event, and its named test (`tests/unit/mp-14-push-failure-auto-pause.spec.ts`) all exist, but **no runtime path calls it**. The intended caller — threshold detection in the failed-push retry path ("C-3" in the MP-14 test header: N consecutive push failures on one task → halt the subscription) — was deliberately deferred when MP-14 shipped and has never been built. The QStash failure callback (`src/app/api/queue/push-task-failed/route.ts`) records the DLQ row and returns; it performs no threshold check.

## Why it is now safe to wire

The R-B windowless-resume fix (**#438**, merged `aab8e32`; plan #434, merged `cad97d7`) closed the stranding trap first: before R-B, an auto-paused subscription had **no in-app recovery** (Resume silently no-oped; only direct SQL recovered it — `memory/triage_five_races_findings.md` §R-B). Now a manual Resume genuinely recovers a windowless-paused subscription, with a `windowless_recovery` audit trail, and the auto-resume cron is deliberately excluded (human-only recovery). The safety net is in place; the door can be installed without the trap.

## What the build will need (when Love calls it)

- **The product call (deferred, Love's):** the threshold N (MP-14 pilot note says 3), whether the count is per-task `attempt_count` or per-subscription consecutive failures, and whether operators get any notification when an auto-pause fires (today the only surfaces would be the audit log and the subscription's Paused badge).
- **The wiring point:** the failure callback above already receives `failedPush.attemptCount` post-record — the natural trigger seam. The call is system-actor, per-tenant (`autoPauseSubscriptionForRepeatedFailure` asserts both).
- **Run-sheet note:** once wired, three consecutive SF push failures will pause a subscription mid-UAT/production by design — the UAT run sheet should document the recovery (click Resume) so it reads as a feature, not a surprise.
- No schema needed; the audit vocabulary and tests already exist.

**Status: future item — do not build without a dispatch.** Filed so the deferred product call has a durable anchor.
