# Day-54 Session C plan — R-E: churn hard-stop cascade (T3)

**Filed:** Day-54 (12 Jun 2026), Session C, per the post-clearance dispatch step 6. Gates: R-A code parked (#472, APPROVE r1) — satisfied. The probe memo (`memory/probe_sf_assigned_cancel_blocked.md`) is **NOT yet on main**: it rides PR #461 (APPROVE round 2, `automerge-t1` armed, gate-and-merge run PASSED) and is blocked from landing solely by the environmental Vercel daily build limit on its checks run. **Merge-order dependency: #461 lands before this plan**, so the citation is true on main at merge time. The probe itself was BLOCKED (no accept/reject verdict) — the ruling below specifies both vendor outcomes, so the build is not design-blocked; the memo records this.
**Ruling (verbatim):** *"R-E: churn is a HARD STOP on everything, assigned deliveries included — subscription cancelled, every pending task cancelled at the vendor immediately — behind a mandatory warning popup stating the customer receives nothing else from that moment on, including recall of already-assigned deliveries. Subscription cancellation stays softer: pending tasks continue to completion. Task cancel = that task only. Brief §3.1.4 amendment dispatch-assigned."*
**Contract base:** `memory/triage_five_races_findings.md` §R-E (merged `6c193ca`).

## §0 Dispatch-ordered VERIFICATION result — no drift park needed

`endSubscription` (`subscriptions/service.ts:1333-1367`) is a pure status flip (`endSubscriptionRow` — single-table, no task writes), and the unpushed-task selection (`tasks/repository.ts:1080-1096`) carries **no subscription-status filter** — materialized tasks of an ended subscription keep flowing to SF and complete. **Current behavior already matches "subscription cancellation stays softer: pending tasks continue to completion."** Task cancel is already single-task. Only the churn leg is missing — the triage finding verbatim: `changeConsigneeCrmState` touches nothing operational.

## §1 The cascade (in `changeConsigneeCrmState`, firing only on `toState === "CHURNED"`)

Inside the existing tx, after the matrix gate passes and the CRM column updates:

1. **Subscriptions:** every subscription of the consignee with status ≠ 'ended' → `endSubscriptionRow` (the same primitive `endSubscription` uses; active AND paused both end — "hard stop on everything").
2. **Tasks, split by vendor involvement (the honesty rule):**
   - **Never-pushed rows** (`external_tracking_number IS NULL`, non-terminal): flip `internal_status='CANCELED'` immediately — no vendor exists to confirm; the local cancel IS the truth.
   - **Pushed rows** (live AWB, non-terminal — **including ASSIGNED/IN_TRANSIT**, the single sanctioned bypass of the R-A assignment freeze): do **NOT** touch `internal_status`. Set `outbound_sync_state='pending_cancel'` and collect `(id, awb)` for the fan-out. The row keeps saying ASSIGNED because the delivery IS still assigned until the vendor confirms.
3. **Post-commit:** `enqueueBulkCancelTasks` for the collected AWB rows (the existing R2 pipeline, verbatim posture: emit-then-re-throw on `failedChunks > 0`); emit `consignee.churn_cascade` (new §3.1.2 event) with `{consignee_id, subscriptions_ended, tasks_canceled_local, recalls_attempted, correlation_id}` + the existing `consignee.crm_state_changed` emit unchanged.

**Vendor confirmation loop (all existing infrastructure, zero new moving parts):**
- SF accepts → webhook `TASK_STATUS_UPDATED_TO_CANCELED` → `applyWebhookStatusEvent` flips `internal_status='CANCELED'` (vendor-confirmed — the honesty rule's only sanctioned flip for pushed rows); the cancel worker's 2xx path flips `outbound_sync_state='synced'`.
- SF refuses (4xx → QStash exhaust) → `cancel-task-failed` callback already writes the `outbound_push_failures` DLQ row AND flips `outbound_sync_state='failed'` (`route.ts:122-149`) — the task keeps its accurate driver-bound status. **No new failure plumbing needed; the refusal signal exists today.**

**One new repository function** (`consignees` module calls into tasks repo via the same direct-import precedent the exceptions service uses): `cancelConsigneeTasksForChurn(tx, tenantId, consigneeId)` — the two UPDATEs above + RETURNING, plus `endAllSubscriptionsForConsignee(tx, tenantId, consigneeId)` in the subscriptions repo. **No schema delta.**

## §2 The honesty rule, surfaced ("vendor refused recall — final delivery")

- **Audit entry (refusal-time):** the cancel DLQ row + `outbound_sync_state='failed'` are the durable record (existing). The cascade emit (§1.3) carries the recall list, so the audit timeline reads: churn → recalls attempted → (webhook-confirmed cancels) or (DLQ refusal rows).
- **Visible flag (calendar popover — Session C's lane):** a driver-bound, non-terminal task whose `outboundSyncState` is `'failed'` and whose consignee is CHURNED renders **"Vendor refused recall — final delivery"**; `'pending_cancel'` renders **"Recall requested — awaiting vendor"**. Derivation only — the popover already receives `outboundSyncState` and the page knows the consignee's CRM state; no new data fetch.

## §3 The mandatory warning popup (CrmStateModal — Session C's lane)

`CrmStateModal.tsx` gains a churn-specific mandatory warning block when `toState === "CHURNED"` (rendered above the reason field; the confirm button reads "Churn — stop everything"): *"This is a hard stop. The customer receives nothing else from this moment on. Every subscription ends now; every pending delivery is cancelled at the vendor immediately — including recall attempts on deliveries already assigned to a driver. If the vendor refuses a recall, that delivery completes as the final one and is flagged. This cannot be undone from this screen."* Wording covers the recall attempt + the hard stop per the dispatch; reactivation keyword path (CHURNED → ACTIVE) is untouched.

## §4 MP-13 Path 2 rewrite

`tests/unit/mp-13-consignee-deactivation-cancels-tasks.spec.ts` Path 2 currently pins the GAP (FK violation on hard-delete). Rewritten to the ruled behavior: CHURNED transition → subscriptions ended + never-pushed tasks CANCELED locally + pushed tasks (incl. ASSIGNED) flipped `pending_cancel` with status preserved + fan-out called. The header's "documents the gap" framing is replaced by the v1.26 contract.

## §5 Tests (RED-first)

Unit: the MP-13 rewrite (§4) is the main RED surface; plus CrmStateModal JSX-shape (warning block renders only for CHURNED) and popover badge derivation cases. Integration (real Postgres, new spec): seed consignee with 2 subscriptions (active + paused) + 4 tasks (CREATED unpushed / CREATED pushed / ASSIGNED pushed / DELIVERED) → churn → assert: both subs 'ended'; unpushed task CANCELED; both pushed non-terminal tasks `pending_cancel` with statuses preserved (ASSIGNED stays ASSIGNED — honesty); DELIVERED untouched; fan-out received exactly the two AWBs; `consignee.churn_cascade` emitted with the counts; non-churn transitions (e.g. → ON_HOLD) cascade NOTHING (guard).

## §6 Brief amendment (dispatch-ASSIGNED)

§3.1.4 (CRM/churn semantics) amended in body text + one append-only §9 row at next-free (**v1.26 expected**, after R-A's v1.25 on #472 — same-session sibling; renumber whichever merges second per the recorded fixup rule). Records: churn = hard stop incl. assigned-delivery recall (the single sanctioned R-A-freeze bypass), honesty rule (local cancel only on vendor confirmation; refused recalls keep accurate state + flag), subscription-end stays softer (verified current behavior — §0), task cancel = single task. **Additive-only diff vs main verified at merge-prep** (the dispatch's explicit constraint; the v1.21-drop incident is the precedent).

## §7 Fences / risks

- No `src/app/(app)/tasks/**` (Session B); the consignee detail + calendar surfaces are Session C's. No spend; no migrations (sync-state vocabulary already contains every value used).
- The cascade runs as the operator's user actor (it IS an operator action gated by `consignee:change_crm_state`); the R-A freeze bypass is structural — the cascade writes via its own repository function, not through the gated task services, exactly as the R-A plan §7 anticipated ("R-E's cascade will use its own repository path").
- Churn while a cancel is already in flight: `pending_cancel` is idempotent; the bulk fan-out re-enqueue converges on the same webhook/DLQ outcomes.
