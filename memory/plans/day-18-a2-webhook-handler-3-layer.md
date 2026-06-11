---
name: A2 — SuiteFleet webhook handler 3-layer plan (Day 18, T3)
description: Plan-PR for the webhook handler 3-layer fix. Layer 1.5 swaps parser identifier extraction from inferred camelCase keys to AWB (per memory/decision_layer_1_5_awb_only_extraction.md). Layer 2 adds applyWebhookStatusEvent service fn that writes webhook_events rows + UPDATEs tasks.internal_status (currently zero call sites). Layer 3 adds tasks.pod_photos jsonb migration + TASK_HAS_BEEN_UPDATED edit-event mapping + DELIVERED-event POD URL extraction. Three net-new audit event types. Two UI surface updates (tasks page bag-icon, calendar week card POD inline). Two brief amendments fold in (§3.1.10 array-shape correction + §5.3 Gate 5 path). Asset tracking entirely Phase 2 per product-owner ruling.
type: project
---

# Day-18 A2 — SuiteFleet webhook handler 3-layer plan

## §0 Scope and tier

**Tier:** T3.

Schema migration adds `tasks.pod_photos jsonb` (migration 0022). T3 hard-stops fire at plan-PR open and code-PR open per `memory/feedback_t3_plan_prs_need_realtime_review.md`.

**Demo unblock target:**

