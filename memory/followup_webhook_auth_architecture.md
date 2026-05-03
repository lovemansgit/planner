---
name: SuiteFleet webhook authentication + payload shape (full architectural capture)
description: Aqib delivered a complete webhook payload via webhook.site capture (Day 7 EOD post-close). Confirms SF auth scheme (lowercase `clientid` + `clientsecret` headers — NOT Authorization/Bearer/HMAC), full LocationPostPayloadDto wire shape, action-based event routing (no status-diff inference needed), shipFrom auto-population from merchant master, and customer.code as the merchant scoping key. Day 8 scope grows substantially — webhook auth/parsing/routing pulls forward from Day 12 alongside C-3.
type: project
---

# SuiteFleet webhook authentication + payload architecture

**Captured:** 2 May 2026 EOD (post-Day-7-close, post-EOD-fill commit)
**Source:** Aqib delivered a live webhook capture from webhook.site
**Affects:** Day-8 C-3 scope updates + new T3 webhook hardening commit; receiver gaps in `src/app/api/webhooks/suitefleet/[tenantId]/route.ts` (Day-4 scaffolding) need closing

---

## Webhook authentication

Confirmed design (per Aqib + screenshots + delivery capture):

- SF webhook config form: receiving system registers a static `client_id` + `client_secret` pair.
- SF stores the pair and sends both on every delivery.
- HTTP header format **confirmed empirically** from delivery capture:
  ```
  clientid: <value>          (lowercase, flat header name — no dashes)
  clientsecret: <value>      (lowercase, flat header name)
  ```
- **NOT** `Authorization: Basic`, **NOT** Bearer, **NOT** HMAC.
- Per-merchant credentials: each pilot tenant gets a distinct credential pair.

This kills any speculation about HMAC signing or rotating tokens. The auth is a static shared-secret pair on every request, header-based.

---

## Webhook payload shape

Confirmed via the live webhook capture (full payload at the bottom of this memo for reference):

- **Method:** POST.
- **Content-Type:** `application/json`.
- **Body shape:** JSON ARRAY of event objects. SF batches events per delivery — multiple lifecycle transitions can land in one POST.
- **Each event object carries an explicit `action` field**. SF does NOT require us to infer event type from status-diff comparisons. The receiver iterates the array and routes each element by its `action` value.
- Sample `action` value observed: `TASK_STATUS_UPDATED_TO_DELIVERED`. Other action values will be discovered as we observe the 15 SF lifecycle events; the existing `webhook-parser.ts` already maps a SF taxonomy, but verify it routes by action field rather than status diff.

### Field-by-field shape (mined from the captured payload)

**Top-level event:**
- `id` (numeric SF task ID — int, not UUID)
- `awb` (e.g. `"TBC-55891430"`)
- `customerOrderNumber`
- `deliveryDate`, `deliveryStartTime`, `deliveryEndTime`
- `type`, `deliveryType`, `status`
- `driver` (nullable)

**`consignee.location`** — the LocationPostPayloadDto shape echoed back:
- `addressLine1`, `addressLine2`, `addressLine3`
- `addressCode`
- `district`, `city`
- `countryId` (numeric, server-assigned), `countryCode` (alpha)
- `contactPhone`, `contactEmail`
- `latitude`, `longitude` (nullable — server resolves)
- `stateProvince`, `state`, `zip`, `contactFax`

**`deliveryInformation`** — nested object with operational telemetry:
- `numberOfAttempts`, `bagsReturned`, `icePacksReturned`
- `taskFailureReason`, `taskCompletionReason`, `failureReasonComment`, `reason`
- `codPaymentMethod`, `collectedAmount`, `posTransactionId`
- `photos`, `pickupPhotos`, `signature`
- `recipientName`, `consigneeRating`, `consigneeComment`, `driverComment`
- `taskAssetsReturned`, `taskAssetsCollected`
- `completionLatitude`, `completionLongitude`
- Plus a redundant `deliveryDate` / `deliveryStartTime` / `deliveryEndTime` block (latest values, vs. the top-level which is the originally-scheduled values)

**`shipFrom`** — auto-populated by SF from merchant master if we don't send it on task create. Carries the same Location shape as `consignee.location` plus a numeric `id` and a separate `name`/`address` pair.

