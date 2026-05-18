# Day-30 plan-PR — B2 /tasks-page cancel + edit (address + driver-note only)

**Filed:** 2026-05-18 (Day-30). **Lane tier:** T3-light (reuses already-proven service paths; design surface is in the per-row UI wiring + the subscription-vs-ad-hoc cancel-path dispatch, not in new service code). **Plan-PR scope:** docs only (this file). **Eventual code-PR scope:** scoped in §9.

**Status:** AWAITING §3.6 reviewer review on this plan-PR. T3-light hard-stop is this plan-PR's §3.6.

---

## §1 — Lane entry conditions + locked constraints

**Lane entry.** Love (product owner) ruled B2 scope: (a) **CANCEL** — surface the already-proven #305 cancel-with-SF path on the merchant `/tasks` page; (b) **EDIT** — address + driver-note ONLY (delivery-date DELIBERATELY excluded to avoid overlap with the skip/exception model); (c) a **T1 brief-amendment / decision-memo amendment** correcting the Day-3 ASSIGNED-cutoff drift surfaced by the Day-30 investigation map.

**Working state.**

- Origin/main HEAD `b86466a` at lane open (production-live `dpl_9QHFqS36fVs9A11jw1UZzMGRfdJm` on `planner-olive-sigma.vercel.app`).
- Brief on main: PLANNER_PRODUCT_BRIEF.md — §3.1.8 cut-off rule is **already** time-based ("hardcoded 18:00 local time the day before delivery"). Brief itself is consistent with code; the drift is in the separate `memory/decision_task_editability_cutoff_at_assigned.md` (Day-3, 28 April 2026) which says "once a task is assigned, it is locked from the merchant's view." That decision memo is the supersede target. Brief version-bump TBD per OQ-6 below.
- A1 plan-PR #306 filed in parallel; A1 = inbound status-apply/display. **B2 = outbound cancel + tasks-page UI.** Zero code-surface overlap (§5).

**Locked constraints (restated from the reviewer-scoped prompt; do not deviate):**

