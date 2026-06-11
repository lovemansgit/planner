---
name: Asset tracking — Phase 2 deferral (Day 18, post-A2-plan-PR)
description: Asset-tracking workstream is entirely out of MVP per Day-18 product-owner ruling. asset_tracking_cache table + migration 0011 stay shipped as dormant infrastructure. Two registered audit events (asset_tracking.state_changed, asset_tracking.taskid_unmatched) stay registered but emit zero events in MVP. /api/task-asset-tracking polling integration deferred. bagsReturned + icePacksReturned webhook fields deprecated; webhook handler ignores. POD photos in MVP source from deliveryInformation.photos, NOT asset_tracking_cache.photos. Captures the re-wire scope for Phase-2 unfreeze.
type: project
---

# Asset tracking — Phase 2 deferral

## §1 Ruling

Per Day-18 product-owner ruling, the entire asset-tracking workstream is out of MVP. This includes:

- The `/api/task-asset-tracking` polling integration with SuiteFleet.
- The `asset_tracking_cache` read/write paths in service-layer code.
- The `bagsReturned` and `icePacksReturned` webhook payload fields.
- Any UI surface that displays bag count, ice-pack count, bag state transitions, or related telemetry.

The MVP demo (May 18 external, May 15 internal) does not depend on asset-tracking visibility. POD photos — the load-bearing demo signal for delivery completeness — source from a different webhook field (see §3 below).

This memo captures the deferral so the Phase-2 unfreeze has a single anchor for "what was scoped out and what needs re-wiring."

## §2 Dormant infrastructure (stays shipped, no removal)

The following ships in MVP and stays shipped through Phase 2; nothing about the deferral requires teardown or refactor.

### §2.1 Schema

[supabase/migrations/0011_asset_tracking_cache.sql](../supabase/migrations/0011_asset_tracking_cache.sql) — `asset_tracking_cache` table is in production. Columns include `photos jsonb` (the original target for POD landing before the §3 reframe), `task_id NOT NULL` (FK ON DELETE-RESTRICT path per the B-1 race-path design), tenant scoping, RLS, and the standard tenant-isolation policy form.

The migration stays applied. No follow-up migration drops or alters it.

### §2.2 Audit event vocabulary

Two audit event types are registered in [src/modules/audit/event-types.ts](../src/modules/audit/event-types.ts) and stay registered in MVP:

- `asset_tracking.state_changed` (line 543) — emitted when a cached package's state column transitions (`COLLECTED` / `EN_ROUTE` / `RECEIVED` / `RETURNED`); both webhook-driven and read-through-fetch trigger sources documented.
- `asset_tracking.taskid_unmatched` (line 553) — emitted when SF returns an asset-tracking record whose `taskId` does not match any local `tasks.external_id`; the cache write is dropped and the event preserves forensic trail.

Both fire zero times in MVP because no code path writes to `asset_tracking_cache` or polls `/api/task-asset-tracking`. Registration retained so Phase-2 wiring doesn't have to relitigate vocabulary at unfreeze.

## §3 What replaces asset-tracking in MVP

POD photos in MVP source from `deliveryInformation.photos` in the SuiteFleet webhook payload, **not** from `asset_tracking_cache.photos`. Webhook handler 3-layer plan-PR (`memory/plans/day-18-a2-webhook-handler-3-layer.md` §4.4) ships migration 0022 with a new `tasks.pod_photos jsonb` column wired directly from the `TASK_STATUS_UPDATED_TO_DELIVERED` event.

The two POD storage surfaces are deliberately separate:

- `tasks.pod_photos` (NEW, MVP) — webhook-driven, populated synchronously with `internal_status = 'DELIVERED'` flip. Zero dependency on asset-tracking infrastructure.
- `asset_tracking_cache.photos` (existing, dormant) — would be populated by the Phase-2 polling integration. Currently no writer.