**`customer`** — the merchant block:
- `id` (numeric)
- `name` (e.g. `"Tabchilli"`)
- **`code` (e.g. `"TBC"`)** — the merchant scoping key. **Required on every task create.**
- `phoneNumber`, `email`
- `partialDelivery` (boolean)
- `taskAssetTrackingEnabled` (boolean — already noted in `decision_bag_tracking_mvp.md`)
- `defaultTaskAssetType`

**`shipmentPackages`** — ARRAY (multi-package per task supported):
- Each: `id` (numeric), `packageStatus`, `encryptedShipmentId`, `packageId`, `trackingId` (e.g. `"TBC-55891430-1"`)
- Pilot meal plans are single-package (`totalShipmentQuantity = 1`, length-1 array), but the receiver MUST handle multi-package generically — do NOT hardcode `array[0]`.

**Top-level scalar / boolean fields:**
- `totalShipmentValueAmount`, `totalShipmentValueCurrency`
- `totalDeclaredGrossWeight`
- `totalShipmentQuantity`
- `codAmount`, `codCurrency`
- `volume`
- `signatureRequired`, `ageVerificationRequired`, `smsNotifications`
- `highValueTask`, `remoteArea`
- `details`, `notes`, `referenceNumber`, `tags`
- `trackingUrl` (e.g. `"https://go.suitefleet.com/6TsX28"`) — public consignee tracking URL
- `locateConsigneeUrl`, `pickedUpTime`, `shipmentCategory`, `otp`
- `createdDate` (ISO timestamp)
- `timestamp` (epoch ms — distinct from createdDate; this is the event timestamp, not the task timestamp)
- `action` (string — the lifecycle event type, the routing key)
- `amazonInformation`, `hangers` (provider-specific extensions; null for our flow)

---

## Architectural implications for Day 8

### shipFrom config DROPPED from C-3 scope

Original Day-8 plan (per `followup_c3_deferred_day8.md`) included `src/config/tenant-shipping.ts` mapping each pilot tenant to a hardcoded warehouse address.

**Webhook capture shows shipFrom is auto-populated by SF.** When we POST a task without a `shipFrom` field, SF fills it from the merchant master (registered once in SF OpsPortal at merchant onboarding).

**Day-8 task-create payloads OMIT shipFrom entirely.** The `tenant-shipping.ts` file is no longer needed. Operator-side action: confirm Transcorp's warehouse is registered in each pilot tenant's SF OpsPortal record.

### `customer.code` REQUIRED on every task create

SF identifies merchants via `customer.code` (e.g. `"TBC"` for Tabchilli). Without it, SF can't scope the create to the right merchant tenant.

**Schema change** (Day 8 migration):
```sql
ALTER TABLE tenants ADD COLUMN suitefleet_customer_code text NOT NULL DEFAULT '';
-- Backfill from Aqib (TBC for Tabchilli; codes for the other 2 pilot merchants pending);
-- once backfilled, drop the DEFAULT and SET NOT NULL with the real values.
```

The cron's task-create payload-build (C-3) reads `tenants.suitefleet_customer_code` per-tenant and passes it as the `customer.code` field on every POST.

### Address shape requirements pinned

Per the consignee webhook payload structure + Aqib's earlier confirmation:

| Field | Required? | Notes |
|---|---|---|
| `addressLine1` | **REQUIRED** | |
| `district` | **REQUIRED** | |
| `city` | **REQUIRED** | |
| `countryCode` | **REQUIRED** | alpha (e.g. `"AE"`) |
| `contactPhone` | **REQUIRED** | E.164 format |
| `addressLine2` | optional | empty string acceptable |
| `addressLine3` | optional | empty string acceptable |
| `addressCode` | optional | empty string acceptable |
| `zip` | optional | empty string acceptable |
| `contactFax` | optional | empty string acceptable |
| `latitude` | nullable | SF resolves via WhatsApp post-push if absent |
| `longitude` | nullable | same |
| `stateProvince` | nullable | |
| `state` | nullable | |
| `contactEmail` | nullable | |
| `countryId` | **OMIT** — server-resolved from `countryCode` | |

This pins the C-3 contract changes already in `followup_c3_deferred_day8.md`: `latitude` / `longitude` go optional in `DeliveryAddress` + conditional spreads in `buildLocation`. Confirmed.

