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

## Day 8 scope — `shipFrom` config DROPPED (post-webhook-capture update)

**Originally planned:** `src/config/tenant-shipping.ts` keyed by tenantId
with hardcoded Transcorp warehouse values.

**Webhook capture (post-Day-7 close, see
`memory/followup_webhook_auth_architecture.md`) shows shipFrom is
auto-populated by SF from the merchant master.** When we POST a task
without a `shipFrom` field, SF fills it in automatically.

**Day-8 task-create payloads OMIT `shipFrom` entirely.** No
`tenant-shipping.ts` file. Operator-side action: confirm Transcorp's
warehouse address is registered once in each pilot tenant's SF
OpsPortal record at merchant onboarding.

The previously-stated values (`Warehouse 23/24, Union Properties` etc.)
are still the right values for the SF OpsPortal registration — they
just live in SF, not in our codebase.

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

### Schema change locked — `consignees.district` + `tenants.suitefleet_customer_code`

`ALTER TABLE consignees ADD COLUMN district text NOT NULL` with backfill.
Backfill strategy still Love's call (placeholder 'Unknown' vs.
staged nullable-then-required); the empirical confirmation that
`district` is the right field name removes the only API-side
uncertainty.

**Plus** (added post-webhook-capture):
`ALTER TABLE tenants ADD COLUMN suitefleet_customer_code text NOT NULL DEFAULT '';`
followed by per-tenant backfill (TBC for Tabchilli; codes for the
other 2 pilot merchants pending from Aqib), then drop the DEFAULT.

The `customer.code` field is REQUIRED on every task-create POST per
the live webhook capture (`memory/followup_webhook_auth_architecture.md`).
Without it, SF can't scope the create to the right merchant. The C-3
cron's payload-build reads `tenants.suitefleet_customer_code` per-tenant
and passes it as `customer.code` on every POST.

### 23505 reconcile path — AWB regex from error message

When SF returns "Awb with value TBC-XXX exists already" on a duplicate
POST, the adapter parses the AWB out, GETs the task from SF by AWB,
stores the SF task ID locally, and marks the task as pushed.

Regex for the error-message parse: `/Awb with value ([\w-]+) exists already/`
— extract group 1 → AWB. The existing `task-client.ts` 23505 handling
needs this routing branch added in C-3.

This is the SF-side reconcile, distinct from the failed_pushes 23505
routing (which is purely Postgres-side, on the partial UNIQUE on
`failed_pushes(task_id) WHERE resolved_at IS NULL`). Two unrelated
23505-handling paths in C-3 — different layers, same SQLSTATE
coincidence.

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

---

## D8-4 reviewer watch-items (carried forward from D8-2 review, 3 May 2026)

D8-2 review surfaced two fail-closed guards the D8-2 migration comments
promise but D8-4 must actually implement and pin with named unit tests.
Both guards live in the cron-service layer's per-tenant push code; both
pin the "skip-and-leave-for-next-cron-pass" semantics rather than
push-and-fail-downstream.

### Watch-item 1 — `consignee.district = 'UNKNOWN'` fail-closed

The D8-2 migration backfills existing rows with the sentinel `'UNKNOWN'`
and SETs NOT NULL. The application-layer guard MUST detect that sentinel
in the cron's per-task push path and skip the push.

**Expected behaviour:**
- Cron walks tasks, prepares payload from `consignee.district` per row.
- If `consignee.district === 'UNKNOWN'`, skip the push for that task.
- Emit `task.push_failed` audit event with metadata
  `reason: 'unknown_district'`, `consignee_id`, `task_id`. The reason
  vocabulary is system-only telemetry; operator-facing alerting in a
  later commit can map the reason to "consignee district is missing —
  please re-upload via CSV."
- Task row stays unpushed (`pushed_to_external_at IS NULL`); next cron
  pass re-attempts (the operator may have backfilled by then).

**Required test:**
`tests/unit/cron-push-rejects-unknown-district.spec.ts` (or equivalent
co-located naming under the cron module). Asserts:
1. A task with `consignee.district = 'UNKNOWN'` does NOT call the SF
   adapter's `createTask` method.
