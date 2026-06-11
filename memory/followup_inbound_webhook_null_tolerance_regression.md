# Inbound SF webhook edit-apply: `.optional()` admits `undefined`, NOT `null` (Day-29 null-tolerance regression)

**Filed:** Day-29 (17 May 2026), post-§3.6 of code-PR for plan #303. **Status:** Ground-truth reference. Cite this whenever modifying any Zod schema that parses an SF inbound webhook payload (any schema in `src/modules/integration/providers/suitefleet/*.ts` whose input is real SF wire data).

**Discovery anchor:** Day-29 AM forensic, anchored by the cancel-twin pair `webhook_events.id IN ('a402bae8-1082-42b3-adf1-b55b267f84e5', '197b1af0-a1b4-4477-9d16-c4a0771b8736')` and 10 historical pre-`cc811d8` `TASK_HAS_BEEN_UPDATED` rows pulled by Love from production `webhook_events` table.

---

## Headline

The post-#298 `webhookEditPayloadSchema` in [`src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts`](../src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts) declared 8 of the 9 `deliveryInformation` leaves as `.optional()` only. **SuiteFleet emits the `deliveryInformation` block PRESENT-and-all-null for any not-yet-delivered task** — a property of the SF wire format, NOT a cancel-only quirk. Zod's `.optional()` admits `T | undefined`; an explicit JSON `null` is a PRESENT value at the wire level, not `undefined`, so each null leaf raises `invalid_type` (expected=string/number, received=null). 8 null leaves → `zod_issue_count=8`, the entire parse fails, `outcome.applied=false, reason='payload_validation_failed'`, no task UPDATE issued, edit silently lost. The receiver still returns 200 (per-event isolation), so SF does not retry.

**The asymmetry IS the proof.** `failureReasonComment` in the same schema was always declared `.nullable().optional()` and correctly accepted SF's null. The other 8 leaves were `.optional()` only. After the fix, all 9 leaves are `.nullable().optional()` and the extractor coerces null → undefined per the same idiom — uniform handling, no new pattern.

---

## The 12-payload corpus (Day-29 forensic)

| Source | Rows | Action | Pulled from |
|---|---|---|---|
| Cancel-twins (post-`cc811d8`) | 2 | `TASK_HAS_BEEN_UPDATED` | `webhook_events.id IN ('a402bae8…', '197b1af0…')` |
| Historical pre-`cc811d8` real edits | 10 | `TASK_HAS_BEEN_UPDATED` | `webhook_events WHERE action = 'TASK_HAS_BEEN_UPDATED' AND received_at < '2026-05-16 14:24:27+04' ORDER BY received_at DESC LIMIT 10` |

**All 12 are structurally identical at the `deliveryInformation` block:**

```json
"deliveryInformation": {
  "recipientName": null,
  "signature": null,
  "consigneeRating": null,
  "consigneeComment": null,
  "driverComment": null,
  "numberOfAttempts": null,
  "failureReasonComment": null,
  "completionLatitude": null,
  "completionLongitude": null
}
```

**Fields verified clean in all 12 payloads (do NOT touch):**

- `deliveryDate` — every payload is `YYYY-MM-DD` (`ISO_DATE_REGEX` matches).
- `deliveryStartTime` / `deliveryEndTime` — every payload is `HH:MM:SS` 24h (`HMS_TIME_REGEX` matches).
- `consignee.location` — present on every payload; `.passthrough()` schema correctly captures full SF object.

---

## Mechanism

### Step-by-step (cancel-twin and real-edit replay identically)

1. SF emits `TASK_HAS_BEEN_UPDATED` with the present-and-all-null `deliveryInformation` block above + a `deliveryDate` (cancel-twins carry no new date; real edits carry the new date).
2. Receiver verifies, dispatches to `applyWebhookEditEvent`.
3. Inside the tx: `webhook_events` INSERT runs first (forensic preservation succeeds — this is why the rows are in the corpus at all).
4. `webhookEditPayloadSchema.safeParse(rawPayload)` is called.
5. **Pre-fix:** Zod walks `deliveryInformation`'s 8 non-`failureReasonComment` leaves; each null leaf fails the `z.string()` / `z.number()` check; 8 issues collected; `safeParse.success = false`.
6. Structured return: `{ applied: false, reason: 'payload_validation_failed' }`; log line `error_code: payload_validation_failed, zod_issue_count: 8`.
7. No task UPDATE issued; no `task.edit_applied_via_webhook` audit row.
8. Receiver returns 200 (per-event isolation in `processWebhookAsync`); SF does not retry.

### The asymmetry

Line 65 pre-fix (and post-fix, unchanged):

```ts
failureReasonComment: z.string().nullable().optional(),
```

This is the ONE leaf that was already null-tolerant. SF's `null` passes through cleanly, becomes `null` at the parsed shape, gets coerced `?? undefined` in `extractEditFields` (existing line 344), and `diffField` short-circuits on `undefined` — column is not written, no diff is recorded. Perfect.

The other 8 leaves were declared `.optional()` only. Same SF `null` raised `invalid_type`. **The fix is to extend the existing `failureReasonComment` pattern to its 8 siblings** — schema add `.nullable()`, extractor add `?? undefined`. Mechanical, no new design.

---

## Fix delivered (plan #303 → code-PR)

**File touched (source, 16 LOC):** [`src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts`](../src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts).

