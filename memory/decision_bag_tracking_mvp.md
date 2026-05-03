---
name: Asset tracking MVP design
description: Hybrid cache + read-through architecture for SuiteFleet asset tracking (operationally "bag tracking"). One cache row per package, 4-state taxonomy from SF doc §6.2, 5-minute TTL, audit-none on cache reads, surfaced on consignee detail + calendar/dashboard. Asset-tracking-enabled flag derived from inbound webhook payload (no separate API call needed)
type: decision
---

Substance of the asset-tracking design was developed in the Day-5 EOD
claude.ai session and lived in working notes. The first version of
this memo (1 May 2026, pre-B-1) used the operational nickname "bag
tracking" throughout, assumed a per-task cardinality, and listed a
provisional 5-state taxonomy. B-1 surfaced empirical findings that
contradict each of those choices; this rewrite reconciles the memo
with the post-B-1 reality so B-2 reads from a coherent design
record.

**Status:** B-1 merged (PR #59). Schema, types, repository, outbound
SF client, and adapter wiring all live. B-2 (T2 closing commit)
adds the service layer (read-through + TTL + cache invalidation),
the audit-event catalogue additions, surface routes, and the
paymentMethod probe.

## Terminology: "asset tracking", not "bag tracking"

"Bag tracking" is the operational nickname Transcorp uses internally
because their pilot uses reusable delivery bags for meal-plan
deliveries. The SuiteFleet API surface is **asset-typed**, with
`BAGS` as one possible asset type. The doc anticipates `BOX`,
`PALLET`, `CONTAINER` as future possibilities.

Code, schema, and module names use the asset-typed vocabulary:
`asset_tracking_cache`, `src/modules/asset-tracking/`,
`AssetTrackingPackage`, `fetchAssetTrackingByAwb`. Operator-facing
copy can keep saying "bags" — the storage layer doesn't care which
label the UI surfaces.

## What asset tracking is

A SuiteFleet feature that tracks physical assets (typically reusable
delivery bags or containers) attached to packages on a task across
the delivery lifecycle. The merchant's couriers attach assets to
packages at pickup; the asset's location and state propagate through
SF's task lifecycle events; the merchant gets visibility on which
assets are out, in transit, received, or returned.

For Transcorp's pilot (reusable bags for meal-plan deliveries),
this is operationally important — bag-loss rate directly affects
unit economics. Surfacing asset state on the operator UI is the
user value.

## Cardinality correction: one row per PACKAGE

The pre-B-1 version of this memo modelled the cache as
`(tenant_id, task_id) → state`. **That was wrong.** A single AWB
with N packages returns N tracking records from SF; each has its
own `id`, `trackingId` (`<awb>-<index>`), `state`, photo log, and
recipient signature blocks.

The cache models packages as the unit of caching. Unique key:
`tracking_id`. See
[`followup_suitefleet_asset_tracking_api.md`](followup_suitefleet_asset_tracking_api.md)
"Cardinality" section for the empirical confirmation and the
`<awb>-<index>` format breakdown.

The `awb` column on `asset_tracking_cache` is a STORED generated
column derived from `tracking_id` so application code cannot drift
the two values (defence-in-depth gap closed during B-1 review).

## Architecture: hybrid cache + read-through

The design pattern is **hybrid cache + read-through with TTL**:

1. **Local cache table** ([`0011_asset_tracking_cache.sql`](../supabase/migrations/0011_asset_tracking_cache.sql))
   stores one row per package per `(tenant_id, tracking_id)`.
   Columns: internal `task_id` (uuid FK to `tasks.id`),
   `task_id_external` (bigint, SF's taskId), `external_record_id`
   (bigint, SF's per-record id), `tracking_id` (text, primary
   lookup key), `awb` (text, generated from `tracking_id`),
   `type`, `state`, `photos` jsonb, `notes`, `supplementary_quantity`,
   `container_id`, `collected_by` / `enroute_by` / `received_by` /
   `returned_by` jsonb, `tenant_id` (denormalised, FK + match-trigger),
   `last_synced_at` (drives TTL), `created_at`, `updated_at`.
2. **Read-through with TTL.** When the operator UI requests asset
   state for a task, the service:
   - Looks up cached rows by `(tenant_id, awb)` — the AWB is the
     query key for SF's endpoint and naturally aligns with how
     records cluster.
   - If at least one row exists and `now() - last_synced_at < 5
     minutes`, returns the cached rows.
   - If the rows are missing or stale (older than 5 min), issues
     an outbound `GET /api/task-asset-tracking?awbs=<AWB>`,
     upserts the result via `upsertCacheRow` (one call per
     returned package), and returns the fresh values.
3. **Webhook-driven invalidation.** Inbound webhook events that
   carry asset-state information (the SF
   `customer.taskAssetTrackingEnabled` +
   `customer.defaultTaskAssetType` payload fields, plus task-state
   transitions that imply asset-state moves) write to the cache.
   Keeps the cache warm without polling.

Why hybrid vs. pure cache or pure read-through:

- **Pure cache (write-only via webhooks)** would miss state on
  packages whose asset-state event the webhook system dropped or
  that pre-date the webhook subscription start.
- **Pure read-through (no cache, GET on every UI render)** would
  hammer SF's `task-asset-tracking` endpoint at a rate proportional
  to UI traffic. SF's rate limit on this endpoint is unknown (vendor
  question 3 in
  [`followup_suitefleet_asset_tracking_api.md`](followup_suitefleet_asset_tracking_api.md)).
- **Hybrid** smooths both: webhooks keep the cache warm in the happy
  path; read-through with TTL covers the edges; TTL bounds how stale
  the UI can get.

## TTL: 5 minutes

5-minute TTL is the working number. Rationale unchanged from the
pre-B-1 draft:

- **Operator UX:** an asset-state change (e.g. courier marks
  RECEIVED) should propagate to the dashboard within ~one refresh
  cycle. 5 min is "fresh enough" for an operations control room
  watching a bag-loss problem; longer would feel stale.
- **SF load:** with `n` operators and `m` AWBs visible on the
  dashboard, worst-case GET rate is `n * m / 300s`. For a small ops
  team (5 operators, 20 AWBs each), that's ~20 GETs/min in the
  worst case — well within the 5 req/sec adapter throttle.
- **Webhook-warm reduces this further:** webhook events refresh the
  cache on most state changes, so TTL-driven reads only fire when
  the webhook missed.

5 min is not load-bearing. If pilot operations data shows it's
wrong, it's a one-line constant change in the B-2 service layer.

## State taxonomy: 4 values (empirical from SF doc §6.2)

The state column on `asset_tracking_cache` is a closed-domain
string enum. The four values are pinned by the
`asset_tracking_cache_state_check` constraint in 0011:

- `COLLECTED` — courier has the asset
- `EN_ROUTE` — asset moving from origin to destination
- `RECEIVED` — handed off at destination
- `RETURNED` — asset came back (returned-to-sender or recovery)

The pre-B-1 draft's 5-state taxonomy (`awaiting_pickup`, `picked_up`,
`in_transit`, `delivered`, `returned`, lowercase) was a
provisional guess and is **superseded** by the empirical 4-state
list above. The Day-4 lesson "do not trust SF documentation; trust
the empirical sample" still applies; in this case the doc IS the
empirical sample because sandbox merchant 588 has no live records
to inspect (vendor question 9 in the asset-tracking API memo).

