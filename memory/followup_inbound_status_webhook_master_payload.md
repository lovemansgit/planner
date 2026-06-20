---
name: followup_inbound_status_webhook_master_payload
description: P1 (Day-67 / 2026-06-19) — SF sends live driver status in the top-level `status` field on EVERY webhook incl. the "master" TASK_HAS_BEEN_UPDATED, but Planner advances internal_status only from the dedicated TASK_STATUS_UPDATED_TO_* ACTION string and the edit applier ignores `status`. Tenants whose SF portal has only TASK_HAS_BEEN_UPDATED subscribed never leave CREATED though SF is telling us the status on every payload. Diagnosis + evidence + status-VALUE vocabulary + backfill plan.
metadata:
  type: followup
---

# Inbound SF status webhook — the "master" TASK_HAS_BEEN_UPDATED payload carries `status`, and Planner ignores it

**Filed:** 2026-06-19, P1 from Ops UAT (Love-reported: a real delivery sat at CREATED through three "Updated · SuiteFleet webhook" timeline entries instead of moving to IN_TRANSIT). **Status:** Diagnosed to certainty against real production `webhook_events` (read-only, Love-authorized). **Backfill: PARKED** for Love's named write-authorization; do not execute until the correct subscriptions are confirmed flowing.

## Headline (two true things)

1. **Subscription gap (the immediate cause).** SF System-Webhook subscriptions are **per-event-type**. The affected UAT tenants had only the `TASK_HAS_BEEN_*` events wired to Planner's per-tenant URL — NOT the dedicated `TASK_STATUS_UPDATED_TO_*` driver-transition events. Registering the dedicated events (Love, 2026-06-19, tenant `mlp`/Meal Up) made statuses flow immediately. This is vendor/config, not code.