1. **Reuse already-proven service paths; do NOT design new cancel/edit mechanisms.** Specifically:
   - CANCEL → reuse `addSubscriptionException(type:"skip", skipWithoutAppend:true)` → `markTaskSkipped` → post-commit `enqueueCancelTask` → `/api/queue/cancel-task` → `adapter.cancelTask` (the #305 path, also surfaced by `cancelNoAppendAction` from the calendar popover at [_calendar-actions.ts:397](src/app/(app)/consignees/%5Bid%5D/_calendar-actions.ts#L397)).
   - EDIT → reuse `PATCH /api/tasks/:id` → `updateTask` ([service.ts:1020-1100](src/modules/tasks/service.ts#L1020-L1100)) for `addressId` and `notes` only. The route's `UpdateTaskBodySchema` already admits both fields ([schemas.ts:34-52](src/modules/tasks/schemas.ts#L34-L52)).
2. **Delivery-date is DELIBERATELY excluded from B2.** The B2 edit UI MUST whitelist `addressId` + `notes` only, even though `updateTask`'s schema admits `deliveryDate` + 13 other fields. Reviewer ruling: date-edits route through the skip/exception model only — the calendar popover's skip-with-override (move-to-date) variant is the canonical surface and is currently Aqib-gated for SF reschedule (Phase 2 of #305 lane).
3. **No new cutoff guard introduced.** The existing time-based `isCutOffElapsedForDate(now, deliveryDate)` 18:00-Dubai-day-before guard at 10 sites is the ratified rule. B2 surfaces routes that ALREADY enforce it inside their existing service paths — confirmed at the per-path site in §2 + §3.
4. **No new SF outbound path for address edits.** Per `updateTaskAndPushOutbound` line ~1602-1626 comment, address-only patches DO NOT enqueue a SF push (snapshot mapping deferred Day-22+). The B2 edit UI MUST disclose this to the operator with the **§3.6-RULED verbatim UX copy** (OQ-3): **"Address change saved; SuiteFleet will reflect on the next scheduled push pass"** (exact wording — do not paraphrase). Reviewer ruling on OQ-3 = (a) accept gap; final copy locked.
5. **§3.6 review gates merge.** Plan-PR §3.6 (this PR) is T3-light hard-stop. Code-PR §3.6 is its own gate. Integration spec runtime confirmation is the standard gate.
6. **No self-tier-escalation.** OQs in §7 ruled by reviewer. ASSIGNED-edge handling (§4) and address-edit reconciliation (§3 OQ-2) are surfaced, not absorbed.

**Lane out-of-scope (restated for clarity):**
- A1 status-mapping-defect (plan #306). Different code surface (inbound apply + drawer); zero overlap.
- Reschedule via move-to-date (Phase 2 of #305). Aqib-gated; not in B2.
- Outbound address-snapshot push to SF (deferred Day-22+ scope per `updateTaskAndPushOutbound` comment).
- /admin/* surfaces. B2 is the merchant operator's `/tasks` page only.

---

## §2 — CANCEL surface

### §2.1 — UI surface (proposed)

Per-row "Cancel" affordance on the `/tasks` list ([src/app/(app)/tasks/page.tsx](src/app/(app)/tasks/page.tsx) + [client.tsx](src/app/(app)/tasks/client.tsx)). Today the page is read-only with multi-select print-labels only (see Day-30 investigation Q2). The cancel UI lands as a per-row icon-button or kebab-menu, with a confirmation modal disclosing "This cancels the delivery on SuiteFleet and reduces subscription count by one. This cannot be undone."

### §2.2 — Service-path reuse — subscription-linked vs ad-hoc tasks

> **§3.6 RULING (OQ-1) — OVERRULED to SINGLE canonical path.** Reviewer-locked: subscription-linked tasks only, via `cancelNoAppendAction`'s service path. **Ad-hoc tasks: cancel shows VISIBLE-BUT-DISABLED with explanatory tooltip; form action ALSO rejects ad-hoc cancel server-side** (disabled button is bypassable — defense-in-depth required). **Do NOT un-cobweb `tasks.cancelTask`** — zero-consumer dormant fn carries silent-failure risk; surfacing it for B2 inverts the risk profile vs the benefit. The builder's two-path recommendation below is superseded; preserved for review history only. See B2-I2′ in §5.1 for the integration spec replacing B2-I2 + B2-I4.

**This is the load-bearing scope decision for cancel (see OQ-1).** The investigation map confirmed two task lineages:

1. **Subscription-linked tasks** (have `tasks.subscription_id IS NOT NULL`, materialized by cron from a subscription) — the `cancelNoAppendAction` path is the literal reuse target. Service call:
   ```
   addSubscriptionException(ctx, subscriptionId, {
     type: "skip",
     date: deliveryDate,
     idempotencyKey,
     skipWithoutAppend: true,
   })
   ```
   This path is post-#305 enqueue-guaranteed: in-tx `markTaskSkipped` sets `internal_status='SKIPPED'` AND flips `outbound_sync_state='pending_cancel'`; post-commit `enqueueCancelTask` fires iff `external_tracking_number IS NOT NULL`.

2. **Ad-hoc tasks** (have `tasks.subscription_id IS NULL`, created via `createAdHocTask` from the consignee detail page _actions.ts:170-260) — `cancelNoAppendAction` cannot be used (requires `subscriptionId`). The dormant `tasks.cancelTask` service-fn ([tasks/service.ts:1263](src/modules/tasks/service.ts#L1263); ZERO consumers today per Day-30 investigation Q4) IS a working cancel-with-SF path: permission `task:cancel`, time-cutoff guard at line 1295, post-commit `enqueueCancelTask` at line 1333. **But** its audit shape is generic `task.updated` (changed_fields=['internalStatus'], to_internal_status='CANCELED') — different from the `subscription.exception.created` event the subscription-linked path emits.

**Builder's recommendation (OQ-1):** the /tasks page UI dispatches based on `task.subscriptionId`:
- `subscriptionId !== null` → `cancelNoAppendAction`-equivalent server action (literal reuse of the proven path); audit row `subscription.exception.created` with `type='skip', skipWithoutAppend:true`.
- `subscriptionId === null` → `tasks.cancelTask`-equivalent server action (un-cobwebs the dormant fn for its first real consumer); audit row `task.updated` with `to_internal_status='CANCELED'`.

Both paths converge on `enqueueCancelTask` → `/api/queue/cancel-task` → `adapter.cancelTask` — same SF outbound surface, same time-cutoff guard. The operator-visible UX is identical ("Delivery cancelled; SuiteFleet notified"). The audit semantics differ because the data lineage differs (subscription vs ad-hoc). Reviewer rules whether this two-path dispatch is acceptable, or whether B2 should pick a single canonical path and refuse the other lineage with a clear error.

### §2.3 — Permission gating

> **§3.6 RULING (per OQ-1 single-canonical-path collapse):** the B2 surface uses `subscription:override_skip_rules` for both UI visibility AND service-layer enforcement on subscription-linked tasks. Ad-hoc tasks: cancel button rendered disabled with tooltip "Cancel via SuiteFleet directly — this task has no Planner subscription" (final copy TBD by Love); server-side form action rejects with `ValidationError("ad-hoc tasks cannot be cancelled from /tasks; cancel directly on SuiteFleet")`. The two-perm builder recommendation below is superseded.

Today's perms:
- `cancelNoAppendAction` reuses `subscription:override_skip_rules` (Operations Manager + Tenant Admin; CS Agent does NOT have it).
- `tasks.cancelTask` uses `task:cancel` (per §J-5 split: ops-manager + cs-agent) — **NOT invoked by B2 per OQ-1 ruling.**

**Builder's recommendation (superseded):** the B2 surface checks BOTH the dispatched-path's existing perm AND a coarse top-level `task:cancel` for the UI affordance visibility. Two perms because:
- The UI button visibility check needs to be cheap and uniform across both lineages → use `task:cancel`.
- The service-layer enforcement uses the lineage-specific perm (preserves existing rules, doesn't broaden authorization).

Reviewer rules in OQ-1 (same OQ as the dispatch question — they're entangled).

### §2.4 — Time-cutoff guard — enforcement point

CONFIRMED enforced on BOTH paths inside the service layer; B2 does not need to add or re-implement the guard:

- Subscription path: [subscription-exceptions/service.ts:397](src/modules/subscription-exceptions/service.ts#L397) — pre-tx, throws `ValidationError("delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception")`.
- Ad-hoc path: [tasks/service.ts:1295](src/modules/tasks/service.ts#L1295) — in-tx, throws `ValidationError("task delivery date '${X}' is past the 18:00 Dubai cut-off the day before; cannot cancel")`.

UI surface: the cancel button can be RENDERED on rows whose `delivery_date` is past cutoff (read-side has no way to know cutoff status without a live time check) — server response is the gate. The UI handles the `ValidationError` by showing inline text in the cancel modal: "Past the cut-off (18:00 the day before delivery). Cannot cancel."

### §2.5 — Idempotency

Both reused paths already enforce idempotency:
- Subscription path: `findByIdempotencyKey(tx, subscriptionId, idempotencyKey)` returns the existing exception_id+409 on replay.
- Ad-hoc path: `cancelTask`'s "Idempotent fast-path" early return at [service.ts:1284-1287](src/modules/tasks/service.ts#L1284-L1287) — already-CANCELED task returns without writes.

UI uses server-generated idempotency keys per the popover precedent (`_calendar-actions.ts:85` pattern).

---

## §3 — EDIT surface (address + driver-note ONLY)

### §3.1 — UI surface (proposed)

Per-row "Edit" affordance on `/tasks`. Two sub-surfaces (or one combined drawer):
- **Address:** dropdown of the consignee's available addresses, similar to the popover's `ChangeAddressPanel` ([DayActionPopover.tsx:404-484](src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx#L404-L484)).
- **Driver note:** textarea (max 1000 chars; matches `ADD_NOTE_MAX_LENGTH` at [service.ts:1402](src/modules/tasks/service.ts#L1402)).

Both reuse the existing service paths.

### §3.2 — Driver-note path mapping

**Builder's recommendation:** reuse the dedicated `addNoteToDriver` fn ([tasks/service.ts:1404](src/modules/tasks/service.ts#L1404)) — the same fn the popover's `addNoteToDriverAction` already calls. Reasons:
- Single-purpose service-fn with its own audit event `task.note_added` (per the brief's typed-event-per-workflow precedent in `subscription.exception.created`).
- Already has cutoff guard at [service.ts:1431](src/modules/tasks/service.ts#L1431).
- Already has PII safety (note text NOT in audit metadata; durable on `tasks.notes`).
- Reuses permission `task:add_note`.
- Does NOT route through the catch-all `updateTask` (avoids generic `task.updated` event for a single-purpose workflow).

Alternative (NOT recommended): route through `PATCH /api/tasks/:id { notes }` → `updateTask`. This works but conflates with the catch-all event surface and forfeits the typed-event audit lineage. Reviewer rules in OQ-4.

### §3.3 — Address-edit path — RECONCILIATION DECISION (the load-bearing OQ-2)

> **§3.6 RULING (OQ-2) — Path A UPHELD (direct column write via `updateTask`).** Binding constraint: the resulting **/tasks Path A vs calendar-popover Path B asymmetry MUST be explicitly documented in the plan as a known intentional MVP asymmetry** — see §3.3.1 below.

**Two paths exist in the codebase; they have different reconciliation semantics and different reach (subscription-linked vs ad-hoc).** Reviewer must rule which one B2 uses.

**Path A — Direct column write via `updateTask`:**

```
PATCH /api/tasks/:id { addressId } → updateTask(ctx, taskId, { addressId })
```

Code path: [api/tasks/[id]/route.ts:66](src/app/api/tasks/%5Bid%5D/route.ts#L66) → [tasks/service.ts:1057+](src/modules/tasks/service.ts#L1057) (cutoff guard, address-FK consistency check at line 1075-1100, UPDATE `tasks.address_id`). No `subscription_exceptions` row written.

- ✅ Works for BOTH subscription-linked AND ad-hoc tasks (no `subscription_id` requirement).
- ✅ Simpler — single column write, no exception model side-effects.
- ✅ Permission already wired: `task:update`.
- ✅ Address-FK consistency check (cross-consignee + cross-tenant) already at [service.ts:1080-1100](src/modules/tasks/service.ts#L1080-L1100).
- ❌ Does NOT enqueue SF address-push today (`updateTaskAndPushOutbound` line 1602-1626 explicitly leaves address-only patches as local-only; "snapshot mapping deferred Day-22+"). Address change is local; SF reflects on next scheduled push pass. **UX disclosure required per §3.6 OQ-3 ruling: verbatim "Address change saved; SuiteFleet will reflect on the next scheduled push pass".**
- ❌ Forfeits the lineage record of "this address was overridden for this delivery vs. that delivery" — no `subscription_exceptions.type='address_override_one_off'` row.

**Path B — Subscription-exception via `addSubscriptionException`:**

```
addSubscriptionException(ctx, subscriptionId, {
  type: "address_override_one_off",
  date: deliveryDate,
  idempotencyKey,
  addressOverrideId,
})
```

Code path: [subscription-exceptions/service.ts:360+](src/modules/subscription-exceptions/service.ts#L360); creates exception row, emits `subscription.exception.created` + `subscription.address_override.applied` audit events. (Per [popover ChangeAddressPanel](src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx#L404-L484) — the calendar surface uses this path.)

- ✅ Preserves the exception lineage (matches the calendar popover's existing semantics).
- ✅ Already has cutoff guard.
- ❌ ONLY works for subscription-linked tasks (requires `subscriptionId`).
- ❌ Also does not enqueue SF push today (the exception path doesn't auto-trigger SF address sync either).
- ❌ Two-path dispatch problem (same as §2.2): /tasks list mixes subscription-linked + ad-hoc, so B2 would need lineage-aware UI dispatch for address too.

**Builder's recommendation (OQ-2):** **Path A** — direct column write via `updateTask`. Reasons: (1) uniform path for both lineages; (2) simpler UI dispatch (no subscription_id branching); (3) the lineage forfeiture is recoverable via the audit-log query "what address did this task have at delivery time?" via `task.updated` event metadata; (4) the calendar popover's Path B continues to exist for the workflow it's designed for ("change address for this delivery only, in the subscription context"), so the lineage record IS preserved for operators who use the calendar surface. Reviewer rules; this is the load-bearing OQ Love flagged.

### §3.3.1 — KNOWN INTENTIONAL MVP ASYMMETRY: /tasks Path A vs popover Path B (per §3.6 OQ-2 binding constraint)

§3.6 ruling on OQ-2 upholds Path A for the /tasks surface AND keeps Path B intact for the calendar popover surface. The asymmetry is intentional MVP scope and is documented here per reviewer binding constraint so future maintainers, operators, and ops auditors can distinguish "two surfaces by design" from "drift between surfaces."

**The two surfaces produce different durable records for the same operator-facing intent ("change address for this delivery"):**

| Aspect | /tasks page (Path A) | Calendar popover (Path B) |
|---|---|---|
| **Service-fn called** | `updateTask(ctx, taskId, { addressId })` | `addSubscriptionException(ctx, subscriptionId, { type: "address_override_one_off", addressOverrideId, date })` |
| **Reach** | Both subscription-linked + ad-hoc tasks | Subscription-linked only (requires `subscriptionId`) |
| **Permission** | `task:update` | `subscription:change_address_one_off` |
| **`tasks.address_id`** | Updated directly | Updated indirectly (via the exception's effect on the task row) |
| **`subscription_exceptions` row** | NO row written | NEW row written with `type='address_override_one_off'` |
| **Audit events emitted** | `task.updated` with `metadata.changed_fields=['addressId']` | `subscription.exception.created` + `subscription.address_override.applied` (both correlated by `correlation_id`) |
| **Reversibility / lineage trace** | Audit log query: `SELECT metadata->>'old_addressId' FROM audit_events WHERE event_type='task.updated' AND resource_id=...` | Direct read: `SELECT * FROM subscription_exceptions WHERE subscription_id=... AND type='address_override_one_off'` |
| **SF outbound push** | Local-only today (per OQ-3 accepted gap) | Local-only today (exception path doesn't auto-trigger SF address push either) |

**Why the asymmetry is acceptable for MVP:**

1. **Uniform reach** at the /tasks page is operationally load-bearing — operators expect every row to have a working Edit button regardless of lineage, and the /tasks page is the operator's "everything view." Path B can't deliver this without per-row dispatch + disabled-state on ad-hoc rows (the same disabled-state pattern OQ-1 forced for cancel — but unlike cancel, edit-address has a working uniform alternative via Path A, so the disabled-state cost is unnecessary).
2. **Calendar popover Path B is workflow-specific** — operators using the popover have already chosen the subscription context ("I'm here looking at a subscription's calendar; this delivery's address is wrong for the subscription's pattern"). The exception-model semantic ("this delivery is a one-off override of the subscription's address rotation") is meaningful at that surface and would be lost if collapsed to Path A globally.
3. **The audit trail bridges both surfaces** — any operator or auditor asking "what did this task's address look like across its lifetime, and which surface changed it?" can answer via `audit_events.event_type` filtering. The two event-type vocabularies (`task.updated` vs `subscription.exception.created`) are themselves the disambiguator.
4. **Post-demo convergence is a separable follow-up** — if Transcorp wants surface-uniform audit lineage in v2, the migration is either (a) collapse the popover to Path A (loses exception-model lineage forever — high cost), or (b) extend the /tasks Path A to also write a `subscription_exceptions` row when `subscriptionId IS NOT NULL` (preserves both lineages and surface-uniform — recommended post-MVP path). Not in B2's scope; logged as candidate.

**Operator-facing implication (UX disclosure):** when an operator edits an address from /tasks on a subscription-linked task, the calendar popover for the same task on the same date will NOT show a "yellow address-override badge" (that badge is driven by the existence of the `subscription_exceptions` row, not the `tasks.address_id` value). This is a known visual asymmetry for MVP. Reviewer rules whether the B2 code-PR also adds a one-line note in the UX copy ("Address edits made here are not tagged as subscription-level overrides; use the calendar to edit for the calendar's audit lineage"); recommendation: skip the copy for MVP (operators won't notice; calendar surface is internal-ops only).

**Auditor-facing implication:** the post-B2 audit-log query "show me every address change for this task" requires UNION across `audit_events WHERE event_type='task.updated' AND metadata->>'changed_fields' ? 'addressId'` ∪ `audit_events WHERE event_type='subscription.address_override.applied' AND resource_id=<task's subscription_id>`. Both event types carry actor + timestamp + metadata; the union is straightforward but is NOT a single-query pattern. Logged in the `followup_tasks_page_vs_popover_address_path_asymmetry.md` companion memo (OQ-9 expanded set).

### §3.4 — Delivery-date EXPLICITLY EXCLUDED

The /tasks-page edit UI MUST NOT expose a delivery-date editor field. The `UpdateTaskBodySchema` admits `deliveryDate` (and 13 other fields) — that is fine for the route's API surface, but **the B2 form action MUST whitelist only `{ addressId, notes }` from the user input before forwarding to `updateTask`/`addNoteToDriver`.** If reviewer wants stricter enforcement, OQ-5 surfaces "should B2 also add a `.pick({ addressId: true, notes: true })` boundary at the form-action layer to reject any other field server-side?" Builder's recommendation: yes, defense-in-depth.

The reason for the exclusion: date-edit semantics are owned by the skip/exception model (popover's skip-with-override → move-to-date variant). Adding an in-place date-edit on /tasks would either (a) bypass the exception model (and the audit lineage that comes with it), or (b) duplicate the exception model's complexity in a second UI surface. The calendar popover IS the canonical surface for date changes; B2 leaves that intact.

### §3.5 — Cutoff guard — enforcement point

CONFIRMED enforced inside the service layer; B2 does not need to add or re-implement:

- `updateTask` (address path): [tasks/service.ts:1057](src/modules/tasks/service.ts#L1057) (current deliveryDate cutoff) + line 1063-1071 (if patch moves deliveryDate, new target also checked — but B2 excludes deliveryDate so the second branch is moot here).
- `addNoteToDriver` (note path): [tasks/service.ts:1431](src/modules/tasks/service.ts#L1431).

Same UI handling pattern as §2.4: server-side `ValidationError` surfaced inline.

---

## §4 — ASSIGNED-edge — explicit no-op for B2

**B2 does NOT introduce the ASSIGNED-early risk.** The risk surface:

> A task with `internal_status='ASSIGNED'` has been pushed to SuiteFleet AND assigned to a driver. Per the Day-3 decision memo `decision_task_editability_cutoff_at_assigned.md`, that task should be locked from merchant edits. But because no code gates on internal_status='ASSIGNED', and because today is BEFORE the time-cutoff (18:00 Dubai day-before delivery for a future-dated task), the time-based guard ALLOWS the cancel/edit through.

This risk **already exists today** on the calendar popover — [DayActionPopover.tsx:101-105](src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx#L101-L105) MUTATION_ELIGIBLE_STATUSES explicitly includes `'ASSIGNED'`. B2 surfaces the same already-permitted paths on the /tasks page. **No new ASSIGNED-state risk is introduced by B2.**

**Plan posture:** B2 does NOT add a new ASSIGNED-state guard. The §3 cutoff-drift memo (§6 below) ratifies the time-based rule AND logs the "ASSIGNED before time-cutoff → merchant could cancel a dispatched task" edge as a KNOWN pre-existing post-demo hardening item, not as a B2 deliverable. The follow-up fix (if Transcorp wants the original Day-3 lock semantics restored) is a separate lane; it would touch the popover MUTATION_ELIGIBLE_STATUSES + add a service-layer guard at all 10 cutoff sites.

---

## §5 — INTERACTION — zero overlap with A1

A1 plan-PR #306 = inbound status-apply/display (apply-webhook-status-event.ts + status-mapper.ts + TaskTimelineDrawer.tsx + parser KNOWN_ACTIONS). B2 = outbound cancel/edit (tasks/service.ts + subscription-exceptions/service.ts + /tasks-page UI).

**File-level overlap analysis:**

| File | A1 touches? | B2 touches? | Overlap risk |
|---|---|---|---|
| `apply-webhook-status-event.ts` | Yes (OQ-3, OQ-5) | No | Zero — different code surface |
| `status-mapper.ts` | Yes (vocabulary reconciliation) | No | Zero |
| `webhook-parser.ts` | Yes (KNOWN_ACTIONS reconciliation) | No | Zero |
| `TaskTimelineDrawer.tsx` | Yes (ACTION_LABELS reconciliation) | No | Zero |
| `tasks/service.ts` (cancelTask, updateTask, addNoteToDriver) | No | Yes (un-cobwebs `cancelTask` consumer surface; new form actions calling existing fns) | Zero — A1 doesn't touch these |
| `subscription-exceptions/service.ts` | No | Yes (new form action that calls `addSubscriptionException`) | Zero |
| `/api/tasks/[id]/route.ts` | No | Yes (new consumer) | Zero — A1 doesn't touch this route |
| `/(app)/tasks/client.tsx` + new `/(app)/tasks/_actions.ts` | No | Yes (B2's primary surface) | Zero |

**Merge-order concern:** A1 and B2 can merge in either order. A1 touches inbound files; B2 touches outbound files + UI. No rebase conflicts expected. **B2 may merge BEFORE A1 without issue** — confirmed.

### §5.1 — Integration specs the code-PR must add

1. **B2-I1 — subscription-linked cancel end-to-end (real Postgres):** seed a subscription-linked task with `external_tracking_number` set + delivery_date in future; new form action fires → assert `subscription_exceptions` row inserted, `tasks.internal_status='SKIPPED'`, `tasks.outbound_sync_state='pending_cancel'`, post-commit `enqueueCancelTask` mock invoked once.
2. **B2-I2′ — ad-hoc cancel REJECTED via single-canonical-path enforcement (per §3.6 OQ-1 OVERRULE; REPLACES the original B2-I2 + B2-I4 specs).** Two-layer assertion:
   - **UI layer:** render the /tasks list with at least one ad-hoc task (`subscription_id IS NULL`); assert the per-row Cancel button is in disabled state with the explanatory tooltip ("Cancel via SuiteFleet directly — this task has no Planner subscription"; final copy TBD by Love). Pin the disabled-state via React-Testing-Library or equivalent client-component assertion (test surface mirrors the existing /tasks client.tsx test layer).
   - **Server layer (defense-in-depth — disabled button is bypassable):** invoke the new server form-action directly with an ad-hoc task's id → assert `ValidationError("ad-hoc tasks cannot be cancelled from /tasks; cancel directly on SuiteFleet")` (or the final reviewer-approved copy); NO `subscription_exceptions` row inserted; NO `tasks.internal_status` change; NO `enqueueCancelTask` invocation; NO audit row emitted.
3. **B2-I3 — cancel past cutoff (subscription path):** seed task with delivery_date = today + clock fixed to 19:00 Dubai; cancel → `ValidationError` with cutoff message; no DB writes.
4. **(B2-I4 removed per §3.6 OQ-1 ruling — no ad-hoc cancel path lands in B2; the ad-hoc rejection is covered by B2-I2′ server-layer assertion.)**
5. **B2-I5 — address edit via Path A (UPHELD per §3.6 OQ-2):** seed task; PATCH `addressId` to a valid address belonging to the consignee → `tasks.address_id` updated, `tasks.updated_at` advanced, audit `task.updated` with `changed_fields:['addressId']`, NO `enqueueUpdateTask` (per §3.3 — address-only patches skip SF push per OQ-3 ruling).
6. **B2-I6 — driver-note edit via `addNoteToDriver`** (UPHELD per §3.6 OQ-4): existing `addNoteToDriver` integration spec coverage applies — surface a smoke spec from /tasks form action to confirm wiring.
7. **B2-I7 — date-edit rejected at form-action layer** (APPROVED per §3.6 OQ-5 defense-in-depth `.pick({addressId, notes})`): form action receives `{ deliveryDate: "2026-06-01" }` → reject before service call with `ValidationError("delivery date cannot be edited on this surface; use the calendar popover skip-with-override")`. Whitelist enforcement asserted via Zod `.pick({addressId: true, notes: true}).strict()` or equivalent boundary schema.
8. **B2-I8 — ASSIGNED-state mutation allowed (pre-existing behaviour confirmation):** seed task with `internal_status='ASSIGNED'`, delivery_date in future, before-cutoff → cancel succeeds. Pin the "B2 does not regress to a new ASSIGNED-state guard" contract.

---

## §6 — Cutoff-drift memo (T1, rides along this lane)

**Scope:** a single commit in the B2 code-PR (or as a separate T1 plan-precursor commit per OQ-7). Two artifacts:

### §6.1 — `memory/decision_task_editability_cutoff_at_assigned.md` amendment

Append a "SUPERSEDED" header section to the existing Day-3 memo. Content:

> **SUPERSEDED 2026-05-18 (Day-30, B2 plan-PR #<N>):** The "lock at TASK_HAS_BEEN_ASSIGNED" rule described above is NOT enforced in code. Brief §3.1.8 (which post-dates this memo) commits to a time-based 18:00-Dubai-day-before cut-off, enforced at 10 service-layer sites via `isCutOffElapsedForDate`. The popover's `MUTATION_ELIGIBLE_STATUSES` ([DayActionPopover.tsx:101-105](../src/app/(app)/consignees/%5Bid%5D/_components/DayActionPopover.tsx#L101-L105)) explicitly includes `'ASSIGNED'` as mutation-eligible. B2 plan-PR §4 ratifies the time-based rule as canonical and logs the "task ASSIGNED before time-cutoff → merchant could cancel a dispatched task" edge as a KNOWN pre-existing post-demo hardening item (not B2's deliverable; see followup memo at `memory/followup_assigned_before_cutoff_dispatch_race.md`).

### §6.2 — New `memory/followup_assigned_before_cutoff_dispatch_race.md`

Type: project follow-up. Captures the post-demo hardening item:

> **Edge:** a task whose `internal_status='ASSIGNED'` (driver bound, may already have the task on their route plan) AND whose `delivery_date` is still BEFORE the 18:00-Dubai-day-before cut-off → operator can today cancel via calendar popover or (post-B2) via /tasks page. Per the superseded Day-3 decision memo (`decision_task_editability_cutoff_at_assigned.md`), Transcorp's global operational rule is "lock at assignment, route changes via cancelTask + replacement." The time-based cut-off does NOT match this rule for the ASSIGNED-before-time-cutoff window (typically the 25-minutes-to-12-hours operational gap between assignment and pickup).
>
> **Why this is acceptable for MVP:** demo flows are operator-driven on tasks not yet at the ASSIGNED state (the demo uses fresh subscription tasks created same-day, cancelled before SF assigns them). The edge is theoretically reachable in production but not on a demo timeline.
>
> **Fix candidates (post-demo):**
> - (A) Add `internal_status !== 'ASSIGNED'` guard at all 10 `isCutOffElapsedForDate` sites OR refactor to a single shared editability-check fn. ~2 hours.
> - (B) Add a soft warning ("This task is already assigned to a driver. Cancelling will dispatch a SF cancel notification mid-route. Proceed?") instead of hard-block. ~1 hour UI only.
> - (C) Accept the time-based rule as the canonical contract and update the Day-3 decision memo wholesale. Documentation-only.
>
> **Reviewer's call** (post-demo). Until ruled, the edge is documented + visible to ops via the audit trail (`task.updated` / `subscription.exception.created` events).

### §6.3 — Brief version-bump — TBD per OQ-6

The brief §3.1.8 is already time-based and consistent with code. **Builder's recommendation (OQ-6):** NO brief version-bump — the brief is the source of truth and code matches; the drift is only in the separate Day-3 decision memo which gets the supersede header. If reviewer prefers brief explicitly mention the supersede ("§3.1.8 is canonical; supersedes the Day-3 `decision_task_editability_cutoff_at_assigned.md` lock-at-assignment framing"), that's a v1.16 append per `feedback_brief_amendment_log_append_only` — append-only, no retroactive edits.

---

## §7 — Open questions (number every reviewer decision)

**OQ-1 — Cancel dispatch: single canonical path vs two-path lineage-aware dispatch. §3.6 RULED — OVERRULED to SINGLE canonical path: subscription-linked tasks ONLY via `cancelNoAppendAction`.** Ad-hoc tasks: cancel shows VISIBLE-BUT-DISABLED with explanatory tooltip; form action ALSO rejects ad-hoc cancel server-side (disabled button is bypassable — defense-in-depth required). **Do NOT un-cobweb `tasks.cancelTask`** (zero-consumer fn carries silent-failure risk; surfacing inverts risk vs benefit). See B2-I2′ in §5.1 for the integration spec replacing the original B2-I2 + B2-I4. Builder's two-path recommendation preserved for review-history only.

**OQ-2 (LOAD-BEARING) — Address-edit reconciliation: Path A direct column write vs Path B exception model. §3.6 RULED — Path A UPHELD via `updateTask`** (§3.3). Binding constraint: the resulting /tasks Path A vs calendar-popover Path B asymmetry MUST be explicitly documented as a known intentional MVP asymmetry — see §3.3.1 (now satisfies that constraint). Path B is NOT collapsed; it remains the calendar-popover surface's path. Builder's recommendation upheld; alternatives (Path B subscription-only, hybrid) rejected.

**OQ-3 — Address-edit SF outbound enqueue (gap fill vs accept). §3.6 RULED (a) — accept gap WITH mandatory UX disclosure copy locked verbatim: "Address change saved; SuiteFleet will reflect on the next scheduled push pass".** Operator-facing copy uses this exact wording (do not paraphrase). Today address-only patches DO NOT enqueue SF push (`updateTaskAndPushOutbound` line 1602-1626 deferred to Day-22+). Builder's recommendation (a) upheld; option (b) extend `updateTaskAndPushOutbound` in this lane is explicitly OUT (preserves T3-light scope); option (c) separate post-demo lane is the deferred fix path (`followup_address_edit_sf_outbound_gap.md` per OQ-9).

**OQ-4 — Driver-note path: `addNoteToDriver` vs `updateTask{notes}`. §3.6 RULED — `addNoteToDriver` upheld** (NOT the catch-all `updateTask`). Preserves typed-event audit (`task.note_added`), PII safety (note text not in audit metadata), and consistency with calendar popover surface. Builder's recommendation upheld.

**OQ-5 — Defense-in-depth whitelist at form-action layer. §3.6 RULED — APPROVED.** Form action explicitly rejects any field other than `addressId` + `notes` via server-side `Zod.pick({addressId: true, notes: true}).strict()` (or equivalent narrow boundary schema). Even though `UpdateTaskBodySchema` admits more, B2's form-action surface narrows the contract. Pinned by integration spec B2-I7.

**OQ-6 — Brief version-bump for cutoff-drift memo (§6.3). §3.6 RULED — OVERRULED: v1.16 brief append.** Record the supersede at the source of truth (the brief itself) — one-line, append-only line, rides B2 code-PR as T1. Builder's "no bump" recommendation overridden because the Day-3 decision memo lives separately from the brief; if a future maintainer reads only the brief, they should see the supersede explicitly. **Note re A1 OQ-7 ("no brief v1.16 for status-mapping fix"): different scope — B2's v1.16 line is a 1-line cutoff-drift supersede record, NOT a v1.16 to absorb A1's wire-vocabulary fix; both rulings coexist (A1's "no v1.16 for the status-mapping fix" stands.)**

**OQ-7 — Cutoff-drift memo commit shape. §3.6 RULED — single commit in B2 code-PR upheld.** Builder's recommendation upheld. The brief v1.16 append (per OQ-6 ruling) AND the Day-3 decision memo amendment AND the new `followup_assigned_before_cutoff_dispatch_race.md` AND the code changes all land in ONE B2 code-PR commit.

**OQ-8 — UI dispatch for cancel/edit buttons across lineages. §3.6 RULED — fold into B2 (now LOAD-BEARING).** OQ-1's disabled-state ruling needs the UI to know `task.subscriptionId` to render the disabled-vs-enabled cancel button correctly. The read-shape widening (verify `Task` carries `subscriptionId` at code-PR open; if missing, widen) is now LOAD-BEARING in B2 — not a "fold-if-reviewer-OK" question. Pre-check at code-PR open is the first builder action.

**OQ-9 — Companion followup memos. §3.6 RULED — all three.** File in B2 code-PR:
- `memory/followup_assigned_before_cutoff_dispatch_race.md` (§6.2 — ASSIGNED-before-cutoff edge)
- `memory/followup_address_edit_sf_outbound_gap.md` (per OQ-3 (a) ruling — SF outbound address-push deferral surface)
- `memory/followup_tasks_page_vs_popover_address_path_asymmetry.md` (per §3.3.1 binding constraint — the intentional MVP Path A vs Path B asymmetry; cross-references the v1.16 brief append + the audit-log union pattern auditors need)

---

## §8 — Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Two-path dispatch (OQ-1) introduces operator confusion ("why is the cancel button styled differently for some tasks?") | Low | Both paths produce identical UX text + identical audit log surface for operators; only the audit-event-type differs (forensic-only) |
| Path A direct-column-write for address (OQ-2) forfeits exception lineage for tasks edited via /tasks but later inspected via calendar popover | Medium | The audit trail (`task.updated` event with `changed_fields:['addressId']`) preserves the change history; the calendar popover's DayDisplayStatus reads from `tasks.address_id` directly, so the visual reflects the latest address regardless of which surface set it |
| Address-edit SF gap (OQ-3 = (a)) means SF and Planner diverge on address until next push pass | Medium | Documented in UX copy; ops triage via `tasks WHERE address_id != <last-pushed-snapshot>` query (not a B2 deliverable; post-demo); next cron tick reconciles via the push path |
| ASSIGNED-edge (§4) is theoretically reachable in production by an operator cancelling a same-day-assigned task | Low for demo / Medium for prod | Documented in `followup_assigned_before_cutoff_dispatch_race.md` as post-demo hardening; ops visibility via audit log; demo scenarios don't exercise the edge |
| Date-edit field accidentally exposed by a future UI regression | Low | OQ-5 (defense-in-depth whitelist) recommended; integration spec B2-I7 pins the rejection |
| ~~`tasks.cancelTask` un-cobwebbing reveals a latent bug~~ — **OBSOLETED by §3.6 OQ-1 ruling.** `tasks.cancelTask` is NOT un-cobwebbed; ad-hoc cancel is rejected at both UI (disabled) and server (form-action `ValidationError`) layers. Risk eliminated by scope reduction; B2-I2′ pins the rejection. | — | — |
| Ad-hoc disabled-button state is bypassable by direct HTTP POST against the form action | Medium | B2-I2′ server-layer assertion: form action returns `ValidationError` server-side for any ad-hoc task id, regardless of UI state. Defense-in-depth per §3.6 OQ-1 ruling. |

---

## §9 — Code-PR shape (preview)

When the code-PR opens (after §3.6 on this plan-PR + OQ rulings):

- **Files touched (expected, per OQ-2 = Path A and OQ-1 = two-path dispatch):**
  - **NEW:** `src/app/(app)/tasks/_actions.ts` — server actions for cancel + edit (cancel dispatch + edit whitelist)
  - `src/app/(app)/tasks/client.tsx` — per-row UI affordances (cancel button + edit drawer)
  - `src/app/(app)/tasks/page.tsx` — read-shape widening if OQ-8 reveals `subscriptionId` is not on the current Task shape (read-only addition)
  - `src/modules/tasks/service.ts` — possibly NO change (reuse existing `cancelTask`, `updateTask`, `addNoteToDriver`); IFF OQ-3 = (b), `updateTaskAndPushOutbound` gets an address-snapshot extension
  - **AMENDMENT:** `memory/decision_task_editability_cutoff_at_assigned.md` — supersede header per §6.1
  - **NEW:** `memory/followup_assigned_before_cutoff_dispatch_race.md` — per §6.2
  - **NEW (IFF OQ-9 approved):** `memory/followup_address_edit_sf_outbound_gap.md` — per OQ-3 (a) gap documentation
- **Tests:**
  - `tests/integration/tasks-page-cancel.spec.ts` — B2-I1 + B2-I2′ + B2-I3 + B2-I8 (B2-I4 removed per OQ-1 ruling)
  - `tests/integration/tasks-page-edit.spec.ts` — B2-I5 + B2-I6 + B2-I7
- **Commit shape:** likely 3 commits — (1) cutoff-drift memo + followup (§6, T1), (2) cancel surface + tests, (3) edit surface + tests. Each individually green.
- **CI gates:** typecheck, unit, test:integration. New specs must surface in `test:integration`.
- **Post-merge:** standard Vercel deploy via inspect-then-promote; smoke check that /tasks renders the new affordances; Aqib UAT loop confirms cancel + edit work end-to-end.

---

**End of plan v1.** Awaiting §3.6 ruling on §3 dispatch + Path A/B + delivery-date exclusion contract + §7 OQs (1–9).

---

## §10 — Reviewer rulings locked (post-§3.6 v1 — 2026-05-18, plan PR #308)

§3.6 RULING on plan v1 at SHA `76b37c0a54b9fcb2098eebcf13382f3cd678e2a8`: APPROVED with rulings + binding constraints + ONE scope reduction (OQ-1 overrule from two-path to single-canonical).

**Locked rulings (do not re-open):**

| OQ | Ruling | Notes |
|---|---|---|
| **OQ-1** | **§3.6 OVERRULED** — SINGLE canonical path (subscription-linked tasks ONLY via `cancelNoAppendAction`). Ad-hoc tasks: cancel VISIBLE-BUT-DISABLED + server-side form-action rejection (defense-in-depth). | Do NOT un-cobweb `tasks.cancelTask` (silent-failure risk on zero-consumer dormant fn). Builder's two-path recommendation overruled. Integration specs B2-I2 + B2-I4 replaced by B2-I2′. |
| **OQ-2** | **§3.6 UPHELD** — Path A direct column write via `updateTask`. | Binding constraint: §3.3.1 documents the intentional MVP asymmetry between /tasks (Path A) and calendar popover (Path B). Cross-reference in `followup_tasks_page_vs_popover_address_path_asymmetry.md` per OQ-9. |
| **OQ-3** | **§3.6 RULED (a)** — accept SF-outbound-address gap WITH mandatory verbatim UX copy. | Locked copy (do not paraphrase): **"Address change saved; SuiteFleet will reflect on the next scheduled push pass"**. Followup memo `followup_address_edit_sf_outbound_gap.md` per OQ-9. |
| **OQ-4** | **§3.6 UPHELD** — `addNoteToDriver` (NOT catch-all `updateTask`). | Typed-event audit + PII safety + popover-surface consistency. |
| **OQ-5** | **§3.6 APPROVED** — defense-in-depth server-side `Zod.pick({addressId: true, notes: true}).strict()` at form-action layer. | Pinned by B2-I7. |
| **OQ-6** | **§3.6 OVERRULED** — v1.16 brief append (single-line, append-only, rides B2 code-PR as T1). | Records the supersede at brief source-of-truth. **NOTE: scope-distinct from A1 OQ-7's "no v1.16 for the status-mapping fix" — both rulings coexist; B2's v1.16 line is specifically the cutoff-drift supersede, not an A1 absorption.** |
| **OQ-7** | **§3.6 UPHELD** — single commit in B2 code-PR. | All artifacts (code change + brief v1.16 append + Day-3 memo amendment + 3 followup memos) land in one commit. |
| **OQ-8** | **§3.6 RULED — fold into B2 (now LOAD-BEARING).** | Read-shape widening for `task.subscriptionId` is required by OQ-1's disabled-state UI logic. Pre-check at code-PR open: verify `Task` shape from `listTasks` carries `subscriptionId`; widen if missing. First builder action at code-PR open. |
| **OQ-9** | **§3.6 RULED — all three followup memos.** | (1) `followup_assigned_before_cutoff_dispatch_race.md` — ASSIGNED-before-cutoff edge; (2) `followup_address_edit_sf_outbound_gap.md` — SF outbound address-push deferral; (3) `followup_tasks_page_vs_popover_address_path_asymmetry.md` — Path A/B intentional MVP asymmetry (per OQ-2 binding constraint). |

**Binding scope changes (locked):**

1. **OQ-1 invalidates integration specs B2-I2 + B2-I4.** Replaced by **B2-I2′** (§5.1 #2): two-layer assertion — UI disabled-state pin + server-side form-action `ValidationError` rejection.
2. **OQ-2 adds §3.3.1** documenting the /tasks Path A vs popover Path B intentional MVP asymmetry — required reading for future maintainers and operators investigating the audit-log union pattern.
3. **OQ-6 v1.16 brief append** lands as a T1 single-line append in the B2 code-PR commit (per OQ-7), recording the supersede of `decision_task_editability_cutoff_at_assigned.md` at the brief level.

**Next steps (reviewer-defined):**

1. ✅ DONE — plan revised with all 9 rulings recorded in §10, OQ inline annotations updated, §3.3.1 asymmetry doc added, §5.1 swapped B2-I2/I4 → B2-I2′, §6 OQ-3 locked verbatim UX copy, §6 OQ-5 approved, §6 OQ-6 v1.16-brief-append note, §6 OQ-8 load-bearing, §6 OQ-9 three-memo set, §8 risk row reworked, §9 test-file list updated. **Revised plan-PR pinned SHA in §11 below.**
2. Reviewer re-reads changed sections only (per directive); explicitly clears the plan.
3. THEN B2 code-PR opens (first builder action: §10 OQ-8 read-shape pre-check at code-PR open).

---

## §11 — Revision history

| Revision | SHA | Filed | Notes |
|---|---|---|---|
| v1 | `76b37c0a54b9fcb2098eebcf13382f3cd678e2a8` | 2026-05-18 (Day-30 PM) | Initial plan — §1-§9. Builder recommendations on 9 OQs. |
| v2 | (this commit — see push output) | 2026-05-18 (Day-30 PM-late) | Post-§3.6: 9 OQs ruled; OQ-1 OVERRULED to single-canonical; OQ-2 UPHELD with §3.3.1 asymmetry-doc constraint satisfied; OQ-3/4/7 upheld; OQ-5/8/9 approved/expanded; OQ-6 OVERRULED to v1.16 brief append; B2-I2 + B2-I4 replaced by B2-I2′; risk row obsoleted; test file list updated. **Reviewer re-reads changed sections only; STOP for explicit clearance before B2 code-PR opens.** |

**End of plan v2.** B2 code-PR does NOT open until reviewer explicitly clears this revision.
