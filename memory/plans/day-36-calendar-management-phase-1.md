# Day-36 T3 plan-PR — calendar-management lane Phase 1 (outbound symmetry: R1+R2+R3+R4+R5)

**Tier:** T3 plan-PR (docs-only).  Plan-PR persistence — stays OPEN until all five Phase-1 code-PRs (R1, R2, R3, R4, R5) ship end-to-end.
**Pinned head SHA:** `9b9f7ba82b146e5c4ea3a594434a3748efb7f9ac` (main HEAD at plan-PR open).
**Branch:** `plan/d36-calendar-management-phase-1`.
**Lane source-of-truth:** [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](../diagnostic_calendar_management_full_surface_enumeration.md) — 17 R-items locked as product decisions across PR #324 (AM diagnostic), PR #325 (R6/R7 amendment), PR #331 (R1-R10 + sub-rulings), plus R11 (POD-shape-e fold) + R12 (resolved-rows visibility fold) ruled at lane-open Day-36.

> **Day-anchor note.** This plan-PR was initially mis-anchored as "Day-34" carrying the framing forward from the Day-33 EOD handoff §G ("Tomorrow's open thread" text), without reality-checking against the calendar. Actual calendar: Day-34 = 2026-05-23 (Sat); Day-35 = 2026-05-24 (Sun); **Day-36 = 2026-05-25 (Mon, today)**. Branch + filename + day-references re-anchored on commit immediately following the original plan body commit (`3c14fcd`). Discipline lesson: this is a second reviewer-side "Verify framing against the running product, not against prior framing" failure (Rule B per [`memory/feedback_verify_framing_against_running_product.md`](../feedback_verify_framing_against_running_product.md) §2, merged at `b417a60`).

---

## §1 Scope

### Phase 1 — IN-SCOPE today (5 R-items, sequential code-PRs)

| R-item | Ruling (locked) | Sub-PR | Sizing |
|---|---|---|---|
| **R1** | (c) on-demand cron trigger — additive primitive; scheduled 16:00 daily tick unchanged | PR-1 | T3 medium-large |
| **R2** | (a) build pause SF cancel fan-out via `enqueueBulkCancelTasks` | PR-2 | T3 structural |
| **R3** | (a) addNoteToDriver SF push via single `enqueueUpdateTask` (notes-field on update body) | PR-3 | T3 small-medium |
| **R4** | (a) one-off address override — backfill in-horizon task `address_id` + single `enqueueUpdateTask` | PR-4 | T3 small-medium |
| **R5** | (a) forward address override scoped to subscription — fan-out via `enqueueBulkUpdateTasks` + subscription-level write + confirmation pop-up | PR-5 | T3 medium |

### Lane-level enumeration — all 17 R-items with phase placement

The plan-PR captures the full lane shape so reviewers see what is NOT in this phase. Phases 2 and 3 each open their own T3 plan-PR after the prior phase closes.

| R-item | Topic | Phase | Reasoning |
|---|---|---|---|
| R1 | On-demand cron trigger | **Phase 1** | Outbound-symmetry primitive; also serves the existing skip-tail cron-deferral surface. |
| R2 | Pause SF cancel fan-out | **Phase 1** | Reuses outbound publisher. |
| R3 | addNoteToDriver SF push | **Phase 1** | Reuses outbound publisher. |
| R4 | One-off address override + SF push | **Phase 1** | Reuses outbound publisher. |
| R5 | Forward address override + SF push | **Phase 1** | Reuses outbound publisher. R5's future-horizon UX enhanced by R1 but not gated on R1 (see §2.R5 dependency check). |
| R6.1+R6.2 | `/tasks` 9-column Date-first layout | **Phase 2** | UI + repository-projection; orthogonal to outbound infra. |
| R6.3 | AWB-click partial-state drawer on null-AWB | **Phase 2** | UI conditional render. |
| R6.4 | Consignee-block click target | **Phase 2** | UI styling + onClick. |
| R7.1 | Calendar default tab for all roles | **Phase 2** | Server-side default-tab resolver. |
| R7.2 | Month default view (no code change — reality matches) | **Phase 2** | T0; documented in Phase 2 plan-PR for completeness. |
| R7.3 | Deep-link param wins + Week→Month fallback | **Phase 2** | View-mode parser fallback. |
| R7.4 | Empty-state Overview fallback | **Phase 2** | Default-tab branching on subscription/task count. |
| R12 (NEW) | Resolved-rows visibility — separate `/resolved` route | **Phase 2** | UI-layer admin surface; pairs cleanly with R6/R7 read-side work. |
| R8 | Task-scoped audit timeline in AWB-click drawer | **Phase 3** | First operator-facing audit surface; view-mode UX. |
| R9 | Full Week-view removal (not UI-hide) | **Phase 3** | View-toggle + render-path deletion. |
| R10 | Year-view heatmap proper render | **Phase 3** | New aggregate query + heatmap render. |
| R11 (NEW) | POD broken-image shape (e) — Planner proxy | **Phase 3** | Calendar-cell visual indicator (Axis 1.5); render-layer surface. |

