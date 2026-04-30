---
name: Bag tracking MVP design
description: Hybrid cache + read-through architecture for SuiteFleet bag (asset) tracking. 5-state taxonomy, 5-minute TTL, audit-none on cache reads, surfaced on consignee detail + calendar/dashboard. Bag-tracking-enabled flag derived from inbound webhook payload (no separate API call needed)
type: decision
---

Substance of the bag-tracking design was developed in the Day-5 EOD
claude.ai session and lived in working notes. This file lifts it into
durable repo memory before B-1 (Day 6, T3 — schema + adapter +
outbound SF call) and B-2 (Day 6, T2 — module + paymentMethod probe)
land. Captured 1 May 2026.

**Status:** Design decided. Schema migration + adapter implementation
land in B-1.

## What "bag tracking" is

A SuiteFleet feature that tracks physical assets (typically reusable
delivery bags / containers) attached to a task across the delivery
lifecycle. The merchant's couriers attach bags to tasks at pickup;
the bag's location and state propagate through SF's task lifecycle
events; the merchant gets visibility on which bags are out, in
transit, delivered, or returned.

For Transcorp's pilot (which uses bags for meal-plan deliveries),
this is operationally important — bag-loss rate directly affects
unit economics. Surfacing bag state on the operator UI is the user
value.

## Architecture: hybrid cache + read-through

The design pattern is **hybrid cache + read-through with TTL**:

