---
name: Day-19 Phase 1 — merchant operator CRUD lane (plan-PR)
description: T3 plan-PR for the Phase 1 merchant operator CRUD lane covering consignee + subscription + ad-hoc task creation, task edit + cancel, bulk operations, hard-stop discovery findings, and SF outbound edit/cancel push. Demo-critical lane between Day-19 PM and May 15 internal CAIO demo.
type: project
---

# Day-19 Phase 1 — merchant operator CRUD lane

> **T3 plan-PR.** Code PR sequences after merge. Hard-stop at plan-PR open per T3 discipline; second hard-stop at code-PR open.

**Branch:** `day19/phase-1-merchant-crud-plan` from `main` HEAD `8044221`
**Target demo:** May 15 internal CAIO demo (Day 25)
**Code-PR target:** end Day 23 (May 13) — 2-day buffer to dry-run

---

## §A — Discovery findings (verbatim from Day-19 PM hard-stop)

Surveyed at session entry; reviewer ruled all 6 OQs before this plan body was drafted. Code citations preserved.

### §A1 — User-context create fns: PARTIAL · effort to close: S–M

| Fn | Status | Citation |
|---|---|---|
| `createConsignee` | ✓ user-context, `consignee:create` | [src/modules/consignees/service.ts:118-122](../../src/modules/consignees/service.ts#L118-L122) |
| `createSubscription` | ✓ user-context, `subscription:create` | [src/modules/subscriptions/service.ts:211-215](../../src/modules/subscriptions/service.ts#L211-L215) |
| `createTask` | ✗ **system-only** via `assertSystemActor` | [src/modules/tasks/service.ts:290-292](../../src/modules/tasks/service.ts#L290-L292) |

Day-5 lock at [`memory/decision_task_module_no_user_create_delete.md`](../decision_task_module_no_user_create_delete.md) is the load-bearing rationale.

**OQ-1 ruling: BREAK Day-5 lock.** Single `createTask` fn with dual-actor gating (system-actor → bypass perm; user-actor → require `task:create`). NOT a separate `createTaskAsUser`. Cleaner; one wire path; one place for SF push to live. Amendment memo at §K.

### §A2 — Subscription auto-task generation: REFUTED · effort to close: M

Subscription create does NOT synchronously generate tasks. Materialization is daily-cron-batch via [`materializeTenant(tx, {tenantId, targetDate, ...})`](../../src/modules/task-materialization/service.ts#L181) operating per-tenant per-date over ALL active subs. **No per-subscription entry point exists.**

**OQ-2 ruling: INCLUDE manual `materializeSubscription` trigger in v1.** Architectural constraint: shared core extraction — the per-subscription manual trigger AND the existing cron-batch path MUST share the same CTE chain. No parallel reimplementation of cadence math, skip logic, or address resolution.

§M architectural watch-item finding (below): **CTE extraction is CLEAN.** Plan body proceeds.

### §A3 — SuiteFleet outbound push for edit/cancel: REFUTED · effort to close: L

`LastMileAdapter` interface ([`src/modules/integration/last-mile-adapter.ts:44-126`](../../src/modules/integration/last-mile-adapter.ts#L44-L126)) defines: `authenticate, refreshSession, createTask, getTaskByAwb, printLabels, fetchAssetTrackingByAwb, verifyWebhookRequest, parseWebhookEvents, mapStatusToInternal`.

**No `updateTask`, no `cancelTask`, no `editTask` outbound paths exist.** Inbound (SF→Planner) IS wired via [`apply-webhook-edit-event.ts`](../../src/modules/integration/providers/suitefleet/apply-webhook-edit-event.ts) + [`apply-webhook-status-event.ts`](../../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts).

**OQ-3 ruling: INCLUDE SF outbound for edit/cancel in v1.** Demo narrative depends on live edit/cancel reflecting on SF side. ~10-14 hr added scope. Plan body §G expands accordingly. Aqib coordination memo at §L.

### §A4 — Subscription pause: PARTIAL with spec/implementation mismatch · effort to close: XS

Schema + service exist:
- `subscriptions.status` enum: `"active" | "paused" | "ended"` (lowercase per migration 0009)
- [`pauseSubscription`](../../src/modules/subscriptions/service.ts#L522) / [`resumeSubscription`](../../src/modules/subscriptions/service.ts#L804) / [`endSubscription`](../../src/modules/subscriptions/service.ts#L1011) all user-context with `subscription:pause` / `:resume` / `:end` perms

Implementation is **bounded pause per brief §3.1.7** — Day-16 Block 4-C / PR #160. Tasks in window auto-CANCELED; subscription `end_date` extended; 18:00 Dubai cut-off enforced; idempotency via correlation_id.

**OQ-4 ruling: AMEND §D ruling to bounded-pause per brief §3.1.7.** UI text/form-field shift only; no backend delta.

### §A5 — Edit-task service-layer: PARTIAL · effort to close: M

[`updateTask`](../../src/modules/tasks/service.ts#L583) (user-context, `task:update`) supports 16 scalar field patches. Per [`UpdateTaskPatch` dispatch](../../src/modules/tasks/service.ts#L594-L627):

| §E ruled-editable field | Supported? |
|---|---|
| `delivery_date` | ✓ |
| `delivery_start_time` | ✓ |
| `delivery_end_time` | ✓ |
| `address_id` | ✗ NOT in UpdateTaskPatch |
| Cutoff guard | ✗ no `isCutOffElapsedForDate` |

**OQ-5 ruling: INCLUDE UpdateTaskPatch addressId extension + cutoff guard in v1.** ~3 hr standalone.

### §A-aggregate — scope estimate

Full v1 per OQ rulings:

| Lane | Effort |
|---|---|
| §A1 createTask dual-actor gating | M (~3 hr) |
| §A2 materializeSubscriptionForDateRange (shared core) | M (~6-8 hr) |
| §A3 SF outbound push (3 adapter methods + client + QStash + tests) | L (~10-14 hr) |
| §A4 bounded-pause UI (text + confirmation panel) | XS-S (~2 hr) |
| §A5 UpdateTaskPatch addressId + cutoff guard | M (~3 hr) |
| Forms + pages (consignee/sub/task — new + edit) | L (~10-12 hr) |
| Bulk-action UI + service (§F) | M (~6-8 hr) |
| Subscription preview component | S (~2 hr) |
| Tests across all surfaces | L (~8-10 hr) |
| **Aggregate** | **XL** (~50-62 hr code; ~3-4 calendar days @ 12-15 hr/day) |

**Plan-PR:** today (Day 19 PM). **Code-PR:** Day 20-23. **Demo-ready:** end Day 23 (May 13). **Buffer to demo:** 2 days.

---

## §B — Locked MoSCoW scope (Love's product vision)

Verbatim product context (Love, Day-19 PM):

> "The mealplanner CRM becomes the main dashboard / portal for merchants to manage all their consignees — these consignees come in the form of subscribers. They sign up for a 1 month, select 3 days a week or 5 days a week, get configured in our system. Start date and end date. If start date is 1 May and end date is 31 May, and consignee selected Mon-Fri skip Sat Sun, meals, time slots 6am - 9am for deliveries (don't forget all other requirements like home address, office address, telephone number, contact, etc.) Then this automatically creates the tasks with those configurations in that time period. Then the merchant operator uses this portal to skip, cancel, change address, etc. There must also be a provision for merchants to create ad-hoc single tasks. So maybe having a checkbox (single task vs subscription) that can provide a single date or a date range option."

### §B.1 — MUST for v1

Frontend (operator-facing, `/(app)/*` routes):

1. `/consignees/new` — create form
2. `/consignees/[id]/edit` — edit form
3. `/subscriptions/new` — create form (with single-task toggle per Love's vision)
4. `/subscriptions/[id]/edit` — edit form (pause/resume action)
5. `/tasks/[id]/edit` — edit form (date + time window + address; cutoff guard)
6. Bulk action bar on `/tasks` list page: bulk-cancel + bulk-edit
7. Ad-hoc task creation: single-task checkbox on `/subscriptions/new`; date or date-range option per Love's vision
8. Subscription preview component ("this will generate N tasks across X date range")

Backend service-layer additions:

- `createTask` dual-actor gating (system-actor existing path + user-actor `task:create`)
- `materializeSubscriptionForDateRange(subId, startDate, endDate, ctx)` — shared CTE core with materializeTenant
- `cancelTask(ctx, taskId)` — single cancel + SF outbound push
- `bulkCancelTasks(ctx, taskIds)` — transactional + SF outbound push
- `bulkUpdateTasks(ctx, taskIds, patch)` — transactional + SF outbound push
- `UpdateTaskPatch` adds `addressId` + cutoff guard
- LastMileAdapter extension: `updateTask`, `cancelTask`, `bulkCancelTasks` (signatures locked post-Aqib comm per §L)
- Permissions catalogue additions: `task:create`, `task:cancel`, `task:bulk_update`, `task:bulk_cancel` (assigned to merchant operator role)

### §B.2 — WON'T in v1 (locked NO)

- CSV bulk upload (Phase 2)
- Per-weekday address rotation UI (data model retained; per-task address change covers v1)
- Hard delete of consignees / subscriptions
- Edit `consignee_id` on existing task (cancel + recreate flow)
- Edit subscription's consignee binding post-creation
- Subscription duplicate / clone
- Inline status changes from operator UI (status comes from SF webhooks only)

---

## §C — Cadence model (PD-1 ruling: option (c) preset-prefill checkboxes)

UI structure on `/subscriptions/new`:

```
┌─ Cadence ────────────────────────────────────────────┐
│  [ Mon-Fri ] [ Mon-Wed-Fri ] [ Weekend ] [ Daily ]   │
│  [ Custom ]                                           │
│                                                       │
│  ☑ Mon  ☑ Tue  ☑ Wed  ☑ Thu  ☑ Fri  ☐ Sat  ☐ Sun   │
└──────────────────────────────────────────────────────┘
```

- Preset selector: chip-style buttons (filter-pill pattern from `/tasks/client.tsx`)
- Selecting preset prefills 7 weekday checkboxes
- Operator can edit checkboxes regardless of preset selection
- "Custom" preset = no prefill; checkboxes stay at current state

Frontend-design constraints:
- Hairline borders on chip buttons (matches brand canon from PR #168/#181)
- Sentence case ("Mon-Fri", "Custom"); no shadows
- Active chip: filled with `--color-brand-navy`; inactive: outlined hairline
- Checkboxes: refined-minimal, 16×16, 1px hairline border

---

## §D — Pause semantics (AMENDED to bounded-pause per brief §3.1.7)

**Load-bearing context:** brief §3.1.7 + Day-16 Block 4-C / PR #160. Reverting to "hard pause" would unwind PR #160 substantive code. **Avoid.**

### §D.1 — Pause flow

UI surfaces on `/subscriptions/[id]/edit`:

1. **Pause action button** — opens pause modal
2. **Modal fields:**
   - `Pause from [date picker]` (validated: ≥ today; cut-off check at submit)
   - `Pause until [date picker]` (validated: > pause_start)
   - `Reason (optional)` textarea
3. **Confirmation panel** (after fields filled, before submit):
   ```
   ┌─ Confirm pause ─────────────────────────────────────┐
   │  X tasks in this window will be canceled.           │
   │  Subscription end date extends from MMM DD → MMM DD.│
   │  [ Cancel ]                              [ Confirm ]│
   └─────────────────────────────────────────────────────┘
   ```
   - Atmosphere primitive: `--color-tint-navy-subtle` background
4. **Cut-off enforcement:** if `pause_start` is past 18:00 Dubai cut-off the day before, surface inline error per existing precedent at [`pauseSubscription:548`](../../src/modules/subscriptions/service.ts#L548)
5. **Idempotency:** correlation_id generated client-side as form-mount UUID; resubmit returns existing pause (replay-safe)

### §D.2 — Resume flow

- "Resume now" button on paused subscription
- Sets `pause_end` to today (or `pause_start` if pause hasn't begun); subscription returns to `'active'` immediately
- Tasks already canceled in window stay canceled (Phase 2 of resume; brief §3.1.7)
- Tasks not yet generated for post-resume dates will materialize via cron OR via §A2 manual trigger

### §D.3 — UI copy guardrail

DO NOT use "stops generating new tasks" or "operator manually cancels" wording. Those describe the rejected hard-pause model. Use:
- "Pause window cancels in-flight tasks"
- "Subscription end date extends to compensate"
- "Resume early to lift the pause before [pause_end]"

---

## §E — Edit-task scope (Q4 ruling + OQ-5 amendment)

### §E.1 — Editable fields

- `delivery_date`
- `delivery_start_time` / `delivery_end_time`
- `address_id` (referencing existing addresses on `tasks.consignee_id`)

### §E.2 — NOT editable (locked)

- `consignee_id` (cancel + recreate flow)
- `internal_status` (system-managed via SF webhooks)
- `customer_order_number` (immutable identifier)

### §E.3 — Cutoff guard

- Refuse edit if `isCutOffElapsedForDate(task.deliveryDate)` returns true (existing precedent in pauseSubscription)
- Surface inline ValidationError; preserve form state
- Cutoff: 18:00 Dubai the day before delivery (matches existing convention)

### §E.4 — Backend changes (§A5)

- `UpdateTaskPatch` type adds `addressId?: Uuid | null`
- `updateTask` validates `addressId` belongs to `consignee.addresses` (FK consistency check)
- Cutoff guard pre-flight: `if (isCutOffElapsedForDate(...)) throw new ValidationError(...)`
- Audit event emitted on edit (existing `task.updated` pattern with `changed_fields` metadata)
- SF outbound push triggered after successful update via §G adapter `updateTask`

### §E.5 — Form UX (modal)

- Modal precedent: PR #174 ConsigneeDetailPage CrmStateModal, PR #177 DayActionPopover, PR #206 PodLightboxModal, PR #213 admin pages
- Single-purpose modal: edit task fields only; no nested affordances
- Escape-to-cancel; primary action right-aligned ("Save changes")
- Address picker: dropdown of `consignee.addresses`; "+ Add address" link to `/consignees/[id]/edit#addresses`
- Date picker: native `<input type="date">` with min = today
- Time pickers: native `<input type="time">`

---

## §F — Bulk operations

### §F.1 — Selection model

- Existing `/tasks/client.tsx` carries selection state across pagination (Day-17 PR #175/#176 work)
- "Select all across pages" affordance already shipped — reuse

### §F.2 — Bulk-edit modal

- Triggered from bulk action bar (appears at top of `/tasks` when ≥1 row selected)
- Field-pick UI: which fields to edit (date / time-window / address)
- Same value applied to all selected tasks
- Per-task cutoff check: tasks past cutoff fail individually
- Partial-failure UX:
  ```
  ┌─ Bulk edit complete ────────────────────────────────┐
  │  ✓ 47 tasks updated                                  │
  │  ⚠ 3 tasks failed (past cutoff): [view list]         │
  └──────────────────────────────────────────────────────┘
  ```
  - Atmosphere primitive `--color-tint-navy-subtle` for confirmation
  - Failed list expandable inline (no second modal)

### §F.3 — Bulk-cancel modal

- Triggered from bulk action bar
- Confirmation: "Cancel N tasks? This pushes cancel to SuiteFleet."
- All selected → `internal_status='CANCELED'`
- All push to SF via `bulkCancelTasks` adapter
- Same partial-failure UX as bulk-edit

### §F.4 — Service-layer transactional wrapper

Both bulk fns:
- Open single transaction for DB updates
- Validate all rows before committing (cutoff check per row)
- DB commits BEFORE SF push (Planner is source of truth)
- SF pushes enqueued via QStash (§G — async, retry-safe)
- Per-task SF push failure: row stays canceled in Planner; flagged in `outbound_push_failures` table for ops review (mirror existing DLQ pattern from Day-14)

### §F.5 — Permission gates

- `task:bulk_update` for bulk-edit
- `task:bulk_cancel` for bulk-cancel
- Both assigned to merchant operator role

---

## §G — SuiteFleet outbound push (INCLUDED in v1 per OQ-3)

### §G.1 — Adapter interface extension

Three new methods on `LastMileAdapter` ([`src/modules/integration/last-mile-adapter.ts`](../../src/modules/integration/last-mile-adapter.ts)):

```ts
interface LastMileAdapter {
  // ... existing methods ...

  /**
   * Day-19 / Phase 1. Update an existing SF task's delivery_date,
   * delivery_window, or address. Mirrors createTask's idempotency
   * posture (correlation_id passed in for replay safety).
   *
   * Throws:
   *   - CredentialError   auth failure / 5xx
   *   - ValidationError   provider returned 4xx
   *   - NotFoundError     SF task with that externalId no longer exists
   */
  updateTask(
    session: AuthenticatedSession,
    externalTaskId: string,
    patch: TaskUpdatePatchRequest,
  ): Promise<void>;

  /**
   * Day-19 / Phase 1. Cancel an existing SF task.
   *
   * Throws same as updateTask.
   */
  cancelTask(
    session: AuthenticatedSession,
    externalTaskId: string,
    correlationId: string,
  ): Promise<void>;

  /**
   * Day-19 / Phase 1. Bulk cancel — SF endpoint TBD (Aqib comm § L).
   * If SF supports bulk endpoint: single call. If not: parallel
   * single-cancel calls with rate-limit throttle (5 req/sec floor
   * per existing precedent at scripts/probe-sf-label-cap.mjs).
   */
  bulkCancelTasks(
    session: AuthenticatedSession,
    externalTaskIds: readonly string[],
    correlationId: string,
  ): Promise<readonly BulkCancelResult[]>;
}
```

**Adapter signatures NOT YET LOCKED** — pending Aqib comm per §L. Plan-PR opens against best-known assumptions; signatures firm before code-PR locks.

### §G.2 — SuiteFleetTaskClient implementation

In [`src/modules/integration/providers/suitefleet/task-client.ts`](../../src/modules/integration/providers/suitefleet/task-client.ts):

- Mirror `createTask` posture: per-call construction with auth-client + token-cache injection
- Idempotency: correlation_id in HTTP header per existing convention (Day-7 webhook auth memo)
- Rate-limit: 5 req/sec throttle per existing convention
- Single-attempt policy on transient failures (no retry inside adapter; QStash handles retry)

### §G.3 — Service-layer integration

Three service-layer fns push via adapter:

```ts
// src/modules/tasks/service.ts

export async function cancelTask(ctx: RequestContext, taskId: Uuid): Promise<Task> {
  requirePermission(ctx, "task:cancel");
  // 1. Fetch task; verify tenant scope
  // 2. Cutoff guard (refuse if past cutoff)
  // 3. UPDATE tasks SET internal_status='CANCELED', canceled_at=NOW()
  // 4. Audit task.canceled
  // 5. Enqueue QStash job → /api/queue/cancel-task with {externalTaskId, correlationId}
  // 6. Return updated task
}

// Bulk variants follow same pattern with transactional DB updates + batched QStash enqueue
```

### §G.4 — QStash decoupling per Day-14 push pattern

- New QStash route: `/api/queue/cancel-task` (mirrors `/api/queue/push-task`)
- New QStash route: `/api/queue/update-task`
- Failure routing → `/api/queue/cancel-task-failed` → `outbound_push_failures` DLQ table
- flowControl key: `sf-push-global-mvp` (production) / `sf-push-global-preview` (preview) — same key as existing push lane (rate-limit shared)

### §G.5 — Schema additions

New table `outbound_push_failures`:

```sql
CREATE TABLE outbound_push_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('update', 'cancel')),
  correlation_id UUID NOT NULL,
  failure_reason TEXT NOT NULL,
  failure_payload JSONB,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_outbound_push_failures_unresolved
  ON outbound_push_failures(tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;
```

Operator visibility (Phase 2): `/admin/dlq/outbound-push-failures` page. v1 scope: table + DLQ writes; UI Phase 2.

### §G.6 — Tests

- Service-layer: cancelTask happy path; cutoff refusal; tenant-scope refusal; perm refusal
- Adapter: updateTask success; 4xx surfaces ValidationError; 5xx surfaces CredentialError
- Queue handler: success path; failure DLQ write; idempotent replay
- Integration: bulk-cancel partial-failure UX (3 of 50 fail; 47 succeed)

### §G.7 — Aqib coordination (parallel lane)

See §L memo. Plan-PR opens against best-known assumptions; signatures firm before code-PR locks. Memo lists 6 questions; expected ~24-48 hr turnaround.

---

## §H — Out-of-scope (locked NO for v1)

- CSV bulk upload (Phase 2)
- Per-weekday address rotation UI (data model retained; per-task address change covers v1)
- Hard delete consignees / subscriptions
- Edit `consignee_id` on existing task
- Edit subscription's consignee binding post-creation
- Subscription duplicate / clone
- Inline status changes from operator UI (status comes from SF webhooks only)
- DLQ viewer page (`/admin/dlq/outbound-push-failures` UI surface — Phase 2)

---

## §I — Sequencing + effort estimate

### §I.1 — Plan-PR (Day 19 PM, today)

- Discovery: ✓ done
- Plan body: ✓ this document
- §K Day-5 amendment memo: ✓ this PR
- §L Aqib coordination memo: ✓ this PR
- §M architectural watch-items: ✓ this section

### §I.2 — Code-PR sequencing

| Day | Lanes | Effort |
|---|---|---|
| Day 20 (May 10) | createTask dual-actor gating + materializeSubscriptionForDateRange + UpdateTaskPatch addressId/cutoff guard + perms catalogue | M+M+M = ~12 hr |
| Day 21 (May 11) | LastMileAdapter extension + SuiteFleetTaskClient impl (post-Aqib) + QStash routes + service-layer cancelTask/bulkCancelTasks/bulkUpdateTasks + outbound_push_failures migration | L = ~14 hr |
| Day 22 (May 12) | Frontend: forms (consignee/sub/task new + edit) + cadence preset chips + address picker + subscription preview component + bulk action bar wire-up | L = ~12 hr |
| Day 23 (May 13) | Tests across all surfaces + bulk-action partial-failure UX + reviewer counter-review iteration | L = ~10 hr |

**Total:** ~48 hr code over 4 calendar days. Demo-ready end Day 23 (May 13). 2-day buffer to dry-run start.

### §I.3 — Counter-review iteration buffer

- Reviewer §3.6 review on plan-PR: today (Day 19 PM)
- Reviewer §3.6 review on code-PR: Day 23-24
- Iteration cycles likely on §G (SF outbound) + §F (bulk ops UX) — ~0.5 day each

### §I.4 — Risk-adjusted demo-ready

- Best case: end Day 23 (May 13), 2-day buffer
- Realistic: end Day 24 (May 14), 1-day buffer
- Worst case: end Day 25 (May 15) AM, demo-day landing — flag if it slips here, reviewer rules on cut-scope

---

## §J — Open questions for reviewer (post-discovery, pre-code-PR)

1. **Form UX patterns: modal vs full-page** — recommend modal for edit affordances (PR #174/#177/#206/#213 precedents); full-page for new (`/consignees/new`, `/subscriptions/new`, `/tasks/new` — all multi-section forms warrant page-level real estate). Confirm?

2. **Bulk-action UX details** —
   - (a) Selection persistence across pagination: REUSE existing PR #175/#176 mechanism
   - (b) Toast vs inline confirmation: prefer **inline confirmation panel** (matches §D pause confirmation pattern); no toast-only failure states
   - (c) Undo affordance: NO for v1 (architecturally distinct work — reverse SF cancel is non-trivial; revisit Phase 2 if operators ask)

3. **Subscription preview component placement** — recommend **inline within form**, below cadence section, above submit. Hero-numeral pattern: "**127** tasks across **31 days** (1 May – 31 May)" with `--color-tint-navy-subtle` atmosphere primitive.

4. **Single-task toggle UX** — Love's vision describes "checkbox single task vs subscription". Recommend **radio toggle** at top of `/subscriptions/new`:
   - ○ Recurring subscription (cadence + date range + N tasks generated)
   - ○ Single task (one date, OR small date range — generates 1-N one-off tasks; no subscription row)
   When "Single task" is selected, cadence section hides; date or date-range picker shows. Confirm UX framing.

5. **Permission catalogue assignments** — confirm new perms (`task:create`, `task:cancel`, `task:bulk_update`, `task:bulk_cancel`) granted to `ops-manager` AND `cs-agent` roles? Or `ops-manager` only?

6. **`outbound_push_failures` DLQ visibility** — v1 scope is DB writes only; UI Phase 2. Confirm.

---

## §K — Day-5 lock amendment memo (cross-reference)

New memo at [`memory/decision_task_module_amendment_v1.md`](../decision_task_module_amendment_v1.md). Drafted as part of this plan-PR.

Summary: amends [`memory/decision_task_module_no_user_create_delete.md`](../decision_task_module_no_user_create_delete.md) to permit user-actor `task:create` for ad-hoc creation flows. Single `createTask` fn with dual-actor gating (system → bypass; user → require `task:create`). Rationale: Love's product vision explicitly names ad-hoc task creation; Day-5 decision pre-dated demo narrative + operator product surface. No regression: cron + bulk import paths continue to use system-actor branch unchanged.

---

## §L — Aqib coordination memo (cross-reference)

New memo at [`memory/followup_suitefleet_outbound_edit_cancel_aqib.md`](../followup_suitefleet_outbound_edit_cancel_aqib.md). Drafted as part of this plan-PR.

Summary: 6 open questions for Aqib re: SF API endpoints (update task / cancel task / bulk variants), auth posture (correlation_id header convention), idempotency expectations, rate-limit constraints. Plan-PR §G work proceeds on best-known assumptions; Aqib comm runs parallel; adapter signatures firm up before code-PR locks.

---

## §M — Architectural watch-items + materializeTenant CTE extraction finding

### §M.1 — materializeTenant CTE extraction: CLEAN ✓

Surveyed [`src/modules/task-materialization/service.ts:181-485`](../../src/modules/task-materialization/service.ts#L181-L485). The same 5-CTE chain (`candidate_dates → eligible_dates → resolved_addresses → INSERT … ON CONFLICT … RETURNING`) repeats THREE times in materializeTenant:

1. Cap-check projection (line 215-249)
2. Phase 2 INSERT…SELECT (line 295-433)
3. §2.2 quarantine counter (line 457-)

The CTE is well-bounded — single tenant-filter predicate (`s.tenant_id = ${tenantId}`), single date-range bound (`generate_series(materialized_through_date+1, targetDate)`). No tenant-cross-cutting business logic.

**Extraction approach for §A2:**

```ts
// New fn: src/modules/task-materialization/service.ts
export async function materializeSubscriptionForDateRange(
  tx: DbTx,
  input: {
    subscriptionId: Uuid;
    startDate: string; // ISO date Asia/Dubai
    endDate: string;
    requestId: string;
  },
): Promise<{ newInsertedTaskIds: readonly Uuid[]; addressResolutionFailedCount: number }> {
  // Same CTE chain as materializeTenant Phase 2, with:
  //   WHERE s.id = ${subscriptionId}              (NOT s.tenant_id = ${tenantId})
  //   generate_series(${startDate}::date, ${endDate}::date, INTERVAL '1 day')
  //   (NOT bounded by materialized_through_date — caller-supplied range)
  //
  // SKIPPED:
  //   - cap-check (single sub won't hit 7000 cap)
  //   - run-row Phase 4 (cron concern; not user-trigger concern)
  //   - horizon advance (Phase 3 is cron batch metric)
  //
  // Quarantine counter retained (operator visibility on per-sub trigger).
}
```

Both `materializeTenant` and `materializeSubscriptionForDateRange` share the same `candidate_dates → eligible_dates → resolved_addresses` core via either:
- (a) Pure SQL builder fn: `buildMaterializeCteSql({tenantFilter | subscriptionFilter}, dateRange) → SQL`
- (b) Inline CTE duplication (as today) — code review enforces parallel evolution

**Recommendation: (a) — pure SQL builder.** Cleaner; parallel evolution risk is real (CTE was already duplicated 3× within materializeTenant; risk grows with extraction).

### §M.2 — Other watch-items

- **§G QStash flowControl key:** reuse existing `sf-push-global-*` keys from Day-14 cron-decoupling — DO NOT create new keys. SF rate limit is global per merchant, not per-operation-type.
- **§F bulk-cancel scale:** /tasks list page max 500 tasks per page; bulk-cancel of 500 tasks = 500 SF cancel calls @ 5 req/sec = 100s wall-clock. Acceptable for v1; flag for SF bulk-endpoint optimization in Phase 2 if Aqib confirms a bulk endpoint exists.
- **§E address-FK consistency:** `addressId` patch must validate the address belongs to `consignees.id` of the task; cross-consignee address assignment refused.
- **§A1 createTask audit-event posture:** existing `task.created` audit event captures `actor_kind`; no schema change. New code reads actor_kind to differentiate system-cron vs user-ad-hoc origins.

---

## Plan-PR verification gates

T3 plan-PR posture (lighter than code-PR):

- ✓ `npm run typecheck` clean (no code changes; should pass trivially)
- ✓ `npm run lint` zero net-new (baseline = 7 pre-existing warnings)
- ✗ `npm test` not applicable (plan-only; no test surface)
- ✓ Branch `day19/phase-1-merchant-crud-plan` from `main` HEAD `8044221` (verified Day-19 PM)
- ✓ §A discovery findings code-cited (file:line + snippets)
- ✓ §K Day-5 amendment memo drafted
- ✓ §L Aqib coordination memo drafted
- ✓ §M materializeTenant CTE extraction finding surfaced
- ✓ All 6 OQ rulings absorbed verbatim

---

## Sources of truth referenced

- [`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) §3.1.7 (bounded-pause), §3.6 (SF identifier model), §5 (demo narrative)
- [`memory/decision_task_module_no_user_create_delete.md`](../decision_task_module_no_user_create_delete.md) (Day-5 lock — amended by §K)
- [`memory/plans/day-14-cron-decoupling.md`](day-14-cron-decoupling.md) (QStash decoupling pattern; cron architecture)
- [`memory/plans/day-14-part2-service-layer.md`](day-14-part2-service-layer.md) (subscription lifecycle; bounded-pause architecture)
- [`memory/followup_suitefleet_webhook_policy.md`](../followup_suitefleet_webhook_policy.md) (canonical 15-event SF taxonomy)
- PR #160 (bounded-pause Block 4-C; load-bearing for §D)
- PR #145/#153 (Day-14 cron-decoupling; load-bearing for §A2 + §G QStash pattern)

---

**End of plan body. Hard-stop at plan-PR open. Reviewer §3.6 counter-review next.**