### Lane-membership rulings (NEW R-items folded today)

#### R11 — POD broken-image shape (e)

**Origin:** [`memory/followup_pod_broken_image_pre_existing.md`](../followup_pod_broken_image_pre_existing.md) + PR #330 Network-diagnostic amendment. Failing render is an AWS S3 pre-signed URL (`X-Amz-Expires=604800`, SigV4); within-TTL renders also fail via `ERR_BLOCKED_BY_RESPONSE`. Root cause is structural mismatch between SF's short-TTL signed-URL contract and Planner's verbatim-storage-and-render model.

**Three fix paths from memo:**
1. **Planner proxy** — server-side `/api/pod-images/[task_id]/[index]` route fetches from S3 at render time.
2. **Re-sign on read** — Planner checks TTL + refreshes by calling SF.  *Aqib-gated* (SF re-sign endpoint existence unconfirmed).
3. **Download + re-host on webhook** — Planner mirrors S3 photo to its own bucket on `TASK_STATUS_UPDATED_TO_DELIVERED` webhook receipt.

**Phase 1 recommendation: Path 1 (Planner proxy).** Trade-offs:
- *Pros:* no Aqib dependency (matters per lane-open ruling — Aqib does not gate plan-PR or non-Path-2 code); no webhook handler latency increase; no backfill migration for the ~10 production rows with stored URLs already past expiry; durable forever (Planner re-fetches at render time regardless of S3 signature state).
- *Cons:* bandwidth + latency cost on every POD render; new tenant-scoped authenticated route shape; needs Cache-Control + likely CDN fronting later if usage grows.
- *Counter-case for Path 3 (download + re-host):* the storage cost is real (POD photos accumulate indefinitely) and webhook handler latency bump is non-trivial (download + upload synchronously or async-via-QStash adds complexity). Path 1 is cleaner architecturally — Planner stays a thin proxy, S3 stays the source of truth at write time, Planner becomes the durable source at render time.

**Phase placement: Phase 3** (calendar-cell visual indicator — sits alongside R8 audit timeline + R10 heatmap as view-mode UX work).

**Schema:** no migration. `tasks.pod_photos` column stores URLs as today.

#### R12 — Resolved-rows visibility gap

**Origin:** [`memory/followup_resolved_rows_visibility_gap.md`](../followup_resolved_rows_visibility_gap.md). After PR-D's bulk-resolve tooling shipped, 19 production rows have `resolved_at` populated but no UI path renders them. `failed_push.bulk_resolved` audit events fire correctly but no operator audit viewer exists.

**Three resolution paths from memo:**
A. **Toggle on existing route** — `?status=resolved|unresolved|all` filter.
B. **Separate `/resolved` route** — purpose-built read-only review surface.
C. **Operator-facing audit log viewer** — broader scope; tangents R8's task-scoped timeline.