1. **Local cache table** (lands in B-1's `0011_bag_tracking_cache.sql`)
   stores the most recently observed bag state per `(tenant_id, task_id)`
   tuple. Columns include `tenant_id` (denormalised, FK + match-trigger
   per the consignees / failed_pushes / task_packages precedent),
   `task_id`, current `state`, `asset_type`, `cached_at`,
   `last_event_at`, optional metadata jsonb.
2. **Read-through with TTL.** When the operator UI requests bag state
   for a task, the service:
   - Looks up the cache row.
   - If the row exists and `now() - cached_at < 5 minutes`, returns
     the cached state.
   - If the row is missing or stale (older than 5 min), issues an
     outbound SF `task-asset-tracking` GET, upserts the result, and
     returns the fresh value.
3. **Webhook-driven invalidation.** Inbound webhook events that carry
   bag-state information (the SF `customer.taskAssetTrackingEnabled`
   + `customer.defaultTaskAssetType` payload fields, plus task-state
   transitions that imply bag-state moves) write to the cache. This
   keeps the cache warm without polling.

Why hybrid vs. pure cache or pure read-through:

- **Pure cache (write-only via webhooks)** would miss state on tasks
  whose bag-state event the webhook system dropped or that pre-date
  the webhook subscription start.
- **Pure read-through (no cache, GET on every UI render)** would
  hammer SF's `task-asset-tracking` endpoint at a rate proportional
  to UI traffic. SF's rate limit on this endpoint is unknown
  (deferred to B-1; cross-referenced in the SF webhook policy memo
  as "vendor question for the Day-14 email").
- **Hybrid** smooths both: webhooks keep the cache warm in the happy
  path; read-through with TTL covers the edges; TTL bounds how stale
  the UI can get.

## TTL: 5 minutes

5-minute TTL is the working number. Rationale:

- **Operator UX:** a bag-state change (e.g. courier marks delivered)
  should propagate to the dashboard within ~one refresh cycle. 5 min
  is "fresh enough" for an operations control room watching a bag-
  loss problem; longer would feel stale.
- **SF load:** with `n` operators and `m` cards visible on the
  dashboard, worst-case GET rate is `n * m / 300s`. For a small ops
  team (say 5 operators, 20 cards each), that's ~20 GETs/min in the
  worst case — well within the 5 req/sec adapter throttle (per the
  Day-4 fact card on rate limits).
- **Webhook-warm reduces this further:** in practice, webhook events
  refresh the cache on most state changes, so TTL-driven reads only
  fire for tasks the webhook didn't cover.

5 min is not load-bearing. If pilot operations data shows it's wrong,
it's a one-line constant change and a cache-invalidation if the
direction is "shorter."

## 5-state taxonomy

The state column on `bag_tracking_cache` is a closed-domain string
enum. **The five concrete state values must be reconciled against
the bootstrap brief §11.2 + the SF `task-asset-tracking` response
shape (which B-1's first sandbox call captures empirically) before
the migration is written.** Likely shape based on standard bag-
tracking lifecycles:

- `awaiting_pickup` — bag assigned to task, courier not yet collected
- `picked_up` — courier has the bag, in possession
- `in_transit` — bag moving from origin to destination
- `delivered` — bag handed off at destination
- `returned` — bag came back (returned-to-sender or bag-recovery flow)

These five states are **provisional**. B-1's first action is the
sandbox round-trip to capture SF's actual response shape; the state
column's CHECK constraint and the TS string-union type are written
against the empirical findings, not against this list. Day-4 lesson
(memory/feedback_*) applies: do not trust SF documentation; trust
the empirical sample. If SF returns 6 or 4 distinct states (not 5),
or uses different names (e.g. `OUT_FOR_DELIVERY` vs. `in_transit`),
the schema follows the wire shape, not this memo.

## Surface points

The bag-state value surfaces in two operator UIs:

1. **Consignee detail page** — when an operator drills into a single
   consignee, the active task list shows current bag state per task.
   This is the per-customer drill-down view.
2. **Calendar / dashboard** — the daily / weekly operations view
   shows bag-state badges on each task card. This is the at-a-glance
   ops control view.

Both surfaces use the same `getBagTrackingState(taskId)` service
method. Read-through TTL applies uniformly; UI doesn't decide cache
freshness.

## Audit policy: emit-none on cache reads

Cache reads are NOT audited. Reasoning:

- A dashboard with 20 task cards firing read-through every 5 minutes
  per operator would flood `audit_events` with thousands of low-
  signal rows per day. The audit log's purpose is forensic
  reconstruction of state changes, not telemetry on UI render rates.
- This matches R-4 (the audit-events convention): reads in general
  are not audited (`getTask`, `getConsignee`, etc.).

What IS audited (B-1 / B-2 to wire):

- **Cache misses that triggered an outbound SF GET** — emit a
  `bag_tracking.refreshed` event (or similar; final event-type name
  lands in B-2's audit catalogue addition) carrying `task_id` and
  `previous_cached_at` so we can reconstruct refresh frequency from
  the audit log if a debugging need arises.
- **State transitions** — when the cache row's `state` column moves
  from one value to another (whether triggered by webhook or by
  read-through GET), emit a `bag_tracking.state_changed` event with
  before/after states, ISO timestamps, and the trigger source
  (webhook | read-through). This is the load-bearing forensic event
  for bag-loss investigation.

Open question for B-2: whether webhook-driven cache writes that find
no state change (e.g. webhook re-delivers an already-cached event)
should emit anything. Lean: no — a no-op on the cache should be a
no-op on the audit log. Document the choice in B-2's catalogue
addition.

## Bonus finding: bag-tracking-enabled flag is webhook-derived

From [followup_suitefleet_webhook_policy.md](followup_suitefleet_webhook_policy.md)
(Day 6 probe): every SF webhook event payload exposes:

- `customer.taskAssetTrackingEnabled` — boolean
- `customer.defaultTaskAssetType` — string (e.g. `"BAGS"`)

**Implication.** B-1 does NOT need a separate "is bag tracking
enabled for this merchant?" API call. The first webhook event for a
new tenant carries the answer. Persist it on a tenant-scoped settings
row (or a dedicated column on `tenants`) on receipt; refresh on
subsequent events; default-falsy until the first webhook arrives.

This shaves one outbound API call from B-1's design and avoids a
race condition where the planner would otherwise have to bootstrap
the flag before any task-related code paths could decide whether to
maintain a bag-tracking cache row at all.

## Cross-references

- **B-1 (Day 6, T3):** schema migration `0011_bag_tracking_cache.sql`,
  domain types, repository, outbound SF asset-tracking client, first
  sandbox round-trip + response-shape pin, 6-scenario RLS regression,
  tenant-match trigger.
- **B-2 (Day 6, T2):** service layer (read-through + TTL + cache
  invalidation), audit-event catalogue additions, surface routes,
  paymentMethod probe (separate concern, bundled into the closing
  Day-6 commit).
- [`followup_suitefleet_webhook_policy.md`](followup_suitefleet_webhook_policy.md) — bonus-finding source + the open `task-asset-tracking` rate-limit question that lands in B-1.
- [`followup_paymentmethod_field_resolution.md`](followup_paymentmethod_field_resolution.md) — the paymentMethod probe outcome lands here regardless of finding (B-2 closing-commit hygiene rule).