The CHECK is restrictive (Option A from B-1 review) — surfacing SF
enum-gaps as visible CHECK violations beats silently caching unknown
values. Webhook ingestion + cache writes wrap inserts in structured
error handling so a CHECK violation logs to an error queue instead
of crashing the handler. Vendor question 1 tracks possible
`CREATED` / `DELIVERED` / `CANCELLED` expansion.

## Surface points

The asset-state values surface in two operator UIs:

1. **Consignee detail page** — when an operator drills into a
   single consignee, the active task list shows asset state per
   package. Per-customer drill-down view.
2. **Calendar / dashboard** — daily / weekly operations view shows
   asset-state badges per task card (aggregating per-package
   states up to the parent task). At-a-glance ops control view.

Both surfaces are served by B-2's service layer. The exact method
signature is a B-2 design call — likely
`getAssetTrackingByAwb(ctx, awb)` returning the cached rows after
a TTL check, or `getAssetTrackingForTask(ctx, taskId)` mapping
task→AWB→cache as a convenience for the consignee/dashboard
callers. Either shape is fine; the cache-lookup primitive
(`findCacheByAwb`) is already in the repository.

## Audit policy

### Emit-none on cache reads

Cache reads are NOT audited. Reasoning:

- A dashboard with 20 AWBs per operator firing read-through every
  5 minutes would flood `audit_events` with thousands of low-signal
  rows per day. The audit log's purpose is forensic reconstruction
  of state changes, not telemetry on UI render rates.