- Brief §5.1 demo Section 4 — *"Click delivered Wednesday → popover shows POD photo / driver / 5-star rating"* ([memory/PLANNER_PRODUCT_BRIEF.md:797](../PLANNER_PRODUCT_BRIEF.md#L797)).
- Brief §5.3 Gate 5 — *"≥1 task with status=DELIVERED and non-null POD photo URL (sourced via real webhook)"* ([memory/PLANNER_PRODUCT_BRIEF.md:832](../PLANNER_PRODUCT_BRIEF.md#L832)).

Both gates fail today: `webhook_events` is 0 rows, no `tasks.internal_status` UPDATE path consumes webhook events, and the POD column does not exist on the schema.

**Out-of-scope decisions made up front (§8 details below):**

- Asset tracking integration (entire workstream) — Phase 2 per product-owner ruling.
- `deliveryInformation.bagsReturned` + `deliveryInformation.icePacksReturned` — deprecated, always-NULL fields, not extracted, not stored.
- Phase-2 "Refresh" button for IN_TRANSIT (brief §3.3.8 existing exception).
- Driver photo (separate from POD).

---

## §1 Background

### §1.1 The three-layer compounding gap

Day-17 EOD smoke surfaced that webhook-driven status changes, edit events, and POD photos were not flowing from SuiteFleet into Planner. Investigation revealed three compounding layers (filed as `memory/followup_webhook_handler_status_pod_date_sync_bug.md`, amended Day-18 PM to correct two factual errors):

- **Layer 1 — events not landing.** Production `webhook_events` table held zero rows. Diagnostic walked three plausible root causes (SF URL not registered / per-tenant credential mismatch / architectural auth gap).
- **Layer 2 — no UPDATE-tasks-SET service fn.** Even if events landed, no service code applied them to `tasks.internal_status`. Codebase audit found zero `UPDATE tasks SET internal_status` call sites in `src/modules/`.
- **Layer 3 — POD URL extraction + edit-event handling not implemented.** No code path extracts POD URLs on DELIVERED events; no path maps `TASK_HAS_BEEN_UPDATED` payload fields to `tasks.delivery_date / address_id / delivery_*_time`.

### §1.2 Day-18 forensic dive — root cause refines to Layer 1.5

Day-18 morning Vercel-log dive resolved Layer 1 to a parser-side root cause distinct from the three originally hypothesised: the receiver was reaching the parser, the parser was running, but every event was being dropped with `error_code: missing_task_id`. The webhook-parser scaffold at `src/modules/integration/providers/suitefleet/webhook-parser.ts:92-101` looks for `["taskId", "externalTaskId", "task_id"]` — none of which appear in real SF webhook payloads. The Day-7 empirical capture surfaced two identifier fields: `id` (numeric, SF-internal) and `awb` (string, e.g. `MPL-25193918`).

Drift sat undetected from Day-7 through Day-17 because:

- The receiver verifies + parses but does NOT propagate events to side-effect code (D8-8 stub `processWebhookAsync` at [src/app/api/webhooks/suitefleet/[tenantId]/route.ts:272-288](../../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts#L272)).
- Parser logs `missing_task_id` as a warn-only event-skip, not a fail.
- `webhook_events` table holds zero rows in production (no INSERT path wired), so the silent-drop signal had no visible surface.

This refinement of the Layer-1 root cause is the **Layer 1.5** contract, locked per `memory/decision_layer_1_5_awb_only_extraction.md`: parser extracts AWB only.

### §1.3 Receiver scaffold state today

[src/app/api/webhooks/suitefleet/[tenantId]/route.ts](../../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts) is the Day-8 D8-8 verification-gates scaffold. The receiver:

- ✅ Verifies UUID well-formedness, tenant accept-flag, body shape, Tier-1 / Tier-2 credentials.
- ✅ Parses payload via `getSuiteFleetAdapter().parseWebhookEvents(bodyJson)`.
- ✅ Logs `idempotency_keys` + `auth_tier` + `event_count`.
- ✅ Audit-emits `webhook.auth_failed` on Tier-2 mismatch.
- ❌ Does NOT INSERT into `webhook_events`.
- ❌ Does NOT UPDATE `tasks.internal_status`.
- ❌ Does NOT extract POD URLs.
- ❌ Does NOT handle `TASK_HAS_BEEN_UPDATED` edit events.

The route comment at lines 250-253 documents the boundary: *"SQS / dedup-table wiring is a Day-9+ concern. Until then, observation-only…"* This plan-PR closes that observation-only posture.

### §1.4 Existing parsing surfaces (mapping inventory)

Two parallel mapping files live in `src/modules/integration/providers/suitefleet/`:

- **status-mapper.ts** — 14 SF actions → 7-value `InternalTaskStatus`. `TASK_HAS_BEEN_UPDATED` returns `null` (known non-lifecycle). Unknown actions warn-log + null. This is Layer 2's status-resolution input.
- **webhook-parser.ts** — 15 actions → `WebhookEventKind` enum (`TASK_STATUS_CHANGED` / `TASK_ASSIGNMENT_CHANGED`). Layer 1.5 patches the `extractTaskId` lookup-key list here.

The two surfaces are complementary, not redundant. `webhook-parser.ts` produces a typed `WebhookEvent` with `externalTaskId` + `idempotencyKey`. `status-mapper.ts` resolves the SF action string to an internal status. Layer 2 will compose them.

### §1.5 Existing schema surfaces

- [supabase/migrations/0006_task.sql](../../supabase/migrations/0006_task.sql) — `tasks` table, `internal_status text NOT NULL DEFAULT 'CREATED' CHECK (...)`, `delivery_date`, `delivery_start_time`, `delivery_end_time`, `external_id text` (Layer-2 lookup key, AWB-shaped per PR #172 discipline).
- [supabase/migrations/0014_addresses_and_subscription_address_rotations.sql:78](../../supabase/migrations/0014_addresses_and_subscription_address_rotations.sql#L78) — `tasks.address_id uuid` (nullable, ON DELETE RESTRICT).
- [supabase/migrations/0018_webhook_events.sql](../../supabase/migrations/0018_webhook_events.sql) — `webhook_events` table, append-only, dedup UNIQUE on `(suitefleet_task_id, action, event_timestamp)`. Currently 0 rows.
- [supabase/migrations/0019_tasks_internal_status_skipped.sql](../../supabase/migrations/0019_tasks_internal_status_skipped.sql) — adds `SKIPPED` to `tasks_internal_status_check` (8 values).
- **No `tasks.pod_photos` column.** Layer 3 ships it as new migration 0022.

### §1.6 Existing audit vocabulary

[src/modules/audit/event-types.ts](../../src/modules/audit/event-types.ts) registers a single webhook event today: `webhook.auth_failed` (Tier-2 mismatch, systemOnly). No vocabulary exists for status/edit/POD application. Layer 2 + Layer 3 register three net-new event types (§5).

---

## §2 Layer 1.5 implementation

Locked per [memory/decision_layer_1_5_awb_only_extraction.md](../decision_layer_1_5_awb_only_extraction.md). Scope is parser-only; receiver INSERT into `webhook_events` is Layer 2's contract.

### §2.1 Code change

[src/modules/integration/providers/suitefleet/webhook-parser.ts:92-101](../../src/modules/integration/providers/suitefleet/webhook-parser.ts#L92) `extractTaskId`:

**Before:**
```ts
function extractTaskId(raw: Record<string, unknown>): string | null {
  for (const key of ["taskId", "externalTaskId", "task_id"]) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
```

**After:**
```ts
function extractTaskId(raw: Record<string, unknown>): string | null {
  const value = raw.awb;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}
```

Numeric coercion drops too — AWB is always a string. The numeric `id` field stays in `raw_payload` for forensic recovery (preserved at the receiver level once Layer 2's INSERT path is wired).

### §2.2 Header comment update

The TODO comment block at lines 22-28 (referring to `suitefleet-adapter-tech-spec.md` and "S-9 empirical sandbox capture") is now factually closed by Day-7 capture. Replace with a one-line note pointing at the decision memo.

### §2.3 Tests

Move from synthetic-shape assertions to a real Day-7 capture fixture. Net new test file (or extend [src/modules/integration/providers/suitefleet/tests/webhook-parser.spec.ts](../../src/modules/integration/providers/suitefleet/tests/webhook-parser.spec.ts)):

- **Test 1:** real Day-7 capture body (AWB-bearing) → parser returns 1 event with `externalTaskId === "<captured AWB>"`.
- **Test 2:** body missing `awb` field (defensive) → parser warn-logs `missing_task_id` and returns empty array.
- **Test 3:** body with `awb: ""` (empty string) → same skip path.

Capture fixture path: `src/modules/integration/providers/suitefleet/tests/fixtures/test_hook.json` (sanitised — strip any tenant-identifying secrets before commit; reviewer to verify).

Fixture sanitisation: replace any real consignee PII (name, phone, address) with synthetic placeholders before commit. Real AWB string preserved (it's the load-bearing test input).

### §2.4 Estimated effort

30-45 min (matches decision memo §5).

---

## §3 Layer 2 design — UPDATE-tasks-SET service fn

### §3.1 Service fn shape

```ts
applyWebhookStatusEvent(
  tenantId: Uuid,
  event: WebhookEvent,                  // parser output
  suitefleetAction: string,             // raw SF action string (for status-mapper lookup)
): Promise<{ applied: boolean; reason?: string }>
```

Returned `applied: false` cases (non-error skips):

- `TASK_HAS_BEEN_UPDATED` → maps to null in status-mapper, status-fn skips silently (Layer 3 handles it).
- Unknown action → status-mapper returns null + warn; status-fn returns `{ applied: false, reason: "unknown_action" }`.
- Task lookup miss (no row in `tasks` matching `external_id = event.externalTaskId`) → returns `{ applied: false, reason: "task_not_found" }`.
- Idempotent retry (same `(suitefleet_task_id, action, event_timestamp)` tuple already in `webhook_events`) → returns `{ applied: false, reason: "duplicate" }`.

### §3.2 Module placement (ruled: Option A)

Two candidate locations were considered:

- **Option A:** `src/modules/integration/` — keeps the webhook concern co-located with the SF adapter and receiver path. Existing precedent: status-mapper + webhook-parser already live under `src/modules/integration/providers/suitefleet/`.
- **Option B:** `src/modules/tasks/` — surfaces the mutation in the task-domain module. Existing tasks module has the read-side; this would add a write-side fn.

**Ruled: Option A.** Co-located with the SF adapter. No re-export from `src/modules/tasks/` today — if a non-webhook caller ever needs status-application logic, that's a real refactor moment, not pre-emptive plumbing.

### §3.3 Step sequence inside the service fn

1. Resolve `InternalTaskStatus | null` via `status-mapper.ts`'s `mapSuiteFleetStatusToInternal(action)`.
2. If null → return `{ applied: false, reason: "non_lifecycle_or_unknown" }`. Layer 3 handles `TASK_HAS_BEEN_UPDATED` separately.
3. Open transaction via `withTenant(tenantId, async (tx) => …)`.
4. INSERT into `webhook_events` `(tenant_id, suitefleet_task_id, action, event_timestamp, raw_payload)`. On 23505 SQLSTATE (UNIQUE violation on dedup index) → return `{ applied: false, reason: "duplicate" }`. Append-only table — no UPSERT, no UPDATE.
5. SELECT `(id, internal_status)` FROM `tasks` WHERE `external_id = event.externalTaskId` — Layer 2 lookup keys off `tasks.external_id` (AWB-shaped per PR #172). The selected `internal_status` is captured as `previous_status` for the audit emit in step 7 (no second read). If 0 rows → return `{ applied: false, reason: "task_not_found" }` + warn-log (forensic surface for AWB-vs-Planner-task gaps).
6. UPDATE `tasks SET internal_status = $newStatus, updated_at = now() WHERE id = $taskId AND tenant_id = $tenantId`.
7. Audit-emit `task.status_changed_via_webhook` (see §5) with metadata `{ task_id, suitefleet_task_id, previous_status, new_status, sf_action, webhook_events_id, event_timestamp }`. `previous_status` comes from the step-5 SELECT.
8. Commit transaction; return `{ applied: true }`.

### §3.4 Idempotency posture

Two layers:

- **DB layer (load-bearing):** UNIQUE index on `webhook_events (suitefleet_task_id, action, event_timestamp)`. SF retries on non-2xx; the second attempt hits the constraint and the service fn short-circuits at step 4.
- **Service-fn layer (defence-in-depth):** the `{ applied: false, reason: "duplicate" }` return path makes the idempotency outcome inspectable by the receiver caller, which then logs but still returns 200.

The receiver MUST return 200 even on duplicate, so SF doesn't keep retrying. The service fn never throws on duplicate; it returns the structured result.

### §3.5 Receiver wiring

[src/app/api/webhooks/suitefleet/[tenantId]/route.ts:254-267](../../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts#L254) `processWebhookAsync` stub gets a real implementation:

```ts
async function processWebhookAsync(
  events: readonly WebhookEvent[],
  requestId: string,
  tenantId: Uuid,
): Promise<void> {
  for (const event of events) {
    try {
      const sfAction = (event.raw as Record<string, unknown>)?.action;
      if (typeof sfAction !== "string") {
        // Parser already skipped this; defensive log.
        continue;
      }
      const result = await applyWebhookStatusEvent(tenantId, event, sfAction);
      // Layer 3 edit-event + POD-extraction calls also dispatch from here (§4).
      log.info({ ...result, request_id: requestId, idempotency_key: event.idempotencyKey });
    } catch (err) {
      captureException(err, { component: "suitefleet_webhook_async", … });
    }
  }
}
```

Per-event error isolation: one failing event MUST NOT poison the loop for the rest of the batch. Sentry capture on throw; loop continues.

### §3.6 Estimated effort

2-3 hr (service fn + receiver wiring + tests + audit registration).

---

## §4 Layer 3 design — edit-event handling + POD capture

### §4.1 Migration 0022 — `tasks` webhook-extracted columns + POD

`supabase/migrations/0022_tasks_webhook_extracted_columns.sql` — filename anchors the full 10-column scope per §4.5 ruling (renamed from `0022_tasks_pod_photos.sql` at plan-PR sign-off so the code-PR doesn't have to relitigate naming).

Ten ADD COLUMN statements, all nullable, no defaults:

```sql
ALTER TABLE tasks
  ADD COLUMN pod_photos                jsonb,
  ADD COLUMN recipient_name            text,
  ADD COLUMN signature                 text,
  ADD COLUMN consignee_rating          smallint,
  ADD COLUMN consignee_comment         text,
  ADD COLUMN driver_comment            text,
  ADD COLUMN number_of_attempts        smallint,
  ADD COLUMN failure_reason_comment    text,
  ADD COLUMN completion_latitude       numeric,
  ADD COLUMN completion_longitude      numeric;
```

- Nullable, no default. NULL on `pod_photos` = no POD received yet (or task is non-DELIVERED). NULL on the 9 webhook-extracted columns = no `TASK_HAS_BEEN_UPDATED` event has ever delivered a value for that field on this row. Non-null `pod_photos` = ARRAY of photo URLs (or richer object — §4.4 deferred to code-PR).
- `signature` typed as `text` covers both base64-blob and URL forms; Day-7 capture review at code-PR open settles which.
- `consignee_rating` + `number_of_attempts` typed as `smallint` (1-5 ratings, attempt counts ≤ a few hundred — int2 is comfortable).
- `completion_latitude` + `completion_longitude` typed as `numeric` (no precision/scale specified to admit SF's wire-side precision verbatim; Day-7 capture review at code-PR confirms shape).
- No indexes. Predicates against any of these columns are not load-bearing for MVP; partial indexes can land later if reporting surfaces emerge.
- RLS already enabled on `tasks` (0006); no policy change.
- GRANT already in place via 0003 ALTER DEFAULT PRIVILEGES.

Migration discipline: forward-only, applied via Supabase SQL editor post-merge per the standing per-statement approval pattern (see `memory/feedback_claude_code_executes_default.md`). Single migration file, single forward-only apply — T3 stays.

### §4.2 TASK_HAS_BEEN_UPDATED edit-event mapping

Service fn `applyWebhookEditEvent(tenantId, event)` dispatched from the same async loop. Reads `event.raw` and conditionally UPDATEs the matching task row.

**Field mapping ("capture all changes" per product-owner ruling):**

| SF payload field | tasks column | Notes |
|---|---|---|
| `delivery_date` | `delivery_date` | date |
| `deliveryStartTime` | `delivery_start_time` | time |
| `deliveryEndTime` | `delivery_end_time` | time |
| `consignee.location.*` | (no column write) | §4.3 ruled (ii): audit-only via metadata; no `tasks.address_id` mutation |
| `deliveryInformation.recipientName` | `recipient_name` | text (§4.5 col) |
| `deliveryInformation.signature` | `signature` | text — base64 or URL per Day-7 capture review at code-PR (§4.5 col) |
| `deliveryInformation.consigneeRating` | `consignee_rating` | smallint (§4.5 col) |
| `deliveryInformation.consigneeComment` | `consignee_comment` | text (§4.5 col) |
| `deliveryInformation.driverComment` | `driver_comment` | text (§4.5 col) |
| `deliveryInformation.numberOfAttempts` | `number_of_attempts` | smallint (§4.5 col) |
| `deliveryInformation.failureReasonComment` | `failure_reason_comment` | text (§4.5 col) |
| `deliveryInformation.completionLatitude` | `completion_latitude` | numeric (§4.5 col) |
| `deliveryInformation.completionLongitude` | `completion_longitude` | numeric (§4.5 col) |

**Deprecated, NOT extracted:**

- `deliveryInformation.bagsReturned` (always NULL per product-owner ruling)
- `deliveryInformation.icePacksReturned` (always NULL per product-owner ruling)

These are referenced by the asset-tracking workstream, which is Phase 2 (§8). Receiver does not assert their presence/absence.

UPDATE statement is conditional on tx-level diff: only writes columns whose payload value differs from the current row, to keep the audit trail meaningful. Same row read in step 5 of §3.3 is reused.

### §4.3 consignee.location.* mapping (ruled: Option (ii))

**Question considered:** when SF sends a `TASK_HAS_BEEN_UPDATED` event with a changed `consignee.location.*` payload, do we mutate `tasks.address_id` directly?

- **Option (i):** Direct write — find or create an `addresses` row matching the new location, assign its uuid to `tasks.address_id`. Risk: explodes the addresses table with one-off override rows that don't tie back to a `subscription_address_rotations` entry.
- **Option (ii):** No-op for address fields in MVP; capture the address payload as audit metadata. Layer-3 doesn't mutate `tasks.address_id`. Defer Phase-2 design of the merge logic.
- **Option (iii):** Strict-rejection — if the address payload differs, log a warn + audit emit, do NOT mutate. Operator workflow handles the discrepancy manually.

**Ruled: Option (ii).** The address-rotation model (`subscription_address_rotations` per migration 0014) is the operator's source of truth; webhook-driven address mutation in MVP would create dual-write surface area for a low-frequency event.

**No fourth audit event type is added.** Address-payload-received cases route through the existing `task.edit_applied_via_webhook` event (§5.2). The address payload is captured as a `changed_fields` metadata entry with `previous: null, new: <payload>`. The `previous: null` posture marks "we observed an SF-side address but didn't apply it" — distinct from real edit-event diffs which carry concrete previous values. Phase-2 design of the merge logic is then a question of "how do we reconcile the captured-but-not-applied audit trail with the address-rotation source of truth," not "how do we add a new event type."

### §4.4 POD photo extraction

On `TASK_STATUS_UPDATED_TO_DELIVERED` (handled in Layer 2's status-fn before the UPDATE, OR in a parallel Layer-3 fn — see §4.6):

1. Extract `event.raw.deliveryInformation.photos` (array of URL strings, or richer object — needs Day-7 capture verification).
2. Write to `tasks.pod_photos` as part of the same UPDATE statement that sets `internal_status = 'DELIVERED'`.
3. Audit-emit `task.pod_received_via_webhook` (§5) with metadata `{ task_id, suitefleet_task_id, photo_count, webhook_events_id }`.

**Schema choice for `pod_photos` jsonb shape:**

- **Option (A):** plain string array `["url1", "url2"]`. Minimal; most consumers (UI, downstream tooling) just iterate.
- **Option (B):** object array `[{url, capturedAt, mimeType}]`. Richer; preserves SF metadata if any.

**Recommendation: (A)** for MVP. SF payload's photo shape is the empirical anchor; Day-7 capture review confirms the actual fields. If the wire shape is richer than urls, store the full object verbatim; otherwise (A).

**Ruling deferred to code-PR open.** Code-PR proposer surfaces Day-7 photo payload shape in code-PR description with proposed (A) or (B); reviewer rules at code-PR open. Plan-PR locks all other open questions but explicitly carries this one forward so it doesn't get lost between plan-PR merge and code-PR open.

### §4.5 Extracted-field column architecture (ruled: Option (1))

The §4.2 table originally listed 9 fields with `TBD column`. Three choices were considered:

- **Option (1):** Add 9 nullable columns to `tasks` in migration 0022 alongside `pod_photos`. Wide schema, queryable directly, Drizzle types reflect the shape.
- **Option (2):** Single `tasks.webhook_extracted_fields jsonb` column. Compact; queries through json operators; Drizzle types are looser.
- **Option (3):** Compute on read from `webhook_events.raw_payload` (no denormalisation). Brief §3.3.8 schema-implication explicitly says *"typed extracted fields AND full raw payload"* — option 3 violates the brief.

**Ruled: Option (1).** Explicit columns honour the brief's "typed extracted fields" guidance and keep Drizzle ergonomics intact.

Column names follow snake_case canon. Nine columns added in migration 0022 alongside `pod_photos`:

- `recipient_name` (text)
- `signature` (text — base64 or URL per Day-7 capture review at code-PR)
- `consignee_rating` (smallint)
- `consignee_comment` (text)
- `driver_comment` (text)
- `number_of_attempts` (smallint)
- `failure_reason_comment` (text)
- `completion_latitude` (numeric)
- `completion_longitude` (numeric)

All nullable, no defaults. Total migration footprint: `pod_photos` + 9 webhook-extracted columns = 10 ADD COLUMN statements (single migration file, single forward-only apply — T3 stays). See §4.1 for the full DDL.

### §4.6 POD-extraction call-site placement

Two options:

- **Option (a):** POD extraction lives inside Layer-2's `applyWebhookStatusEvent` — when the resolved `InternalTaskStatus === 'DELIVERED'`, the same UPDATE writes `pod_photos` from the payload.
- **Option (b):** POD extraction is a separate Layer-3 fn `applyWebhookPodEvent` dispatched from the receiver alongside the status fn.

**Recommendation: (a)** — single transaction guarantees the status flip and POD landing are atomic. Avoids a window where status='DELIVERED' but `pod_photos IS NULL`.

### §4.7 Estimated effort

2-3 hr (migration + service fn + receiver wiring + tests + audit registration).

---

## §5 New audit event vocabulary

Three net-new event types to register in [src/modules/audit/event-types.ts](../../src/modules/audit/event-types.ts):

### §5.1 `task.status_changed_via_webhook`

```ts
"task.status_changed_via_webhook": {
  id: "task.status_changed_via_webhook",
  resource: "task",
  action: "status_changed_via_webhook",
  description:
    "Day-18 / A2 Layer 2. A task's internal_status was UPDATEd as a consequence of a SuiteFleet webhook event landing. Distinct from operator-driven status changes (which use task.status_changed) — the via_webhook suffix marks the system-actor path. Carries webhook_events.id for forensic linkage to the raw payload.",
  metadataNotes:
    "task_id, suitefleet_task_id (AWB), previous_status, new_status, sf_action, webhook_events_id, event_timestamp.",
  systemOnly: true,
},
```

### §5.2 `task.edit_applied_via_webhook`

```ts
"task.edit_applied_via_webhook": {
  id: "task.edit_applied_via_webhook",
  resource: "task",
  action: "edit_applied_via_webhook",
  description:
    "Day-18 / A2 Layer 3. A task row was UPDATEd from a TASK_HAS_BEEN_UPDATED webhook payload. Captures the field-by-field delta in metadata; covers delivery_date, delivery_start_time, delivery_end_time, and the deliveryInformation.* extracted fields. Address-payload-received cases (consignee.location.* changes per plan §4.3) are captured in metadata as changed_fields entries with previous=null but do NOT mutate tasks.address_id in MVP.",
  metadataNotes:
    "task_id, suitefleet_task_id, webhook_events_id, changed_fields (array of {field, previous, new}).",
  systemOnly: true,
},
```

### §5.3 `task.pod_received_via_webhook`

```ts
"task.pod_received_via_webhook": {
  id: "task.pod_received_via_webhook",
  resource: "task",
  action: "pod_received_via_webhook",
  description:
    "Day-18 / A2 Layer 3. POD photos landed for a task on TASK_STATUS_UPDATED_TO_DELIVERED. tasks.pod_photos transitioned from NULL to a populated jsonb. Co-emits with task.status_changed_via_webhook (DELIVERED transition) but the POD event is the load-bearing signal for the demo §5.3 Gate-5 preflight.",
  metadataNotes:
    "task_id, suitefleet_task_id, photo_count, webhook_events_id.",
  systemOnly: true,
},
```

### §5.4 Test additions in event-types.spec.ts

Three smoke cases:
- Each new event type appears in the registry.
- Each is `systemOnly: true`.
- Each follows `resource.action_past_tense` shape.

Existing event-types.spec.ts pattern at [src/modules/audit/tests/event-types.spec.ts](../../src/modules/audit/tests/event-types.spec.ts) is the precedent.

---

## §6 UI surface for POD

Two surfaces, both reading from `tasks.pod_photos`:

### §6.1 Tasks page — bag-icon column

Per product-owner-supplied design direction:

- New column at first or last position (reviewer ruling on column order).
- Renders a blue+green bag-silhouette icon (POD/cooler-bag iconography per `memory/MEMORY.md` "POD cooler-bag icon refinement" entry).
- **NULL state:** icon greyed out (muted / opacity-40 / `text-stone-400`-equivalent token).
- **Populated state:** icon in brand colour; click target opens a modal/lightbox showing the photo(s).
- Modal: simple image-display (one photo per page if `pod_photos` has multiple; minimal carousel if any). No download in MVP.

Source: `tasks.pod_photos` jsonb. Server component reads, passes to client component for the modal trigger + lightbox state.

Test coverage:
- Helper test: NULL → greyed surface, populated → active surface.
- Client-component test: deferred per `memory/followup_client_component_test_infra.md` (same posture as merchant admin Modal tests).

### §6.2 Calendar week view — card-embedded inline POD

Per product-owner-supplied screenshot (sample card with POD label + image embedded inline):

- Existing PR #177 calendar week-view card UI extends with an inline POD image when `tasks.pod_photos` is non-null AND `internal_status === 'DELIVERED'`.
- No separate icon trigger — the image renders inline at a small thumbnail size (~64×64 or per design system token).
- Click → opens the same modal/lightbox from §6.1 (shared component).

PR #177 is the existing calendar-popover surface (per Day-17 EOD §2). Layer-3 amends the rendered card content; no new route.

### §6.3 Column placement on tasks page (ruled: last column)

First column vs last column considered. **Ruled: last column** — POD icon is informational, not a primary action affordance. Operator scanning patterns stay intact.

### §6.4 Estimated effort

UI surfacing: ~1-1.5 hr total (tasks page column + calendar card thumbnail + shared lightbox modal).

---

## §7 Brief amendments (folded into this PR)

Brief moves **v1.7 → v1.8** in this plan-PR. §9 amendment log entry included with the version bump and a one-line summary of the §3.1.10 + §5.3 corrections.

Two brief amendments land in the same plan-PR.

### §7.1 §3.1.10 — webhook payload format correction

**Current text** ([memory/PLANNER_PRODUCT_BRIEF.md:384](../PLANNER_PRODUCT_BRIEF.md#L384)):
> Webhook payload format: `?sf-format=object` (single-event JSON, simpler handler logic).

**Empirical state:** SF sends JSON arrays. The receiver enforces `Array.isArray(bodyJson)` ([route.ts:146](../../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts#L146)), the parser asserts the same ([webhook-parser.ts:149](../../src/modules/integration/providers/suitefleet/webhook-parser.ts#L149)), and Day-7 capture confirms array shape.

**Amended text:**
> Webhook payload format: JSON array (batched per receipt; each entry is one event). The receiver iterates events; the dedup UNIQUE on `webhook_events` collapses retries.

### §7.2 §5.3 Gate 5 — preflight verification path

**Current text** ([memory/PLANNER_PRODUCT_BRIEF.md:832](../PLANNER_PRODUCT_BRIEF.md#L832)):
> ≥1 task with status=DELIVERED and non-null POD photo URL (sourced via real webhook)

**Amended text:**
> ≥1 task with status=DELIVERED and `tasks.pod_photos IS NOT NULL` (sourced via real webhook → Layer 2 status-fn write → Layer 3 POD-extraction populates the jsonb in the same UPDATE statement).

The amendment binds the gate to the concrete column landed by this plan-PR.

### §7.3 §3.3.8 — POD example reaffirmed

No text change. The cache-from-webhook commitment ([memory/PLANNER_PRODUCT_BRIEF.md:563-571](../PLANNER_PRODUCT_BRIEF.md#L563)) stays. POD is the canonical example; the schema-implication line ("typed extracted fields AND full raw payload") is what drives §4.5's Option-(1) recommendation.

---

## §8 Out of scope (Phase 2)

### §8.1 Asset tracking integration — entire workstream

Per product-owner ruling: the `/api/task-asset-tracking` polling API, the `bagsReturned` / `icePacksReturned` payload fields, and the `asset_tracking_cache` table read/write paths are entirely out of MVP.

- The `asset_tracking_cache` table + 0011 migration **stay shipped** as dormant infrastructure.
- The audit event types `asset_tracking.state_changed` + `asset_tracking.taskid_unmatched` (already registered at [event-types.ts:543/553](../../src/modules/audit/event-types.ts#L543)) stay registered but emit zero events.
- No code path reads or writes `asset_tracking_cache` in MVP.
- No UI surface displays bag/ice-pack state.

Phase-2 followup memo to file as part of this plan-PR's pre-merge checklist (§11): `memory/followup_asset_tracking_phase_2.md` — captures the deferral, the dormant-infrastructure note, and the read/write call-sites that need wiring at unfreeze.

### §8.2 Phase-2 "Refresh" button for IN_TRANSIT

Brief §3.3.8 lines 569 already documents this as Phase-2 exception. No change.

### §8.3 POD photo download / attachment workflows

In MVP the lightbox only displays. Download, share, attach-to-email, etc. are Phase 2.

### §8.4 Driver photo (separate from POD)

Brief §3.3.3 lines 494-495 mentions driver name in popover. Driver photo is not in MVP; would be a separate cache target.

### §8.5 Address-mutation merge logic

Per §4.3 recommendation: webhook-driven `consignee.location.*` mutations are audit-only in MVP. Phase-2 design covers the merge with `subscription_address_rotations`.

---

## §9 Tests (worked-example coverage)

### §9.1 Layer 1.5

Unit specs in [src/modules/integration/providers/suitefleet/tests/webhook-parser.spec.ts](../../src/modules/integration/providers/suitefleet/tests/webhook-parser.spec.ts):

- AWB extraction from real Day-7 capture fixture (positive case).
- Missing `awb` field → skip + warn (defensive).
- Empty `awb` string → skip + warn (defensive).

Existing synthetic-shape spec rows pinning `taskId` / `externalTaskId` / `task_id` are deleted; the inferred-key fallback is gone.

### §9.2 Layer 2 — integration spec (real Postgres)

New file: `tests/integration/webhook-status-event-applied.spec.ts`:

- Seed a tenant + a task with `external_id = 'TEST-AWB-${RUN_ID}'` and `internal_status = 'CREATED'`.
- Construct a webhook event payload (one entry, action `TASK_STATUS_UPDATED_TO_PICKED_UP`, `awb = 'TEST-AWB-${RUN_ID}'`).
- Invoke `applyWebhookStatusEvent` → expect `applied: true`.
- Assertions:
  - `webhook_events` has the new row with the dedup tuple.
  - `tasks.internal_status` flipped to `IN_TRANSIT`.
  - `audit_events` has a `task.status_changed_via_webhook` row with the expected metadata fields.
- Re-invoke with the same payload → expect `applied: false, reason: "duplicate"` AND `webhook_events` row count unchanged AND `tasks.internal_status` unchanged AND no second audit event.
- Invoke with a missing-task payload → expect `applied: false, reason: "task_not_found"`.

Per-run isolation: random RUN_ID slug per Day-18 PR #191 precedent (audit_events_no_delete RULE blocks DELETE cascade — implicit teardown via RUN_ID suffix).

### §9.3 Layer 3 — integration specs

Two new files:

`tests/integration/webhook-edit-event-applied.spec.ts`:
- Seed a task → fire `TASK_HAS_BEEN_UPDATED` with new `delivery_date` + `deliveryStartTime` + `deliveryEndTime`.
- Expect `tasks.delivery_date / delivery_start_time / delivery_end_time` updated.
- Expect `task.edit_applied_via_webhook` audit event with the field-delta metadata.
- Expect deprecated fields (`bagsReturned`, `icePacksReturned`) ignored even if present in payload.
- Address-payload-changed case → expect NO `tasks.address_id` mutation (per §4.3 (ii) recommendation).

`tests/integration/webhook-pod-received.spec.ts`:
- Seed a task at `internal_status = 'IN_TRANSIT'` with `pod_photos = NULL`.
- Fire `TASK_STATUS_UPDATED_TO_DELIVERED` with `deliveryInformation.photos = ['url1', 'url2']`.
- Expect `tasks.internal_status = 'DELIVERED'` AND `tasks.pod_photos = '["url1","url2"]'::jsonb`.
- Expect `task.status_changed_via_webhook` AND `task.pod_received_via_webhook` audit events both fired.

### §9.4 Migration 0022 standalone test

Smoke test in the existing migration-test surface (or as part of integration setup):

After 0022 applies, all 10 ADD COLUMN statements landed on `tasks` with the expected types and nullability:

| Column | Type | Nullable | Default |
|---|---|---|---|
| `pod_photos` | `jsonb` | yes | NULL |
| `recipient_name` | `text` | yes | NULL |
| `signature` | `text` | yes | NULL |
| `consignee_rating` | `smallint` | yes | NULL |
| `consignee_comment` | `text` | yes | NULL |
| `driver_comment` | `text` | yes | NULL |
| `number_of_attempts` | `smallint` | yes | NULL |
| `failure_reason_comment` | `text` | yes | NULL |
| `completion_latitude` | `numeric` | yes | NULL |
| `completion_longitude` | `numeric` | yes | NULL |

Existing `tasks` rows have all 10 columns as NULL (no backfill needed; nullable lets pre-existing rows stay). Spec asserts via `information_schema.columns` query against the live test DB or by Drizzle introspection.

### §9.5 Audit event-types unit tests

Three smoke cases per §5.4. Existing pattern at [src/modules/audit/tests/event-types.spec.ts](../../src/modules/audit/tests/event-types.spec.ts).

### §9.6 Receiver-route end-to-end POST integration test

New file: `tests/integration/webhooks-suitefleet-receiver-route.spec.ts` (or extend existing receiver-spec surface if one exists).

POST a synthetic webhook payload to `/api/webhooks/suitefleet/[tenantId]` using a seeded test tenant + valid Tier-1/Tier-2 credentials per existing receiver test patterns. Assert end-to-end:

- `webhook_events` row landed with the dedup tuple from the synthetic payload.
- `tasks.internal_status` flipped on the matching `external_id` (AWB).
- `audit_events` carries the corresponding `task.status_changed_via_webhook` row.
- Per-event error isolation works: a payload with one valid event and one malformed event returns 200 and lands the valid event without poisoning the loop.

Catches wiring bugs in `processWebhookAsync` that §9.2's direct-fn invocation cannot — the receiver-route path includes verification + parsing + dispatch + audit-emit composition, none of which §9.2 exercises end-to-end.

Estimated: 30 min addition.

---

## §10 Sequencing

1. **Plan-PR opens** (this document) → reviewer counter-review at plan-PR open (T3 first hard-stop per `memory/feedback_t3_plan_prs_need_realtime_review.md`).
2. **Plan-PR merges.**
3. **Code-PR opens** on branch `day18/a2-webhook-handler-code` (separate from this plan branch).
4. **Code-PR review at PR open** (T3 second hard-stop). Reviewer assesses: schema migration, service fn shape vs plan, audit registrations, test coverage parity with §9.
5. **Code-PR merges.**
6. **Manual SQL editor application of migration 0022 to production** (per existing migration discipline, `memory/feedback_claude_code_executes_default.md` per-statement approval gate). Fresh-DB migration test runs as part of code-PR CI — 0022 is verified to apply cleanly against a DB with only 0001-0021 in place, not just against the dev DB which has accumulated state.
7. **Production smoke:**
   - Trigger SF event against demo tenant (Aqib coordination if no live SF traffic by then; OR sandbox-588 cron-generated task progressing through SF lifecycle).
   - Verify `webhook_events` row written for the action.
   - Verify `tasks.internal_status` flipped on the matching `external_id`.
   - Verify `audit_events` carries the `task.status_changed_via_webhook` row.
8. **Demo data prep** (independent of #7): real SF webhook fired against demo task → POD photo lands in `tasks.pod_photos` → tasks-page bag-icon flips to active state, calendar week card embeds the photo inline.

---

## §11 Pre-merge checklist (this plan-PR)

- [ ] Plan-PR §0-§10 complete and internally consistent.
- [ ] No mention of test/sandbox credentials, secrets, or per-tenant client-id/client-secret values in plan body or commit messages.
- [ ] Brief amendment language drafted for §7.1 (§3.1.10 array-shape correction) and §7.2 (§5.3 Gate-5 path). Amendments fold into the same PR via direct edits to `memory/PLANNER_PRODUCT_BRIEF.md`.
- [ ] Phase-2 followup memo drafted: `memory/followup_asset_tracking_phase_2.md` covers the asset-tracking deferral, the dormant-infrastructure note, the deprecated-payload-fields list, and the call-site re-wire scope at unfreeze.
- [x] Reviewer rulings captured for the open questions (4 ruled in plan-PR, 1 deferred to code-PR by design):
  - §3.2 — Layer-2 module placement → **ruled Option A** (integration; no re-export to tasks).
  - §4.3 — consignee.location.* mapping → **ruled Option (ii)** (audit-only via existing `task.edit_applied_via_webhook` event with `previous: null` metadata; no fourth event type, no `tasks.address_id` mutation).
  - §4.4 — POD jsonb shape → **deferred to code-PR open.** Code-PR proposer surfaces Day-7 photo payload shape with proposed (A) or (B); reviewer rules at code-PR open.
  - §4.5 — extracted-field column architecture → **ruled Option (1)** (9 nullable columns alongside `pod_photos` in migration 0022; snake_case canon; see §4.1 DDL and §4.5 column list).
  - §6.3 — tasks-page POD column placement → **ruled last column.**
- [ ] Reviewer approves plan-PR before code-PR opens.

---

## §12 Cross-references

- `memory/decision_layer_1_5_awb_only_extraction.md` — Layer 1.5 contract.
- `memory/followup_webhook_handler_status_pod_date_sync_bug.md` — Layer-1 forensics + Layer-2/3 sketch (amended Day-18 PM).
- `memory/followup_webhook_auth_architecture.md` — Day-7 capture context.
- `memory/feedback_t3_plan_prs_need_realtime_review.md` — T3 hard-stop discipline.
- `memory/feedback_claude_code_executes_default.md` — migration approval-gate pattern.
- `memory/PLANNER_PRODUCT_BRIEF.md` §3.1.10, §3.3.8, §5.1 §4, §5.3 Gate 5.
- `src/app/api/webhooks/suitefleet/[tenantId]/route.ts` — receiver entry point.
- `src/modules/integration/providers/suitefleet/webhook-parser.ts` — Layer-1.5 patch site.
- `src/modules/integration/providers/suitefleet/status-mapper.ts` — Layer-2 status-resolution input.
- `src/modules/audit/event-types.ts` — Layer-2/3 audit registrations.
- `supabase/migrations/0006_task.sql` — `tasks` baseline.
- `supabase/migrations/0014_addresses_and_subscription_address_rotations.sql` — `tasks.address_id`.
- `supabase/migrations/0018_webhook_events.sql` — `webhook_events` schema (no code reader yet).
- `supabase/migrations/0019_tasks_internal_status_skipped.sql` — current 8-value status enum.
