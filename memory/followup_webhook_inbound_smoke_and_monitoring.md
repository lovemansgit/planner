---
name: followup_webhook_inbound_smoke_and_monitoring
description: Two hardening follow-ups raised by the Day-67 P1 (inbound status webhook ignored / un-subscribed). (1) Pre-UAT smoke never exercised a real inbound STATUS-webhook round-trip or verified the per-tenant SF subscription set — add an inbound-status leg. (2) No alerting on webhook-action MIX or on status `task_not_found` — a subscription lapse / status drop is invisible without log-diving. Add an action-mix monitor + Sentry capture on status task_not_found. File-only; do not build without a plan.
metadata:
  type: followup
---

# Webhook inbound smoke + monitoring gaps (Day-67 P1 retro)

**Filed:** 2026-06-19, alongside [followup_inbound_status_webhook_master_payload.md](followup_inbound_status_webhook_master_payload.md). **Status:** recommendations only — NOT built. Each is its own plan when picked up.

## Why this exists

A real delivery's status sat at CREATED for hours while SF was sending the live status on every webhook, and the broader subscription gap had been silently dropping driver-transition events since ~21–23 May — **~4 weeks undetected**. Two gaps let it hide:

### Gap 1 — smoke never did a real inbound STATUS round-trip (the forcing function)

Pre-UAT smoke verified AWB re-creation and DB-side POD, but **never drove a real inbound `TASK_STATUS_UPDATED_TO_*` (or master-payload `status`) round-trip end-to-end**, and never asserted the **per-tenant SF subscription set** is complete. A round-trip leg would have caught both the ignored-`status` bug and the missing subscriptions on day one.

**Recommendation:** add a smoke leg that, for each merchant tenant, (a) confirms the SF portal has all driver-transition events subscribed to that tenant's `…/api/webhooks/suitefleet/{tenantId}` URL, and (b) flips a throwaway sandbox task through PICKED_UP → DELIVERED and asserts Planner's `internal_status` advances. Pair with a per-tenant subscription-inventory check (the per-status routing is documented in [followup_suitefleet_webhook_policy.md](followup_suitefleet_webhook_policy.md)).

### Gap 2 — no alerting on webhook action MIX or status `task_not_found`

- The status applier emits only `log.warn` on `task_not_found` ([apply-webhook-status-event.ts](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) L400-406) — **no `captureException`**, unlike the route's other failure paths. A silent AWB mismatch (e.g. re-creation) is invisible without log-diving.
- Nothing watches the **action MIX**. A tenant that suddenly receives only `TASK_HAS_BEEN_*` and zero `TASK_STATUS_UPDATED_TO_*` over a window is the exact signature of a subscription lapse — and is trivially detectable.

**Recommendation:** (a) add `captureException` on status `task_not_found` (low-risk, ~3 LOC); (b) add a lightweight monitor (cron or daily digest) that alarms when a tenant with active deliveries has received no driver-transition events over a rolling window, OR when the `status`-field of inbound master webhooks advances past CREATED but `tasks.internal_status` has not. The second form catches the ignored-`status` class directly even if subscriptions are fine.

## Posture

Both are post-fix hardening, not the P1 fix itself. They park as separate small plans. Do not bundle into the status-fix PR (over-engineering trigger) unless Love rules otherwise.