- **Lines 59–67 (8 schema leaves):** `.optional()` → `.nullable().optional()`. Line 65 (`failureReasonComment`) was already correct; unchanged.
- **Lines 336–346 (8 extractor leaves):** `di?.<field>` → `di?.<field> ?? undefined`. Line 344 (`failureReasonComment`) was already correct; unchanged.
- Comment refresh above the `return` block: scopes the null-coercion rationale to all 9 leaves uniformly (the prior comment only mentioned `failureReasonComment`).

**File touched (test, 2 new it-blocks):** [`tests/integration/webhook-edit-event-applied.spec.ts`](../tests/integration/webhook-edit-event-applied.spec.ts).

- `D29-NULL`: pinned regression fixture (VERBATIM SF wire shape from AWB DMB-17621675 / 2026-05-19 capture, AWB rebranded to `AWB_NULL_TOL` per the existing test-pattern). 8 assertions: parse PASS, applied=true, `changedFieldCount===1`, `delivery_date` advanced, `updated_at` advanced, 8 null-leaf columns UNTOUCHED, audit row with single `delivery_date` `changed_fields` entry, `webhook_events` row preserved.
- `D29-NULL-DUP`: negative-replay against the dedup gate (`reason='duplicate'` on second call with same `awb`+`occurredAt`). Confirms the null-leniency widening did NOT route around the UNIQUE constraint.

**Surfaces explicitly UNCHANGED** (per plan #303 §4, restated here as the ground-truth non-touch list for future maintainers):

| Surface | Why unchanged |
|---|---|
| `ISO_DATE_REGEX` / `HMS_TIME_REGEX` | Date+time formats are clean in all 12 payloads — not the problem. |
| Root + `deliveryInformation` strip-posture (default Zod object behavior) | Plan #294 §6.1 U2: lenient on unknown SF fields; correctly shipped at #298. |
| `consigneeLocationSchema.passthrough()` | Audit-metadata richness; correctly shipped at #298. |
| `#298 C3` `changedFields` four-responsibility decouple | Independent fix layer; verified correct via existing Day-28 I1/I2 tests. |
| `webhook_events` UNIQUE on `(suitefleet_task_id, action, event_timestamp)` | Brief says it includes `tenant_id`; actual SQL does NOT (Day-29 Phase-1 forensic flag). Separate post-demo item, not load-bearing for this regression. |
| Audit-event vocabulary (count stays at 9, brief §3.1.2 unchanged) | No new event type; no audit-count change; no brief v1.16. |
| Outbound SF push path (Session B's §D(2) lane on #302) | Different file (`task-client.ts`); zero overlap. |

---

## Ground-truth contract for FUTURE inbound-webhook Zod schema changes

When adding or modifying a Zod field that maps to an SF wire-data leaf:

1. **Default `.nullable().optional()` for ALL leaf fields**, not just `.optional()`. SF treats absence and null as semantically equivalent at the wire level; the parser must too. The asymmetric `failureReasonComment` was the only correct leaf in #298's schema for a reason — extend that pattern; do not introduce new `.optional()`-only declarations.
2. **In the extractor, coerce `?? undefined`** for any nullable leaf that flows into a `diffField`/`diffNumeric` site. The downstream contract is "undefined = field absent → leave column alone." A literal `null` arriving at `diffField` would push a `{ previous: <current>, new: null }` entry and nullify the Planner column — almost always wrong.
3. **Strip-posture at the object level stays** — `.passthrough()` only where forensic audit-metadata richness requires it (currently just `consignee.location`).
4. **Date and time formats stay strict** — `ISO_DATE_REGEX` and `HMS_TIME_REGEX` correctly reject non-canonical forms. SF wires these cleanly.
5. **Add a regression fixture for every new schema field** — present-and-all-null variant if the field is a `deliveryInformation` sibling, present-and-typed variant if the field is a top-level. The Day-28 suite missed this regression because no fixture exercised the present-and-all-null shape. A fixture that omits the block is NOT a substitute.
6. **Verify against the 12-payload corpus** (or refresh the corpus from production `webhook_events` before changing the schema) — empirical wire shape is the only ground truth; do not trust SF docs alone.

---

## Cross-references

- Plan PR: [#303](https://github.com/lovemansgit/planner/pull/303) — `memory/plans/day-29-inbound-webhook-null-tolerance-fix.md`.
- Predecessor lane: [#294](https://github.com/lovemansgit/planner/pull/294) plan / [#298](https://github.com/lovemansgit/planner/pull/298) code — Day-28 two-bug compound fix (`extractEditFields` snake/camel + `changedFields` four-responsibility decouple). Mechanism documented at [`memory/followup_inbound_webhook_edit_apply_two_bugs.md`](followup_inbound_webhook_edit_apply_two_bugs.md). #298's schema is the surface this Day-29 lane corrects; #298 itself is otherwise correct.
- Webhook receiver: [`src/app/api/webhooks/suitefleet/[tenantId]/route.ts`](../src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts) — per-event isolation guarantees the receiver still 200s on parser-failed events (no SF retry), which is why this regression was invisible without forensic log inspection.
- Cancel path: [`src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts`](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) — `TASK_STATUS_UPDATED_TO_CANCELED` correctly applied during Love's Day-29 manual cancel test; the cancel path is unaffected by this regression. Session B's §D(2) lane (#302) is the active surface there; do not collide.
- `webhook_events` schema: [`supabase/migrations/0018_webhook_events.sql`](../supabase/migrations/0018_webhook_events.sql) — UNIQUE on `(suitefleet_task_id, action, event_timestamp)` (no `tenant_id`); brief §3.1.10 says includes `tenant_id`. Flagged Day-29 Phase-1 §2; separate post-demo item.
