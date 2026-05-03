---
name: SuiteFleet task-asset-tracking API — endpoint, wire shape, vendor questions
description: Empirical + doc-based reference for the SF asset-tracking endpoint used by B-1 / B-2. Captures the awbs-vs-taskId correction, the documented wire shape, the 4 observed states, and the 9 open vendor questions deferred to the Day-14 vendor email
type: followup
---

Reference for the SF `task-asset-tracking` API surface that B-1 (schema
+ adapter) and B-2 (service + paymentMethod probe) build against.
Captured 1 May 2026 from new SF API documentation (received mid-B-1)
plus an empirical sandbox probe that confirmed the endpoint shape but
not the inner-record shape.

## Endpoint

- **Path:** `GET /api/task-asset-tracking`
- **Query parameter:** `awbs=<AWB>` — comma-separated for multiple, per the doc
- **Auth:** standard `Authorization: Bearer <token>` + `Clientid` headers, same as `/api/tasks`

### Correction history

The B-1 design memo originally said "outbound SF `task-asset-tracking`
GET" without specifying the parameter. The first probe (1 May 2026)
guessed `?taskId=<id>` and got 200 with empty `content[]` — masking
the bug because the empty-array response looked the same as a
no-records-attached response. New SF doc surfaced after the probe and
clarified: the parameter is `awbs=`, not `taskId=`. The 15 prior
probes that returned empty `content[]` may or may not have actually
been answering "no records for this task." The corrected probe
(`?awbs=MPS-98410409` against task 59113, sandbox merchant 588,
status DELIVERED) returned the same empty wrapper — so for this
account, the empty-content behaviour is real, not a parameter bug.

## Response shape (Spring Data paginated)

Outer wrapper, **empirically confirmed verbatim** (1 May 2026 probe):

~~~json
{
  "content": [],
  "last": true,
  "totalElements": 0,
  "totalPages": 0,
  "first": true,
  "number": 0,
  "numberOfElements": 0,
  "size": 50,
  "empty": true
}
~~~

Inner record shape, **per doc, not empirically pinned** — sandbox
merchant 588 has `customer.taskAssetTrackingEnabled: true` but no
existing tasks have asset-tracking records attached. The schema in
B-1's `0011_asset_tracking_cache.sql` is designed against the doc;
the first real record that lands via webhook or a fresh probe gets
snapshotted into a test fixture and the doc-derived assumptions are
retroactively replaced with empirical truth. Per Day-4 lesson: do
not trust SF docs alone — but in the absence of empirical data, doc
plus acknowledged caveat is the workable middle.

## Cardinality

**One tracking object per package, not per task.** A single AWB with
N packages returns N tracking objects. `trackingId` format is
`<AWB>-<index>`, e.g. `MPL-52583211-1` for the first package on AWB
`MPL-52583211`. The schema models packages as the unit of caching
(`asset_tracking_cache` table, one row per `trackingId`), not tasks.
"Bag tracking" is the operational nickname; the API surface is
asset-typed, with `BAGS` as the observed value and `BOX` /
`PALLET` / `CONTAINER` documented as future possibilities.

## Observed state values

The doc shows a 4-state lifecycle:

- `COLLECTED` — courier has the asset
- `EN_ROUTE` — asset moving from origin to destination
- `RECEIVED` — handed off at destination
- `RETURNED` — asset came back (returned-to-sender or recovery flow)

The B-1 schema's CHECK constraint is
`state IN ('COLLECTED', 'EN_ROUTE', 'RECEIVED', 'RETURNED')` —
Option A from review: surfaces SF enum-gaps as visible CHECK
violations rather than silently caching unknown values. Webhook
ingestion + cache writes wrap the insert in structured error
handling so a CHECK violation logs to an error queue instead of
crashing the handler. Vendor question 1 (below) tracks whether SF
has additional states (CREATED / DELIVERED / CANCELLED hypothesised
but not confirmed).

## Cross-reference: bag-tracking-enabled flag