### SF task ID is NUMERIC integer, not UUID

SF returns `id: 58957` — int. The existing `tasks.external_id` column is `text` per `0006_task.sql` (which is fine — text can hold any int's stringified form), but the webhook receiver MUST parse the incoming numeric `id` as a number first, then stringify for storage / lookup. Don't pass `body.id` directly to a UUID-expecting code path.

### AWB format observed: `{customer.code}-{numeric}`

Example: `TBC-55891430`. Customer code prefix + numeric suffix.

**Useful for the 23505 reconcile path:** when SF returns "Awb with value TBC-XXX exists already" on a duplicate POST, parse the AWB out, GET the task from SF by AWB, store the SF task ID locally, mark the task as pushed.

Regex for the error-message parse: `/Awb with value ([\w-]+) exists already/`. Extract group 1 → AWB. Existing `task-client.ts` 23505 handling needs this routing.

### `shipmentPackages` is an array — generic multi-package handling

Pilot meal plans are single-package (`totalShipmentQuantity = 1`, length-1 array), but the receiver MUST handle multi-package webhooks generically. Don't hardcode `payload.shipmentPackages[0]` anywhere.

The existing `task_packages` table (from 0007) already models this 1-task-to-N-packages relationship. Verify the webhook receiver upserts per-package status using `trackingId` as the key (matches the asset-tracking pattern from B-1).

### `deliveryInformation` operational telemetry

Cold-chain-relevant fields for meal-plan delivery: `numberOfAttempts`, `bagsReturned`, `icePacksReturned`, `taskFailureReason`, `codPaymentMethod`, `photos`, `signature`. Plus completion timestamp + lat/lng + driver/consignee comments.

**Day 8 receiver scope:** capture these into existing telemetry storage. The current `tasks` table doesn't have columns for any of this — open question whether a new `task_telemetry` table is needed or whether targeted columns on `tasks` suffice. **UI surfacing of this data is post-pilot — NOT Day-8 work.** For Day 8, capture-but-don't-render is enough.

---

## Gaps identified in existing code

### Existing webhook receiver has NO auth check

`src/app/api/webhooks/suitefleet/[tenantId]/route.ts` (Day 4 / W-1 scaffolding) does NOT verify `clientid` / `clientsecret` headers today. The route header comment mentions verification but the code path is empty.

Day-8 hardening: add the auth check inline at the start of the POST handler. Reject 401 on mismatch; emit `webhook.auth_failed` audit event (new event type — systemOnly: true; metadata: `tenant_id`, `presented_clientid_prefix` (first 4 chars only — never log full credentials), `reason: 'mismatch' | 'missing_headers'`).

### Existing receiver may not handle array-body

Day-4 scaffolding likely parses the body as a single object (the public docs originally suggested single-event POSTs). Live capture shows array of events.

**Action:** inline the current body-parsing logic at the Day-8 hardening PR open. If single-object, refactor to array-iterate. Test cases: single-event array, multi-event array, empty array (return 400), non-array body (return 400).

### Existing receiver may not route by `action` field

Day-4 scaffolding may have anticipated routing by status diffs (compare incoming `status` to local task's current status). The action-based routing SF actually provides is simpler and matches the vendor's design.

**Refactor** to action-based routing if the current code does status-diff inference.

---

## Day 8 scope (likely T3 — webhook auth + parsing + routing hardening)

This is a separate commit from C-3, NOT folded into it. Scope:

### 1. Schema migration

```sql
-- tenants table — merchant scoping key
ALTER TABLE tenants ADD COLUMN suitefleet_customer_code text NOT NULL DEFAULT '';
-- backfill via UPDATE per pilot tenant
-- then: ALTER TABLE tenants ALTER COLUMN suitefleet_customer_code DROP DEFAULT;
-- (keep NOT NULL after backfill)

-- new table — per-tenant webhook credentials
CREATE TABLE tenant_suitefleet_webhook_credentials (
  tenant_id            uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  client_id            text NOT NULL,
  client_secret_hash   text NOT NULL,    -- bcrypt or argon2; never store plaintext
  rotated_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- RLS: tenant_isolation policy (defensive NULLIF form per project convention)
-- Defence-in-depth: tenant_id is the PK, not a denormalised FK column,
-- so no *_assert_tenant_match trigger needed (same posture as
-- task_generation_runs from C-2).
```

Both tables: RLS + tenant_id defence-in-depth + RLS regression test in `rls-tenant-isolation.spec.ts`.

### 2. Receiver hardening at `src/app/api/webhooks/suitefleet/[tenantId]/route.ts`

- Parse `clientid` / `clientsecret` headers (case-insensitive lookup — Node's `Headers` API normalises lowercase but defensive lookup is belt-and-braces).
- Constant-time `bcrypt.compare` against the stored hash for the request's tenant.
- 401 on auth mismatch. Emit `webhook.auth_failed` audit event.
- Parse body as JSON array (reject non-array with 400).
- Iterate array, route each element by its `action` field.
- Per-element processing failures don't abort the batch — capture each failure (Sentry via the C-6 wrapper), continue iterating, return 200 to SF at the end so SF doesn't retry the whole batch.
- Until auth lands, the receiver remains **observation-only** (logs but doesn't mutate state). Once auth + array-parsing are in, flip the state-mutation paths on.

### 3. Admin UI for credential lifecycle (T2 follow-up after the T3 above)

- Generate a cryptographically-random `client_id` + `client_secret` pair (e.g. 32-byte hex via `crypto.randomBytes(32).toString('hex')`).
- Display the secret ONCE on creation. Never retrievable. Hash and store.
- Rotation flow: operator clicks "Rotate", new pair generated, OLD pair stays valid for a grace window (e.g. 5 minutes) so SF OpsPortal-side update has time to land.
- Permission: `tenant.webhook_credentials:manage` (Tenant Admin only — NOT TENANT_SCOPED auto-pickup; explicit grant).
- Audit events: `webhook_credentials.created`, `webhook_credentials.rotated`, `webhook_credentials.revoked`.

### 4. Operator playbook (memo / runbook entry)

- SF OpsPortal config setup: where to enter the planner-generated `client_id` / `client_secret`.
- Rotation procedure: operator-side coordination between planner UI and SF OpsPortal.
- Leak response: how to revoke a compromised pair (set old pair's `rotated_at` AND immediately generate new + push to SF).

---

## C-3 updates from this webhook capture

`memory/followup_c3_deferred_day8.md` needs the following changes (folded into the Day-8 brief draft):

- **Drop `tenant-shipping.ts`** — shipFrom auto-populated from SF merchant master.
- **Add `customer.code`** to task-create payload, sourced from new `tenants.suitefleet_customer_code` column. The existing schema migration scope grows by one column.
- **Address shape requirements pinned** per webhook capture (see table above). The `latitude` / `longitude` lean is now empirical, not just Aqib-stated.
- **23505 reconcile path** — regex-extract AWB from error message, GET task by AWB, store SF id locally. Adapter layer in `task-client.ts` needs this branch.

These updates land in the Day-8 C-3 commit, not as a separate PR — they're scope inclusions for the existing planned work.

---

## Cross-references

- `memory/followup_c3_deferred_day8.md` — C-3 scope updated per shipFrom auto-population, customer.code, address shape, 23505 reconcile path
- `memory/followup_suitefleet_label_endpoint.md` — same security-rule pattern (server-side fetch, never expose secrets to operator browser)
- `memory/followup_createtask_idempotency.md` — 23505 routing per the AWB regex above
- `memory/handoffs/day-7-eod.md` — Aqib Group 2/3/4 fully resolved (except `createBulk` vs single-loop recommendation, which carries forward as an open follow-up)
- `src/app/api/webhooks/suitefleet/[tenantId]/route.ts` — Day-4 file substantially modified in Day 8 (auth + array-parse + action-route)
- `decision_bag_tracking_mvp.md` — `customer.taskAssetTrackingEnabled` flag confirmed on payload; Day-8 / Day-9 onwards should refresh the tenant's stored flag from each webhook
- `decision_planner_auth_independent.md` — webhook auth (SF → planner) is separate from planner auth (operator → planner); two boundaries

---

## Full webhook payload reference (sample only)

This is one captured event. The actual webhook body is an array — multiple of these can land in a single POST. Pasted verbatim for forensic / regression-test reference; treat field values as illustrative, not canonical (PII redacted in production logs per the planner's logger convention).

```json
[
  {
    "id": 58957,
    "awb": "TBC-55891430",
    "customerOrderNumber": "54440",
    "deliveryDate": "2026-04-28",
    "deliveryStartTime": "05:00:00",
    "deliveryEndTime": "17:00:00",
    "type": "DELIVERY",
    "deliveryType": "STANDARD",
    "status": "DELIVERED",
    "driver": null,
    "consignee": {
      "id": 32160,
      "name": "nitish kumar",
      "location": {
        "addressLine1": "Shaqran Street",
        "addressLine2": "",
        "addressLine3": "",
        "addressCode": "",
        "district": "Ajman Industrial Area 2",
        "countryId": 224,
        "city": "Ajman",
        "contactPhone": "+9717082295575",
        "contactEmail": "webexpert.nitish@gmail.com",
        "countryCode": "AE",
        "latitude": null,
        "longitude": null,
        "stateProvince": null,
        "zip": "",
        "contactFax": "",
        "state": null
      }
    },
    "deliveryInformation": {
      "id": 58966,
      "deliveryDate": "2026-05-01",
      "deliveryStartTime": null,
      "deliveryEndTime": "12:59:00",
      "deliveryBoxes": null,
      "collectedAmount": null,
      "failureReasonComment": null,
      "reason": null,
      "numberOfAttempts": 1,
      "completionLatitude": null,
      "completionLongitude": null,
      "driverComment": null,
      "consigneeRating": null,
      "consigneeComment": null,
      "recipientName": null,
      "signature": null,
      "bagsReturned": null,
      "icePacksReturned": null,
      "posTransactionId": null,
      "photos": null,
      "pickupPhotos": null,
      "taskFailureReason": null,
      "taskCompletionReason": null,
      "taskAssetsReturned": null,
      "codPaymentMethod": null,
      "taskAssetsCollected": null
    },
    "hangers": null,
    "shipFrom": {
      "id": 36896,
      "name": null,
      "address": null,
      "latitude": null,
      "longitude": null,
      "addressLine1": "Dubai, Al wasl, Dar wasl Mall, UAE P.O. Box: 515000",
      "addressLine2": null,
      "addressLine3": null,
      "addressCode": null,
      "district": "Dubai",
      "city": "Dubai",
      "stateProvince": null,
      "zip": null,
      "contactPhone": "+971 58 584 3463",
      "contactFax": null,
      "contactEmail": null,
      "geofence": null,
      "countryId": 224,
      "countryCode": "AE",
      "state": null
    },
    "customer": {
      "id": 581,
      "name": "Tabchilli",
      "code": "TBC",
      "phoneNumber": "000000000",
      "email": null,
      "partialDelivery": false,
      "taskAssetTrackingEnabled": false,
      "defaultTaskAssetType": null
    },
    "shipmentPackages": [
      {
        "id": 263600,
        "packageStatus": "DELIVERED",
        "encryptedShipmentId": null,
        "packageId": null,
        "trackingId": "TBC-55891430-1"
      },
      {
        "id": 263601,
        "packageStatus": "DELIVERED",
        "encryptedShipmentId": null,
        "packageId": null,
        "trackingId": "TBC-55891430-2"
      }
    ],
    "amazonInformation": null,
    "totalShipmentValueAmount": 119,
    "totalDeclaredGrossWeight": 0,
    "totalShipmentQuantity": 2,
    "codAmount": 0,
    "totalShipmentValueCurrency": "AED",
    "signatureRequired": false,
    "ageVerificationRequired": false,
    "codCurrency": "AED",
    "createdDate": "2026-04-27T10:26:30",
    "volume": 0,
    "details": null,
    "notes": null,
    "timestamp": 1777640353755,
    "action": "TASK_STATUS_UPDATED_TO_DELIVERED",
    "smsNotifications": false,
    "referenceNumber": null,
    "trackingUrl": "https://go.suitefleet.com/6TsX28",
    "locateConsigneeUrl": null,
    "highValueTask": false,
    "otp": null,
    "tags": null,
    "pickedUpTime": null,
    "shipmentCategory": null,
    "remoteArea": false
  }
]
```
