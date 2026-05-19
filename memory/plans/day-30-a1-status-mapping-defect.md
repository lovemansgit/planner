# Day-30 plan-PR — A1 status-mapping defect (BRD §4.1)

**Filed:** 2026-05-18 (Day-30). **Lane tier:** T3 (full SF→Planner status contract requires reviewer ruling; multiple silently-disagreeing vocabularies + same-write-as-POD coupling carry design surface, not mechanical). **Plan-PR scope:** docs only (this file). **Eventual code-PR scope:** scoped in §5.

**Status:** AWAITING §3.6 reviewer review on this plan-PR. T3 hard-stop #1 is this plan-PR's §3.6. T3 hard-stop #2 is the code-PR's §3.6.

---

## §1 — Lane entry conditions + locked constraints

**Lane entry.** Love (product owner) ruled A1 IN per BRD §4.1 committed scope after Aqib UAT (Slides 7, 8-reflect, 10) confirmed: SF status webhook events (Picked Up, Cancelled, Delivered, In Transit, Failed, …) are captured by the inbound receiver but ALL render as generic "Updated" in the consignee-detail timeline drawer; DELIVERED does not surface POD. Aqib Q1 confirmed events ARE arriving (`webhook_events` table is populated post-#298/§D(1)/§D(2)), so this is NOT a delivery-pipeline gap (which was resolved earlier by `followup_webhook_handler_status_pod_date_sync_bug.md` Layer-1 fix).

**Working state.**

- Origin/main HEAD `b86466a` at lane open (production-live alias `planner-olive-sigma.vercel.app` on `dpl_9QHFqS36fVs9A11jw1UZzMGRfdJm` from post-#304 promote).
- Brief: PLANNER_PRODUCT_BRIEF.md current (no version increment forced by this lane — TBD §9 OQ-7).
- This lane does NOT (proposed) require any schema migration, env change, or Vercel re-promote beyond the code-PR's standard build+deploy.

**Locked constraints (restated for §3.6; do not deviate):**

1. **Static-code-only investigation; production webhook_events sample is the deciding diagnostic for root-cause confirmation.** The code path described in §2 below is what the source reads at SHA `b86466a`. The "WHY everything renders Updated" claim cannot be resolved from static reading alone (see §2.4 honesty-disclosure); the plan therefore proposes a small Phase-0 evidence step before the fix code-PR.

2. **Fix-forward only.** No retroactive backfill of webhook_events.action codes already in production; no migration of historical rows. If the mapping contract changes (§3 below), it applies prospectively. Affected historical rows are ops-visible via the timeline drawer's existing raw-code fallback path.

3. **No scope widening.** B1 (address-edit display) and B2 (merchant-cancel display) are explicitly OUT (see §5). Anything outside §3's mapping table surface is surfaced as an OQ, not folded.

4. **§3.6 review gates merge.** Plan-PR §3.6 (this PR) is T3 hard-stop #1. Code-PR §3.6 is T3 hard-stop #2. Integration spec runtime confirmation is T3 hard-stop #3.

5. **No self-tier-escalation.** OQs (§6) ruled by reviewer.

---

## §2 — Root cause, evidenced (trace + hypothesis)

### §2.1 — Inbound webhook receipt → status read → mapping → UPDATE → render: full hop chain

All citations against `git show origin/main:<path>` at SHA `b86466a`.

| Hop | File:Line | Behavior |
|---|---|---|
| 1. Receive | [src/app/api/webhooks/suitefleet/[tenantId]/route.ts:114](src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts#L114) | `await req.text()` → JSON-parse → SF-array shape validation via `parseWebhookEvents`. |
| 2. Parse | [src/modules/integration/providers/suitefleet/webhook-parser.ts:99-149](src/modules/integration/providers/suitefleet/webhook-parser.ts#L99-L149) | `extractAction(entry)` reads `raw.action` (the SF wire field, a literal string). `extractTaskId(entry)` reads `raw.awb`. `classifySuiteFleetAction(action)` maps to `WebhookEventKind` via `KNOWN_ACTIONS` table (15 entries). |
| 3. Dispatch | [src/app/api/webhooks/suitefleet/[tenantId]/route.ts:248](src/app/api/webhooks/suitefleet/%5BtenantId%5D/route.ts#L248) | **Literal-string dispatch**: `rawAction === "TASK_HAS_BEEN_UPDATED"` → `applyWebhookEditEvent`; everything else → `applyWebhookStatusEvent`. **Note:** dispatch is on the raw string, NOT on the parser's `WebhookEventKind`. |
| 4a. Status apply | [src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:80](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L80) | `mapSuiteFleetStatusToInternal(sfAction)` via `ACTION_TO_INTERNAL_STATUS` table (14 entries + 1 explicit non-lifecycle + unknowns return `null`). |
| 4b. Status apply (null result) | [apply-webhook-status-event.ts:81-83](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L81-L83) | `return { applied: false, reason: "non_lifecycle_or_unknown" }`. **CRITICAL:** this early return is BEFORE the `withTenant` block → **no webhook_events row inserted, no internal_status update, no audit emit**. Silent drop. |
| 5. webhook_events INSERT (status path, mapped only) | [apply-webhook-status-event.ts:104-114](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L104-L114) | INSERT with `action = ${sfAction}` (the raw SF string). |
| 6. tasks UPDATE | [apply-webhook-status-event.ts:154-169](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L154-L169) | `internal_status = ${newStatus}` + `pod_photos` extracted on DELIVERED. |
| 7a. Edit apply path | [apply-webhook-edit-event.ts:113](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts#L113) (post-#304 SHA, schema at line 58-68) | INSERT webhook_events with `action='TASK_HAS_BEEN_UPDATED'` ALWAYS (every event routed here gets this literal); then diff per-column extraction. Never touches `internal_status`. |
| 8. Render — timeline drawer | [src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx:39-56](src/app/(app)/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx#L39-L56) | `ACTION_LABELS` (16 entries) maps `webhook_events.action` → human label. Unknown action codes fall back to **raw action string**, not "Updated". |
| 9. Render — calendar day cell | [src/app/(app)/consignees/[id]/_components/DayDisplayStatus.ts:63-82](src/app/(app)/consignees/%5Bid%5D/_components/DayDisplayStatus.ts#L63-L82) | Reads `task.internalStatus`, projects to `DayDisplayStatus` (6 visual states); labels via `DAY_DISPLAY_VISUALS`. |
| 10. Render — /tasks list | [src/app/(app)/tasks/status.ts:23-29](src/app/(app)/tasks/status.ts#L23-L29) | `TASK_STATUS_FILTERS` maps `tasks.internalStatus` (7 enum values) → label pills. |
| 11. Render — getTaskTimeline source | [src/modules/tasks/service.ts:1532-1543](src/modules/tasks/service.ts#L1532-L1543) | `SELECT action, event_timestamp FROM webhook_events WHERE suitefleet_task_id = ${AWB}` — drawer source. |

### §2.2 — Three independent action-code vocabularies (the schema-drift surface)

There are THREE separately-maintained maps of SF action codes; each is a hard-coded table; they disagree on key names:

**(A) Parser KNOWN_ACTIONS** ([webhook-parser.ts](src/modules/integration/providers/suitefleet/webhook-parser.ts), 15 entries) — drives `WebhookEventKind` classification only; classification result is informational (the dispatch in hop 3 uses the raw string, not the kind).

**(B) Status-mapper ACTION_TO_INTERNAL_STATUS** ([status-mapper.ts:59-90](src/modules/integration/providers/suitefleet/status-mapper.ts#L59-L90), 14 entries) — drives the `internal_status` update. **`null` return path silently drops the entire event (no webhook_events row, no internal_status write, no audit).**

**(C) Drawer ACTION_LABELS** ([TaskTimelineDrawer.tsx:39-56](src/app/(app)/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx#L39-L56), 16 entries) — drives the human-readable label rendering.

**Key vocabulary delta surfaced by code read:** the drawer's `ACTION_LABELS` includes `TASK_STATUS_UPDATED_TO_ASSIGNED: "Assigned to driver"` ([line 43](src/app/(app)/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx#L43)), but parser KNOWN_ACTIONS + status-mapper ACTION_TO_INTERNAL_STATUS both use `TASK_HAS_BEEN_ASSIGNED` (not `TASK_STATUS_UPDATED_TO_ASSIGNED`). **One side is wrong about SF wire vocabulary; static code alone can't say which.** If SF wire emits `TASK_STATUS_UPDATED_TO_ASSIGNED`, status-mapper returns `null` → entire event silently dropped (no row in webhook_events, no `internal_status='ASSIGNED'` write, drawer never sees it). If SF wire emits `TASK_HAS_BEEN_ASSIGNED`, drawer falls back to raw code string instead of "Assigned to driver".

### §2.3 — Refutation of single-mapping-layer hypothesis

The reviewer's brief framing — "single status-translation/display layer incomplete or unwired" — is **NOT confirmed** by static code read at `b86466a`. The mapping IS present in 3 separate, independently-maintained vocabularies (§2.2). None is empty or trivially broken. Each has reasonable internal coverage for its own SF action set. The bug is at the **boundary** between the SF wire and our vocabularies (specifically: a wire-vs-code-vocabulary drift, plus a likely silent-drop pattern in the status-apply layer for codes the mapper doesn't recognize), AND in the cross-layer non-agreement (§2.2 ASSIGNED example).

### §2.4 — Honest disclosure: WHY everything renders "Updated" is NOT fully provable from static code alone

> [SUPERSEDED Day-31 — see Phase-0 results section below; lead hypothesis falsified by production evidence.]

The strongest hypothesis grounded in code evidence (and which exactly matches Aqib's "ALL render as generic Updated" observation):

**SF wire emits `TASK_HAS_BEEN_UPDATED` for most/all lifecycle changes in production.** Routed to `applyWebhookEditEvent` (per hop-3 literal-string dispatch) → webhook_events row inserted with `action='TASK_HAS_BEEN_UPDATED'` (always) → drawer renders "Updated" (per ACTION_LABELS[TASK_HAS_BEEN_UPDATED] = "Updated"). `tasks.internal_status` is never advanced by the edit path. `tasks.pod_photos` is never extracted by the edit path. The status-specific codes (TASK_STATUS_UPDATED_TO_*) either don't fire on this SF tenant config or fire with codes our mapper doesn't recognize (silent drop). **The Day-29 cancel-twin precedent shows SF emits BOTH a TASK_STATUS_UPDATED_TO_CANCELED event AND a TASK_HAS_BEEN_UPDATED twin for the same operator action; the cancel-twin survived to produce a CANCELED internal_status update, but the routing of every TASK_HAS_BEEN_UPDATED twin to the edit path inflates the "Updated" timeline rows.**

This hypothesis is **consistent with** all evidence read:
- Aqib's observation that "Picked Up, Cancelled, Delivered, In Transit, Failed" all render as Updated.
- The §D(1) Day-29 inbound apply work (which confirmed the receiver+parser ARE seeing events).
- The cancel-twin pattern (TASK_STATUS_UPDATED_TO_CANCELED + TASK_HAS_BEEN_UPDATED, both for one action).
- The vocabulary drift in §2.2.

**But the hypothesis cannot be proven from static code.** A production webhook_events sample (Phase 0 evidence step in §3 below) is the deciding diagnostic — a 1-row-per-action GROUP BY of the last 24-72h of production webhook_events.action will surface: (a) what action codes are actually arriving, (b) what proportion are TASK_HAS_BEEN_UPDATED vs. status-specific codes, (c) which lifecycle codes (if any) are silently dropping at the status-mapper.

**Plan posture:** Phase 0 (evidence) runs FIRST, BEFORE the fix code-PR. Code-PR scope is defined contingent on Phase-0 evidence rulings (see §6 OQ-1).

---

## §2.5 — Inbound timezone symmetry (BINDING ADDITION from §3.6 review of plan #306 v1)

**Context:** A3 / PR #307 (`382d79b`, "outbound TZ — shift Dubai-local TIME → UTC, deliveryDate stays Dubai-local") shipped the outbound half of a TZ contract: SF wire times are UTC, Planner storage is Dubai-local-TZ-naive (`postgres time` column, no zone). The #307 commit message explicitly routes the symmetric inbound concern here: "The symmetric inbound TZ bug in `apply-webhook-edit-event.ts` (SF sends UTC; Planner writes verbatim into Dubai-local TIME column → also drifts) is confirmed and routed to the A1 lane (Session A). Not touched here." The §3.6 reviewer of plan #306 v1 made resolution of this symmetry a BINDING addition before code-PR opens.

### §2.5.1 — Trace at b86466a — which inbound apply paths write SF-supplied time fields?

| File | Writes `tasks.delivery_start_time` / `delivery_end_time` from SF wire? | UTC→Dubai-local conversion present? |
|---|---|---|
| [`apply-webhook-status-event.ts`](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) | **NO.** Only writes `tasks.internal_status` + `tasks.pod_photos` ([lines 154-169](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L154-L169)). Zero time-field references in the file. | N/A — not applicable. |
| [`apply-webhook-edit-event.ts`](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts) | **YES.** Three sites at b86466a (post-#304 file shape). | **NO** — confirmed absent. See §2.5.2. |

**The three inbound time-write sites in `apply-webhook-edit-event.ts` at b86466a:**

1. **Schema accept** (lines 72-73):
   ```ts
   deliveryStartTime: z.string().regex(HMS_TIME_REGEX).optional(),
   deliveryEndTime: z.string().regex(HMS_TIME_REGEX).optional(),
   ```
   `HMS_TIME_REGEX` = `/^\d{2}:\d{2}:\d{2}$/` (line 50). Validates the literal HH:MM:SS shape; performs ZERO conversion of any kind.

2. **Extractor** (lines 339-340):
   ```ts
   delivery_start_time: parsed.deliveryStartTime,
   delivery_end_time: parsed.deliveryEndTime,
   ```
   Verbatim passthrough of the Zod-parsed string into the `ExtractedFields` shape (interface at [lines 310-323](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts#L310-L323)).

3. **UPDATE write** (`buildSetFragment`, lines 497-500):
   ```ts
   case "delivery_start_time":
     return sqlTag`delivery_start_time = ${value}::time`;
   case "delivery_end_time":
     return sqlTag`delivery_end_time = ${value}::time`;
   ```
   Casts the string to PostgreSQL `time` (TZ-naive type). No `AT TIME ZONE` clause, no helper call — the wire string lands directly in the column.

The diff site at [lines 363-364](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts#L363-L364) compares the extracted value against the current row value via `diffField`'s string `===` equality, which only suppresses a write when the two strings already match — irrelevant to the TZ-conversion concern.

### §2.5.2 — Conversion-helper search (b86466a, repo-wide)

Searched the repo at b86466a for any `utcTimeToDubaiLocal` / `utcToDubai` / inverse-of-`dubaiLocalTimeToUtc` helper. **Result: none exists.** A3 introduced only the outbound direction:

- `dubaiLocalTimeToUtc` — defined at `src/modules/integration/providers/suitefleet/task-client.ts` (introduced in #307 at SHA `382d79b`); subtracts `DUBAI_UTC_OFFSET_HOURS = 4` with `(localHour - 4 + 24) % 24` wrap.
- No `utcTimeToDubaiLocal` / `+4h` inverse exists anywhere in `src/modules/integration/`, `src/shared/`, or any inbound-apply module.

**Confirmed:** the inbound apply path lacks the UTC→Dubai-local conversion that the symmetric TZ contract requires.

### §2.5.3 — Verdict — symmetric bug CONFIRMED LATENT in code; activation depends on Phase-0

**Bug is latent in code:** `apply-webhook-edit-event.ts` writes whatever string SF sends as `deliveryStartTime` / `deliveryEndTime` directly into the Dubai-local TZ-naive `time` columns. If SF wire is UTC (per A3's Love-confirmed SF contract — same contract on both directions, deliveryDate stays Dubai-local, time fields are UTC), then a wire value of `"06:00:00"` (Dubai 10:00) writes as `06:00:00` into the Dubai-local column → operator-facing display shows `06:00`, not `10:00`. Net: −4h drift on every inbound time reflection — the exact mirror of the pre-A3 outbound bug Aqib's UAT surfaced on 2026-05-18.

**Activation depends on Phase-0 evidence (Q-C):** the bug fires IFF SF actually emits the time fields on inbound webhooks. Q-C is added to the §6 OQ-1 Phase-0 SQL below.

### §2.5.4 — Fix scope — IN THIS LANE (per §3.6 reviewer ruling)

- **Add `utcTimeToDubaiLocal(time: string): string`** helper — inverse of A3's `dubaiLocalTimeToUtc`: `(utcHour + 4) % 24` wrap, same `HMS_TIME_REGEX` validation, same `ValidationError` posture on malformed input. Single helper, ~20 LOC mirroring A3's helper.
- **Call site** — inside `extractEditFields` ([apply-webhook-edit-event.ts:325-348](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts#L325-L348)) — convert `parsed.deliveryStartTime` and `parsed.deliveryEndTime` via the new helper BEFORE returning into `ExtractedFields`. This is the same boundary location A3 picked for the outbound side (helper at the wire-boundary deserializer); keeps the rest of the apply path TZ-unaware.
- **deliveryDate UNCHANGED** — per A3 ruling, `deliveryDate` stays Dubai-local cross-system. Inbound `deliveryDate` passthrough at [line 338](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts#L338) (`delivery_date: parsed.deliveryDate`) is correct.
- **Cross-midnight wrap inversion handling** — same concern as A3 outbound (post-conversion `end < start` is possible, e.g., SF wire 18:00-22:00 UTC → Dubai 22:00-02:00 → numerically inverted). A3 throws `ValidationError`. Inbound mirror options:
  - **(i)** Throw `ValidationError` → routes to `payload_validation_failed` outcome (existing inbound vocabulary); webhook_events row preserved as forensic; no UPDATE; ops-visible. Consistent with A3's stance.
  - **(ii)** Accept wrap as semantic "window spans midnight"; store both times as-converted; UI layer disambiguates. More complex; defers the wrap-semantic decision.

**Builder's recommendation:** **(i) — throw `ValidationError`** — symmetric with A3's outbound stance, reuses the existing `payload_validation_failed` outcome (no new vocabulary), webhook_events row preserves the offending payload for ops triage. Reviewer rules in OQ-10.

### §2.5.5 — Integration spec additions (extends §7.1 set)

- **I6 (mandatory iff Phase-0 Q-C shows ≥1 inbound time-field arrival):** real SF-shaped TASK_HAS_BEEN_UPDATED payload with `deliveryInformation.deliveryStartTime: "06:00:00"` (the UTC value matching Aqib's Dubai 10:00 case from the A3 UAT). Assert `tasks.delivery_start_time = '10:00:00'` post-apply (NOT `06:00:00`); `updated_at` advanced; audit metadata `changed_fields` shows the column moved.
- **I7 (symmetric to A3 (c)):** SF wire 18:00:00–22:00:00 UTC → post-conversion 22:00:00–02:00:00 Dubai → `ValidationError` per OQ-10 (i) ruling; webhook_events row preserved; no UPDATE; no audit emit on this task.
- **I8 (no-op when SF doesn't send time fields):** TASK_HAS_BEEN_UPDATED with `deliveryInformation` absent of `deliveryStartTime` / `deliveryEndTime` → extractor returns `undefined` for both → diffField short-circuits → no UPDATE on those columns, no conversion called.

(Numbering note: I6/I7/I8 are appended to §7.1's existing I1-I5; no renumbering of the earlier specs.)

### §2.5.6 — If Phase-0 Q-C shows SF NEVER sends time fields on inbound — symmetry closes (conditional)

If Q-C returns zero rows where `raw_payload->'deliveryInformation'->>'deliveryStartTime' IS NOT NULL` OR `raw_payload->'deliveryInformation'->>'deliveryEndTime' IS NOT NULL`, then **SF does not send inbound time fields and the symmetric bug is not-applicable in production**. The helper is still recommended as defense-in-depth (so future SF behavior change doesn't silently activate the drift), but I6+I7 become unit-test-only coverage rather than load-bearing integration regression. Reviewer rules in OQ-10 whether to ship the helper in either evidence outcome (recommended) or skip if SF demonstrably never emits times.

---

## §3 — The mapping contract (full SF-status → Planner-status table)

This is the reviewed contract. ALL SF webhook status event types currently coded in the project, with target Planner internal_status, target drawer label, and DELIVERED-→POD coupling row. Reviewer rules deltas in §6 OQ-2.

### §3.1 — The 15 SF action codes currently coded (parser KNOWN_ACTIONS)

| # | SF wire action code | Status-mapper → internal_status | Drawer ACTION_LABEL (current) | POD attached? | Notes |
|---|---|---|---|---|---|
| 1 | `TASK_HAS_BEEN_ORDERED` | `CREATED` | "Ordered" | — | initial creation event |
| 2 | `TASK_HAS_BEEN_ASSIGNED` | `ASSIGNED` | **MISSING (drawer has `TASK_STATUS_UPDATED_TO_ASSIGNED` instead)** | — | **§2.2 vocabulary drift** |
| 3 | `TASK_HAS_BEEN_UPDATED` | `null` (non-lifecycle) → routed to edit path | "Updated" | — | the suspected silent-mass-router per §2.4 |
| 4 | `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC` | `IN_TRANSIT` | "Arrived at DC" | — | |
| 5 | `TASK_STATUS_UPDATED_TO_PICKED_UP` | `IN_TRANSIT` | "Picked up" | — | |
| 6 | `TASK_STATUS_UPDATED_TO_IN_TRANSIT` | `IN_TRANSIT` | "In transit" | — | |
| 7 | `TASK_STATUS_UPDATED_TO_HUB_TRANSFER` | `IN_TRANSIT` | "Hub transfer" | — | |
| 8 | `TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY` | `IN_TRANSIT` | "Out for delivery" | — | |
| 9 | `TASK_STATUS_UPDATED_TO_DELIVERED` | `DELIVERED` | "Delivered" | **YES** — `extractPodPhotos(raw.deliveryInformation.photos)` writes `tasks.pod_photos` in same UPDATE | brief §3.3.8 commitment |
| 10 | `TASK_STATUS_UPDATED_TO_FAILED` | `FAILED` | "Failed" | — | |
| 11 | `TASK_STATUS_UPDATED_TO_REATTEMPT` | `ON_HOLD` | "Reattempt scheduled" | — | |
| 12 | `TASK_STATUS_UPDATED_TO_RESCHEDULED` | `ON_HOLD` | "Rescheduled" | — | |
| 13 | `TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN` | `FAILED` | "Processing for return" | — | flagged in [followup_internal_task_status_lossiness.md](memory/followup_internal_task_status_lossiness.md) (collapses with hard-FAILED) |
| 14 | `TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER` | `FAILED` | "Returned to shipper" | — | flagged as above |
| 15 | `TASK_STATUS_UPDATED_TO_CANCELED` | `CANCELED` | "Cancelled" | — | inbound cancel ack (covers operator-initiated SF-side cancel AND the post-#305 outbound cancel-twin) |
| 16 | `TASK_CREATED` (synthetic) | — (drawer only, not a real SF event) | "Created" | — | drawer-only synthetic from `tasks.created_at` |

### §3.2 — Reviewer-flagged gaps requiring §3.6 ruling

The static read of `b86466a` surfaces three deltas the reviewer must rule on. These are the genuine design surfaces; each is enumerated as an OQ in §6.

1. **ASSIGNED vocabulary mismatch (§2.2):** which SF wire code is canonical — `TASK_HAS_BEEN_ASSIGNED` (parser + mapper assumption) or `TASK_STATUS_UPDATED_TO_ASSIGNED` (drawer assumption)? Phase-0 evidence resolves; reviewer rules canonical → all three layers reconciled in code-PR.
2. **TASK_HAS_BEEN_UPDATED routing semantics:** today, every TASK_HAS_BEEN_UPDATED event routes to the edit path (apply-webhook-edit-event) and ONLY surfaces as "Updated" in the drawer. If SF emits status-changes-as-edits in production (§2.4 hypothesis), the drawer should either (a) suppress the "Updated" entry when a sibling TASK_STATUS_UPDATED_TO_* event arrived for the same task within a small time window (de-dup against twin), OR (b) extract a more specific label from the edit-event's `deliveryInformation.status` field (if SF includes it in the edit payload). Reviewer rules de-dup vs. enrichment.
3. **Silent-drop on status-apply (apply-webhook-status-event.ts:81-83):** the `non_lifecycle_or_unknown` early-return predates the webhook_events INSERT, so unknown SF action codes leave NO forensic trace in webhook_events. For a vocabulary-drift bug like this one, ops cannot retrospectively see "what codes did SF emit that we silently dropped?" without inspecting raw Vercel logs (which are time-bounded). Reviewer rules whether the INSERT should move BEFORE the mapper-null check (preserves forensic trail at the cost of a possibly-pointless row for genuinely-unknown events).

### §3.3 — Reviewer-flagged: SF status with no clean Planner equivalent

The reviewer asked to "flag any SF status with no clean Planner equivalent for a reviewer ruling." From the 14 coded actions:

- **PROCESS_FOR_RETURN + RETURNED_TO_SHIPPER → FAILED:** lossy collapse with first-attempt FAILED, per pre-existing followup. Status-mapper comment explicitly flags this as a known accuracy trade-off. **Not a new lane decision** — left to the existing [followup_internal_task_status_lossiness.md](memory/followup_internal_task_status_lossiness.md) post-MVP item.
- **REATTEMPT + RESCHEDULED → ON_HOLD:** semantically clean collapse (both = paused awaiting next attempt). No reviewer decision needed.
- **5×IN_TRANSIT collapse (ARRIVED_ON_DC / PICKED_UP / IN_TRANSIT / HUB_TRANSFER / OUT_FOR_DELIVERY):** intentional 5→1 collapse per status-mapper.ts header §22-25 comment. The DRAWER preserves the 5-way granularity (each has its own label) so the timeline shows full transition richness even though `tasks.internal_status` collapses. **Not a new decision.**

**No new "no clean equivalent" surfaces from this lane.** OQ-3 confirms.

---

## §4 — POD surfacing — same-lane vs split (analysis only; reviewer rules)

### §4.1 — Code reality with file:line

POD extraction is in the SAME function as the status write, in the SAME UPDATE statement:

- [apply-webhook-status-event.ts:91](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L91): `const podPhotos = newStatus === "DELIVERED" ? extractPodPhotos(rawPayload) : null;` — POD is conditionally extracted in the same function scope as the status mapping.
- [apply-webhook-status-event.ts:154-169](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L154-L169): branching UPDATE — DELIVERED branch sets `internal_status` AND `pod_photos` in one SQL statement; non-DELIVERED branch sets `internal_status` only. Atomicity per plan §4.6 Option (a).
- [apply-webhook-status-event.ts:218-225](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L218-L225): `extractPodPhotos` reads `raw.deliveryInformation.photos` (array of unknowns; returns `null` on absent/empty/non-array).
- [apply-webhook-status-event.ts:247-262](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L247-L262): separate `task.pod_received_via_webhook` audit event emitted post-tx-commit, IFF `podPhotoCount > 0`.

### §4.2 — Reader-side POD render path

- [src/app/(app)/tasks/_components/pod-state.ts:11-19](src/app/(app)/tasks/_components/pod-state.ts#L11-L19): `podCellState(podPhotos)` projects to `"active" | "muted"`.
- [src/app/(app)/tasks/client.tsx:305](src/app/(app)/tasks/client.tsx#L305): client component reads `task.podPhotos`, calls `podCellState`, renders POD modal trigger.

### §4.3 — Same-lane vs split — recommendation

**Builder's recommended posture: SAME LANE.** Reasons (reviewer rules in OQ-4):

- Brief §3.3.8 explicitly ties POD-from-webhook to the status write ("same UPDATE"). Splitting risks regression of the atomicity contract.
- The DELIVERED → POD coupling is mechanical: POD is only surfaced when SF says DELIVERED. If the status mapping is fixed (DELIVERED now correctly reaches `tasks.internal_status = DELIVERED`), POD surfacing is automatic if and only if `extractPodPhotos` ALSO fires in the same code path. Splitting would introduce a "DELIVERED maps but POD doesn't surface" risk — exactly Aqib's complaint.
- The `task.pod_received_via_webhook` audit event is already separable (post-tx, conditional emit), so split observability for the POD half is preserved.

**Split is reasonable IF and only if** the reviewer rules that the post-#305 webhook collision guard (which protects SKIPPED + DELIVERED from re-write) needs to be re-examined alongside POD specifically. See §4.4 for the interaction.

### §4.4 — Interaction risk with §6.2 #305 collision guard

[apply-webhook-status-event.ts:163-169](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L163-L169) per #305 added a WHERE-clause guard that **does NOT explicitly appear in the current source** — re-check at code-PR open. Per #305 commit message: "internal_status='SKIPPED' is now preserved against the inbound TASK_STATUS_UPDATED_TO_CANCELED ack of our own PATCH. webhook_events row still INSERTs (audit trail intact); only the gated tasks UPDATE no-ops on SKIPPED. Same guard applies to the DELIVERED branch as defence-in-depth against driver-vs-operator race." Builder must read the current file at code-PR open to confirm exactly which guard is present and how the DELIVERED guard interacts with POD writes (does the no-op on already-DELIVERED also no-op the POD write?). **Surfaced as OQ-5.**

---

## §5 — Scope boundary

### §5.1 — IN SCOPE (this lane, code-PR delivers)

- **§3 mapping contract:** the full SF action → Planner internal_status + drawer label + POD-attached table. Reviewer rules deltas; code-PR reconciles parser KNOWN_ACTIONS, status-mapper ACTION_TO_INTERNAL_STATUS, and drawer ACTION_LABELS to all use the same canonical action-code vocabulary.
- **Phase 0 evidence step:** a SQL-only diagnostic run by Love to GROUP BY action on the last 72h of production webhook_events, confirming the §2.4 hypothesis (or refuting it and surfacing what's actually arriving). Plan-PR documents the SQL; Love executes; reviewer rules on the evidence.
- **Drawer ASSIGNED-label vocabulary reconciliation** (§2.2): one canonical key across all three layers, per Phase-0 evidence.
- **POD surfacing on DELIVERED end-to-end** (§4): assert via integration spec that a fresh DELIVERED webhook with `deliveryInformation.photos` produces (a) `tasks.internal_status='DELIVERED'`, (b) `tasks.pod_photos` populated, (c) POD modal renders in /tasks list view (smoke check, not unit test).
- **OQ-2 resolution: TASK_HAS_BEEN_UPDATED twin-routing** — whether to de-dup, suppress in drawer, or enrich.

### §5.2 — OUT OF SCOPE (do not bleed; surfaced for traceability)

- **B1 — Address-edit display lane.** Separate. Touches calendar/popover address rendering. No overlap with status/POD lane.
- **B2 — Merchant-cancel display lane.** Separate. Touches `cancelTask` service-fn UI consumer surface (which today has zero callers per the Day-30 investigation map). Will surface a new operator surface that requires its own status-mapping awareness — but this lane is about INBOUND, B2 is about OUTBOUND.
- **followup_internal_task_status_lossiness.md** (PROCESS_FOR_RETURN / RETURNED_TO_SHIPPER → FAILED collapse): pre-existing post-MVP item; NOT this lane.
- **webhook_events UNIQUE-constraint tenant_id flag** (Day-29 Phase-1 forensic §2): separate post-demo item.
- **Outbound SF push path** (Session B's lane in #305 / #302): zero overlap; status-mapper is read-only consumed there.
- **Schema migration** for any new `tasks` column: NOT expected (POD is already columnar; status-mapper output already columnar). OQ-7 confirms.

---

## §6 — Open questions (number every reviewer decision)

**OQ-1 — Phase 0 evidence is mandatory before code-PR.** **§3.6 RULING: APPROVED (a) — non-negotiable.** SQL reviewer-tightened to THREE queries (Q-A action distribution, Q-B TASK_HAS_BEEN_UPDATED status enrichment — decisive for OQ-2, Q-C inbound time-field presence — decisive for OQ-10 §2.5). Love runs all three against production:

**Q-A — action distribution, all tenants, 7-day window** (wider than 72h because demo-tenant traffic is thin):

```sql
SELECT action, COUNT(*) AS event_count,
       COUNT(DISTINCT suitefleet_task_id) AS distinct_tasks,
       MIN(received_at) AS first_seen, MAX(received_at) AS last_seen
FROM webhook_events
WHERE received_at >= NOW() - INTERVAL '7 days'
GROUP BY action ORDER BY event_count DESC;
```

**Q-B — does SF carry a real status INSIDE TASK_HAS_BEEN_UPDATED payloads?** (LOAD-BEARING for OQ-2):

```sql
SELECT
  raw_payload->>'action' AS action,
  raw_payload->'deliveryInformation'->>'status' AS delivery_info_status,
  COUNT(*) AS cnt
FROM webhook_events
WHERE action = 'TASK_HAS_BEEN_UPDATED'
  AND received_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2 ORDER BY cnt DESC;
```

Q-B is decisive for OQ-2: if `delivery_info_status` is consistently populated with real statuses → OQ-2 ruling will be (b) enrich; if null/absent → OQ-2 ruling will be (a) suppress-twin. **Do NOT pre-build for either** — wait for evidence.

**Q-C — does SF carry deliveryStartTime / deliveryEndTime in inbound webhooks?** (LOAD-BEARING for §2.5 OQ-10 — TZ symmetry):

```sql
SELECT
  action,
  CASE
    WHEN raw_payload->'deliveryInformation'->>'deliveryStartTime' IS NOT NULL
     AND raw_payload->'deliveryInformation'->>'deliveryEndTime'   IS NOT NULL THEN 'both_present'
    WHEN raw_payload->'deliveryInformation'->>'deliveryStartTime' IS NOT NULL THEN 'start_only'
    WHEN raw_payload->'deliveryInformation'->>'deliveryEndTime'   IS NOT NULL THEN 'end_only'
    ELSE 'neither'
  END AS time_field_presence,
  raw_payload->'deliveryInformation'->>'deliveryStartTime' AS sample_start,
  raw_payload->'deliveryInformation'->>'deliveryEndTime'   AS sample_end,
  COUNT(*) AS cnt
FROM webhook_events
WHERE received_at >= NOW() - INTERVAL '7 days'
GROUP BY 1, 2, 3, 4
ORDER BY cnt DESC;
```

Q-C is decisive for OQ-10: if `time_field_presence != 'neither'` for any row, the inbound TZ helper from §2.5.4 lands as load-bearing fix (I6+I7 integration specs); if all rows are `'neither'`, the helper is defense-in-depth only and I6+I7 become unit-test-only (per §2.5.6).

**OQ-2 — TASK_HAS_BEEN_UPDATED twin-routing.** When SF emits a TASK_STATUS_UPDATED_TO_* event AND a TASK_HAS_BEEN_UPDATED twin for the same operator action (Day-29 cancel-twin precedent), the drawer surfaces both — and the "Updated" twin is misleading. Reviewer rules: (a) drawer suppresses "Updated" entries when a sibling status-event exists within a small time window (e.g., ±30s) for the same task, (b) edit-event applier extracts a more specific label from `deliveryInformation.status` if present, (c) leave both visible and rely on operator interpretation, (d) other. Builder's recommendation: (a) — least intrusive, cleanest UX, no schema or applier code change.

**OQ-3 — Forensic trail for silent-drop on unknown actions.** Move webhook_events INSERT BEFORE the `mapSuiteFleetStatusToInternal` null-check ([apply-webhook-status-event.ts:80-83](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L80-L83)), so unknown-vocabulary SF events leave a forensic row. Cost: webhook_events bloat for genuinely-junk-action events (very low frequency expected). Benefit: future vocabulary-drift bugs surface in 1 SQL query against webhook_events instead of requiring Vercel-log diving. Builder's recommendation: yes (small +5 LOC; high observability ROI; ops doesn't have to remember to monitor Vercel logs for a class of events that should be loud but are silent today). Reviewer rules.

**OQ-4 — POD same-lane vs split.** Builder's recommendation: SAME LANE per §4.3. Reviewer rules.

**OQ-5 — #305 collision-guard interaction with DELIVERED+POD.** Builder reads the current `apply-webhook-status-event.ts` at code-PR open and confirms whether the §6.2 guard added in #305 short-circuits POD writes when the row is already in `internal_status='DELIVERED'`. If yes, a DELIVERED twin (SF re-sends webhook on race) would NO-OP the POD write — operator-visible bug latent today. Reviewer rules whether this is in-scope to fix in this lane or a separate followup.

**OQ-6 — Drawer fallback for unknown action codes.** Today: unknown action falls back to the raw SF code string (e.g., `"TASK_STATUS_UPDATED_TO_ASSIGNED"`). Reviewer rules: (a) keep raw-code fallback (operator sees SCREAMING_SNAKE, can ping ops), (b) fallback to a generic "Status update" label, (c) fallback to `"Updated"` (current state for many events through the §2.4 hypothesis). Builder's recommendation: (a) — surfacing raw codes makes vocabulary drift visible, vs. (b)/(c) which mask it.

**OQ-7 — Brief amendment.** Does any §3 mapping contract change force a brief v1.16 entry? Builder's preliminary read: NO — the brief commits to "SF status → internal_status" semantically (DELIVERED→DELIVERED, etc.) but does NOT enumerate the wire-vocabulary action codes. The fix is at the action-code wire vocabulary, not the semantic mapping. Reviewer confirms or rules amendment is required.

**OQ-8 — Companion followup memo.** Per the post-#303 OQ-4 precedent, file `memory/followup_inbound_webhook_action_vocabulary_drift.md` in the code-PR summarizing: the three-vocabulary design (§2.2), Phase-0 evidence findings, the canonical action-code vocabulary post-fix, drawer fallback policy, and the ground-truth contract for FUTURE inbound-webhook vocabulary changes. Builder's recommendation: yes.

**OQ-10 — Inbound TZ symmetry — wrap-inversion handling + ship-helper-unconditionally.** Two sub-rulings (per §2.5). **§3.6 RULED (2026-05-18 PM, plan-PR #306 v2 re-read):**
- (a) **RULED (i)** — throw `ValidationError` on post-conversion wrap-inversion. Symmetric with A3 outbound (reviewer-ruled + body-read in #307). Same TZ contract → same failure mode → same forensic behavior. Option (ii) accept-as-cross-midnight-semantic explicitly rejected as a bug vector (different wrap philosophy on inbound vs outbound for the same contract).
- (b) **RULED — ship UNCONDITIONALLY** (not Q-C-gated). The correct wire-boundary conversion is correct regardless of whether currently exercised; gating it on current vendor behavior is the exact anti-pattern that produced this defect class. Q-C still determines I6/I7 load-bearing-vs-unit-only (per §2.5.6), but the helper ships either way. ~20 LOC.

---

## §7 — Inbound-apply interaction — neighborhood with #298 / #304 / #305

This lane sits in the SAME files as the inbound-webhook lanes already shipped:

- [apply-webhook-status-event.ts](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) — touched by #305 (§6.2 collision guard, additive WHERE-clause). This lane will likely touch the same file (OQ-3 forensic move, OQ-5 collision-guard re-check). **Must read at code-PR open SHA, not the cached state.**
- [apply-webhook-edit-event.ts](src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts) — touched by #298 (extractEditFields camelCase fix + changedFields decouple) and #304 (8-leaf null-tolerance). This lane MAY touch the edit applier if OQ-2 ruling chooses option (b) — enriching the edit event with a more specific label from `deliveryInformation.status`. Else NO touch.
- [webhook-parser.ts](src/modules/integration/providers/suitefleet/webhook-parser.ts) — touched in pre-Day-18 work; KNOWN_ACTIONS is a coded vocabulary table. This lane reconciles the table with the canonical post-Phase-0 vocabulary.
- [status-mapper.ts](src/modules/integration/providers/suitefleet/status-mapper.ts) — last touched at Day-13/Day-18. This lane is the primary surface (the mapping contract from §3 lives here).
- [TaskTimelineDrawer.tsx](src/app/(app)/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx) — last touched Day-22/PR-B. This lane reconciles ACTION_LABELS with the canonical vocabulary.

**Schema-drift risk:** the 3-vocabulary design (§2.2) is the structural cause of the bug. Code-PR must collapse to a SINGLE shared canonical action-code vocabulary (export from one module, import into the other 2) OR add a CI guard that asserts all three tables cover the same key set. **OQ-9** — reviewer rules: (a) refactor to single shared constant, (b) add CI test asserting set-equality, (c) leave as-is and rely on integration tests. Builder's recommendation: (a) — the structural fix; the simplest representation of "these three tables are the same key set."

### §7.1 — Integration spec at code-PR open (Day-23 §F discipline)

The code-PR carries the following integration specs (real Postgres + mocked SF wire):

1. **I1 (mandatory): all canonical action codes apply correctly.** For each of the 14 lifecycle SF action codes (per Phase-0 evidence + §3 contract), assert that:
   - webhook arrives → `webhook_events` row inserted with correct `action` value
   - `tasks.internal_status` updated to expected value per §3 table
   - `tasks.updated_at` advanced
   - `task.status_changed_via_webhook` audit row emitted with correct `sf_action` + `new_status` metadata
   - Drawer label for that action is the expected string per §3 table (assert by reading getTaskTimeline output)

2. **I2 (DELIVERED end-to-end with POD):** TASK_STATUS_UPDATED_TO_DELIVERED with `deliveryInformation.photos: ["url1.jpg", "url2.jpg"]` payload → `tasks.internal_status='DELIVERED'`, `tasks.pod_photos = ["url1.jpg", "url2.jpg"]`, `task.pod_received_via_webhook` audit row with `photo_count: 2`. Smoke-render check (manual): operator opens /tasks, POD pill on the task is "active" tone.

3. **I3 (TASK_HAS_BEEN_UPDATED twin de-dup, IFF OQ-2 ruling = a):** SF sends TASK_STATUS_UPDATED_TO_DELIVERED + TASK_HAS_BEEN_UPDATED within 5s for same task → drawer shows ONE entry ("Delivered"); the "Updated" twin is suppressed.

4. **I4 (unknown-action forensic, IFF OQ-3 ruling = move-INSERT-up):** SF sends a synthetic unknown action `TASK_STATUS_FOO_BAR` → `webhook_events` row inserted with `action='TASK_STATUS_FOO_BAR'`, `tasks` untouched, no audit emit. Operator/ops can SELECT this row.

5. **I5 (existing #298/#304/#305 regression survival):** the Day-28 + Day-29 inbound-edit-apply integration suite continues passing — D29-NULL fixture + all 7 Day-18 fixtures + the #305 skip→outbound suite — no regression from this lane's changes.

---

## §8 — Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 0 evidence reveals SF wire vocabulary is more diverse than the 14 coded actions — needing new entries | Medium | §3 table is reviewer-rulable; new entries added in code-PR per Phase-0 findings; integration spec I1 surfaces missing coverage as a test failure |
| Reconciling drawer ACTION_LABELS with parser/mapper introduces a UI label change Aqib hasn't seen (e.g., "Assigned to driver" → something else) | Low | Reviewer rules drawer label per Phase-0 evidence + §3 table; Aqib UAT loop runs post-promote |
| OQ-2 ruling (a) de-dup window of ±30s misses some twins or surface false-positives (operator made two distinct edits within 30s, one gets suppressed) | Low-Medium | Time window TBD by reviewer; can be tightened/loosened; integration spec I3 can pin the window |
| OQ-5 reveals the §6.2 collision guard short-circuits POD writes on already-DELIVERED — latent bug in production | Low-Medium | If true, the fix is in-scope (reviewer rules) — narrow the WHERE clause to allow pod_photos write even when internal_status already DELIVERED |
| Shared-canonical-vocabulary refactor (OQ-9 (a)) breaks an import in an unrelated module | Low | Builder reads all consumers at code-PR open; TypeScript compile + integration spec coverage gate |
| Phase 0 sample is too thin (low SF traffic in 72h on demo tenant) to confidently rule | Medium | Extend window; query historical webhook_events from all tenants (with PII care); reviewer rules if Phase 0 is conclusive enough |

---

## §9 — Code-PR shape (preview)

When the code-PR opens (after §3.6 on this plan-PR + Phase-0 evidence + OQ rulings):

- **Files touched (expected):**
  - `src/modules/integration/providers/suitefleet/webhook-parser.ts` (KNOWN_ACTIONS reconciliation)
  - `src/modules/integration/providers/suitefleet/status-mapper.ts` (ACTION_TO_INTERNAL_STATUS reconciliation; possibly OQ-3 forensic move)
  - `src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts` (OQ-3 forensic move; OQ-5 collision-guard re-check; OQ-2 (b) enrichment IFF chosen)
  - `src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx` (ACTION_LABELS reconciliation; OQ-2 (a) de-dup IFF chosen)
  - **NEW:** shared canonical-vocabulary constant (OQ-9 (a) IFF chosen)
  - **NEW:** `memory/followup_inbound_webhook_action_vocabulary_drift.md` (OQ-8 IFF approved)
- **Tests:**
  - `tests/integration/webhook-status-event-applied.spec.ts` — extend with the 14 lifecycle-action coverage of §3.1 (I1)
  - Add new integration spec for I2 (DELIVERED + POD end-to-end)
  - Add new integration spec for I3 (twin de-dup) IFF OQ-2 (a)
  - Add new integration spec for I4 (unknown-action forensic) IFF OQ-3 forensic-move
- **Commit shape:** likely 2-3 commits (vocabulary reconciliation; drawer/OQ-2 fix; OQ-3 forensic move + tests) — each individually green so partial revert is possible.
- **Post-merge:** standard Vercel deploy via inspect-then-promote. Aqib UAT loop on the same Slides 7/8/10 surface — pass criteria: Picked Up / Cancelled / Delivered / In Transit / Failed all render their specific label, NOT "Updated"; DELIVERED also surfaces POD pill on /tasks.

---

**End of plan v1.** Awaiting §3.6 ruling on §6 OQs (1–9), §3 mapping contract, and §7 schema-drift posture.

---

## §10 — Reviewer rulings locked (post-§3.6 v1 — 2026-05-18, plan PR #306)

§3.6 RULING on plan v1 at SHA `4b35b9170619f524227d3656979d9b4dda1aea76`: APPROVED with rulings + one binding addition. Root-cause refutation (3-vocabulary drift + literal-string dispatch + §2.4 TASK_HAS_BEEN_UPDATED-twin hypothesis) accepted as correct and well-evidenced. The "static code cannot prove WHY everything renders Updated; Phase-0 evidence gates the code-PR" posture is ratified.

**Locked rulings (do not re-open):**

| OQ | Ruling | Notes |
|---|---|---|
| **OQ-1** | **APPROVED (a)** — Phase-0 evidence MANDATORY before code-PR. Non-negotiable. | SQL reviewer-tightened to Q-A + Q-B + Q-C (see §6 OQ-1 above). |
| **OQ-2** | **RULING DEFERRED — Phase-0-gated.** Do NOT pre-decide (a) suppress. | Correct answer depends on Q-B: if SF emits status-specific codes WITH an Updated twin → suppress; if ONLY TASK_HAS_BEEN_UPDATED with status inside `deliveryInformation.status` → enrich is the ONLY option (suppress would destroy the only event). Wait for evidence. |
| **OQ-3** | **APPROVED** — yes, move webhook_events INSERT before mapper null-check. | In-scope for code-PR. |
| **OQ-4** | **APPROVED** — SAME LANE for POD. Locked. | Splitting manufactures Aqib's exact bug. |
| **OQ-5** | **APPROVED IN-SCOPE with hard requirement.** | At code-PR-open SHA, read the actual current §6.2 #305 guard and explicitly determine whether the SKIPPED/DELIVERED no-op collateral-damages the `pod_photos` write. If a DELIVERED twin can no-op the POD write, the guard-narrowing fix (allow `pod_photos` write even when `internal_status` already DELIVERED) is IN THIS LANE. Reviewer will body-read this specific interaction at code-PR §3.6 — highest-risk surface in the lane. |
| **OQ-6** | **APPROVED (a)** — raw-code fallback. | Visible drift is the correct failure mode. |
| **OQ-7** | **CONFIRMED** — no brief v1.16. | Fix is at wire-vocabulary layer, below the brief's semantic abstraction. |
| **OQ-8** | **APPROVED** — file `followup_inbound_webhook_action_vocabulary_drift.md` in the code-PR. | |
| **OQ-9** | **APPROVED (a)** — single shared canonical action-code vocabulary, exported from one module, imported by parser + mapper + drawer. The structural fix. | CI-guard (b) explicitly rejected as weaker. |
| **OQ-10(a)** | **RULED (i)** — throw `ValidationError` on post-conversion wrap-inversion. | Symmetric with A3's outbound stance (reviewer-ruled + body-read in #307). Same TZ contract → same failure mode → same forensic behavior (`payload_validation_failed` outcome, `webhook_events` row preserved, no silent emit). Option (ii) accept-as-cross-midnight-semantic rejected: a different wrap philosophy on inbound vs outbound for the same contract is a bug vector. |
| **OQ-10(b)** | **RULED** — ship the `utcTimeToDubaiLocal` helper **UNCONDITIONALLY** (not gated on Q-C). | ~20 LOC defense-in-depth. The correct wire-boundary conversion is correct regardless of whether currently exercised; the I8 no-time-field-path no-op spec proves it's harmless when unused; gating it on current vendor behavior is the exact anti-pattern that produced this defect class. Q-C still determines whether I6/I7 are load-bearing integration regression (SF emits times) vs unit-test-only (SF doesn't) per §2.5.6 — but the helper ships either way. |

**Next steps (reviewer-defined):**

1. ✅ DONE — plan revised with §2.5 inbound-TZ-symmetry section + Q-C added to OQ-1 SQL + OQ-10 added + this §10 rulings-locked section. **Revised plan-PR pinned SHA in §11 below.**
2. Love runs Phase-0 Q-A + Q-B + Q-C against production; pastes results to reviewer.
3. Reviewer rules OQ-2 + OQ-10 (a)+(b) from the evidence.
4. THEN code-PR opens (T3 hard-stop #2). No code, no Phase-0 SQL run by builder, no self-merge.

---

## §11 — Revision history

| Revision | SHA | Filed | Notes |
|---|---|---|---|
| v1 | `4b35b9170619f524227d3656979d9b4dda1aea76` | 2026-05-18 (Day-30 AM) | Initial plan — §1-§9. |
| v2 | `af7c05a32f8c9a7992b7e156c27b2a9f1a1d6800` | 2026-05-18 (Day-30 PM) | Post-§3.6: locks OQ-1/3/4/5/6/7/8/9 rulings; defers OQ-2 to Phase-0; adds OQ-10 (TZ symmetry) + §2.5 trace; tightens §6 OQ-1 SQL to Q-A + Q-B + Q-C. Reviewer re-reads §2.5 + §6 OQ-1 + OQ-10 + §10. |
| v3 | (this commit — see push output) | 2026-05-18 (Day-30 PM-late) | Post-v2 re-read: §2.5 + §6 OQ-1 + §10 ACCEPTED. OQ-10(a) RULED (i) ValidationError; OQ-10(b) RULED ship-unconditionally. §10 + §6 OQ-10 updated to record reviewer-locked rulings. **Record update only — no §3.6 re-read required.** A1 plan-PR #306 FULLY RULED — all 10 OQs locked; T3 hard-stop #1 CLEARED. Code-PR gated on Phase-0 evidence + OQ-2 + I6/I7 load-bearing confirmation. |

**End of plan v3.** A1 plan-PR #306 fully ruled. **STOP — do NOT open code-PR.** Sequenced next steps: (1) Love runs Phase-0 Q-A + Q-B + Q-C against production; (2) reviewer rules OQ-2 from Q-B + confirms I6/I7 load-bearing-vs-unit-only from Q-C; (3) THEN A1 code-PR opens (T3 hard-stop #2).

---

## Phase-0 results + post-evidence rulings (Day-31)

> [SUPERSEDED Day-31 PM — see "Real-task end-to-end test (Day-31 PM)" section below. The Phase-0 data was non-representative test data; defects 2 and 3 are FALSIFIED as planner bugs; a new lead defect (inbound SF-edit propagation) is identified.]

Filed: 2026-05-19 (Tue, Day-31). Phase-0 evidence executed; lead hypothesis from §2.4 (single empty mapping layer / routing-dispatch-on-raw-string) FALSIFIED by production data. Rulings on OQ-2 + I6/I7 + A1 fix shape are LOCKED below.

### Phase-0 execution context

Phase-0 was run Day-31 on production (Love-run, read-only, 4 queries). Schema confirmed: `webhook_events` keyed by `suitefleet_task_id`, time column `received_at`; `tasks` keyed by `external_id`, status `internal_status`, POD `pod_photos`. Join: `webhook_events.suitefleet_task_id = tasks.external_id` (both text).

### Q-A — action distribution (last 14 days)

| action | count |
|---|---|
| TASK_HAS_BEEN_UPDATED | 125 |
| TASK_HAS_BEEN_ORDERED | 84 |
| TASK_STATUS_UPDATED_TO_DELIVERED | 27 |
| TASK_STATUS_UPDATED_TO_PICKED_UP | 9 |
| TASK_STATUS_UPDATED_TO_CANCELED | 5 |

**Specific status codes ARE present in production.** The original "single empty mapping layer / routing-dispatch-on-raw-string" lead hypothesis is FALSIFIED.

### Q-B — action × resulting internal_status

| action | resulting internal_status | count |
|---|---|---|
| TASK_STATUS_UPDATED_TO_DELIVERED | DELIVERED | 15 |
| TASK_STATUS_UPDATED_TO_PICKED_UP | IN_TRANSIT | 7 |
| TASK_HAS_BEEN_UPDATED | CREATED | 20 |

**Conclusion:** parser + mapper are CORRECT for specific codes. Explicit DO-NOT-TOUCH on surfaces (A) `parser KNOWN_ACTIONS` and (B) `mapper ACTION_TO_INTERNAL_STATUS`.

### Q-C — DELIVERED POD extraction

15 events; **9 with_pod, 6 without_pod**. POD extraction is partially wired — there is a **data-shape defect on a 2nd SF payload shape** that the current `extractPodPhotos` does not handle.

### Confirming query — current status of tasks that received a generic update (14d)

**20 of 20 at CREATED.** The intentionally-enabled generic `TASK_HAS_BEEN_UPDATED` sync channel is regressing task status to CREATED rather than applying real state from `raw_payload`. Config intent confirmed by Love: **all webhooks (specific + generic) are deliberately enabled**; the generic event is an intended catch-all sync channel, NOT noise to suppress.

### Rulings (locked Day-31, supersede prior placeholders)

- **OQ-2 = ENRICH, suppress-twin REJECTED.** Locked on design intent (generic channel deliberately enabled) + Q-B data. The generic `TASK_HAS_BEEN_UPDATED` event stays recorded for the forensic trail; the drawer no longer keys off the raw `action`.
- **A1 TZ spec weight I6/I7 = LOAD-BEARING CONFIRMED.** Q-C's 6/15 POD miss is the production evidence; the POD same-lane fix is **mandatory** at code-PR open, not optional.
- **A1 fix shape = THREE planner-side defects, NO routing rewire, NO parser/mapper vocab change:**
  1. **Drawer render fix (surface C).** Label resolves from `tasks.internal_status`, not raw `action`. Cosmetic.
  2. **POD data-shape fix.** `extractPodPhotos` handles the 2nd `raw_payload` shape behind the 6/15 miss. Medium.
  3. **[LEAD, HIGH / T3-weight] TASK_HAS_BEEN_UPDATED generic handler must apply real task state from `raw_payload`, never default/regress to CREATED.** Live data-correctness bug; demo-correctness exposure.
- **No Aqib dependency on the A1 critical path.** The May-9 taper is explained as config (all webhooks on), NOT an SF behavior change — closed, no Aqib question needed on it.
- **Exact `raw_payload` shapes for defect 2 (the 6 POD-miss rows) and defect 3 (TASK_HAS_BEEN_UPDATED rows)** to be read from `webhook_events.raw_payload` during the A1 code-PR build — scoped INTO the build, NOT a new Phase-0 gate.

---

## Real-task end-to-end test (Day-31 PM) — definitive re-ruling

Filed: 2026-05-19 (Tue, Day-31 PM). The Phase-0 conclusions above were drawn from non-representative TEST data (tasks never cycled to delivered, no real POD, no real edits). A real end-to-end test — a subscription-linked task driven through the full SF lifecycle with a real POD and two real SF-side edits — INVERTS the diagnosis. Defects 2 and 3 are FALSIFIED. A new lead defect is identified (Finding A — inbound SF-edit propagation broken). Rulings below.

### TEST

Subscription-linked task **AWB MPL-80355079** (SF id `61137`, Planner task id `a4115023-056c-4244-9efd-b6f9aa541489`, MPL tenant / SF `customerId` 588) driven through the full real SF lifecycle:

`TASK_HAS_BEEN_UPDATED(ORDERED) → TASK_HAS_BEEN_ORDERED → TASK_STATUS_UPDATED_TO_PICKED_UP → _ARRIVED_ON_DC → TASK_HAS_BEEN_ASSIGNED → _OUT_FOR_DELIVERY → _IN_TRANSIT → _DELIVERED`

with a real POD photo, plus two SF-side edits (address change to "North Park"; `deliveryDate` 2026-05-20 → 21 → 19). All edits made on SuiteFleet; none on Planner.

### DEFECT 3 (status "regresses to CREATED") — FALSIFIED, CLOSED, NOT A PLANNER BUG

Planner task `internal_status` correctly = `DELIVERED` at end of real lifecycle. The 20/20-CREATED Phase-0 finding was a test-data artifact (tasks never cycled). The proposed status-resolution fix (extend `deliveryInformationSchema` with `status`, add status-enum map) is WITHDRAWN — it would have fixed a non-bug.

### DEFECT 2 (POD extraction misses a 2nd shape) — FALSIFIED, CLOSED, NOT A PLANNER BUG

Real DELIVERED webhook carried `photos: [s3-signed-url]`; Planner `pod_photos` extracted it correctly. The 6/15 Phase-0 miss was test fixtures with empty/absent photos. `extractPodPhotos` current behavior is correct.

NOTE (not a code defect): POD is an AWS S3 signed URL with `X-Amz-Expires=604800` (7 days); demo-preflight must ensure the demo POD task is delivered within 7 days of the demo or the image link 403s. Logged as a preflight item, not a fix.

### DEFECT 1 (drawer labels render generic "Updated") — CONFIRMED REAL BUG

The real SF action vocabulary observed on the wire (authoritative list to key `ACTION_LABELS` against):

- `TASK_HAS_BEEN_UPDATED`
- `TASK_HAS_BEEN_ORDERED`
- `TASK_HAS_BEEN_ASSIGNED`
- `TASK_STATUS_UPDATED_TO_PICKED_UP`
- `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC`
- `TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY`
- `TASK_STATUS_UPDATED_TO_IN_TRANSIT`
- `TASK_STATUS_UPDATED_TO_DELIVERED`

**Ruling:** drawer preserves GRANULAR labels (Love decision Day-31) — each SF status renders its own distinct label, NOT collapsed to internal-status buckets. Surface C only; surfaces A (parser) + B (mapper) confirmed UNTOUCHED and CORRECT by the real test.

### FINDING A (NEW LEAD DEFECT) — inbound SF-edit propagation broken

Real evidence: SF-side address edit ("Warehouse 23/24, Al Quoz Industrial 1" → "North Park") and `deliveryDate` edit (→ 2026-05-19) were sent by SF (visible in PICKED_UP-onward `raw_payload` `consignee.location.addressLine1` and `deliveryDate`) but did NOT apply to the Planner task: `task.address_id` still resolves to the ORIGINAL address row (line "Warehouse 23/24, Al Quoz Industrial 1"); `task.delivery_date` still = 2026-05-20 (original). The inbound `TASK_HAS_BEEN_UPDATED` edit-apply path (`apply-webhook-edit-event.ts`) is not propagating address/date edits.

This matches Aqib's original UAT symptom far better than the (falsified) status theory.

**CONCRETE DIAGNOSTIC LEAD:** `consignee.id` shifts `33299 → 33364` across the edit boundary — SF creates a NEW consignee record on an address edit rather than mutating the existing one; the Planner inbound apply logic likely keys on the original consignee identity and never matches/applies.

**Severity:** HIGH (T3-class — inbound apply path).

**Lane shape decision (Love, Day-31):** Finding A is the new A1 LEAD, fixed BEFORE the demo (option (a)). Diagnosis-before-fix mandatory.

### OUT OF SCOPE / FOLLOW-ON

Planner→SF outbound edit propagation (the reverse direction) is untested; deferred to a separate test+lane AFTER Finding A is resolved (Love directive). Do NOT bundle.

---

## A1 final lane shape (Day-31 PM — Love directives, locked)

This section is the FINAL, AUTHORITATIVE A1 lane shape. It supersedes all prior rulings in this file where in conflict. Driver: Love directives Day-31 PM after the real-task E2E test + architectural clarification (address is stored at consignee level, not task level; SF does emit an inbound webhook on an address edit).

1. **DEFECTS 2 & 3 (POD extraction; status "regresses to CREATED") — CLOSED.** Not planner bugs. Test-data artifacts. No code. (Unchanged from the Day-31 PM re-ruling above.)

2. **FINDING A — ADDRESS HALF — RECLASSIFIED: NOT A BUG. LOG + DEFER (Love directive).** Architectural ground truth (Love-confirmed): address is stored at the CONSIGNEE level, not the TASK level. An SF-side address edit mints a new consignee (observed: `consignee.id` 33299→33364) and does NOT rewrite an already-created task's `address_id` — this is BY DESIGN, not a defect. Converges with: (a) Session A's code diagnosis — `apply-webhook-edit-event.ts` deliberately never writes `tasks.address_id` (explicit filter line 244 + `address_id` absent from `EXTRACTED_COLUMN_NAMES` lines 470-483 and `buildSetFragment` lines 493-523, two enforcement layers); (b) the already-LOCKED B1 ruling (Planner is address source-of-truth; SF-side address change must SURFACE+PROMPT the operator, no auto-overwrite). **ACTION:** logged here as a finding; NO A1 code; the operator-surface/prompt UX remains the separate locked B1 lane (post-demo unless Aqib UAT escalates). The consignee-id-keyed-lookup hypothesis from the earlier Phase-0 section is REFUTED — task lookup is AWB-only (`apply-webhook-edit-event.ts` line 206); the `consignee.id` shift is invisible to that path.

3. **FINDING A — DATE HALF — FIX NOW (Love directive, PRE-DEMO, in A1 scope).** Inbound SF `deliveryDate` edit must propagate to `tasks.delivery_date`. Root cause NOT yet confirmed: the schema/key-shape hypothesis (camelCase vs snake_case) is REFUTED — real wire `raw_payload` uses `"deliveryDate"` camelCase (matches schema line 71); the test fixture's snake_case `"delivery_date"` is stale fixture only. SF DOES send the inbound edit webhook (Love-confirmed) — "no event received" is also refuted. The actual root cause requires a fresh read-only diagnosis pass (diagnosis-before-fix mandatory) — the two eliminated hypotheses narrow it but do not identify it. Likely surfaces to read: whether `deliveryDate` is in `EXTRACTED_COLUMN_NAMES` / `buildSetFragment` for the inbound edit path at all; whether a TZ/format transform drops it (note: Day-30 A3 found an OUTBOUND TZ bug; the symmetric INBOUND bug is a known follow-on — confirm whether implicated here or separate); whether the edit event for a date-only change is even dispatched to `applyWebhookEditEvent` vs silently classified elsewhere.

4. **DEFECT 1 — DRAWER GRANULAR STATUS LABELS — FIX NOW (Love directive, PRE-DEMO, in A1 scope).** Drawer preserves GRANULAR labels: each SF status renders its own distinct label, NOT collapsed to internal-status buckets. Authoritative SF action vocabulary to key `ACTION_LABELS` against (confirmed on real wire, Day-31 test): `TASK_HAS_BEEN_UPDATED`, `TASK_HAS_BEEN_ORDERED`, `TASK_HAS_BEEN_ASSIGNED`, `TASK_STATUS_UPDATED_TO_PICKED_UP`, `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC`, `TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY`, `TASK_STATUS_UPDATED_TO_IN_TRANSIT`, `TASK_STATUS_UPDATED_TO_DELIVERED`. Surface C only (drawer `ACTION_LABELS`). Surfaces A (parser) + B (mapper) confirmed CORRECT and UNTOUCHED by the real test — do NOT modify them.

5. **PRE-DEMO A1 BUILD SCOPE = item 3 (date fix) + item 4 (drawer granular labels), ONE T3 code-PR, single commit, §3.6 hard-stop #2 on the diff.** Item 2 (address) is LOG+DEFER, not built. Items defects 2/3 closed. Planner→SF outbound edit propagation remains the deferred separate-test follow-on (unchanged, do NOT bundle).

---

## A1 confirmed root cause + full ruling (Day-31 PM — demo decoupled, build-to-correct)

This section is FINAL and AUTHORITATIVE; supersedes prior sections where in conflict. Driver: Love directives Day-31 PM after the full MPL-80355079 event-sequence evidence + the ruling that SF fires the update webhook on every change and the Planner must capture all changed fields except address. DEMO IS DECOUPLED — Love has moved the demo indefinitely and will not reschedule until this is perfectly done. Build to CORRECTNESS, not to any date. No demo-pressure splits or timing deferrals.

1. **CONFIRMED ROOT CAUSE** (corroborated by the full MPL-80355079 `webhook_events` sequence): The inbound status handler `applyWebhookStatusEvent` writes ONLY `internal_status` (+`pod_photos` on DELIVERED) and does NOT apply field deltas embedded in status-event payloads. SF fires its update webhook on every change (Love-confirmed), but in a lifecycle where edits precede/accompany status movement, the changed values (e.g. `deliveryDate` 2026-05-20→2026-05-19) ride EMBEDDED inside `TASK_STATUS_UPDATED_TO_*` payloads, routed to `applyWebhookStatusEvent`, never applied. Only 2 standalone `TASK_HAS_BEEN_UPDATED` events existed for the test task, both at creation (13/05) carrying the original date; zero standalone edit events in the 19/05 edit window. This is a status-handler structural gap, NOT a receiver/routing/storage bug and NOT a Zod-validation silent-drop (both prior hypotheses refuted by full evidence). `apply-webhook-status-event.ts` grep for `delivery_date` / `deliveryDate` / `address_id` = zero matches confirms the gap.

2. **FULL RULING (Love, Day-31 PM):** The inbound path MUST capture and apply EVERY changed field the payload carries — `deliveryDate`, `deliveryStartTime`, `deliveryEndTime`, and all other mutable task fields the payload exposes — with the SINGLE explicit exception of ADDRESS (consignee-level per the locked address ruling; B1 owns the address-edit UX; address remains LOG+DEFER, NOT captured by this fix). This is a structural fix to `applyWebhookStatusEvent` (status events must reconcile embedded field deltas), scoped to ALL non-address mutable fields, not a single-field date patch.

3. **EVIDENCE BOUNDARY (honesty for §3.6):** The MPL-80355079 real evidence proves the DATE embedded-delta gap specifically. Timeslot and other non-address fields were NOT edited in that test, so their behavior is inferred from payload schema, NOT observed on real wire. Before Phase-2 build, a SUPPLEMENTARY real test (Love-run) will edit timeslot + 1-2 other non-address mutable fields on a real task so the structural fix and its integration spec are pinned to real observed multi-field behavior, not date-only. The Phase-2 integration spec must distinguish field deltas proven on real wire vs covered from schema; §3.6 must not over-claim "proven on real data" for unobserved fields.

4. **DEFECTS 2/3 CLOSED** (unchanged). DEFECT 1 drawer granular labels — unchanged, still in Phase-2 scope, keyed to the 8 confirmed SF action strings in the prior section's item 4, surface C only, A+B untouched.

5. **COMMITTED FOLLOW-ON LANE** (no longer "someday" — recorded as committed work, sequenced AFTER the inbound structural fix lands; do NOT bundle): Planner→SF OUTBOUND edit propagation — a real test in the reverse direction (edit a field in the Planner UI, verify it propagates to SF) plus whatever fix that surfaces. Inbound-then-outbound order per Love directive.

6. **PHASE SEQUENCE** (no demo clock; full discipline, no compression): **(Step 1)** this amendment, reviewer-verified. **(Step 2)** Love-run supplementary real multi-field test. **(Step 3)** Session A: structural `applyWebhookStatusEvent` field-capture fix (all fields except address) + Defect 1 drawer fix, ONE T3 commit, §3.6 hard-stop #2 on the diff at pinned SHA, green CI, no `--admin`. **(Step 4)** outbound symmetry lane per item 5.

---

## A1 root cause refinement — second-task wire evidence (Day-31 PM, supplementary multi-field test)

This section is FINAL and AUTHORITATIVE; it REFINES (does not falsify) the confirmed root cause in the prior section. Driver: a second real end-to-end test (task AWB MPL-38610276, SF id 61089, MPL tenant / SF customerId 588), driven through the full SF lifecycle with real SF-side edits to `deliveryDate` (20→21→20→19) and the delivery window, captured from production `webhook_events.raw_payload` (Love-run read-only) and the resulting Planner `tasks` row.

### 1. IDENTIFIER MODEL — recorded finding (cost three queries; not a bug)

`webhook_events.suitefleet_task_id` is keyed by AWB (e.g. `"MPL-38610276"`). `tasks.external_id` is keyed by the SF NUMERIC id (e.g. `"61089"`). These are DIFFERENT fields for the same task. Any `webhook_events × tasks` correlation must map AWB↔SF-id explicitly; a naive equi-join on a shared key returns zero rows and falsely reads as "no events." This is the same identifier-layer confusion the lane has hit before. Recorded so future diagnosis does not re-burn the queries.

### 2. TIMESLOT NOW PROVEN ON REAL WIRE — evidence boundary CLOSED

The 4th-fold evidence-boundary paragraph stated timeslot/non-date fields were schema-only, unobserved on real wire, pending this supplementary test. This test CLOSES that gap for the delivery window. On the wire, top-level `deliveryEndTime` moved `09:10:00` (create, 12/05) → `13:10:00` (first edit event 16:20:36 on 19/05) and held through DELIVERED. The window edit DID propagate on the wire and DID land on the Planner `tasks` row (Planner `delivery_end_time = 13:10:00` = the EDITED value, not the `09:10:00` create value). Timeslot delta application is therefore CONFIRMED ON REAL WIRE. The SF-UI field label `"deliveryBeforeTime"` does NOT exist on the wire; `after_time` / `before_time` are null in every row; the wire window vocabulary is exclusively top-level `deliveryStartTime` / `deliveryEndTime`.

### 3. ROOT-CAUSE REFINEMENT — the loss mechanism is INTERLEAVING, not "all deltas ignored"

The 4th-fold root cause (`applyWebhookStatusEvent` applies `internal_status` + `pod_photos` only, never embedded field deltas) is corroborated for DATE and must be SHARPENED. Observed asymmetry on this task: the window edit (changed EARLY, while standalone `TASK_HAS_BEEN_UPDATED` edit events were still flowing at 16:20–16:22) APPLIED to the Planner row; the date edit (`top_date` 2026-05-20 → 2026-05-19 first appeared LATE, at 16:23:35 on `TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY` — a STATUS event — after the last standalone edit event) did NOT apply (Planner `delivery_date` stale at 2026-05-20). Refined mechanism: a changed field is LOST iff its new value rides ONLY a status-event payload (because the change occurred after the last standalone edit event); fields that change while standalone edit events are still flowing survive via the edit-apply path. The structural fix (status events must reconcile embedded deltas — 4th-fold ruling, UNCHANGED and correct) is the right fix; the refinement governs the INTEGRATION SPEC: it MUST reproduce the late-change-rides-status-event sequence (change a field AFTER the last standalone edit event, only a status event carries it), not merely "edit then deliver" — the latter would pass while the real bug survives (single-diagnostic-surprise: the coarse test shows date stale and looks like clean confirmation while the window silently applied).

### 4. NAMED §3.6 #2 HARD-STOP SURFACE — top-level vs deliveryInformation source

The DELIVERED payload carries TWO date/time families: (a) TOP-LEVEL `deliveryDate` / `deliveryStartTime` / `deliveryEndTime` = the task's SCHEDULED window (the values the fix must reconcile); (b) NESTED `deliveryInformation.deliveryDate` / `deliveryStartTime` / `deliveryEndTime` = DRIVER ACTUAL-COMPLETION timestamps (e.g. 16:23:00 / 16:24:00 — when the driver actually started/finished; `deliveryInformation` is null until delivered). The structural fix MUST read scheduled-window deltas from PAYLOAD TOP LEVEL and MUST NEVER read them from `deliveryInformation.*`. A fix that reads `deliveryInformation.*` would pass a green integration test and write the driver's completion clock into the scheduled window in production. This is a NAMED §3.6 #2 body-read hard-stop surface, peer to OQ-5's collision-guard interaction.

### 5. DISTINCT FINDING — inbound TZ symmetric bug, confirmed live (NOT folded into the embedded-delta gap)

Planner `delivery_start_time = 07:10:00` faithfully stores wire top-level `deliveryStartTime = 07:10:00`, which is create-time `deliveryAfterTime 11:10` minus 4h — the inbound UTC→Dubai-local conversion gap (§2.5 / T1-followon-1 surface), now confirmed on real production wire. This is a DISTINCT defect on the write path that DID run (value stored, wrong by −4h), separate from the embedded-delta gap (value not stored at all). Already covered by OQ-10(b) ship-unconditionally. Remains a named separate finding; explicitly NOT folded into the confirmed root cause.

### 6. NET EFFECT ON LANE STATE

4th-fold ruling stands, verified-faithful, core diagnosis corroborated on a second independent task AND its evidence-boundary gap (timeslot) now CLOSED. No re-ruling. Build scope unchanged: structural `applyWebhookStatusEvent` field-capture fix (all fields except address) + Defect 1 drawer granular labels, one T3 commit, §3.6 hard-stop #2. The integration spec is now CONSTRAINED by items 3 (interleaving sequence mandatory) and 4 (top-level source mandatory). #306 stays OPEN (plan-PR-persistence).
