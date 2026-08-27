# Plan — Consolidated UAT remediation (decks 1 + 2)

**Type:** T3 plan-PR (PLAN ONLY — no `src/` change, no migration created, no SF mutation). **Filed:** 2026-06-21 (Day-56). **Anchored to:** `main` @ `f181845` (working tree byte-identical to `origin/main` for `src/`; all citations @ this SHA). **Brief:** v1.29. **Diagnosis basis:** `memory/diagnostic_uat_issues_2_0.md` (PR #531) + the read-only probes recorded inline below.

**Scope:** EIGHT workstreams across two Aqib UAT decks (`Issue_file.pptx` = deck 1, `issues_2_0.pptx` = deck 2) + QStash poll registration. Standing rulings honored: POD on BOTH surfaces; every SF status surfaced distinctly (no collapse); QStash registration authorized; F2-generic out of scope (#521); deriveAwb bare-AWB defect parked.

> **§3.6 hard-stop:** this is the plan-PR round. Reviewer body-reads at the pinned head SHA and rules BEFORE any code-PR opens. CI/test N/A for a plan-PR (read-only probes were run; results inline). No code-PRs opened from this dispatch.

---

## Phase table

| # | Workstream | Deck | Status after probe | Code bug? | Gating |
|---|---|---|---|---|---|
| 1 | Label "Fleet overview" → "Operations overview" | 1 s2 | **String does not exist on main** — likely already shipped (#394) | No | OQ-1 (confirm target) |
| 2 | F4 per-merchant asset-tracking toggle "missing" | 1 s3-4 | **Toggle SHIPPED** on `/admin/merchants/[id]`, not on `/edit` — discoverability | No (UX) | OQ-2 |
| 3 | A1 — creation delivery-note never pushes to SF | 2 | **Confirmed bug** (read-but-never-pushed) | Yes | none — ship early |
| 4 | POD icon "gone" — both surfaces | 2 (A3) | Icon NOT removed (folded into Actions #427); `/admin/tasks` raw-URL broken | Yes (admin) + UX (tasks) | OQ-3, OQ-4 |
| 5 | Override-22nd cancel not reaching SF | 1 s5-6 | Move-to-date flips `pending_cancel`, **never enqueues** → original stranded on SF | Yes (in effect) | OQ-5 |
| 6 | Churn — SF cancelled, Planner did not | 1 s7-9 | **Historical timing-gap** (pre-#521); 3 tasks data-stranded | No (code) — data repair | OQ-6 (named SQL) |
| 7 | AWB MLU-21789001 classification | cross | Resolves to JOY BOY: Phase-5 SKIPPED task, fine; siblings = Phase 6 | No | n/a |
| 8 | A2 — surface every SF status distinctly | 2 | Scope expansion: 8 new statuses × 16 surfaces + migration + brief | Yes (product) | OQ-7..OQ-11 |
| Q | QStash */30 bag-poll registration | — | Authorized; not in vercel.json; script ready; QStash tier-independent | Infra | parks for token |

---

## PHASE 1 — Label "Fleet overview" → "Operations overview"

**Probe result:** `grep -rni "fleet overview" src/` → **zero hits.** The string does not exist on main. Current state:
- Admin nav already reads **"Overview"** → `/admin/calendar` ([admin/nav-config.ts:181](../../src/app/(admin)/admin/nav-config.ts#L181)) — the Calendar→Overview rename shipped in #394.
- Page `<h1>` already renders **"Operations overview"** ([calendar/page.tsx:230](../../src/app/(app)/calendar/page.tsx#L230) admin branch; [admin/calendar/page.tsx:91](../../src/app/(admin)/admin/calendar/page.tsx#L91)).
- Only "Fleet" residue: code comments + one non-visible `aria-label="Fleet metrics"`.

**Conclusion:** Deck 1 slide 2 predates #394; the rename appears **already done**. **Scope-literal stop** — the named string isn't present; not re-scoping.

- **Scope/files:** none unless OQ-1 redirects. **Schema:** none. **Test:** none (or a copy assertion if a residual surfaces). **Brief:** §3.2.1, §3.3.9.

---

## PHASE 2 — F4 per-merchant asset-tracking toggle "missing"

**Probe result — classification (a): toggle SHIPPED and works; Aqib looked in the wrong place.**
- Service `setMerchantAssetTracking` gate `merchant:update` ([modules/merchants/service.ts:629](../../src/modules/merchants/service.ts#L629)).
- UI control IS wired: `AssetTrackingToggle` ([admin/merchants/[id]/_components/AssetTrackingToggle.tsx](../../src/app/(admin)/admin/merchants/[id]/_components/AssetTrackingToggle.tsx), button "Enable for this merchant" when off) → action `setAssetTrackingAction` ([_actions.ts:29](../../src/app/(admin)/admin/merchants/[id]/_actions.ts#L29)) → service. Rendered in the "Asset tracking" `<Section>` on the merchant **detail** page ([admin/merchants/[id]/page.tsx:236-255](../../src/app/(admin)/admin/merchants/[id]/page.tsx#L236-L255)), `canEdit`-gated to `merchant:update`.
- The toggle is NOT on the **edit** page (`/admin/merchants/[id]/edit` renders only `EditMerchantForm`). Aqib clicked "Edit merchant" and found no toggle.
- "Asset tracking is not enabled" copy is the merchant/admin Inventory-page guard ([reports/inventory/page.tsx:95](../../src/app/(app)/reports/inventory/page.tsx#L95); [admin/inventory/page.tsx:137](../../src/app/(admin)/admin/inventory/page.tsx#L137)), shown when the flag is false — exactly what a dark/unlit tenant sees.

**Fix shape (per OQ-2):** Either (a) document + tell Aqib where it lives (zero code), or (b) add a discoverability pointer/duplicate control on the edit page. Recommend **(b)-lite**: surface the toggle (or a read-only "Asset tracking: Disabled — manage on detail page" link) on the edit page, since operators expect merchant config in the edit flow.
- **Files (if b):** `admin/merchants/[id]/edit/page.tsx` + reuse `AssetTrackingToggle`. **Schema:** none. **Test:** RTL render assertion the control appears on edit. **Brief:** §3.1.4, §3.2.1, v1.28.

---

## PHASE 3 — A1: creation delivery-note never pushes to SF (CONFIRMED BUG)

**Root cause (diagnosed, PR #531):** `consignees.delivery_notes` is captured at creation and written ([modules/consignees/repository.ts:159-172](../../src/modules/consignees/repository.ts#L159-L172)) but **never read** into any outbound payload. The push-snapshot SELECT omits the column (`SELECT id, name, phone, email, address_line, emirate_or_region, district FROM consignees`, [task-push/service.ts:~509](../../src/modules/task-push/service.ts)); the task-create wire builder sets `notes` from `task.notes ?? undefined` ([:271-307](../../src/modules/task-push/service.ts)); and materialization inserts no `notes` ([task-materialization/service.ts:293-338](../../src/modules/task-materialization/service.ts)) → materialized tasks carry `notes = NULL`. The working R3 path rides `tasks.notes` via `addNoteToDriver` + `enqueueUpdateTask({patch:{notes}})`.

**Fix shape:** bridge `consignees.delivery_notes` → `tasks.notes` so the note rides the EXISTING outbound. Two injection points (OQ — minor, builder's call):
- **(A) materialization-time copy** — when materializing a task, default `tasks.notes` from the consignee's `delivery_notes`. Durable; the note becomes part of the task and also shows in Planner task views. Touches the materializer INSERT.
- **(B) push-time read** — add `delivery_notes` to the `ConsigneePushSnapshot` SELECT and pass `consignee.deliveryNotes ?? task.notes` as the wire `notes`. No DB write; note stays consignee-level.

Recommend **(A)** — it makes the note a first-class task attribute (visible in `/tasks`, editable, and consistent with R3 which also lives on `tasks.notes`). One nuance: per-task R3 edits must win over the consignee default (only seed when `tasks.notes IS NULL`).
- **Files:** `task-materialization/service.ts` (INSERT), the push snapshot if (B); add `delivery_notes` to the materializer source SELECT. **Schema:** none (column exists). **Test:** RED-first — (1) create consignee with note → materialize → assert `tasks.notes` seeded; (2) assert wire `task-resource:create` payload carries the note; (3) R3 per-task note override is not clobbered. **Brief:** §3.1.4 (createConsignee), §3.3.6, R3 `task.note_pushed_to_external`.

---

## PHASE 4 — POD icon "gone" — history investigation + both-surface restore

**Probe result (git history — the icon was NOT removed):**
- POD column originally added `dd9d120` (#206, Day-19) as a dedicated `<Th>POD</Th>` column.
- `f0c6d2a` (promoted `dd45f67`, #427 R6-part-1) **folded POD into the Actions cell** and dropped the dedicated column — INTENTIONAL per Love's Ruling-2 #414 ("POD folded into Actions").
- Current `/tasks`: `PodCell` ([tasks/client.tsx:434, 906-944](../../src/app/(app)/tasks/client.tsx#L906-L944)) renders a **muted bag SVG** (40% opacity) for rows without photos and a clickable active icon for rows with photos. `PodIcon` is an **inline SVG** — a broken S3 URL cannot hide it.

**TRUE cause of "icon gone":** two compounding factors, NOT removal and NOT the S3 issue —
1. `/tasks` **default date filter = today** ([tasks/page.tsx:102-106](../../src/app/(app)/tasks/page.tsx#L102-L106)); DELIVERED rows (the only ones with POD) are mostly past-dated → hidden in the default view, so an operator sees only muted ghosts.
2. POD is **visually buried** in the Actions cell with no column header (post-#427 fold), so even an active icon is easy to miss.

**Admin surface (`/admin/tasks`):** icon renders fine, but `AdminPodCell` passes **raw S3 URLs** to the lightbox ([AdminPodCell.tsx:42](../../src/app/(admin)/admin/tasks/_components/AdminPodCell.tsx#L42)) — no `podProxyPhotoPaths`. Clicking an older DELIVERED row opens a broken/403'd image. The operator `/tasks` surface already routes through the proxy ([tasks/client.tsx:~933](../../src/app/(app)/tasks/client.tsx)).

**Fix shapes:**
- **4a (`/tasks` visibility — OQ-3):** the icon exists but is undiscoverable. Conflicts with the #414 fold ruling, so it needs Love. Options: (i) restore a dedicated POD column (reverts #414); (ii) keep the fold but add a labeled affordance/tooltip; (iii) leave layout, change the default filter so DELIVERED+POD rows are visible. Recommend **(ii)** — least disruptive, honors #414, makes the bag discoverable (column micro-label + tooltip on muted icon).
- **4b (`/admin/tasks` broken image — confirmed bug, no ruling needed):** route the admin cell through the proxy — at [AdminPodCell.tsx:42](../../src/app/(admin)/admin/tasks/_components/AdminPodCell.tsx#L42) use `podProxyPhotoPaths(task.id, task.podPhotos)` + import. The proxy already enforces tenant scope via `buildRequestContext`. One-liner + import. Ship early.
- If Aqib's specific photo is also >7-day vendor-dead (S3 sig expired), that is the **separate durable-capture** follow-on (`followup_pod_broken_image_pre_existing.md` deferred item 1) — do NOT scope here unless his photo proves stale (OQ-4).
- **Files:** 4a `tasks/client.tsx` + maybe `page.tsx`; 4b `AdminPodCell.tsx`. **Schema:** none. **Test:** 4b RTL — admin POD cell `<img src>` resolves to `/api/tasks/.../pod/...`. **Brief:** §3.3.6, §3.3.8 (cache-from-webhook), §3.3.11.

---

## PHASE 5 — Override-22nd cancel not reaching SF

**Probe result:** "Override to the 22nd" = the **move-to-date** skip variant (`target_date_override` set). `isMoveToDate` is computed true ([subscription-exceptions/service.ts:~723-725](../../src/modules/subscription-exceptions/service.ts#L723)); `markTaskSkipped` still flips the original task to `outbound_sync_state='pending_cancel'`, but the enqueue gate **excludes move-to-date** (`!isMoveToDate`, [:815-819](../../src/modules/subscription-exceptions/service.ts#L815-L819)) → **no `enqueueCancelTask` fires.** The comment ([:803-807](../../src/modules/subscription-exceptions/service.ts#L803)) parks move-to-date outbound on the SF `rescheduleTask` wire contract (Aqib-gated, Phase-2).

**Effect (the real bug):** the original task is left UNCANCELED on SF while the compensating task at the target date materializes and pushes → SF holds BOTH = double delivery. Plus the original sits in a **stuck `pending_cancel`** locally with nothing to resolve it (only an unrelated event like a churn clears it — exactly what happened to MLU-21789001).

**Variant behavior (confirmed):**
| Variant | `pending_cancel` flip | `enqueueCancelTask` |
|---|---|---|
| default skip | yes | yes (AWB present) ✅ |
| skip-without-append (cancel-only) | yes | yes (AWB present) ✅ |
| move-to-date (`target_date_override`) | yes | **no** ❌ (parked) |

**Fix shape (OQ-5):**
- **(a) cancel-now:** for move-to-date, ALSO fire `enqueueCancelTask` on the original (it genuinely needs canceling; the compensating task pushes fresh as the "moved" delivery). Reuses the proven cancel path — **unblocks today, no SF rescheduleTask needed.** Add an `else if (isMoveToDate && skippedTask?.externalTrackingNumber)` branch.
- **(b) reschedule:** implement SF `task-resource:reschedule` (brief §3.1.11) — "proper" reschedule, but **Aqib-gated** on the wire contract.
- Recommend **(a)** now + keep (b) as a later refinement. Either way, the stuck-`pending_cancel` hygiene must be fixed (don't flip `pending_cancel` for a path that never enqueues, OR enqueue).
- **Files:** `subscription-exceptions/service.ts`. **Schema:** none. **Test:** RED-first — move-to-date on a pushed task enqueues a cancel for the original + no stuck `pending_cancel`. **Brief:** §3.1.4 step 10, §3.1.6 (target_date_override), §3.1.11.

---

## PHASE 6 — Churn: SF cancelled, Planner did not (INBOUND reflection)

**Probe result — classification (a)-historical: webhook ARRIVED, pre-#521 applier didn't read `status`.** Distinct from Phase 5 (this is inbound, not outbound).
- Churn cascade is correct: `changeConsigneeCrmState` CHURNED → `cancelConsigneeTasksForChurn` ([tasks/repository.ts:1731-1757](../../src/modules/tasks/repository.ts#L1731-L1757)) sets pushed tasks `pending_cancel` WITHOUT flipping `internal_status` (honesty rule v1.26); post-commit `enqueueBulkCancelTasks` ([consignees/service.ts:784](../../src/modules/consignees/service.ts#L784)).
- DB evidence (read-only): consignee **JOY BOY** (tenant `mlp`) churned 2026-06-19 15:32:50Z; 4 recalls. SF returned CANCELED via `TASK_HAS_BEEN_UPDATED` (`status=CANCELED`) at 15:32:52-53Z — present in `webhook_events`. All 4 tasks now `outbound_sync_state='synced'` (SF accepted recall) but:

  | AWB | internal_status | SF truth | delivery_date |
  |---|---|---|---|
  | MLU-12656969 | **CREATED** | CANCELED | 2026-06-25 |
  | MLU-98710980 | **CREATED** | CANCELED | 2026-06-24 |
  | MLU-26959517 | **CREATED** | CANCELED | 2026-06-23 |
  | MLU-21789001 | SKIPPED | CANCELED | 2026-06-22 |

- **Root cause:** #521 (`3adc90f`, reads master `status`) promoted **2026-06-20** (`fe79bf0`) — NOT live when the webhooks arrived 2026-06-19. Pre-#521 code saw no column diff and returned `no_diff`. The webhooks are stored but there is no replay mechanism. **#521 fixes this going forward** (verified: F2-generic covered, behavioural re-verify only).

**Conclusion:** NO ongoing code bug. The 3 CREATED tasks are **data-stranded** and will not self-heal. MLU-21789001 stays SKIPPED (operator-local, webhook-protected — correct).

**Fix shape (OQ-6 — PARKS for Love's named SQL):** data reconciliation only —
```sql
-- READ-ONLY here; this is the WRITE that parks for Love's named authorization
UPDATE tasks SET internal_status='CANCELED', updated_at=now()
 WHERE id IN ('<MLU-12656969 id>','<MLU-98710980 id>','<MLU-26959517 id>')
   AND tenant_id='d875f4ad-0e6e-47c7-8691-44291f1079d1';
```
**Broader connection:** these 3 are a SUBSET of the larger pre-#521 stranded-task population catalogued in `followup_inbound_status_webhook_master_payload.md` (~100 tasks across demo-bistro / meal-plan-scheduler / mlp). Recommend folding this into that memo's **parked backfill** (option 2: authoritative SF fetch per task — most accurate) rather than a one-off UPDATE, so the whole stranded set heals once, under one named authorization. **No code change.** **Brief:** §3.1.4 churn cascade v1.26, §3.1.2.

---

## PHASE 7 — AWB MLU-21789001 classification

**Probe result:** task `864f231e`, tenant `mlp` (Meal Up), consignee **JOY BOY**, `internal_status=SKIPPED`, `outbound_sync_state=synced`, delivery_date 2026-06-22. No stuck `pending_cancel`, no DLQ row.
- **Belongs to Phase 5** (move-to-date override on the 22nd → compensating 29th) AND incidentally **Phase 6** (JOY BOY was churned; the churn's recall canceled it on SF → synced). Planner correctly keeps SKIPPED (webhook-protected). **No fix needed for this AWB** — it's the example that led to JOY BOY's 3 genuinely-stranded siblings (Phase 6). **Brief:** n/a.

---

## PHASE 8 — Surface every SuiteFleet status distinctly (SCOPE EXPANSION — heavy, LAST)

Love's ruling: **no collapsing** — every SF status maps to its own visible Planner status.

### 8.1 Canonical SF status set (from code @f181845 — zero drift vs brief §3.1.10)
14 lifecycle actions collapse into 7 internal states today ([status-mapper.ts:59-90](../../src/modules/integration/providers/suitefleet/status-mapper.ts#L59-L90)); the master `status` VALUE map mirrors them ([status-progression.ts:31-48](../../src/modules/integration/providers/suitefleet/status-progression.ts#L31-L48)). Collapses to undo:
- **IN_TRANSIT bucket (5→):** ARRIVED_ON_DC (value `ARRIVED_IN_DC`), PICKED_UP, IN_TRANSIT, HUB_TRANSFER, OUT_FOR_DELIVERY.
- **FAILED bucket (3→):** FAILED, PROCESS_FOR_RETURN, RETURNED_TO_SHIPPER.
- **ON_HOLD bucket (2→):** REATTEMPT, RESCHEDULED.
- 1:1 already: ORDERED→CREATED, ASSIGNED, DELIVERED, CANCELED.
- `TASK_HAS_BEEN_UPDATED` stays non-lifecycle (edit event). No `shipmentPackages[].packageStatus` handling exists.

### 8.2 Proposed expanded `TaskInternalStatus` (per no-collapse ruling)
Current 8: CREATED, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED, CANCELED, ON_HOLD, SKIPPED ([tasks/types.ts:44-52](../../src/modules/tasks/types.ts#L44-L52)).
Proposed 8 NEW values: `ARRIVED_AT_DC`, `PICKED_UP`, `HUB_TRANSFER`, `OUT_FOR_DELIVERY`, `PROCESS_FOR_RETURN`, `RETURNED_TO_SHIPPER`, `REATTEMPT`, `RESCHEDULED`. → full set 15 SF-derived + SKIPPED.
- **ON_HOLD retirement:** becomes the collapse target of nothing once REATTEMPT/RESCHEDULED exist. Existing `ON_HOLD` rows cannot be retroactively split → keep ON_HOLD as a legacy value in the CHECK + backfill rule (OQ-9).
- **Genuine-merge candidates to flag (OQ-8):** PROCESS_FOR_RETURN + RETURNED_TO_SHIPPER (both post-failure return; lossiness tracked in `followup_internal_task_status_lossiness.md`); ARRIVED_AT_DC + HUB_TRANSFER (internal logistics waypoints — merchant may not care). Default = surface distinctly per ruling; Love can re-collapse.

### 8.3 Migration (NAME only — parks for Love's SQL)
`supabase/migrations/0035_tasks_internal_status_expand.sql` — DROP + re-ADD the `internal_status` CHECK (precedent: [0019_tasks_internal_status_skipped.sql](../../supabase/migrations/0019_tasks_internal_status_skipped.sql) widened [0006_task.sql](../../supabase/migrations/0006_task.sql)) with the full 15+SKIPPED list. Also update the integration-inbound type ([integration/types.ts:23-30](../../src/modules/integration/types.ts#L23-L30)) and the `UpdateTaskBodySchema` Zod enum ([tasks/schemas.ts:34](../../src/modules/tasks/schemas.ts#L34), which today also drops SKIPPED — fix that drift in passing).

### 8.4 Inbound mapper changes
Remap the 1:1 in `ACTION_TO_INTERNAL_STATUS` ([status-mapper.ts](../../src/modules/integration/providers/suitefleet/status-mapper.ts)) + `STATUS_VALUE_TO_INTERNAL` ([status-progression.ts](../../src/modules/integration/providers/suitefleet/status-progression.ts)). Revisit `shouldAdvanceStatus` LINEAR_RANK ([:82-86](../../src/modules/integration/providers/suitefleet/status-progression.ts#L82)) — the forward spine must learn the new in-transit sub-stages (ASSIGNED < ARRIVED_AT_DC < PICKED_UP < IN_TRANSIT < HUB_TRANSFER < OUT_FOR_DELIVERY?) so a lagging webhook can't regress (OQ-10 — the canonical SF ordering needs Aqib confirmation).

### 8.5 Surface inventory — EVERY status-rendering site (the bulk; 16 sites)
| # | Surface | File:line | Role | Break risk if not updated |
|---|---|---|---|---|
| S1 | operator `/tasks` filters + label | [tasks/status.ts:21-29](../../src/app/(app)/tasks/status.ts#L21-L29) | TASK_STATUS_FILTERS (7) | HIGH — raw enum, no pill, no filter |
| S2 | operator task row | [tasks/client.tsx:347,400-402](../../src/app/(app)/tasks/client.tsx#L347) | label+pill | MED (graceful) |
| S3 | status icon | [tasks/_components/StatusIcon.tsx:27-43](../../src/app/(app)/tasks/_components/StatusIcon.tsx#L27-L43) | icon switch (7) | HIGH — TS switch |
| S4 | calendar day view | [calendar/_components/ConsolidatedDayView.tsx:43-77](../../src/app/(app)/calendar/_components/ConsolidatedDayView.tsx#L43-L77) | STATUS_VISUALS (7) + fallback | LOW (renders "Unknown") |
| S5 | subscription task list | [subscriptions/[id]/_components/SubscriptionTasksList.tsx:130-149](../../src/app/(app)/subscriptions/[id]/_components/SubscriptionTasksList.tsx#L130-L149) | StatusBadge switch, no default | HIGH — renders nothing |
| S6 | consignee calendar projection | [consignees/[id]/_components/DayDisplayStatus.ts:15-142](../../src/app/(app)/consignees/[id]/_components/DayDisplayStatus.ts#L15) | projects to display set; **exhaustiveness guard** | **WON'T COMPILE** (correct guard) |
| S7 | calendar legend | consignees/[id]/_components/CalendarStatusLegend.tsx | legend (6) | inherits S6 |
| S8 | month view | consignees/[id]/_components/CalendarMonthView.tsx | uses S6 | inherits S6 |
| S9 | year view | consignees/[id]/_components/CalendarYearView.tsx:226 | FAILED-density hardcode | LOW |
| S10 | day-action eligibility | consignees/[id]/_components/day-actions.ts:60-69 | MUTATION_ELIGIBLE / NOTE_TERMINAL sets | MED (semantic) |
| S11 | day-action popover | consignees/[id]/_components/DayActionPopover.tsx:700-703 | bool checks | LOW |
| S12 | history/timeline tone | consignees/[id]/_components/HistoryTab.tsx:139-149 | tone switch (4), no default | MED |
| S13 | admin `/admin/tasks` | admin/tasks/page.tsx:253,341,354-355 | reuses TASK_STATUS_FILTERS | MED |
| S14 | editability buckets | [modules/tasks/editability.ts:17-26](../../src/modules/tasks/editability.ts#L17-L26) | DRIVER_BOUND / TERMINAL sets | MED (semantic — assign each new status) |
| S15 | update schema | [modules/tasks/schemas.ts:34](../../src/modules/tasks/schemas.ts#L34) | Zod enum (7, missing SKIPPED) | HIGH if operator-settable |
| S16 | task-timeline drawer | components/task-timeline/TaskTimelineDrawer.tsx:76-86 | ACTION_LABELS (action vocab) | LOW (action codes, not status) |

**Semantic bucket assignments needed for each new status** (S10/S14): driver-bound? terminal? mutation-eligible? note-eligible? e.g. PICKED_UP/OUT_FOR_DELIVERY/HUB_TRANSFER/ARRIVED_AT_DC are driver-bound (freeze edits, like IN_TRANSIT); PROCESS_FOR_RETURN/RETURNED_TO_SHIPPER are terminal-ish; REATTEMPT/RESCHEDULED are NOT terminal (operator may still act).

### 8.6 Labels + colors (OQ-11 — Love rules display copy + brand color per new status)
Today: green=DELIVERED, amber=ASSIGNED/IN_TRANSIT, red=FAILED, stone/navy=CREATED/CANCELED/ON_HOLD ([brand-tokens.css](../../src/styles/brand-tokens.css); no per-status semantic tokens — colors are inline Tailwind per surface). Each new status needs: label copy, pill bg+text classes, StatusIcon case, consignee-calendar projection bucket, legend membership, HistoryTab tone. Palette is limited (green/amber/red/stone/navy) — 15 statuses need a richer scale or grouped tints (e.g. all in-transit sub-stages share amber tints with distinct labels). Recommend **grouped tints** (one hue family per lifecycle phase, distinct labels) to stay within the brand system.

### 8.7 Brief amendment
§3.1.10 needs a **mapping table** (SF status → internal status → label) added — requires a `decision_*.md` + a brief **version bump** to v1.30 in §9 (amendment protocol §10). **Brief:** §3.1.10, §3.3.6, §3.3.11.

---

## PHASE Q — QStash */30 bag-tracking poll registration (Love-authorized)

**Probe result:** `vercel.json` has only `generate-tasks` (daily) + `auto-resume` (daily); `asset-tracking-poll` is **absent** (correct — it must NOT be a Vercel cron). The registration tool `scripts/create-qstash-asset-poll-schedule.mjs` is ready, idempotent (schedule id `asset-tracking-poll-30m`), needs `QSTASH_TOKEN` + `PUBLIC_BASE_URL`, schedule `*/30 * * * *`. The route is QStash-signature-gated (`verifySignatureAppRouter`, existing keys, no new secret). **Architecture confirmed:** Upstash QStash is a SEPARATE scheduler POSTing to the endpoint on its own clock — it does **NOT** consume Vercel cron quota, so it fires independently of Vercel Hobby's daily-only cron limit. **Cost:** 48 msg/day ≪ 1,000/day free tier → **$0**.

**Plan (PARKS for Love's named authorization + token):** set `QSTASH_TOKEN` (+ `PUBLIC_BASE_URL`) in prod env → run the script once → verify the schedule fires (a poll tick ingests mlp's in-motion AWBs incl. zoro's). **No code change**; no `vercel.json` edit. **Latent dependency:** the `deriveAwb` truncation defect (`MLU-97015852`→`MLU`) is PARKED (needs multi-bag sample per standing ruling) — flag that even once polling runs, task-level drill-down/stale-detection may misbehave until that's fixed. **Brief:** v1.28.

---

## Open questions (each with ONE recommendation)

- **OQ-1 (Phase 1):** "Fleet overview" doesn't exist on main; admin already reads "Overview"/"Operations overview". Is the rename **already satisfied**, or is there a different label Aqib means? → **Rec:** treat as DONE; confirm against current prod with Aqib; no code.
- **OQ-2 (Phase 2):** F4 toggle lives on the merchant **detail** page, not **edit**. Doc-only, or surface on edit too? → **Rec:** add a discoverability pointer/control on the edit page (small UI).
- **OQ-3 (Phase 4a):** `/tasks` POD icon is present-but-buried (post-#414 fold). Restore dedicated column (reverts #414), add affordance/tooltip, or change default filter? → **Rec:** keep the fold, add a labeled affordance + tooltip (honors #414, fixes discoverability).
- **OQ-4 (Phase 4):** Is Aqib's specific POD photo also >7-day vendor-dead? → **Rec:** get the AWB/date from Aqib; if stale, route to the deferred durable-capture follow-on, not this lane.
- **OQ-5 (Phase 5):** Move-to-date original-cancel — fix now via existing cancel path (a), or wait for SF rescheduleTask (b)? → **Rec:** (a) now; (b) later. Also stop flipping `pending_cancel` on a path that never enqueues.
- **OQ-6 (Phase 6):** Reconcile the 3 stranded JOY BOY tasks — one-off UPDATE, or fold into the broader pre-#521 backfill (`followup_inbound_status_webhook_master_payload.md`)? → **Rec:** fold into the broader backfill (authoritative SF fetch), one named-SQL authorization heals the whole set. PARKS for Love's named write.
- **OQ-7 (Phase 8):** Confirm the full no-collapse expansion (8 new statuses) is the intent vs a smaller subset Aqib actually needs surfaced. → **Rec:** confirm the subset Aqib cares about first (likely PICKED_UP + OUT_FOR_DELIVERY + REATTEMPT vs RESCHEDULED); ship those, defer pure-internal waypoints.
- **OQ-8 (Phase 8):** Keep PROCESS_FOR_RETURN/RETURNED_TO_SHIPPER and ARRIVED_AT_DC/HUB_TRANSFER distinct, or merge? → **Rec:** surface distinctly per ruling; revisit if noisy.
- **OQ-9 (Phase 8):** Existing `ON_HOLD` rows can't be retro-split into REATTEMPT/RESCHEDULED. Keep ON_HOLD as legacy, or backfill to a default? → **Rec:** keep ON_HOLD as legacy in the CHECK; new events use the specific values; no destructive backfill.
- **OQ-10 (Phase 8):** Canonical SF lifecycle ORDER for the monotonic guard's forward spine (where do ARRIVED_AT_DC / HUB_TRANSFER sit)? → **Rec:** get the authoritative ordering from Aqib/SF docs before wiring LINEAR_RANK.
- **OQ-11 (Phase 8):** Label copy + brand color per new status. → **Rec:** grouped hue-family tints (one family per lifecycle phase) with distinct labels, within the existing brand palette; Love rules final copy.

---

## Code-PR breakdown (proposed sequencing)

**Wave 1 — independent, no ruling, ship first (small, parallelizable):**
1. **PR-A — Phase 3 (A1 note bridge).** Confirmed bug; no schema; RED-first tests.
2. **PR-B — Phase 4b (`/admin/tasks` POD proxy one-liner).** Confirmed bug; trivial.

**Wave 2 — gated on a single ruling each (open once OQ answered):**
3. **PR-C — Phase 2 (F4 toggle discoverability)** — gated OQ-2.
4. **PR-D — Phase 4a (`/tasks` POD visibility)** — gated OQ-3 (#414 conflict).
5. **PR-E — Phase 5 (move-to-date cancel)** — gated OQ-5.

**Non-code / parked (no PR):**
- **Phase 1** — confirm-and-close (OQ-1), likely no PR.
- **Phase 6** — data-repair SQL, parks for named authorization (OQ-6); fold into the broader backfill.
- **Phase Q (QStash)** — env+script run, parks for token.

**Wave 3 — heavy lane LAST (Phase 8), sequenced internally, each gated:**
6. **PR-F1 — enum + migration 0035 + brief v1.30 amendment** (migration parks for SQL; needs OQ-7/8/9).
7. **PR-F2 — inbound mapper + shouldAdvanceStatus spine** (needs OQ-10).
8. **PR-F3 — surface sweep** (16 sites; the bulk; needs OQ-11 labels/colors). Split by surface cluster if large (tasks/admin cluster; consignee-calendar cluster).

**Sequencing rationale:** Wave 1 closes two real defects immediately. Wave 2 unblocks on quick rulings. Phase 8 ships last because it touches a DB constraint (named SQL), the brief (version bump), and 16 render sites — the largest blast radius and the most ruling-dependent.

---

## Scope-literal stops
1. **Phase 1** — named string "Fleet overview" does not exist on main; not re-scoped (OQ-1).
2. **Phase 6** — the fix is a live-DB write (data repair); parks for Love's named SQL authorization (OQ-6). No code.
3. **Phase 8 migration 0035** — named, not created; parks for Love's named SQL. Brief amendment to v1.30 parks on the decision memo.
4. **Phase Q** — `QSTASH_TOKEN` secret-set + script run park for Love's named authorization.
5. **deriveAwb bare-AWB defect** — remains parked (needs multi-bag sample) per standing ruling; flagged as a latent dependency of Phase Q.