**Phase 1 recommendation: Path B (separate `/resolved` route).** Trade-offs:
- *Pros:* clean separation of mental models (work-queue vs review-log). Purpose-built columns (`resolved_at`, `resolved_by`, `resolution_notes` shown; bulk-resolve / retry actions absent). Default sort = `resolved_at DESC` for recency. Discoverable via "View resolved →" link on the work-queue page.
- *Cons:* extra route + nav entry; two routes to maintain (the work-queue stays unchanged).
- *Counter-case for Path A:* mental-model tangle is real — "Resolve selected" / "Retry selected" actions are meaningless on resolved rows and need conditional hiding; columns change meaning by mode; pagination + filtering compound. Not worth the small scope save.
- *Counter-case for Path C:* audit-log viewer is the right long-term direction (R8 task-scoped timeline is the same direction at a per-task scope) but too broad for a single R-item under this lane. Path C is naturally the post-Phase-3 follow-on.

**Phase placement: Phase 2** (same UI/read-side admin surface family as R6 cross-surface navigation work).

**Schema:** no migration. `failed_pushes.resolved_at` / `resolved_by` / `resolution_notes` columns already populated.

---

## §2 Implementation surfaces enumerated by R-item

### R1 — On-demand cron trigger

**Service-layer entry:** new function in [`src/modules/task-materialization/service.ts`](../../src/modules/task-materialization/service.ts) — exposes `materializeTenant` (already exists; current invoker = cron handler at [`src/app/api/cron/generate-tasks/route.ts:1-487`](../../src/app/api/cron/generate-tasks/route.ts)) as an additive on-demand invocation primitive. Operator-action handlers invoke it after committing the triggering exception row.

**First consumer surface (this PR):** skip-tail-end reinsertion existing flow at [`src/modules/subscription-exceptions/service.ts:481-538`](../../src/modules/subscription-exceptions/service.ts). Today the materialization of the tail task is deferred to next cron tick; post-R1, the operator-action handler calls the on-demand primitive synchronously (or async-via-QStash — see §5 OQ-2).

