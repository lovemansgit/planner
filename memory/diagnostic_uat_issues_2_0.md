---
name: diagnostic_uat_issues_2_0
description: Consolidated DIAGNOSIS-ONLY memo for the second UAT issue batch — Aqib A1-A4 + Love F2/F3. Traces each cluster to exact files/lines at main f181845, names root-cause shape, runs a second confirming probe, and sketches a fix shape (shape only). Surfaces two findings that are NOT the bug they appear to be (A2 is a by-design status collapse; F3 outbound is already wired). NO fix proposed — reviewer consolidates into one plan.
metadata:
  type: reference
---

# Diagnostic — UAT issues batch 2.0 (Aqib A1-A4 + Love F2/F3)

**Filed:** 2026-06-21 (Day-56). **Mode:** diagnosis-only (no src/ change, no migration, no SQL write, no SF mutation). **Anchored to:** production `main` @ `f181845` (working tree byte-identical to `origin/main` for `src/`; all line citations are @ this SHA). **Brief:** v1.29.

**Headline for the reviewer (read this first):** Two of the six items are NOT the defect they are framed as.
- **A2** ("picked up shows as in transit", "reattempt shows as on hold") is a **deliberate status collapse** in the mapper, working exactly as written — not a typo and not a master-webhook override. The "fix" is a **product decision** (do we want distinct statuses?), not a one-line map correction.
- **F3** ("override/skip cancel not reaching SF") — the outbound cancel **is already wired** ( `pending_cancel` flip + `enqueueCancelTask`). It is NOT "never enqueued." Either nothing was on SF to cancel, or the enqueue failed at the consumer, or the operator used the move-to-date variant (which by explicit Phase-2 design emits no outbound). Needs the specific failing task before any fix is scoped.

The other four (A1, A3, A4, F2) are characterized below with concrete fix shapes.

---

## Cluster 1 — outbound-push-missing-on-a-path (A1 + F3)

### A1 — Delivery note entered during CONSIGNEE CREATION never pushes to SuiteFleet

**Symptom:** A delivery note typed in the consignee-creation form never reaches SF; it only pushes when later re-added per-task from the calendar (the working R3 driver-note path).

