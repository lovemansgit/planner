# Day-53 — R16: resume re-sync (SF re-activation on subscription resume): plan

**Lane:** T3, Love-directed Day-53 PM (Plan-A wave, Lane A). Build contract: `memory/followup_r16_resume_sf_reactivation.md` verbatim. Plan-PR then code-PR; both park.

## §1 The probes (spec-mandated, ran first — Demo Bistro probe tasks, all end CANCELED)

Two wire questions decided the shape; both answered empirically on the sandbox (2026-06-11, ~11:56–12:06Z, five probe tasks under Demo Bistro customer 591, auth via the resolver-backed api_key session; forensic trail in `webhook_events` rows for tenant `29502ac3-…`):

1. **Un-cancel: REJECTED.** `PATCH /api/tasks/awb/{awb}` `{status:"ORDERED"}` on a CANCELED task → **403 "User not allowed to do such action."** SF cancel is terminal for the API client. → **R16 is the re-create path** (the spec's fallback branch: fresh create, new AWB, mapping updates).
2. **Re-create with the SAME `customerOrderNumber`: ACCEPTED.** Create A (`R16-DEDUPE-…`) → cancel A (`DMB-37795272` CANCELED 12:01:57Z) → create B with the identical order number → **200, new AWB `DMB-00676692`** (ORDERED 12:02:03Z). No duplicate signal — the push path's `SuiteFleetAwbExistsError` reconcile branch (which would re-adopt the cancelled SF task) does NOT fire for R16's scenario. The deterministic order number (`prefix-YYYYMMDD`, task-materialization/service.ts) is reused as-is.

Probe incident disclosed: the first probe run's cancel got 500 — my probe sent `Content-Type: application/json` where SF requires `application/merge-patch+json` (the production task-client always sent merge-patch; probe corrected). The stray ORDERED probe task was hygiene-cancelled.

## §2 Shape (sibling of R2, in reverse, zero migrations)

R2's pause flow: `markTasksCanceledInWindow` flips pushed rows to `pending_cancel` → post-commit `enqueueBulkCancelTasks` → `subscription.pause_cancels_pushed` → emit-then-re-throw on partial enqueue failure. R16 mirrors it on the **early-manual-resume branch** (the only branch that restores tasks; auto-resume restores nothing and gets no leg):

1. **`markTasksRestoredInWindow` (tasks/repository.ts) — extended, same caller:** today it flips `internal_status` CANCELED→CREATED and the *safe-state half* (`pending_cancel`→`synced` — the comment at repository.ts:1581 names R16 as the missing active half this supersedes). New behavior, one UPDATE:
   - rows with `external_tracking_number IS NOT NULL` (= SF-cancelled during the pause, whether webhook-converged to `synced` or still `pending_cancel`/`failed`): **clear `external_id` + `external_tracking_number` + `pushed_to_external_at`, set `outbound_sync_state='pending'`** — the existing unpushed-row state (0028 default), which is the honest description: "needs a push".
   - rows with no AWB: untouched beyond the status flip (today's behavior).
   - `RETURNING id, (old) external_tracking_number` — the signature changes from `Promise<number>` to row array, mirroring `markTasksCanceledInWindow`; single production caller (`resumeSubscription`).
2. **`resumeSubscription` (subscriptions/service.ts) — post-commit fan-out:** for the cleared rows, `enqueueTaskPushBatch({tenantId, taskIds, requestId})` — the EXISTING materialization publisher driving the EXISTING `/api/queue/push-task` consumer. Because the ids are cleared, `pushSingleTask`'s already-pushed guard passes and it performs a **fresh SF create → `markTaskPushed` writes the NEW AWB + `synced`**. Failure machinery (failed_pushes DLQ, `push-task-failed` twin, past-dated guard) is all inherited, zero new routes.
3. **Audit:** new registered event `subscription.resume_reactivations_pushed` (sibling of `subscription.pause_cancels_pushed`), emitted post-commit when ≥1 row was cleared: `{subscription_id, correlation_id (pause window's), actual_resume_date, reactivated_task_count, enqueued_count, failed_chunks, previous_awbs: [{task_id, awb}]}`. `previous_awbs` is the forensic bridge — once the row's ids are cleared, the old AWB survives only here + webhook_events + any DLQ rows; ops triage of §4's residuals needs it. Bounded by the pause-window size (tens of rows).
4. **Emit-then-re-throw** on `failedChunks > 0` — verbatim R2 posture: local restore is committed; the thrown error surfaces "restored locally; SF re-activation pending"; the rows sit in `outbound_sync_state='pending'` until the next materializer reconciliation tick re-discovers them (§1.1 self-healing — this is strictly better than R2's pending_cancel equivalent, because `pending` is already the state the reconciler sweeps).
5. **Webhook convergence:** the new AWB converges through the normal status path. Late webhooks for the OLD AWB find no row (`apply-webhook-status-event` looks up by `external_tracking_number`, now cleared) → existing no-match handling; the restored row cannot be clobbered back to CANCELED.

## §3 Races looked at, posture chosen (consistent with Love's five-race deferral)

- **In-flight cancel message meets resume** (pause→early-resume within the QStash window, seconds–minutes): the cancel consumer's existing AWB-mismatch guard (`cancel-task/route.ts:112`) rejects the message with 400 + Sentry BEFORE the wire call — the restored row is never touched. **Residual:** the old SF task escapes its cancel (a ghost ORDERED task SF-side). Visible three ways: the Sentry `awb_mismatch` event, `previous_awbs` on the resume audit event, and SF's own portal. Not silently swallowed; not solved here — it is one corner of the pre-existing R2 race family Love deferred to the five-race triage ("after the mutating lanes settle").
- **Cancel already failed (`failed` rows):** the old AWB may still be live on SF; the failed cancel already sits in `outbound_push_failures` (ops surface). R16 re-pushes the row like any other; the DLQ row + `previous_awbs` carry the ghost forensics. Same triage family.
- **Restored-but-never-pushed rows:** stay with the materializer's reconciliation sweep (their state is already `pending`); R16 does not duplicate that pipeline.

## §4 Tests (RED-first, real Postgres + unit)

Integration (extends the lifecycle suite's harness):
1. **The happy sibling path:** pause a sub with pushed rows (AWBs set, webhook-converged `synced`+CANCELED) → early manual resume → rows are CREATED with **ids cleared + `pending`**, and the service result carries the reactivation rows; publisher mock (`vi.mock` on task-materialization/queue, the suite's existing pattern) saw exactly those task ids.
2. **Audit shape:** `subscription.resume_reactivations_pushed` emitted once with the registered metadata incl. `previous_awbs`.
3. **Partial-failure:** publisher mock returns `failedChunks: 1` → the service throws AFTER emitting; rows remain `pending` (committed).
4. **No-AWB rows:** restored without id-clearing, no payload, no emit (zero-payload resume = no R16 event).
5. **Auto-resume:** no reactivation leg (no clear, no emit) — pins the branch boundary.
6. **Old-AWB webhook safety:** after a clear, applying a `TASK_STATUS_UPDATED_TO_CANCELED` event for the old AWB leaves the restored row CREATED (no-match path pinned end-to-end).

Unit: lifecycle spec extensions for the new `markTasksRestoredInWindow` return shape + fan-out call; `enqueueTaskPushBatch` itself already has coverage.

## §5 Scope fences

- **Zero migrations** (dispatch expectation verified: `pending` exists since 0026/0028; no CHECK change, no column). If anything in build forces one → STOP, park the question.
- DO-NOT-TOUCH honored: no /tasks surfaces, no nav-config/drawer-action, no addresses module, no consignees/[id], no Session C audit entries (R16 ADDS its own event-types entry — additive, separate lines).
- **Brief:** ONE append-only §9 row (assigned to this lane) recording the R16 outbound leg; version number = next free at merge time (Session C holds v1.21).
- **UAT run sheet:** the step-H R16 known-limitation note is removed in the code-PR (recorded follow-through, day-53 handoff §9).
- No bulk/uncancel adapter additions (probe says none exist to add); no new queue routes.