- Matches R-4 (the audit-events convention): reads in general are
  not audited (`getTask`, `getConsignee`, `getSubscription`).

### Three audit events for B-2 to add

Naming convention: lowercase `resource.action_past_tense` per the
audit catalogue's existing shape (cf. `task.bulk_created`,
`subscription.paused`).

1. **`asset_tracking.refreshed`** — emitted when a cache miss
   triggers an outbound SF GET. systemOnly: false (operator UI
   reads can trigger this via TTL-miss). Metadata: `awb`,
   `previous_synced_at`, `record_count`. Lets ops reconstruct
   refresh frequency from the audit log if cache hit-rate
   debugging surfaces.
2. **`asset_tracking.state_changed`** — emitted when the cache
   row's `state` column moves from one value to another (whether
   triggered by webhook or by read-through GET). systemOnly:
   false. Metadata: `tracking_id`, `task_id_external`,
   `previous_state`, `new_state`, `trigger_source` (`webhook` |
   `read_through`). Load-bearing forensic event for bag-loss
   investigation.
3. **`asset_tracking.orphan_dropped`** — emitted when SF returns
   an asset-tracking record whose `taskId` does not match any
   Planner-side `tasks.external_id`. The cache write is dropped
   (path (i) from the B-1 race-path design call: FK NOT NULL on
   `task_id` makes orphans structurally non-storable).
   **systemOnly: true** — only the ingestion path emits this; no
   user actor triggers it. Metadata per Love's note: `tracking_id`,
   `task_id_external`, `awb`. Enough to reconstruct WHICH SF
   event was dropped if ops later needs to investigate a
   webhook-period data gap.

Open question for B-2: webhook-driven cache writes that find no
state change (e.g. webhook re-delivers an already-cached event
that was already at the same state) — emit anything? Lean: no.
A no-op on the cache should be a no-op on the audit log. Document
the choice in B-2's catalogue addition.

## Bonus finding: asset-tracking-enabled flag is webhook-derived

From [`followup_suitefleet_webhook_policy.md`](followup_suitefleet_webhook_policy.md)
(Day 6 probe): every SF webhook event payload exposes:

- `customer.taskAssetTrackingEnabled` — boolean
- `customer.defaultTaskAssetType` — string (e.g. `"BAGS"`)

**Implication.** Planner does NOT need a separate "is asset
tracking enabled for this merchant?" API call. The first webhook
event for a new tenant carries the answer. Persist it on a
tenant-scoped settings row (or a dedicated column on `tenants`) on
receipt; refresh on subsequent events; default-falsy until the
first webhook arrives. This wiring is a post-B-2 follow-up — B-2
itself focuses on the read-through service + audit catalogue +
surface routes, not the persistence of the per-tenant flag.

This shaves one outbound API call from the design and avoids a
race condition where Planner would otherwise have to bootstrap
the flag before any task-related code paths could decide whether
to maintain an asset-tracking cache row at all.

## Cross-references

- **B-1 (Day 6, T3) — MERGED at `547eac9` (PR #59):** schema
  migration `0011_asset_tracking_cache.sql`, domain types,
  repository (`findCacheByAwb`, `upsertCacheRow`), outbound SF
  asset-tracking client, adapter wiring (`fetchAssetTrackingByAwb`),
  empirical wrapper fixture pinned, 6-scenario RLS regression,
  tenant-match trigger.
- **B-2 (Day 6, T2 closing commit):** service layer (read-through
  + TTL + cache invalidation), three audit-event catalogue
  additions (above), surface routes, paymentMethod probe
  (separate concern, bundled into closing).
- [`followup_suitefleet_asset_tracking_api.md`](followup_suitefleet_asset_tracking_api.md)
  — corrected endpoint (`?awbs=<AWB>`), empirical wrapper, 4-state
  enum, 9 open vendor questions for the Day-14 SF email.
- [`followup_suitefleet_webhook_policy.md`](followup_suitefleet_webhook_policy.md)
  — bonus-finding source + the open `task-asset-tracking`
  rate-limit question.
- [`followup_paymentmethod_field_resolution.md`](followup_paymentmethod_field_resolution.md)
  — paymentMethod probe outcome lands here regardless of finding
  (B-2 closing-commit hygiene rule).
