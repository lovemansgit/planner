---
name: C-3 cron bulk push deferred to Day 8 — pre-push data resolution gap
description: Day-7 C-3 (cron's bulk-push phase + DLQ + 23505 routing) deferred to Day 8 because consignees has no `district` column and SF's LocationPostPayloadDto requires district per Love's operational knowledge. Captures the full Day-8 scope: schema migration, contract over-strictness fix, locked defaults, Transcorp shipFrom values, and the open Aqib questions whose answers fold back into this memo before EOD.
type: project
---

# C-3 cron bulk push — deferred to Day 8

**Captured:** 2 May 2026 (Day 7 calendar, EOD-prep window)
**Why this is durable, not ephemeral:** Day 8 morning's brief author needs the full pre-push data resolution scope captured discoverable as a file, not reconstructed from chat. Several decisions were locked across multiple back-and-forths today; this is the single source of truth.

---

## Why C-3 was deferred

Per `memory/followup_createtask_idempotency.md` and Love's operational knowledge of SuiteFleet, **`district` is mandatory in SF's `LocationPostPayloadDto`** for both `consignee.address` and `shipFrom`. The current `consignees` schema (0004) does NOT carry a district column:

```sql
CREATE TABLE consignees (
  id, tenant_id, name, phone, email,
  address_line, emirate_or_region,    -- only these two address fields
  delivery_notes, external_ref, notes_internal,
  created_at, updated_at
);
```

Without a district column to read from, the cron's pre-push payload-build step has no way to populate the field, which means SF rejects every push with a validation error → 100% DLQ rate on the first cron night. Path (a) per the standing rule: **defer C-3 to Day 8**.

C-4 (DLQ retry service + admin UI) deferred alongside since the retry button has nothing to call until C-3 lands.

---

## Day 8 scope — schema work

### `ALTER TABLE consignees ADD COLUMN district text`

Backfill strategy is **Love's call** — two viable options pending decision:

| Option | Tradeoff |
|---|---|
| `NOT NULL` with placeholder ('Unknown' / '') backfill | Forward-only; existing rows get a sentinel; CSV re-import overwrites. Simpler schema, but operators see fake data until backfilled. |
| Nullable-then-required (add nullable, populate via CSV re-import, then `ALTER TABLE … SET NOT NULL`) | Two-step migration; cleaner semantics; requires a future PR to flip the nullability after import. |

Both work. The placeholder approach is faster to ship; the staged approach is honest about the gap.

### Adapter/contract over-strictness — fix in same Day 8 PR (or sibling)

`src/modules/integration/types.ts` carries:

```ts
export interface DeliveryAddress {
  // ...
  readonly district?: string;          // OPTIONAL — make REQUIRED (under-strict for SF)
  readonly latitude: number;            // REQUIRED — make OPTIONAL (over-strict; SF resolves via WhatsApp post-push)
  readonly longitude: number;           // REQUIRED — make OPTIONAL (same)
  // ...
}
```

`src/modules/integration/providers/suitefleet/task-client.ts:111-126` `buildLocation` unconditionally spreads `latitude` / `longitude` into the wire body. Both type-contract and build-path need to flip:

- Type contract: `latitude?: number`, `longitude?: number`, `district: string` (drop the `?`)
- Build path: conditional spreads for `latitude` / `longitude` (mirrors the existing `district` pattern)

Without this fix, even after the schema migration the cron payload-build will fail typecheck (the cron will pass `latitude: undefined` against a non-optional `number` field).

---

## Day 8 scope — defaults locked

The Day-8 cron payload-build path uses these defaults at the cron-service layer (NOT in the adapter — adapter stays generic):

| Field | Default | Status |
|---|---|---|
| `countryCode` | `'AE'` | LOCKED — pilot is UAE-only |
| `itemQuantity` | `1` | LOCKED — meal plans typically 1 bag per delivery |
| `paymentMethod` | `'PrePaid'` | **PENDING Aqib confirmation** on whether SF expects this nested under `deliveryInformation` or at the top level |
| `city` | `consignees.emirate_or_region` | **PENDING Aqib confirmation** on whether SF's `city` field accepts emirate names ("Dubai") or expects a finer-grained area ("Jumeirah", "Al Barsha") |
| `latitude` / `longitude` | omitted (undefined) | LOCKED — SF resolves via WhatsApp post-push per Love |
| `codAmount`, `totalShipmentValueAmount` | TBD for prepaid meal plans | **PENDING Aqib confirmation** |

---

## Day 8 scope — Transcorp `shipFrom` values

Hardcoded in a new `src/config/tenant-shipping.ts` keyed by tenantId. **All 3 pilot tenants share the same warehouse for now** (Transcorp's central facility):

```ts
{
  addressLine1: "Warehouse 23/24, Union Properties",
  district: "Al Quoz Industrial 1",
  city: "Dubai",
  countryCode: "AE",
}
```

Structure as per-tenant config from day one (even though all 3 entries are identical) so future per-tenant warehouses don't require code changes — only config additions. Later evolves into a `tenant_settings` table.

---

## Day 8 scope — ingest paths

CSV import and API consignee creation both need to populate the new `district` field:

- **CSV import**: column added to the import schema. Validation: required string. Migration of existing CSVs needs a column-rename or operator-supplied value.
- **API consignee creation** (`POST /api/consignees`): Zod schema gains `district` as required.
- **Existing rows backfill**: depends on which schema option Love picks (placeholder vs. staged).

Open question for Love: do existing pilot-tenant consignees already have district info captured anywhere out-of-band (operator notes, CRM exports, external_ref system) that we can pull from for backfill? If not, the answer is "operators re-input via CSV re-upload."

---

## Original C-3 plumbing carries forward intact

**Only the pre-push data resolution layer changed.** Everything else from the C-3 design at PR-discussion time stays:

- **Throttle**: 5 req/sec sequential `await sleep(200ms)` loop in the cron-service layer (NOT adapter-internal). Math: 7K @ 5 req/sec = 1,400 sec = 23m20s; fits Vercel Pro 60-min cron timeout with ~36-min headroom.
- **23505 routing**: on the `failed_pushes` partial UNIQUE (NOT on SF — SF doesn't dedupe per `memory/followup_createtask_idempotency.md`). First failure → INSERT; subsequent failure for same task → 23505 → UPDATE existing row (`recordFailedPushAttempt`, increments attempt_count, refreshes failure context, preserves first_failed_at).
- **DLQ writes**: single row per task while unresolved (partial UNIQUE on `task_id WHERE resolved_at IS NULL`); `attempt_count` starts at 1; `failure_detail` captures summarised SF response (capped at ~4KB, no credentials/PII); `failure_reason` mapped from adapter-layer typed errors.
- **Audit events**: `task.pushed` (new, systemOnly: true) on success; `task.push_failed` (existing) on failure (re-emit on retry attempts with incremented `attempt_count` in metadata).
- **Single-attempt within one cron pass**: per the idempotency memo, no retry-on-uncertainty inside a single invocation — that creates duplicate physical deliveries. Retry happens via the next cron pass (which finds the still-unpushed task because `pushed_to_external_at IS NULL`).

---

## Confirmed via Aqib (Group 1 — received 2 May 2026, late afternoon)

C-3 unblock path is FULLY RESOLVED. The remaining-defaults guesswork in
the prior section is now empirical — Day 8 implements against
confirmed values, not lean-and-revisit.

### Address payload — both `district` AND `city` mandatory, separate fields

- **API field name = `district`** — matches the codebase's existing
  `DeliveryAddress.district` field. NO rename needed in
  `src/modules/integration/types.ts`.
- **Mandatory address fields per Aqib**: `addressLine1`, consignee
  `name`, `phone`, `district`, `country` (countryCode), `city`.
- **`city` is mandatory and SEPARATE from `district`**: a Dubai-based
  meal plan delivery payload must carry BOTH `city: "Dubai"` AND
  `district: "Al Quoz Industrial 1"` (using the warehouse example).
  These are not interchangeable; SF will reject a payload that omits
  either one.
- **`shipFrom` does NOT need lat/lng** — the WhatsApp resolution
  Love mentioned applies only to the consignee side. shipFrom is a
  fixed warehouse address, not WhatsApp-resolved.

### Payment + value fields — locked for prepaid meal plans

- `paymentMethod = 'PrePaid'` — **top-level**, NOT nested under
  `deliveryInformation` for the prepaid path. The existing
  `task-client.ts` code that nests it (`deliveryInformation: { paymentMethod: ... }`)
  is wrong for prepaid; needs un-nesting in C-3. (COD path may nest
  it later — open scope, not pilot-blocking.)
- `codAmount = 0` for prepaid. COD path is conditional:
  `codAmount > 0` AND `paymentMethod = 'COD'` together.
- `totalShipmentValueAmount = 0` acceptable for prepaid meal plans
  (no need to track declared value when nothing is being collected
  on delivery).
- `totalShipmentQuantity = 1` confirmed — single bag per meal plan
  delivery in pilot scope.
- `volume = 0` acceptable.

### Contract changes locked for C-3 PR

In `src/modules/integration/types.ts`:

```ts
// BEFORE
readonly latitude: number;
readonly longitude: number;

// AFTER
readonly latitude?: number;
readonly longitude?: number;
```

In `src/modules/integration/providers/suitefleet/task-client.ts`,
`buildLocation` function — change unconditional spreads to conditional:

```ts
// BEFORE
latitude: address.latitude,
longitude: address.longitude,

// AFTER
...(address.latitude !== undefined && { latitude: address.latitude }),
...(address.longitude !== undefined && { longitude: address.longitude }),
```

This parallels the existing conditional pattern for `district`,
`addressLine2`, `addressCode`. Both type and build path flip together
in the C-3 commit.

Also un-nest `paymentMethod` in `buildSuiteFleetTaskBody`:

```ts
// BEFORE
deliveryInformation: { paymentMethod: request.paymentMethod },

// AFTER
paymentMethod: request.paymentMethod,
// (drop the deliveryInformation wrapper for the prepaid path; if a
// COD-specific wrapper is needed later, re-introduce conditionally)
```

### Schema change locked — `consignees.district`

`ALTER TABLE consignees ADD COLUMN district text NOT NULL` with backfill.
Backfill strategy still Love's call (placeholder 'Unknown' vs.
staged nullable-then-required); the empirical confirmation that
`district` is the right field name removes the only API-side
uncertainty.

### `city` — open mapping question (not blocking)

`consignees.emirate_or_region` currently captures values like "Dubai".
For pilot tenants (UAE-only), "Dubai" is both the emirate AND the
city — same string, distinct concepts. Two options for Day 8:

1. **Re-use `emirate_or_region` as the city source** for SF payloads
   (no schema change). Works for pilot. Surfaces a naming-vs-semantics
   question if a future merchant has a city-vs-emirate distinction
   (e.g., a tenant in Sharjah where the emirate is "Sharjah" but
   the city might be "Sharjah" or a finer-grained area).
2. **Add a separate `city` column** to consignees in the same
   migration as `district`. Cleaner semantics; one extra column;
   forward-compatible.

Lean: option 1 for pilot — the empirical reality is one-string-fits-both
in UAE pilot scope. Surface the option-2 schema as a follow-up if a
non-Dubai/non-Abu-Dhabi merchant ever onboards. Day 8 PR explicitly
documents this choice in the consignees migration header.

### Updated Aqib outstanding list

Group 1 (C-3 unblock): **FULLY RESOLVED** ✓

Group 2 (label endpoint): partially resolved — the format and content
shape are confirmed, but the exact endpoint URL/path is still pending.
See dedicated section below.

Groups 3+ (other categories from the original 14-question batch):
status varies — capture in successor follow-ups when answers arrive.

---

## Label scope (FULLY RESOLVED via Aqib Group-2 — see dedicated memo)

The label endpoint shape, security constraints, and Day-8 implementation
scope are captured in
`memory/followup_suitefleet_label_endpoint.md`. Summary:

- **Endpoint**: `GET https://shipment-label.suitefleet.com/generate-label`
  with `?taskId={id-or-csv}&type=indv-small&tz_offset=4&token=...&clientId=...`.
  Returns rendered PDF binary directly. Bulk via comma-separated taskIds.
- **Format**: `indv-small` (4x6) only — no per-merchant variation,
  pure passthrough, no logo manipulation. Morning-brief §8 L4 logo-swap
  plan dropped.
- **Security constraint** (load-bearing): token-in-query MUST NOT reach
  operator browsers. Planner backend fetches server-side, streams PDF
  bytes back as `application/pdf`. Token stays inside Transcorp.
- **Day 8 T2 commit scope**: new `task:print_labels` permission
  (TENANT_SCOPED auto-pickup), new `task.labels_printed` audit event
  (systemOnly: false), `POST /api/tasks/labels` route, multi-select
  button on `/tasks`, `LastMileAdapter.printLabels(session, taskIds)`.

**Cross-reference**: see `memory/followup_suitefleet_label_endpoint.md`
for the full endpoint shape, security analysis, route + adapter
contract, visibility-filter behaviour, and open post-pilot questions.

---

## Day 8 closing-commit posture

C-3 (cron push + DLQ + 23505 routing + Sentry wiring of the bulk-push failure path that C-6 reserved a slot for) is the single largest commit on the Day-8 calendar. Likely 2× C-2's complexity given the schema migration + contract fix + ingest path + cron-service layer all touch in one PR. Plan §4.7 closing-commit discipline applies — no known semantic gaps in whatever lands as Day-8's closing commit.