There is no MVP code path that reads `asset_tracking_cache.photos`. Phase-2 design will decide whether `asset_tracking_cache.photos` remains a separate cache (driver-photo, packaging-state photos) or is consolidated into `tasks.pod_photos`.

## §4 Deprecated webhook fields (ignored in MVP)

Two `deliveryInformation.*` payload fields are explicitly NOT extracted by the Layer-3 edit-event mapping in the A2 plan-PR (see plan §4.2 "Deprecated, NOT extracted"):

- `deliveryInformation.bagsReturned` — always NULL per product-owner ruling.
- `deliveryInformation.icePacksReturned` — always NULL per product-owner ruling.

The webhook handler does not assert their presence/absence. The fields can appear in raw payloads (preserved in `webhook_events.raw_payload`) or be missing — neither shape changes handler behaviour. At Phase-2 unfreeze these fields may resurface as legitimate data sources; until then they are noise.

## §5 Re-wire scope at Phase-2 unfreeze

When the workstream unfreezes, the re-wire surface area is concentrated in five places:

### §5.1 Polling integration (new code)

- Read-through call-site against `/api/task-asset-tracking` SuiteFleet endpoint. Likely lives at `src/modules/integration/providers/suitefleet/asset-tracking-client.ts` (file already scaffolded in repo per Day-7+).
- Cron schedule: TBD at Phase-2 plan time. Frequency depends on pilot ops feedback on bag-loss investigation cadence.

### §5.2 Cache read path (new code)

- `asset_tracking_cache` SELECT call-sites for the bag-state UI surface. None today.
- RLS already enforces tenant isolation; no schema-side work needed.

### §5.3 Cache write path (existing scaffolds, currently no callers)

- `asset_tracking_cache` INSERT / UPSERT call-site keyed off `task_id`. The B-1 race-path design landed at the schema level (NOT NULL `task_id`, drop on unmatched).
- Write triggers: webhook handler (on `bagsReturned` / `icePacksReturned` non-null) AND polling response.

### §5.4 Webhook field re-enable

- Layer-3 edit-event mapping in the A2 webhook handler service fn extends to consume `bagsReturned` and `icePacksReturned`. Currently NOT extracted.
- Decision point: do these fields write to `asset_tracking_cache` directly OR to a denormalised column on `tasks`? Consistent with the §4.5 Option (1) ruling for other webhook-extracted fields, the latter is more likely; the former preserves the original B-1 cache design. Phase-2 plan-time call.

### §5.5 UI surface

- Bag count / ice-pack count display on the `/calendar` consolidated view + per-consignee detail page popover. Currently absent.
- Bag-state transitions visualisation (per-task timeline §3.3.6 — the brief's existing per-task delivery state timeline could absorb this).

### §5.6 Audit-event emit paths

- Both `asset_tracking.state_changed` and `asset_tracking.taskid_unmatched` need call-sites. Currently zero. Re-enables when §5.3 + §5.4 wire up.

## §6 Cross-references

- `memory/plans/day-18-a2-webhook-handler-3-layer.md` §8.1 — Phase-2 deferral reasoning + dormant-infrastructure framing.
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.3.8 — cache-from-webhook commitment; POD is the canonical example sourcing from `tasks.pod_photos` not `asset_tracking_cache`.
- `memory/decision_layer_1_5_awb_only_extraction.md` — Layer 1.5 AWB-only extraction; the lookup discipline that lets Layer 2 + 3 wiring proceed without asset-tracking dependency.
- `supabase/migrations/0011_asset_tracking_cache.sql` — table + RLS + B-1 race-path design.
- `src/modules/audit/event-types.ts:543` — `asset_tracking.state_changed` registered event.
- `src/modules/audit/event-types.ts:553` — `asset_tracking.taskid_unmatched` registered event.
- `src/modules/integration/providers/suitefleet/asset-tracking-client.ts` — provider scaffold (no current callers).
- `memory/decision_bag_tracking_mvp.md` — original bag-tracking design memo (predates the Phase-2 deferral; superseded by this memo for MVP scope).