**Concurrency guard (load-bearing §3.6 #2 watch surface per handoff):** on-demand invocation must not collide with the scheduled 16:00 daily tick. The materializer's existing idempotency (Day-14 Phase 5 design) is load-bearing — verify under on-demand invocation. Test surface = a concurrent-trigger integration spec firing on-demand + scheduled within the same wall-clock window.

**Cron-equivalent invocation shape:** SYNCHRONOUS in-request OR async-via-QStash. Sync = simpler latency story for operator (calendar reflects on next page-load); async = non-blocking but introduces sub-second-to-seconds delay. **OQ-2 surfaces this for §3.6 #1 ruling.**

**Audit:** new event `cron.on_demand_invoked` (operator UUID + subscription_id + triggering action type). Event registration via [`src/modules/audit/event-types.ts`](../../src/modules/audit/event-types.ts).

**No schema delta.**

### R2 — Pause SF cancel fan-out

**Service-layer entry:** extend `pauseSubscription` at [`src/modules/subscriptions/service.ts:672-875`](../../src/modules/subscriptions/service.ts). After `markTasksCanceledInWindow` completes, enqueue SF cancels via existing `enqueueBulkCancelTasks` at [`src/modules/task-outbound-queue/publish.ts:277`](../../src/modules/task-outbound-queue/publish.ts).

**Repository change:** extend `markTasksCanceledInWindow` at [`src/modules/tasks/repository.ts:1403`](../../src/modules/tasks/repository.ts) to set `outbound_sync_state='pending_cancel'` on cancelled-in-window tasks that have `external_tracking_number IS NOT NULL` (matches the existing `markTaskSkipped` pattern at line 1354). This makes the existing outbound_sync_state badge light up for paused tasks (diagnostic A1.5 needs-ruling resolved).

**Outbound payload:** `BulkCancelPayload` already accepts per-task `correlation_id` + `tenant_id` (publisher's existing contract); cancel-task worker route reuses Day-29 §D(2) publish→consume→ack pipeline unchanged.

**Audit:** existing `subscription.paused` event keeps current shape. NEW event variant for the bulk-cancel emission — may register a new `subscription.pause_cancels_pushed` audit event with cancelled-task UUIDs in metadata (operator observability per Phase 1 R2/R3/R4/R5 audit shape — see §5 OQ-4).

**No schema delta.**

### R3 — addNoteToDriver SF push

**Service-layer entry:** extend `addNoteToDriver` at [`src/modules/tasks/service.ts:1404-1463`](../../src/modules/tasks/service.ts). After the local `tasks.notes` UPDATE commits, enqueue an SF update via existing `enqueueUpdateTask` at [`src/modules/task-outbound-queue/publish.ts:199`](../../src/modules/task-outbound-queue/publish.ts).

**SF wire contract:** SuiteFleet `updateTask` already accepts the `notes` field per [`src/modules/integration/providers/suitefleet/task-client.ts:197-340`](../../src/modules/integration/providers/suitefleet/task-client.ts) (verified at lane-open). No client-side change.

**Outbound payload shape (decision item — see §5 OQ-1):** does the push set `outbound_sync_state='pending_update'` (NEW enum value) for in-flight visibility, OR rely on `failed_pushes` for failure-tracking only with no in-flight state? Same decision applies to R4 and R5.

**Audit:** existing `task.note_added` event keeps current metadata shape (note text NOT in audit per PII). NEW event variant `task.note_pushed_to_external` registered when SF ack arrives. **§5 OQ-4** surfaces audit event shape across R2/R3/R4/R5 for uniform reviewer ruling.

**No schema delta** (unless OQ-1 chooses 'pending_update' — then migration 0029 — see §3).

### R4 — One-off address override

**Service-layer entry:** extend `addSubscriptionException` at [`src/modules/subscription-exceptions/service.ts:481-538`](../../src/modules/subscription-exceptions/service.ts) for the `address_override_one_off` type (Day-13 schema; exception row INSERT path already exists). After the exception row commits:
1. UPDATE `tasks.address_id` on the single targeted task to the new `address_override_id`.
2. Enqueue SF update via `enqueueUpdateTask` with the new address fields on the payload.

**SF wire contract:** `updateTask` accepts address fields per task-client.ts (verified at lane-open).

**Outbound state:** see §5 OQ-1 ('pending_update' enum value decision).

**No schema delta** (exception schema supports `address_override_id` per migration 0015; `tasks.address_id` already exists).

### R5 — Forward address override (subscription-scope)

**Service-layer entry:** extend `addSubscriptionException` for the `address_override_forward` type. Three load-bearing steps:
1. **In-horizon backfill:** UPDATE `tasks.address_id` on every task on the subscription with `delivery_date >= start_date AND delivery_date < CURRENT_DATE + interval '14 days'`.
2. **Fan-out SF push:** enqueue SF updates via `enqueueBulkUpdateTasks` at [`src/modules/task-outbound-queue/publish.ts:352`](../../src/modules/task-outbound-queue/publish.ts).
3. **Subscription-level future-horizon:** the existing `address_override_forward` exception row (already INSERTed) is read by the materialization CTE at [`src/modules/task-materialization/cte-builder.ts:163-178`](../../src/modules/task-materialization/cte-builder.ts) for future >14-day-out tasks. **No new column on `subscriptions` needed** — verified at lane-open.

**R1 dependency check (verified):** R5's three load-bearing steps function correctly WITHOUT R1. The in-horizon backfill (step 1) + SF push (step 2) work synchronously in the operator-action handler. Step 3 (future-horizon) relies on the scheduled 16:00 cron tick to materialize new-address tasks beyond the 14-day horizon — R5's ruling does NOT require those to materialize immediately. R1's on-demand primitive ENHANCES the future-horizon UX (materialize immediately rather than on next 16:00 tick) but is not a hard dependency. **PR-5 ships into a context where R1 is live (sequential ordering — see §6) but R5 satisfies its own ruling regardless of R1 being live.**

**Confirmation pop-up (load-bearing §3.6 #2 watch surface per handoff):** UI form-submit guard required per R5 ruling. Integration spec must verify the pop-up renders on radio-selection of `address_override_forward` + blocks form submit until operator confirms.

**Outbound state:** see §5 OQ-1.

**No schema delta** (exception schema supports `address_override_id` for forward variant; subscription-level address derives from exception row via CTE).

---

## §3 Schema migrations

**Mandatory migrations: 0.** Phase 1 ships entirely on existing schema.

**Optional migration (OQ-1 decision — §5):**

- **0029_tasks_outbound_sync_state_pending_update.sql** — extend the `outbound_sync_state` CHECK enum at [`supabase/migrations/0026_tasks_outbound_sync_state.sql:47-53`](../../supabase/migrations/0026_tasks_outbound_sync_state.sql) (current 5 values: 'synced' / 'pending' / 'pending_cancel' / 'pending_reschedule' / 'failed') to admit **'pending_update'** for in-flight visibility of R3/R4/R5 update-style pushes. If reviewer rules NO at §3.6 #1, no migration ships.

**Apply path if migration ships:** Day-2 convention — Supabase SQL editor manual apply BEFORE Vercel promote of dependent code-PR (per Day-33 lesson #4 in [`memory/handoffs/day-33-eod.md`](../handoffs/day-33-eod.md) §F). Migration 0029 sequencing depends on which sub-PR introduces the new enum value (likely PR-3 = R3 if OQ-1 is ruled yes).

---

## §4 Test coverage

**Integration spec surface per R-item.** All specs verify contracts against real Postgres (Plan #317 F-4 pattern — integration specs hit a real DB connection from the worktree, NOT mocks).

| R-item | Spec surface (load-bearing) |
|---|---|
| R1 | (1) On-demand → materializer invocation completes synchronously / async per OQ-2 ruling.  (2) **Concurrency guard:** on-demand + scheduled cron firing in the same wall-clock minute → no duplicate task INSERTs (idempotency verified).  (3) Audit event fires per operator action. |
| R2 | (1) Pause SF cancel fan-out enqueues one QStash job per cancelled-in-window task with `external_tracking_number NOT NULL`.  (2) `outbound_sync_state` flips to `'pending_cancel'` on all affected tasks.  (3) Existing pause-cut-off and end-date-extension behaviors regress-free. |
| R3 | (1) `enqueueUpdateTask` called with `notes` field on payload after local note commit.  (2) `outbound_sync_state` per OQ-1 ruling.  (3) Audit event registration per OQ-4 ruling. |
| R4 | (1) `tasks.address_id` UPDATE commits in same tx as exception row.  (2) `enqueueUpdateTask` called with address fields on payload.  (3) Cross-consignee address-ownership check (existing at service.ts:426-456) regress-free. |
| R5 | (1) **Confirmation pop-up:** form-submit guard renders + blocks until operator confirms.  (2) All in-horizon tasks on the subscription receive `tasks.address_id` UPDATE.  (3) `enqueueBulkUpdateTasks` fan-out emits one payload per in-horizon task.  (4) **Materializer subscription-read on next cron tick** picks up the `address_override_forward` exception row and materializes >14-day-out tasks at new address (load-bearing per handoff watch surface). |

**Test fixture surfacing:** R5 (4) and R1 (2) both need a deterministic cron-tick fixture — reuse Plan #317 PR-B pattern (savepoint-wrapper around the test transaction to allow the materializer's withServiceRole to nest cleanly).

---

## §5 Locked decisions vs OQs

### LOCKED (no reviewer ruling needed — product decisions from PR #331 + this plan-PR)

15 R-items + sub-rulings from PR #331 at `9d7b15b` (see [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](../diagnostic_calendar_management_full_surface_enumeration.md) §Rulings (Day-33 PM session)).

2 NEW R-items folded today: **R11 (POD-shape-e → Path 1 Planner proxy)** + **R12 (resolved-rows → Path B separate /resolved route)** — see §1 lane-membership rulings.

### OQs (need reviewer ruling at §3.6 #1 hard-stop)

**OQ-1 — `outbound_sync_state` `'pending_update'` enum value.** Add as migration 0029 for R3/R4/R5 in-flight visibility, OR rely on `failed_pushes` for failure-tracking only with no in-flight state? Trade-off: in-flight state matches existing pause/cancel pattern + lights up the existing outbound_sync_state badge for updates; no in-flight state keeps schema unchanged + simplifies the publisher contract. **Builder lean: add the state (consistency with cancel pattern; lights up existing badge for operator visibility).**

**OQ-2 — R1 sync vs async dispatch shape.** SYNCHRONOUS in-request invocation (`await materializeTenant(...)` in the operator-action handler before returning) OR async-via-QStash dispatch (publish a job; operator gets fast response; calendar reflects on next page-load after worker completes). Trade-off: sync = simpler operator UX (refresh-and-see), latency stacks under bursts; async = non-blocking, sub-second-to-seconds delay before reflect. **Builder lean: synchronous (simpler operator mental model; latency is single-tenant materialization which is bounded; QStash flow control already protects the bulk outbound push from the action). If reviewer prefers async, the dispatcher is the same primitive used by the scheduled cron and reuses the existing QStash infrastructure.**

**OQ-3 — R5 confirmation pop-up location.** Inline in the existing `DayActionPopover` (small modal-within-popover), OR full-screen modal that replaces the popover. Trade-off: inline = no context loss; modal = stronger visual gate. **Builder lean: inline modal-within-popover (lower friction; operator mental model already on the day-action panel).**

**OQ-4 — R2/R3/R4/R5 audit event registration shape.** Three options: (a) one new event per operator action with affected-task UUIDs in metadata (`subscription.pause_cancels_pushed`, `task.note_pushed_to_external`, etc.); (b) reuse existing audit events with an `outbound_push_enqueued` boolean flag added to metadata; (c) no new audit events — `failed_pushes` is the only audit-of-record for outbound state. Trade-off: option (a) is most observable; option (b) keeps event taxonomy stable; option (c) is minimal. **Builder lean: option (a) — Phase 1 is the first time these four surfaces emit outbound; explicit events match the existing `task.push_failed` precedent.**

**OQ-5 — Brief amendment.** Phase 1 expands §3.1.4 outbound push beyond skip-cancel to pause-cancel + update-style pushes (note, address one-off, address forward). Lane-rulings memo says no amendment required, but Phase 1 materially extends the documented outbound surface. **Builder lean: brief amendment to §3.1.4 + §3.5 task action model (R2/R3/R4/R5 listed as in-scope outbound operations) lands with PR-2 or PR-3 (whichever ships the first net-new outbound shape). Bump brief v1.15 → v1.16.** Reviewer rules at §3.6 #1.

---

## §6 Sub-PR sequencing

**Sequential 5 sub-PRs.** NOT parallel — same posture as Plan #317 §10 hard requirement (shared outbound publisher infra means later PRs depend on earlier folds; sequential gives reviewer cleaner §3.6 reads).

| Sub-PR | R-item | Sequencing rationale |
|---|---|---|
| **PR-1** | R1 | First — provides on-demand primitive. First consumer = existing skip-tail surface (already needed the on-demand path per Day-32 followup). Subsequent PRs ship into a context where R1 is live; R5 in particular gets full UX (in-horizon + future-horizon immediate) on first ship. |
| **PR-2** | R2 | Second — pause is the highest-severity gap (drivers attempt delivery on paused days because SF dispatches them; A2.3 in diagnostic). Bulk-fan-out shape exercises the publisher; subsequent PRs (R3/R4) inherit the integration-spec scaffolding. |
| **PR-3** | R3 | Third — single-task update via `enqueueUpdateTask`; simplest update-shape. Exercises the 'pending_update' state (if OQ-1 ruled yes) for the first time + introduces migration 0029. |
| **PR-4** | R4 | Fourth — single-task update + local address backfill. Reuses PR-3's update-shape spec scaffolding. |
| **PR-5** | R5 | Last — fan-out update + confirmation pop-up + subscription-level future-horizon. The most complex sub-PR; benefits from R1 (PR-1) + R3/R4 (PR-3/PR-4) integration patterns being in place. Future-horizon materializer-read is the load-bearing §3.6 #2 surface per handoff. |

**Inter-PR forks:** PR-2 / PR-3 / PR-4 could ship in any order after PR-1 if reviewer wants flexibility. Recommended order above is chronological-severity.

---

## §7 Cross-references

### Lane-level

- [`memory/diagnostic_calendar_management_full_surface_enumeration.md`](../diagnostic_calendar_management_full_surface_enumeration.md) — Lane source-of-truth. 17 R-items + sub-rulings locked.
- [`memory/followup_calendar_management_full_resolution.md`](../followup_calendar_management_full_resolution.md) — Day-32 lane shape + Love directive ("build them properly, don't dampen the UI").
- [`memory/followup_pod_broken_image_pre_existing.md`](../followup_pod_broken_image_pre_existing.md) — R11 origin memo + 3 fix paths (Path 1 picked).
- [`memory/followup_resolved_rows_visibility_gap.md`](../followup_resolved_rows_visibility_gap.md) — R12 origin memo + 3 resolution paths (Path B picked).
- [`memory/MEMORY-followup-current.md`](../MEMORY-followup-current.md) — active-lane digest.
- [`memory/handoffs/day-33-eod.md`](../handoffs/day-33-eod.md) §G — lane-open thread context + §F discipline lessons. (§G text uses "Day-34" framing — that is the mis-anchor surfaced post-PR-#335-open; see day-anchor note in header.)

### Brief sections

- §3.1.4 outbound push optimistic-ack pattern (Phase 1 expands beyond skip-cancel — see §5 OQ-5).
- §3.1.5 14-day rolling materialization horizon (R5 in-horizon-vs-future-horizon distinction).
- §3.1.6 skip-with-tail-reinsertion (R1 first consumer surface).
- §3.1.7 bounded pause window (R2 surface).
- §3.3.3 DayActionPopover (R3/R4/R5 surface).
- §3.5 task action model (R2/R3/R4/R5 add new outbound operations — see §5 OQ-5).

### Code surfaces (worktree pinned at SHA `9b9f7ba`)

- [`src/app/api/cron/generate-tasks/route.ts`](../../src/app/api/cron/generate-tasks/route.ts) — cron handler (R1 primitive extraction).
- [`src/modules/task-materialization/service.ts`](../../src/modules/task-materialization/service.ts) — `materializeTenant` (R1 primitive).
- [`src/modules/task-materialization/cte-builder.ts:146-178`](../../src/modules/task-materialization/cte-builder.ts) — materialization CTE; R5 future-horizon resolves via this.
- [`src/modules/subscription-exceptions/service.ts:481-538`](../../src/modules/subscription-exceptions/service.ts) — `addSubscriptionException` (R4 + R5 entry).
- [`src/modules/subscriptions/service.ts:672-875`](../../src/modules/subscriptions/service.ts) — `pauseSubscription` (R2 entry).
- [`src/modules/tasks/service.ts:1404-1463`](../../src/modules/tasks/service.ts) — `addNoteToDriver` (R3 entry).
- [`src/modules/tasks/repository.ts:1354,1403`](../../src/modules/tasks/repository.ts) — `markTaskSkipped` (existing pattern), `markTasksCanceledInWindow` (R2 extension).
- [`src/modules/task-outbound-queue/publish.ts:135,199,277,352`](../../src/modules/task-outbound-queue/publish.ts) — `enqueueCancelTask`, `enqueueUpdateTask`, `enqueueBulkCancelTasks`, `enqueueBulkUpdateTasks` (all four already in production).
- [`src/modules/integration/providers/suitefleet/task-client.ts:197,209,341,834,920`](../../src/modules/integration/providers/suitefleet/task-client.ts) — SF `updateTask` + `cancelTask` (wire contracts already in production).
- [`supabase/migrations/0026_tasks_outbound_sync_state.sql`](../../supabase/migrations/0026_tasks_outbound_sync_state.sql) — outbound_sync_state CHECK enum (R3/R4/R5 OQ-1 potentially extends).
- [`supabase/migrations/0028_tasks_outbound_sync_state_pending_default.sql`](../../supabase/migrations/0028_tasks_outbound_sync_state_pending_default.sql) — most-recent migration (next number = 0029 if OQ-1 ruled yes).
- [`src/modules/audit/event-types.ts`](../../src/modules/audit/event-types.ts) — audit event registration (OQ-4 surface).

### Plan-PR precedents

- [PR #317](https://github.com/lovemansgit/planner/pull/317) — Plan #317 closed Day-33 end-to-end. Plan shape + §3.6 hard-stops + §10 ruling fold + sequential code-PR cadence inherit from #317.
- [`memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`](day-25-per-merchant-sf-credentials-amendment-dual-auth.md) — exemplar T3 plan-PR shape with detailed §-by-§ scoping.

### Standing discipline rules

- [`memory/feedback_brief_amendment_log_append_only.md`](../feedback_brief_amendment_log_append_only.md) — brief amendment carries v1.15 → v1.16 if OQ-5 ruled yes (see §5).
- [`memory/decision_review_discipline_ci_gate.md`](../decision_review_discipline_ci_gate.md) — §3.6 hard-stop with CI gate; all 5 Phase-1 code-PRs inherit.
- [`memory/feedback_parallel_sessions_use_git_worktree.md`](../feedback_parallel_sessions_use_git_worktree.md) — this plan-PR opened from a dedicated worktree off origin/main HEAD `9b9f7ba`.
- [`memory/feedback_sha_derive_from_git_output_not_prefix.md`](../feedback_sha_derive_from_git_output_not_prefix.md) — pinned head SHA in this plan-PR header is the verbatim `git rev-parse HEAD` output, not extended from a prefix.
- Day-33 EOD §F lesson #4 — migrations apply via Supabase SQL editor manually BEFORE Vercel promote of dependent code-PR; migration 0029 (if OQ-1 ruled yes) follows this convention.

### Out of scope (explicit non-collisions)

- **Phase 2** — R6.1+R6.2 (9-column Tasks layout) + R6.3 + R6.4 + R7.1-7.4 + **R12 (resolved-rows /resolved route)**. Separate T3 plan-PR opens after Phase 1 closes.
- **Phase 3** — R8 (audit timeline) + R9 (Week removal) + R10 (Year heatmap) + **R11 (POD proxy)**. Separate T3 plan-PR opens after Phase 2 closes.
- **Mobile/tablet responsive breakpoints** for the 9-column R6 layout — explicitly deferred from PR #331 to Phase 2 plan-PR per handoff.
- **HEM 403 single-tenant credential failure** ([`memory/followup_hem_403_credential_failure.md`](../followup_hem_403_credential_failure.md)) — Aqib coordination lane; does NOT block Phase 1.
- **R7.2 view-mode default** — RULED no code change (reality already matches Month default). Documented in Phase 2 plan-PR for completeness; no Phase-1 surface.
- **Audit log viewer (R12 Path C precursor)** — broader scope; if reviewer prefers Path C over Path B for R12, lane scope changes and Phase 2 re-plans.

---

## §3.6 #1 hard-stop checklist (paste-back body-read at pinned SHA)

Per [`memory/decision_review_discipline_ci_gate.md`](../decision_review_discipline_ci_gate.md):

- [ ] Plan-PR body read end-to-end at pinned head SHA `9b9f7ba`.
- [ ] R1/R5 dependency claim verified against `materializeTenant` primitive + CTE-builder forward-override read path.
- [ ] Schema drift walked across all 17 R-items; zero mandatory migrations confirmed; OQ-1 surfaces the only optional migration.
- [ ] All 5 OQs (§5 OQ-1 through OQ-5) ruled.
- [ ] Sequential PR-1 → PR-5 ordering confirmed (or revised with reasoning).
- [ ] Brief amendment posture confirmed (OQ-5).

---

**End of Day-36 Phase 1 plan-PR.** Plan-PR persistence — stays OPEN until PR-5 ships end-to-end. PRs 2 and 3 of the calendar-management lane open after Phase 1 closes; this plan-PR enumerates them for visibility but does not scope them.