Per [followup_suitefleet_webhook_policy.md](followup_suitefleet_webhook_policy.md),
every inbound webhook payload exposes:

- `customer.taskAssetTrackingEnabled: boolean`
- `customer.defaultTaskAssetType: string` (e.g. `"BAGS"`)

So the bag-tracking-enabled flag is webhook-derived; B-1 does not
need a separate "is enabled?" lookup against this endpoint.

## Open vendor questions (consolidate into the Day-14 SF email)

Nine open questions from the SF doc §8 + B-1 review:

1. **Complete state enum?** Are `COLLECTED / EN_ROUTE / RECEIVED /
   RETURNED` exhaustive, or do additional states exist (CREATED at
   record creation? DELIVERED as a post-RECEIVED terminal? CANCELLED
   on a recovery flow?)? Schema CHECK is restrictive until vendor
   confirms.
2. **Pagination behaviour for AWBs with > 50 packages.** Default
   `size: 50` matches the empty-wrapper probe. Does `size=` accept
   higher values? Is there a hard ceiling? B-1's adapter
   (`fetchAssetTrackingByAwb`) currently logs a warning if
   `totalPages > 1` and returns only the first page; B-2 follow-up
   wires real pagination if it ever surfaces in production.
3. **Endpoint rate limit.** Unknown — the broader `task-asset-tracking`
   rate-limit question deferred from the W-1 webhook policy memo.
   Conservative 5 req/sec adapter throttle (per the Day-4 task
   client) applied for now.
4. **`awbs=` separator for batch queries.** Doc flags comma-
   separated as unconfirmed and recommends verification with
   SuiteFleet. Empirical test deferred until B-2 or later when a
   real multi-AWB scenario surfaces.
5. **Webhook events for state transitions.** Do `COLLECTED` /
   `EN_ROUTE` / `RECEIVED` / `RETURNED` transitions emit dedicated
   webhook events, or are they only retrievable via this GET?
   Affects the cache-warming model in B-2.
6. **Photo storage URLs.** `photos` field shape unknown — array of
   strings? Array of objects with metadata? Lifetime of the URLs?
   Schema stores as `jsonb` for flexibility until empirical sample
   surfaces.
7. **`*_by` user objects.** `collected_by`, `received_by`,
   `enroute_by`, `returned_by` — full user record per the doc
   (id / name / email / phone / role?). Schema stores as `jsonb`
   to absorb the shape; no foreign key into a Planner-side users
   table because these are SF couriers, not Planner users.
8. **`container_id` reference target.** Bigint nullable per the
   doc. Reference to what? A SF-side container entity? Cross-
   trackingId aggregation? Out of B-1 scope; documented as jsonb-
   adjacent metadata until needed.
9. **Asset-record creation lifecycle.** Sandbox merchant 588 has
   `taskAssetTrackingEnabled: true` but no existing task has any
   records. Are records created automatically on task creation
   when the customer flag is on, or is there a separate
   attachment / pickup-event step? Affects whether Planner needs
   a "create asset-tracking record" outbound call (currently NOT
   in B-1 scope; pure read-through cache).

## Cross-references

- [`followup_suitefleet_webhook_policy.md`](followup_suitefleet_webhook_policy.md) — webhook-derived `taskAssetTrackingEnabled` flag, parent for the rate-limit question
- [`decision_bag_tracking_mvp.md`](decision_bag_tracking_mvp.md) — hybrid cache + read-through architecture; pending a follow-up T1 commit (post-B-1) to (a) rename "bag" to "asset" terminology in body text, (b) replace the provisional 5-state taxonomy with the 4-state empirical-from-doc list, (c) update endpoint reference to `?awbs=`. Unbundled from B-1 per scope discipline; rewrite is more than a 5-line edit.
- B-1 schema: `0011_asset_tracking_cache.sql` (column shape per the new doc, one row per `trackingId`)
- B-2 follow-ups: pagination wiring, webhook-driven cache writes, paymentMethod probe (separate concern bundled into closing commit)