**Code path traced (@f181845):**
- **Captured & stored correctly:** form field `delivery_notes` ([consignees/new/_components/CreateConsigneeForm.tsx:91-96](../src/app/(app)/consignees/new/_components/CreateConsigneeForm.tsx#L91-L96)) → parsed ([_helpers.ts:67,103](../src/app/(app)/consignees/new/_helpers.ts#L67)) → `createConsignee` ([modules/consignees/service.ts:180,204](../src/modules/consignees/service.ts#L180)) → `insertConsignee` writes the `consignees.delivery_notes` column ([repository.ts:159-172](../src/modules/consignees/repository.ts#L159-L172)).
- **Never read into any outbound payload:** `createConsignee` fires **no** SF push at all — only an audit emit (`consignee.created`). Consignees reach SF implicitly via task creation, and the task-push read omits the column: the `ConsigneePushSnapshot` raw SELECT is `SELECT id, name, phone, email, address_line, emirate_or_region, district FROM consignees` — `delivery_notes` absent ([modules/task-push/service.ts:~509](../src/modules/task-push/service.ts)). The outbound `ConsigneeSnapshot` type has no note field ([modules/integration/types.ts:~92-96](../src/modules/integration/types.ts)). The task-create wire builder sets `notes` from `task.notes ?? undefined` ([task-push/service.ts:~271-307](../src/modules/task-push/service.ts)), and task materialization inserts no `notes` ([modules/task-materialization/service.ts:~293-338](../src/modules/task-materialization/service.ts)) — so a materialized task carries `notes = NULL`.
- **Working contrast (R3):** `addNoteToDriver` writes `tasks.notes` then `enqueueUpdateTask({ patch: { notes } })` ([modules/tasks/service.ts:~1446](../src/modules/tasks/service.ts)). The note rides the **task**, never the consignee record. SF's note field is task-level.

**Root cause (hypothesis → confirmed):** Shape **(i) read into a column but never pushed.** `consignees.delivery_notes` is a dead-end column with respect to SF. There is no bridge from `consignees.delivery_notes` → `tasks.notes` anywhere in materialization or push.

**Second probe:** `grep -rn "delivery_notes"` across `task-push/`, `task-materialization/`, `integration/` → **zero** read sites. Independently confirms the column is write-only relative to the outbound path.

**Fix shape (sketch only):** Seed `tasks.notes` from `consignees.delivery_notes` at materialization/push time (add the column to the push snapshot SELECT and default the task `notes` from the consignee note). One decision to make: materialization-time copy vs push-time read.

---

### F3 — Override/skip CANCEL "not reaching SuiteFleet outbound"

**Symptom (as reported):** skip-without-append / cancel-delivery (override) does not produce an SF cancel.

**Code path traced (@f181845):**
- `cancelNoAppendAction` → `addSubscriptionException(type:'skip', skipWithoutAppend:true)`.
- In-tx: `markTaskSkipped` sets `internal_status='SKIPPED'` **and flips `outbound_sync_state='pending_cancel'`** for the pushed row ([subscription-exceptions/service.ts:577-598](../src/modules/subscription-exceptions/service.ts#L577-L598); confirmed by the comment at [:813](../src/modules/subscription-exceptions/service.ts#L813) "the task row stays in outbound_sync_state='pending_cancel' (set by markTaskSkipped in the tx)").
- Post-commit: `enqueueCancelTask` **does fire** when `type==='skip' && !isMoveToDate && skippedTask!==null && externalTrackingNumber!==null`, inside try/catch that **re-throws** so the route surfaces "saved locally; SF push pending" and the row stays `pending_cancel` for triage ([service.ts:815-848](../src/modules/subscription-exceptions/service.ts#L815-L848)). This mirrors R2 pause-cancel posture exactly.

**Root cause (hypothesis):** **The outbound IS wired** for the genuine case (materialized + pushed task). This **contradicts the bootstrap framing** of F3 as "never enqueued." The cancel is missing only in cases that are correct-by-design or operational, not a code gap:
1. Task **unmaterialized** (no task row) → `skippedTask===null` → nothing on SF to cancel (correct; sub-case 13a). A frozen driver-bound row instead throws a clear `ValidationError` ([:586-596](../src/modules/subscription-exceptions/service.ts#L586-L596)).
2. Task **materialized but never pushed** (no AWB) → nothing on SF to cancel (correct; sub-case 13b).
3. **Move-to-date variant** (`target_date_override`, `isMoveToDate===true`) → **emits no outbound by explicit Phase-2 design** (Aqib-gated on the SF `rescheduleTask` wire contract; [:805-807](../src/modules/subscription-exceptions/service.ts#L805-L807)). If Aqib used "move skip to date," this is the "not reaching SF" he saw — and it is a *parked reschedule*, not a cancel bug.
4. **Enqueue/consumer failure** → shape (iii) enqueued-but-failing: the row is left `pending_cancel`, the error is captured + re-thrown — NOT silently dropped.

**Second probe:** Read both the in-tx flip and the post-commit enqueue directly (above) and compared to the R2 pause fan-out (`pauseSubscription` → `enqueueBulkCancelTasks`). The skip→cancel single-task path is the structural twin of the proven pause path. Wiring is present and correct.

**Fix shape (sketch only):** **None until disambiguated.** The reviewer should obtain the *specific* task Aqib cancelled and check (a) did it have an AWB, (b) is there a cancel-class row in `failed_pushes` / a stuck `outbound_sync_state='pending_cancel'`, (c) was it a move-to-date override. If (3) move-to-date is the real ask, the fix is the parked Phase-2 SF `rescheduleTask` outbound (Aqib wire contract). If (4) failing enqueue, it is an ops/DLQ matter, not a wiring change.

> **Scope-literal note:** the bootstrap predicts `outbound_sync_state` is *not* flipped on cancel; the code *does* flip it. Recording the contradiction rather than re-scoping.

---

## Cluster 2 — inbound status-reflection wrong (A2 + F2)

### A2 — "picked up" → "in transit"; "reattempt" → "on hold"

**Symptom:** SF "picked up" shows as "in transit" on Planner; SF "reattempt" shows as "on hold."

**Code path traced (@f181845):**
- **Action map** ([status-mapper.ts](../src/modules/integration/providers/suitefleet/status-mapper.ts)): `TASK_STATUS_UPDATED_TO_PICKED_UP → "IN_TRANSIT"` ([:68](../src/modules/integration/providers/suitefleet/status-mapper.ts#L68)); `TASK_STATUS_UPDATED_TO_REATTEMPT → "ON_HOLD"` ([:88](../src/modules/integration/providers/suitefleet/status-mapper.ts#L88)). Both are **documented intentional collapses**: IN_TRANSIT absorbs 5 SF sub-states incl. PICKED_UP ([:22-25](../src/modules/integration/providers/suitefleet/status-mapper.ts#L22-L25)); ON_HOLD absorbs REATTEMPT + RESCHEDULED ([:35-37](../src/modules/integration/providers/suitefleet/status-mapper.ts#L35-L37)).
- **Value map** (#521, the master-webhook top-level `status`): `PICKED_UP → "IN_TRANSIT"` ([status-progression.ts:34](../src/modules/integration/providers/suitefleet/status-progression.ts#L34), observed on wire); `REATTEMPT → "ON_HOLD"` ([:47](../src/modules/integration/providers/suitefleet/status-progression.ts#L47), inferred/unverified).
- **UI labels** confirm the symptom is faithful to the model: on `/tasks`, `IN_TRANSIT → "In transit"` and `ON_HOLD → "On hold"` (tasks/status.ts). So "picked up shows as in transit" is the mapper working as written.

**Root cause (verdict):** **Static-map design choice, NOT a bug and NOT a master-override interaction.** The collapse is the documented intent. `shouldAdvanceStatus` ([status-progression.ts:108-121](../src/modules/integration/providers/suitefleet/status-progression.ts#L108-L121)) is a shared guard used by both appliers; ON_HOLD/FAILED are deliberately off the linear spine so they are never blocked as "backward," and there is no path by which the master payload silently overrides a correctly-written dedicated event to a wrong terminal value.

**Second probe (structural, rules out master-override):** The route dispatch forks cleanly — `TASK_HAS_BEEN_UPDATED` → edit applier, all `TASK_STATUS_UPDATED_TO_*` → status applier ([webhooks/suitefleet/[tenantId]/route.ts:~285-288](../src/app/api/webhooks/suitefleet/[tenantId]/route.ts)) — and both share the same `shouldAdvanceStatus`. No override path exists. Confirms A2 is the static map, not an interaction.

**Fix shape (sketch only — this is a PRODUCT call, surface to Love/Aqib):** If operators must see "Picked up" and "Reattempt" distinctly, add new `InternalTaskStatus` values (`PICKED_UP`, `REATTEMPT`) + DB CHECK migration + UI label entries + remap the two action/value-map rows. Cheaper interim: UI-only finer label without changing the collapsed model (but ON_HOLD then can't distinguish reattempt vs rescheduled). **No change should be made as a "bug fix" — it expands the status model.**

> **Brief contradiction flag:** §3.1.10 lists the 15 SF action codes but provides **no internal-status mapping table.** The 5→1 / 2→1 collapses are undocumented code design. If A2 is ruled a product change, the brief needs a mapping table added (decision + §9 bump).

---

### F2 — Churn cancel not reflecting; is #521 the fix?

**Symptom / standing suspicion:** churn-driven cancels don't reflect in Planner; suspected already-fixed by #521.

**Code path traced (@f181845):** `CANCELED` is covered on **both** inbound paths — dedicated action `TASK_STATUS_UPDATED_TO_CANCELED → "CANCELED"` ([status-mapper.ts:85](../src/modules/integration/providers/suitefleet/status-mapper.ts#L85)) and master value `CANCELED → "CANCELED"` ([status-progression.ts:40](../src/modules/integration/providers/suitefleet/status-progression.ts#L40)). `shouldAdvanceStatus` allows a move to CANCELED unless the task is already DELIVERED/CANCELED (idempotent) ([:74,108-121](../src/modules/integration/providers/suitefleet/status-progression.ts#L74)).

**Root cause (verdict):** **#521 DOES cover the inbound reflection** of an SF cancel, whether it arrives on the dedicated event or carried on the master `TASK_HAS_BEEN_UPDATED` `status` field. The churn cascade itself is honesty-correct (v1.26): it sets `pending_cancel` and waits for vendor webhook confirmation before flipping local status. **Therefore the residual risk is vendor-side, not code:** reflection only happens if SF actually emits a CANCELED status for the recalled tasks. If the affected tenant's SF portal has only `TASK_HAS_BEEN_*` subscribed, #521 still catches it via the master `status` field — *provided the recall reached SF and SF acknowledges the cancel.*

**Second probe:** This is the same subscription-gap mechanism diagnosed for the original P1 ([followup_inbound_status_webhook_master_payload.md](followup_inbound_status_webhook_master_payload.md)); #521 closed the code half. The remaining half is (a) SF subscription config and (b) whether the outbound recall succeeded (a vendor-refused recall keeps true status by design, v1.26).

**Fix shape (sketch only):** No webhook-path code change. To close F2 operationally: confirm SF emits CANCELED for churned/recalled tasks (Aqib), and that the outbound recall fan-out lands (check `pending_cancel` rows that never received a confirming webhook). `REATTEMPT` value remains unverified-on-wire ([status-progression.ts:41-47](../src/modules/integration/providers/suitefleet/status-progression.ts#L41-L47)) — a spelling drift there falls through to null+warn (safe, but the task won't advance from that one event).

---

## Cluster 3 — POD not viewable (A3)

**Symptom:** Aqib could not view a proof-of-delivery photo.

**Pre-existing context:** [followup_pod_broken_image_pre_existing.md](followup_pod_broken_image_pre_existing.md) — POD URLs are SF-supplied S3 SigV4 pre-signed URLs (7-day TTL), stored verbatim; rendering them directly fails (`ERR_BLOCKED_BY_RESPONSE` within TTL; `403 AccessDenied` past TTL). Day-53 PM the fix was PR'd: a render-time authenticated proxy.

**Code path traced (@f181845):**
- **Proxy route IS on main and fully wired:** [src/app/api/tasks/[id]/pod/[index]/route.ts](../src/app/api/tasks/[id]/pod/[index]/route.ts) — gates via `buildRequestContext` (`task:read` + tenant scope), tries a captured durable copy first, else resolves the stored URL server-side, fetches via Node sockets (immune to browser policy), and on a 403/expired upstream returns a styled SVG placeholder with `X-Planner-Pod-State: expired-at-vendor` (graceful, not a broken glyph). Landed `0665e8c` (#377) + `dd45f67` (#423 capture/H3).
- **Per-surface coverage:**

| Surface | File:line | URL to `<img>` | Verdict |
|---|---|---|---|
| `/tasks` POD cell → lightbox | tasks/client.tsx:~933 (`podProxyPhotoPaths`) | **proxy** | COVERED |
| `/admin/tasks` POD cell | [AdminPodCell.tsx:42,55](../src/app/(admin)/admin/tasks/_components/AdminPodCell.tsx#L42) (`task.podPhotos ?? []`) | **raw S3** | **NOT COVERED — broken** |
| consignee calendar `CalendarPodCard` | CalendarPodCard.tsx:~55 (`photos[0]`) | raw | ORPHANED dead code (no call sites) |
| day-popover / task drawer | DayActionPopover.tsx | (no POD render) | n/a |

- Write path `extractPodPhotos` ([apply-webhook-status-event.ts:~622-628](../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts)) and read path `mapPodPhotos` ([tasks/repository.ts:~301-306](../src/modules/tasks/repository.ts)) pass URLs through verbatim; proxy rewriting is client-side via `podProxyPhotoPaths`, which the admin cell never calls.

**Root cause (classification):** **(b) uncovered-surface-broken.** The operator `/tasks` surface is fixed; the **`/admin/tasks` surface still ships raw S3 URLs** → broken images for any expired (>7-day) photo and `ERR_BLOCKED_BY_RESPONSE` even within TTL. Aqib operates as Transcorp staff, so the admin surface is the most likely surface he hit. (Secondary possibility: he viewed a >7-day-old photo through the covered `/tasks` surface and saw the honest SVG placeholder — that is degradation, not breakage, and vendor-dead Planner-side.)

**Second probe (git history):** `git log` on `src/app/api/tasks/**/pod/**` confirms the proxy landed in `0665e8c`/`dd45f67`; no commit between those and `f181845` touches `AdminPodCell.tsx`. The memo's "Deferred follow-ons" item 2 (admin POD cell through the proxy) was **never done** — main's state matches the memo, no contradiction.

**Fix shape (sketch only):** Route the admin cell through the proxy: at [AdminPodCell.tsx:42](../src/app/(admin)/admin/tasks/_components/AdminPodCell.tsx#L42) use `podProxyPhotoPaths(task.id, task.podPhotos)` (same import/pattern as the operator cell). The proxy already enforces tenant scope via `buildRequestContext`; no new route. Separately: delete or rewire orphaned `CalendarPodCard`.

**Need from Aqib to finalize:** which surface he used (`/tasks` vs `/admin/tasks`) and the photo's age. That disambiguates uncovered-surface (fixable) vs vendor-dead-410 (>7 days, unrecoverable without the deferred durable ingest-time capture).

---

## Cluster 4 — bag scan not updating report (A4)

**Symptom:** Aqib scanned 1 bag COLLECTED for consignee "zoro"; a hard refresh didn't update the report.

**Code path traced (@f181845):**
- **Dark gate (403):** tenant refresh throws `ForbiddenError` if `task_asset_tracking_enabled=false` ([modules/asset-tracking/report-service.ts:330-333](../src/modules/asset-tracking/report-service.ts#L330-L333)); admin refresh same at [:369-371](../src/modules/asset-tracking/report-service.ts#L369). The cron poll filters at the query level — `WHERE task_asset_tracking_enabled = true` ([api/cron/asset-tracking-poll/route.ts:53-61](../src/app/api/cron/asset-tracking-poll/route.ts#L53-L61)) — so a dark tenant simply never appears in the sweep.
- **#528 parser fix confirmed in-tree** (`6f2e076`): the SF asset wire field is now read as `status` (not `state`), HTTP 400 resolved — [integration/providers/suitefleet/asset-tracking-client.ts:~153,169](../src/modules/integration/providers/suitefleet/asset-tracking-client.ts) (`record.status`, `ASSET_STATES.has(record.status)`).
- **QStash 30-min schedule NOT registered:** absent from `vercel.json` (only `generate-tasks` + `auto-resume` crons); the registration tool `scripts/create-qstash-asset-poll-schedule.mjs` is a one-time manual runner whose header says "Run ONCE on Love's go AFTER the lane merges"; `QSTASH_TOKEN` is absent from `.env.local`; the route comment states the schedule "is NOT created by this code." **The background poll has never run.**

**DB evidence (read-only, production, 2026-06-21):**
- "zoro" is a **consignee** (id `c9fdc03c-…`), tenant `mlp` / "Meal Up" (id `d875f4ad-…`).
- **`tenants.task_asset_tracking_enabled = TRUE` for mlp — the tenant is LIT, not dark.**
- **Zero** `asset_tracking_cache` / `asset_scan_log` rows for any of zoro's 8 tasks. The entire mlp tenant has exactly **1** cache row (consignee "Jacob", AWB `MLU-97015852`, `state=RECEIVED`, updated 2026-06-20 11:42Z) + 14 scan-log rows, all for that one task.
- Three of zoro's AWBs are in-motion in the look-back window (MLU-56225484 / MLU-20229348 / MLU-70174442) — they *would* be fetched if anything polled.

**Root cause (verdict):**
- **Primary: cause (2) — the QStash poll was never registered, so nothing auto-ingests.** Definitive (config + env + code evidence).
- **Cause (1) DARK is ruled out** (mlp flag = TRUE).
- **Cause (3) parse-fail is ruled out** post-#528 (the one existing cache row proves the ingest pipeline lands rows end-to-end after the fix).

**Two important refinements (surface to reviewer):**
1. **Manual "Refresh now" vs browser reload.** If "hard refresh" meant a browser reload, the report just re-reads an empty cache → nothing shows (consistent with primary cause). If Aqib clicked **"Refresh now"**, that path is **live and bypasses the schedule** — and the single Jacob row proves it *can* land. So a manual refresh covering zoro's in-motion AWBs *should* have worked; that it didn't points to either (a) the refresh ran before the scan, (b) zoro's COLLECTED scan is under an AWB outside the in-motion look-back, or (c) the deriveAwb defect below.
2. **Latent `deriveAwb` truncation defect (the parked "bare-AWB drill-down" from #528).** `deriveAwb()` strips the last dash segment, so `trackingId "MLU-97015852" → awb "MLU"`; the one cache row stores `awb="MLU"` while `external_tracking_number="MLU-97015852"`. The Inventory report joins on `task_id` (so it renders), but task-level read-through / stale-detection via `findCacheByAwb(external_tracking_number)` would miss the `"MLU"` rows — causing re-ingest-every-tick and a broken task-level drill-down. This is a real secondary defect independent of the schedule.

**Second probe (cross-check):** mlp is LIT **and** zoro has zero asset rows — both facts point to "never polled," not to dark/403 (which would show the flag FALSE) and not to parse-fail (which would surface as a 400 on a manual refresh, and would not have let the Jacob row land). Consistent.

**Fix shape (sketch only):** Register the schedule once — `QSTASH_TOKEN=<prod> PUBLIC_BASE_URL=<prod> node scripts/create-qstash-asset-poll-schedule.mjs` (needs Love's go + the token; this is the brief's deferred step, not a code change). Separately, fix `deriveAwb` truncation so the cache key matches `external_tracking_number` (the parked bare-AWB defect). Before either, confirm via a read-only SF probe whether zoro's COLLECTED scan is even visible in SF's asset API for the in-motion AWBs (recommended confirming probe — not run here to avoid an unprompted live SF call in a diagnosis-only session).

> **Brief check:** consistent with v1.28 ("QStash registration deferred, needs QSTASH_TOKEN"). One state-fact worth noting: mlp is **lit in production** — per [decision_f4_asset_tracking_sf_sync_ruling.md](decision_f4_asset_tracking_sf_sync_ruling.md) only the manual admin toggle writes that flag, so an admin lit mlp (plausibly for UAT). Not a contradiction; flagged for awareness since the fleet shipped dark.

---

## Summary table

| Item | Surface | Root-cause shape | Is it a code bug? | Fix shape (sketch) |
|---|---|---|---|---|
| A1 | consignee-create note | read-into-column, never pushed | **Yes** | bridge `consignees.delivery_notes` → `tasks.notes` at materialize/push |
| F3 | skip/override cancel | already-wired; missing only when no AWB / move-to-date / consumer-fail | **No (as framed)** | none until the specific failing task is identified |
| A2 | inbound status labels | by-design status collapse | **No — product decision** | add distinct internal statuses + UI labels (expands model) OR UI-only label |
| F2 | churn cancel reflection | #521 covers inbound; residual is vendor/config | **No (code)** | confirm SF emits CANCELED + recall lands; verify REATTEMPT wire spelling |
| A3 | POD view | uncovered admin surface (raw S3 URL) | **Yes** | route `AdminPodCell` through the existing proxy |
| A4 | bag-scan report | QStash poll never registered (+ latent deriveAwb defect) | **Partly (defect) + ops (registration)** | register schedule (Love+token); fix deriveAwb truncation |

## Scope-literal stops / things needing a human ruling
1. **F3 framing contradicted by code** — outbound cancel is wired; bootstrap predicted it wasn't. Did not re-scope; need the exact task Aqib cancelled (AWB? move-to-date? failed_pushes row?).
2. **A2 is a product decision, not a bug** — needs Love/Aqib to rule whether "Picked up"/"Reattempt" must be distinct before any code expands the status model + brief §3.1.10 mapping table.
3. **A3 needs Aqib's surface + photo age** — uncovered-admin (fixable) vs vendor-dead >7-day (needs the deferred durable-capture lane).
4. **A4 manual-refresh-vs-reload ambiguity** — the recommended confirming probe is a read-only SF asset-tracking GET for zoro's in-motion AWBs; not run here (no unprompted live SF call in a diagnosis-only session).

**No plan-PR opened. No src/ touched. Reviewer consolidates these into one plan.**