2. A `task.push_failed` event is emitted with
   `reason: 'unknown_district'`.
3. The task row remains unpushed (no `pushed_to_external_at` or
   `external_id` write).

### Watch-item 2 — `tenants.suitefleet_customer_code IS NULL` fail-closed

The D8-2 migration adds the column NULLABLE; SET NOT NULL is deferred
to a follow-up after operator backfills all 3 pilot tenants. Until then
(and as a permanent guard against future tenants onboarded without the
code), the cron must fail-closed when the column is null.

**Expected behaviour:**
- Cron resolves the tenant's `suitefleet_customer_code` once per
  tenant-pass (not per task — same value across the batch).
- If `null` (or empty string, defence-in-depth), skip the entire
  tenant's push for this cron pass.
- Emit a single `tenant.push_skipped` audit event (NEW event type —
  systemOnly: true) with metadata
  `reason: 'missing_customer_code'`, `tenant_id`, `skipped_task_count`
  (number of tasks that would have been pushed). Single event per
  pass per tenant, NOT per task — the cause is a tenant-level config
  gap, not a per-task failure. Surfaces operationally as one alert
  per tenant per cron pass instead of N alerts. Field name is
  canonical per the sub-item below — use `skipped_task_count`, not
  `task_count`.
- All tasks in the batch stay unpushed; next cron pass re-attempts.

**NOTE on event-type design:** chose `tenant.push_skipped` (new) over
re-using `task.push_failed` because (a) the cause isn't per-task —
emitting N task-level events for one tenant-config gap pollutes the
audit timeline; (b) the operator-facing alert is "tenant X needs a
customer_code", not "task Y failed N times" — different remediation.
Surface this design choice at D8-4 PR open for explicit reviewer sign-
off before the new event type lands.

**Required test:**
`tests/unit/cron-push-rejects-missing-customer-code.spec.ts` (or
equivalent). Asserts:
1. A tenant with `suitefleet_customer_code = null` results in ZERO
   calls to the SF adapter's `createTask` method, even when the tenant
   has pending tasks.
2. Exactly ONE `tenant.push_skipped` event is emitted per tenant per
   pass, with `reason: 'missing_customer_code'` and
   `skipped_task_count: <expected>`.
3. All tasks for the tenant remain unpushed.

#### Sub-item — register `tenant.push_skipped` in `event-types.ts`

Reviewer follow-up after D8-2 design-choice acceptance (3 May 2026).
The new `tenant.push_skipped` audit event MUST be registered in
`src/modules/audit/event-types.ts` at D8-4, alongside the guard
itself. Easy to forget when adding the guard logic; pinning here
explicitly so D8-4 implementer doesn't ship the guard with an
unregistered event type.

**Registration shape:**
- Event type: `tenant.push_skipped`
- `systemOnly: true` — cron-emitted, not user-driven; appears in
  systemOnly subscription audit feeds, not in operator-visible
  per-tenant timelines.
- Metadata shape (canonical):
  ```ts
  {
    tenant_id: Uuid,
    reason: 'missing_customer_code',
    skipped_task_count: number,
  }
  ```
- `reason` is a string union from the start — extending later for
  other tenant-level skip causes (e.g. `'tenant_suspended'`) is
  cheap. For D8-4 only `'missing_customer_code'` is in the union.

**At D8-4 PR open**: inline the registration block from
`event-types.ts` alongside the guard logic. Reviewer can confirm
`systemOnly: true` and the metadata shape match this spec without
chasing the file.

D8-4 PR opening message must inline:
- The per-task `unknown_district` guard logic (load-bearing).
- The per-tenant `missing_customer_code` guard logic (load-bearing).
- The new `tenant.push_skipped` audit event registration in
  `event-types.ts`.
- The two named unit-test files (summary + scenarios; full inline
  on reviewer ask).

Reviewer signed off on the posture decisions in D8-2; D8-4 owes the
actual enforcement + tests. Without these guards, the D8-2 migration's
operational story breaks (sentinel district pushed to SF; null
customer_code pushed and rejected downstream).