2. **Latent code bug (Love's "master webhook" intuition, confirmed from data).** SF puts the **live driver status in a top-level `status` field on EVERY webhook**, including the "master" `TASK_HAS_BEEN_UPDATED`. Planner's status applier keys off the **action string** (`mapSuiteFleetStatusToInternal(sfAction)` in [status-mapper.ts](../src/modules/integration/providers/suitefleet/status-mapper.ts)), and the edit applier ([apply-webhook-edit-event.ts](../src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts)) reads `deliveryDate`/times/`deliveryInformation`/`consignee.location` and **drops `status` entirely**. So a tenant subscribed only to `TASK_HAS_BEEN_UPDATED` receives the full status progression on every payload and ignores it.

## Decisive evidence (production `webhook_events`, 2026-06-19, read-only)

**One task walked itself through four master webhooks today** — AWB `MLU-97015852` (tenant `mlp`/Meal Up), all action `TASK_HAS_BEEN_UPDATED`:

| Time (UTC) | top-level `status` | `shipmentPackages[0].packageStatus` | Planner result |
|---|---|---|---|
| 12:10:04 | `ORDERED` | `ORDERED` | ignored |
| 12:44:10 | `PICKED_UP` | `PICKED_UP` | ignored |
| 12:59:06 | `OUT_FOR_DELIVERY` | `OUT_FOR_DELIVERY` | ignored |
| 13:42:43 | `DELIVERED` | `DELIVERED` | ignored |

Task stayed `internal_status = CREATED` throughout. The dedicated `TASK_STATUS_UPDATED_TO_DELIVERED` payload carries the **same** `status: "DELIVERED"` — which is why subscribing to it fixes the flow (the status applier maps the action, gets `DELIVERED`, applies).

**The apply/match logic is correct.** A scan for `TASK_STATUS_UPDATED_TO_*` rows matching no task (the signature of a lookup/column bug) returned **zero orphans**. Every status event that ever arrived matched its task (lookup is `external_tracking_number = awb`, correct, fixed long ago in #210). The reviewer-surface audit's column-mismatch and AWB-suffix theories are both **disproven**.

**Driver-transition events globally stopped ~21–23 May 2026** (last `DELIVERED` 2026-05-23, `IN_TRANSIT`/`OUT_FOR_DELIVERY` 2026-05-21, `PICKED_UP` 2026-05-19) while `TASK_HAS_BEEN_UPDATED` kept arriving to today — the subscription set changed for the new merchant tenants.

## SF `status` field VALUE vocabulary (for the fix's map — NOT the action map)

Distinct `status` values observed in `webhook_events.raw_payload->>'status'`:

```
ORDERED, PICKED_UP, ARRIVED_IN_DC, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, FAILED, CANCELED
```
Not yet observed but expected by symmetry: `ASSIGNED, HUB_TRANSFER, RESCHEDULED, REATTEMPT, PROCESS_FOR_RETURN, RETURNED_TO_SHIPPER`.

**GOTCHA (load-bearing):** the status VALUE is `ARRIVED_IN_DC` (IN), while the matching ACTION is `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC` (ON). The value vocabulary is **not** a substring of the action vocabulary — a status-VALUE→InternalTaskStatus map must be its own explicit table, re-probed against the live wire, never derived by slicing the action string.

## Affected merchant tenants (CREATED + pushed, only `TASK_HAS_BEEN_*` receipts) — 2026-06-19

| slug | name | count | delivery_date span | note |
|---|---|---|---|---|
| `demo-bistro` | Demo Bistro | 6 (`DMB-*`) | 2026-05-18 .. 05-29 | mostly past-dated → genuinely stuck |
| `meal-plan-scheduler` | Meal Plan Scheduler | ~90 (`MPL-*`) | 2026-05-12 .. 07-02 | MIX: past-dated stuck + future-dated legitimately-CREATED |
| `mlp` | Meal Up | 10 (`MLU-*`) | 2026-05-18 .. 06-26 | UAT tenant; dedicated webhooks now registered |

The exact set is re-derivable read-only via [scripts/diag-p1-status-webhook-readonly.mjs](../scripts/diag-p1-status-webhook-readonly.mjs).

## Backfill plan (PARKED — needs Love's named write-authorization; wait for subscriptions to be confirmed flowing)

The originally-imagined "replay from logged `webhook_events`" **cannot recover these** — for the stuck tasks there is no status row in `webhook_events` to replay (the status arrived inside ignored `TASK_HAS_BEEN_UPDATED` bodies, or as un-subscribed events). Two viable recovery sources:

1. **Re-derive from the master `status` field already in `webhook_events`** — for tasks whose `TASK_HAS_BEEN_UPDATED` receipts carry a terminal/advanced `status` (e.g. `MLU-97015852` has a `DELIVERED` body), map the latest `status` → internal and UPDATE. Cheap; uses data we already hold. Only as accurate as the last received master payload.
2. **Authoritative SF fetch** — `GET /api/tasks/awb/{awb}/task-activities` per affected task, set `internal_status` from SF's current truth. Most accurate; costs one SF call per task (~100 tasks).

Either is a **write** → parks for Love's NAMED authorization, and only AFTER the code fix + correct subscriptions are confirmed (else tasks re-stale immediately). Recommend #2 for terminal accuracy, gated on the fix landing.

## Cross-references
- Receiver route (per-event dispatch by action): [route.ts](../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts) L286.
- Status applier (action→internal): [apply-webhook-status-event.ts](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts).
- Edit applier (ignores `status`): [apply-webhook-edit-event.ts](../src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts).
- SF webhook taxonomy + per-status routing: [followup_suitefleet_webhook_policy.md](followup_suitefleet_webhook_policy.md).
- Real edit-payload corpus (no status field was noted there because the corpus only inspected `deliveryInformation`): [followup_inbound_webhook_null_tolerance_regression.md](followup_inbound_webhook_null_tolerance_regression.md).
- Observability + smoke gaps that let this hide ~4 weeks: [followup_webhook_inbound_smoke_and_monitoring.md](followup_webhook_inbound_smoke_and_monitoring.md).
