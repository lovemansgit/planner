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

**OQ-1 — Phase 0 evidence is mandatory before code-PR.** Builder's recommendation: yes — without production webhook_events sample we cannot pin which SF action codes are actually arriving and in what proportions. Proposed SQL (Love runs):

```sql
SELECT action, COUNT(*) AS event_count,
       MIN(received_at) AS first_seen,
       MAX(received_at) AS last_seen
FROM webhook_events
WHERE received_at >= NOW() - INTERVAL '72 hours'
GROUP BY action
ORDER BY event_count DESC;
```

Reviewer rules: (a) run Phase 0 first (recommended), (b) skip Phase 0 and code-PR fixes hypothesis-blind, or (c) different SQL scope (e.g., longer window, specific tenant filter).

**OQ-2 — TASK_HAS_BEEN_UPDATED twin-routing.** When SF emits a TASK_STATUS_UPDATED_TO_* event AND a TASK_HAS_BEEN_UPDATED twin for the same operator action (Day-29 cancel-twin precedent), the drawer surfaces both — and the "Updated" twin is misleading. Reviewer rules: (a) drawer suppresses "Updated" entries when a sibling status-event exists within a small time window (e.g., ±30s) for the same task, (b) edit-event applier extracts a more specific label from `deliveryInformation.status` if present, (c) leave both visible and rely on operator interpretation, (d) other. Builder's recommendation: (a) — least intrusive, cleanest UX, no schema or applier code change.

**OQ-3 — Forensic trail for silent-drop on unknown actions.** Move webhook_events INSERT BEFORE the `mapSuiteFleetStatusToInternal` null-check ([apply-webhook-status-event.ts:80-83](src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L80-L83)), so unknown-vocabulary SF events leave a forensic row. Cost: webhook_events bloat for genuinely-junk-action events (very low frequency expected). Benefit: future vocabulary-drift bugs surface in 1 SQL query against webhook_events instead of requiring Vercel-log diving. Builder's recommendation: yes (small +5 LOC; high observability ROI; ops doesn't have to remember to monitor Vercel logs for a class of events that should be loud but are silent today). Reviewer rules.

**OQ-4 — POD same-lane vs split.** Builder's recommendation: SAME LANE per §4.3. Reviewer rules.

**OQ-5 — #305 collision-guard interaction with DELIVERED+POD.** Builder reads the current `apply-webhook-status-event.ts` at code-PR open and confirms whether the §6.2 guard added in #305 short-circuits POD writes when the row is already in `internal_status='DELIVERED'`. If yes, a DELIVERED twin (SF re-sends webhook on race) would NO-OP the POD write — operator-visible bug latent today. Reviewer rules whether this is in-scope to fix in this lane or a separate followup.

**OQ-6 — Drawer fallback for unknown action codes.** Today: unknown action falls back to the raw SF code string (e.g., `"TASK_STATUS_UPDATED_TO_ASSIGNED"`). Reviewer rules: (a) keep raw-code fallback (operator sees SCREAMING_SNAKE, can ping ops), (b) fallback to a generic "Status update" label, (c) fallback to `"Updated"` (current state for many events through the §2.4 hypothesis). Builder's recommendation: (a) — surfacing raw codes makes vocabulary drift visible, vs. (b)/(c) which mask it.

**OQ-7 — Brief amendment.** Does any §3 mapping contract change force a brief v1.16 entry? Builder's preliminary read: NO — the brief commits to "SF status → internal_status" semantically (DELIVERED→DELIVERED, etc.) but does NOT enumerate the wire-vocabulary action codes. The fix is at the action-code wire vocabulary, not the semantic mapping. Reviewer confirms or rules amendment is required.

**OQ-8 — Companion followup memo.** Per the post-#303 OQ-4 precedent, file `memory/followup_inbound_webhook_action_vocabulary_drift.md` in the code-PR summarizing: the three-vocabulary design (§2.2), Phase-0 evidence findings, the canonical action-code vocabulary post-fix, drawer fallback policy, and the ground-truth contract for FUTURE inbound-webhook vocabulary changes. Builder's recommendation: yes.

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

**End of plan.** Awaiting §3.6 ruling on §6 OQs (1–9), §3 mapping contract, and §7 schema-drift posture.
