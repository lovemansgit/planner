# Day-29 plan-PR — §D(2) skip → SF outbound bug fix (T3)

**Status:** plan-PR draft, awaiting §3.6 review
**Tier:** T3 (multi-surface — service + adapter + queue + webhook + UI + tests + possible schema)
**Ruled by:** reviewer Day-29 ruling that brief §3.1.11 row 6 ("Cancel task (skip path) → task-resource:update with cancel, PATCH") is governing affirmative text and the skip service flow's failure to wire it is a BUG, not designed-local. See memory/handoffs/day-22-pm-eod-session-a.md and the Day-29 §D(2) Phase-1 diagnostic (Session B research notes).
**Production base:** 1a7da84 (post-PR #300 horizon=21 bump)
**Branch:** day-29/plan-skip-sf-outbound
**Out of scope (do NOT touch):** cron horizon / compensating-task push path (PR #300 territory); §D(1) inbound webhook apply lane (separate session).

---

## §0 Executive summary

The skip service ([src/modules/subscription-exceptions/service.ts:360-641](../../src/modules/subscription-exceptions/service.ts#L360-L641)) commits the local skip (INSERT exception, UPDATE end_date, UPDATE task → `SKIPPED`) and emits audit events, then RETURNS. It never enqueues an outbound message to SuiteFleet. The cancelTask adapter shipped Day-21 PR #227 — `PATCH /api/tasks/awb/{awb}` with `{status:"CANCELED"}`, `application/merge-patch+json`, field name LOCKED — sits unused by the skip path. Result: the skipped delivery stays live as "Ordered" on SF; SF drivers would still attempt it.

This plan closes that gap for all THREE skip variants:

| Variant | Trigger | SF mapping | Adapter |
|---|---|---|---|
| 1. Plain skip | `type='skip'`, no override, `skip_without_append!=true` | Cancel original on SF; compensating task pushes via existing nightly cron horizon path (unchanged) | `cancelTask` (REUSE PR #227) |
| 2. Skip-without-append | `type='skip'`, `skip_without_append=true` | Cancel original on SF; no compensating task (unchanged) | `cancelTask` (REUSE PR #227) |
| 3. Move-to-date | `type='skip'`, `target_date_override` set | Reschedule original on SF (per brief §3.1.11 row 7, distinct mapping); no second task INSERT | `rescheduleTask` (**NET-NEW adapter surface**) |

The plan follows the **optimistic-ack pattern** named by brief §3.1.4 line 319 ("matches the optimistic-ack pattern from skip/cancel flows"): local DB commits inside the existing transaction; SF outbound enqueues post-commit; failures land in `outbound_push_failures` DLQ via the existing QStash failureCallback path.

**Net-new surface flag (loud):** variant 3 (reschedule) is genuine net-new adapter surface — no `rescheduleTask` exists on `TaskClient` or `LastMileAdapter`, no `/api/queue/reschedule-task[-failed]` routes exist, no service publisher exists. Day-18 A1 plan ([memory/plans/day-18-a1-customer-id-resolver-swap.md:225-228](../../memory/plans/day-18-a1-customer-id-resolver-swap.md#L225-L228)) explicitly deferred reschedule as "Separate plan-PR if/when needed for MVP." This plan IS that plan-PR for the reschedule slice. The exact SF API path + payload shape for `task-resource:reschedule` is unconfirmed in code (it's a registered mapping in brief §3.1.11, not an implemented adapter) — see §9 OQ-1.

**Schema-change flag (loud):** the plan needs a per-task pending-confirm signal that survives the gap between local skip commit and SF webhook convergence. `pushed_to_external_at` cannot be reused — it's a one-shot "first push succeeded" timestamp ([src/modules/task-push/repository.ts:1096-1102](../../src/modules/task-push/repository.ts#L1096-L1102)) and is already populated for tasks we're now cancelling. Options surveyed at §6; recommended option requires a single non-NULL column add on `tasks`. This escalates blast radius and §3.6 review — flagged explicitly per the Day-29 reviewer brief.

**State-collision flag (loud):** the inbound webhook applier ([src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:163-168](../../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L163-L168)) UPDATEs `internal_status` blindly with no state-check guard. SF emits `TASK_STATUS_UPDATED_TO_CANCELED` ~1s after our PATCH ([src/app/api/queue/cancel-task/route.ts:17-20](../../src/app/api/queue/cancel-task/route.ts#L17-L20) documents the convergence path). That webhook would silently overwrite `SKIPPED` → `CANCELED`, erasing the Planner-local semantic distinction the brief §3.1.1 declares ("`SKIPPED` = human-driven exception with compensating-date semantics" vs "`CANCELED` = terminal stop"). This must be fixed inside the same plan-PR slice; left for §D(1) session would split a bug-fix across two PRs and risk the SKIPPED rows in production being silently overwritten between deploys. See §6.2.

---

## §1 Scope (product-owner locked — do not narrow)

In scope (full plan):
- §2 Service-layer wiring inside `addSubscriptionException` — post-commit, per-variant outbound enqueue
- §3 Reuse of `cancelTask` adapter + `enqueueCancelTask` publisher for variants 1+2 (no field-contract changes; LOCKED per Day-21)
- §4 Net-new `rescheduleTask` adapter + publisher + queue route + failure route for variant 3
- §5 DLQ extension: `outbound_push_failures.operation` CHECK constraint extended to include `'reschedule'` (existing migration 0023 only allows `'update' | 'cancel' | 'bulk_cancel'`)
- §6 UI pending-confirm signal — column + read-side surfaces
- §6.2 Webhook state-collision guard — preserve `SKIPPED` against inbound `CANCELED` convergence ack
- §7 Audit posture — extend `subscription.exception.created` metadata OR register net-new event (open question §9 OQ-3)
- §8 Test plan — route + integration assertions for outbound presence per variant, plus state-collision regression
- §9 Open questions for §3.6 ruling

Out of scope:
- Cron horizon / compensating-task push path. Brief §3.1.5 governs this; PR #300 owns it. The skip-cancel for original task and the compensating-task push are TWO separate SF operations on TWO separate task rows.
- §D(1) inbound webhook apply lane (Session A's lane on Day-29). Note §6.2 IS in scope but it touches the applier's overwrite logic, not the parser/router. Session boundary holds because the change is a guard-clause inside the existing apply-time UPDATE, scoped to this plan-PR's correctness — not a parser/router redesign.
- Operator-initiated cancel/update flows (Day-21 PR #227 / Day-22 territory). The cancelTask service path (`tasks/service.ts:1263`) already wires correctly; this plan only adds NEW callers (skip variants 1+2), no changes to the existing cancelTask service surface.
- Move-to-date task INSERT on the new date. Per the existing skip service ([service.ts:483-504](../../src/modules/subscription-exceptions/service.ts#L483-L504)) and merged Day-14 plan §3.2 step 13b ([memory/plans/day-14-part2-service-layer.md:261](../../memory/plans/day-14-part2-service-layer.md#L261)), the new-date task is materialized via the cron's normal path on next tick — no exception-create-time INSERT. Variant 3's outbound emission ONLY rescheduling the original SF task, NOT a second SF createTask call.

---

## §2 Service-layer call-path — exact insertion point + per-variant branching

**Target file:** [src/modules/subscription-exceptions/service.ts](../../src/modules/subscription-exceptions/service.ts)

### §2.1 Insertion point

The current post-commit block runs at [service.ts:568-631](../../src/modules/subscription-exceptions/service.ts#L568-L631) (audit emits). The outbound enqueue lives in the SAME block, AFTER all audit emits, BEFORE the `return` at line 633.

Reason for ordering:
- AFTER tx commit: matches optimistic-ack precedent ([tasks/service.ts:1326](../../src/modules/tasks/service.ts#L1326) comment). Enqueue failure does NOT roll back the local commit; local DB stays consistent + the operator can re-attempt via "retry" (an already-SKIPPED task no-ops gracefully, see §3.4).
- AFTER audit emits: the audit events `subscription.exception.created` + `subscription.end_date.extended` carry the load-bearing `correlation_id`. The outbound message payload reuses that same `correlation_id` so the full lifecycle (local commit → audit → SF push → SF webhook back) is traceable as one unit.
- BEFORE return: caller MUST see the enqueue error so the form action can surface "saved locally; SF push pending" (per [service.ts:319](../../src/modules/subscription-exceptions/service.ts#L319) optimistic-ack contract).

### §2.2 Captured-from-tx data

The current transaction ([service.ts:406-560](../../src/modules/subscription-exceptions/service.ts#L406-L560)) does not surface `externalTrackingNumber` / `taskId` to the post-commit block. The plan changes the `markTaskSkipped` call site (line 550) to return the affected task row (or specifically `{ taskId, externalTrackingNumber }`), and the tx closure propagates that as a new field on `txResult`.

Plan calls this **minimum-surface task return**: tx-internal change scoped to a single helper return shape, not a service signature change. Post-commit reads the captured tuple, no second DB roundtrip.

Sub-case handling for unmaterialized skip (plan §3.2 sub-case 13a — skip recorded for date still beyond horizon):
- `markTaskSkipped` no-ops (zero rows match); `externalTrackingNumber` is null/absent.
- Post-commit enqueue branch is gated `if (capturedTask !== null && capturedTask.externalTrackingNumber !== null)`. No outbound message. Matches the cancelTask precedent ([tasks/service.ts:1330](../../src/modules/tasks/service.ts#L1330) "Pre-push cancels stay local").
- When cron eventually reaches that date, the existing eligibility CTE ([src/modules/task-materialization/cte-builder.ts:129](../../src/modules/task-materialization/cte-builder.ts#L129)) skips materialization — so no SF task ever exists for the skipped date. No outbound needed.

### §2.3 Per-variant branching (pseudocode for the post-commit enqueue block)

```ts
// Post-commit (after all audit emits, before return).
// Only for type='skip' — address-override variants are skipped here.
if (
  exception.type === "skip"
  && capturedTask !== null
  && capturedTask.externalTrackingNumber !== null
) {
  const isMoveToDate =
    input.targetDateOverride !== undefined
    && input.skipWithoutAppend !== true;

  if (isMoveToDate) {
    // Variant 3 — reschedule on SF (NET-NEW adapter, see §4).
    await enqueueRescheduleTask({
      tenant_id: tenantId,
      task_id: capturedTask.taskId,
      awb: capturedTask.externalTrackingNumber,
      rescheduled_for: input.targetDateOverride, // ISO date
      correlation_id: exception.correlationId,
    });
  } else {
    // Variants 1 + 2 — cancel on SF (REUSE PR #227).
    await enqueueCancelTask({
      tenant_id: tenantId,
      task_id: capturedTask.taskId,
      awb: capturedTask.externalTrackingNumber,
      correlation_id: exception.correlationId,
    });
  }
}
```

### §2.4 Error handling

Mirrors cancelTask precedent ([tasks/service.ts:1339-1362](../../src/modules/tasks/service.ts#L1339-L1362)): wrap enqueue in `try/catch`; on failure: log + Sentry + re-throw. Local DB stays committed (no rollback); caller form action surfaces "saved — pushing to SuiteFleet may need retry" toast. Operator may re-POST with the same idempotency key — the idempotent replay path ([service.ts:467-471](../../src/modules/subscription-exceptions/service.ts#L467-L471)) returns 409 with the existing exception_id and DOES NOT re-emit audit events; per §9 OQ-2 we also do NOT re-enqueue on idempotent replay (otherwise the operator's retry can race the original publisher).

---

## §3 Variants 1 + 2 — reuse cancelTask adapter (no new adapter surface)

### §3.1 What's reused (zero changes to these surfaces)

- Adapter: `cancelTask(session, awb, correlationId)` at [src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts:203](../../src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts#L203). Field name `{status:"CANCELED"}` and Content-Type `application/merge-patch+json` are **LOCKED** per [memory/handoffs/day-21-eod.md:37-39](../../memory/handoffs/day-21-eod.md#L37-L39). This plan does NOT touch the locked contract.
- Publisher: `enqueueCancelTask(payload)` at [src/modules/task-outbound-queue/publish.ts:135](../../src/modules/task-outbound-queue/publish.ts#L135). Payload schema: `CancelTaskPayload = { tenant_id, task_id, awb, correlation_id }` at [src/modules/task-outbound-queue/types.ts:37-42](../../src/modules/task-outbound-queue/types.ts#L37-L42). Dedup key: `${task_id}:cancel:${correlation_id}` — see §3.3 for collision posture.
- QStash consumer: [src/app/api/queue/cancel-task/route.ts](../../src/app/api/queue/cancel-task/route.ts). Three defensive pre-call guards (task_not_found, tenant_mismatch, awb_mismatch) all return 200 with structured outcome. ValidationError/CredentialError throw → QStash retry exhaustion → failureCallback at `/api/queue/cancel-task-failed` → row in `outbound_push_failures` with `operation='cancel'`.
- Webhook convergence: `TASK_STATUS_UPDATED_TO_CANCELED` from SF (~1s post-PATCH) → [src/modules/integration/providers/suitefleet/status-mapper.ts:89](../../src/modules/integration/providers/suitefleet/status-mapper.ts#L89) maps to internal `CANCELED` → apply-webhook-status-event UPDATE. **But see §6.2 for the SKIPPED-vs-CANCELED state-collision fix this plan adds — without that guard the inbound webhook silently overwrites SKIPPED.**

### §3.2 What's added (variants 1+2)

ONE call site — the post-commit branch at §2.3.

No new payload type. No new publisher function. No new queue route. No new DLQ operation enum value.

### §3.3 Dedup key collision posture

The existing operator-initiated cancelTask service ([tasks/service.ts:1333](../../src/modules/tasks/service.ts#L1333)) also calls `enqueueCancelTask` with the same dedup-key shape `${task_id}:cancel:${correlation_id}`. The skip-cancel uses a fresh `correlation_id` (the one minted in [service.ts:522](../../src/modules/subscription-exceptions/service.ts#L522), generated UUID v7 per exception row). So dedup keys never collide across the two callers — operator-initiated cancel and skip-cancel get distinct QStash messages even if they hit the same task within the dedup window. This is intended behaviour: each is a distinct operator intent.

### §3.4 Idempotent retry (operator double-tap)

If the operator re-POSTs the same skip with the same idempotency_key:
- Service layer detects replay at [service.ts:467](../../src/modules/subscription-exceptions/service.ts#L467) and returns 409 with existing exception_id.
- **The plan adds:** the replay path does NOT re-enqueue (skip §2.3 entirely on `txResult.replay !== null`). This matches the existing replay-skips-audit-emit pattern at [service.ts:562-565](../../src/modules/subscription-exceptions/service.ts#L562-L565).
- The first POST's enqueue already fired (or already failed loudly). Idempotent replay does not re-attempt.
- If the first POST's enqueue FAILED and operator wants to retry the SF push without re-creating the exception: out of scope for this plan; the existing ops-triage DLQ replay path on `outbound_push_failures` is the recovery surface (admin retry UI is Phase 2 per [supabase/migrations/0023_outbound_push_failures.sql:80-83](../../supabase/migrations/0023_outbound_push_failures.sql#L80-L83), but the DB row carries enough state for manual ops intervention).

---

## §4 Variant 3 — `rescheduleTask` net-new adapter surface

### §4.1 What's net-new (loud blast-radius)

Every surface below is genuinely net-new. No prior code exists for outbound reschedule. Reschedule appears in the codebase ONLY as the inbound webhook action `TASK_STATUS_UPDATED_TO_RESCHEDULED` → maps to `ON_HOLD` ([status-mapper.ts:89](../../src/modules/integration/providers/suitefleet/status-mapper.ts#L89)) — that's SF telling Planner "driver reattempt scheduled," wholly different from Planner telling SF "operator wants to move this delivery to a different date."

| Surface | Net-new file/binding |
|---|---|
| Adapter interface | Add `rescheduleTask(session, awb, rescheduledFor, correlationId)` to `LastMileAdapter` at [src/modules/integration/last-mile-adapter.ts](../../src/modules/integration/last-mile-adapter.ts) |
| Task client | Add `rescheduleTask({ session, awb, rescheduledFor, correlationId })` to `SuiteFleetTaskClient` at [src/modules/integration/providers/suitefleet/task-client.ts](../../src/modules/integration/providers/suitefleet/task-client.ts) |
| Factory binding | Add binding in [src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts](../../src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts) (mirrors cancelTask binding at line 203) |
| Publisher | Add `enqueueRescheduleTask(payload)` to [src/modules/task-outbound-queue/publish.ts](../../src/modules/task-outbound-queue/publish.ts) mirroring `enqueueCancelTask` (lines 135-187). Dedup key shape: `${task_id}:reschedule:${correlation_id}`. Reuse the shared flowControl key (SF rate-limit is global per merchant). |
| Payload type | Add `RescheduleTaskPayload = { tenant_id, task_id, awb, rescheduled_for, correlation_id }` to [src/modules/task-outbound-queue/types.ts](../../src/modules/task-outbound-queue/types.ts) |
| Queue route | Net-new `src/app/api/queue/reschedule-task/route.ts` (mirrors cancel-task/route.ts verbatim — signature gate, pre-call defensive lookup, adapter call, throw on transient for QStash retry) |
| Failure route | Net-new `src/app/api/queue/reschedule-task-failed/route.ts` (mirrors `cancel-task-failed/route.ts` — write `outbound_push_failures` row with `operation='reschedule'`) |
| DLQ enum | Migration: `ALTER TABLE outbound_push_failures DROP CONSTRAINT … operation_check, ADD … CHECK (operation IN ('update','cancel','bulk_cancel','reschedule'))` — see §5 |

### §4.2 SF API shape — research dependency

The brief §3.1.11 mapping ([memory/PLANNER_PRODUCT_BRIEF.md:474](../../memory/PLANNER_PRODUCT_BRIEF.md#L474)) registers `Reschedule task → task-resource:reschedule → POST`. This is a design target — the exact SF endpoint path, request body shape, and field-name verb are NOT confirmed in the codebase. Day-21's empirical-correction precedent ([memory/handoffs/day-21-eod.md:37-39](../../memory/handoffs/day-21-eod.md#L37-L39)) shows brief mappings sometimes diverge from SF's actual wire contract.

**Plan-time research artefact (Aqib clarification, NOT speculation in this doc):**
- Confirm SF endpoint path. Candidates from brief patterns: `POST /api/tasks/awb/{awb}/reschedule` OR `POST /api/tasks/{numeric_id}/reschedule`. The cancel-task adapter already established AWB at the path-param for single-task mutations ([cancel-task/route.ts:111-128](../../src/app/api/queue/cancel-task/route.ts#L111-L128)). Default assumption pre-confirmation: AWB-at-path.
- Confirm request body field name for the new date. Candidates: `{rescheduledFor: "YYYY-MM-DD"}`, `{newDeliveryDate: "YYYY-MM-DD"}`, `{deliveryDate: "YYYY-MM-DD"}`, or different. **No assumption committed in the plan doc.**
- Confirm webhook reflection. Does SF emit `TASK_STATUS_UPDATED_TO_RESCHEDULED` (currently mapped → `ON_HOLD`) on operator-initiated reschedule? Or a different action? If reschedule succeeds quietly with no webhook, the pending-confirm signal (§6.1) needs a different convergence trigger. See §9 OQ-4.

The plan-PR open-questions section (§9) lists these as MUST-RESOLVE-BEFORE-CODE-PR. The code-PR cannot start until Aqib confirms the wire contract; otherwise we ship speculative `{rescheduledFor: ...}` and burn the lock-in window the way Day-21 OQ-3 was avoided by empirical probe.

### §4.3 Variant-3 semantic concern (open question §9 OQ-5)

Per [src/modules/integration/providers/suitefleet/status-mapper.ts:89](../../src/modules/integration/providers/suitefleet/status-mapper.ts#L89), SF's `TASK_STATUS_UPDATED_TO_RESCHEDULED` maps to internal `ON_HOLD`. The current semantic for `ON_HOLD` ([status-mapper.ts:35](../../src/modules/integration/providers/suitefleet/status-mapper.ts#L35)) is "paused, awaiting reattempt or reschedule" — set when a DRIVER reschedules (customer unavailable, reattempt tomorrow).

When operator-initiated reschedule fires (variant 3), the local task is `SKIPPED` (by [markTaskSkipped at line 550](../../src/modules/subscription-exceptions/service.ts#L550)). The SF round-trip would then emit `TASK_STATUS_UPDATED_TO_RESCHEDULED`. Without §6.2 guard, the inbound applier overwrites `SKIPPED` → `ON_HOLD` — wrong semantic. With §6.2 guard, the webhook ack is silently absorbed (no overwrite).

This is the design forcing function for §6.2.

---

## §5 DLQ schema extension

**Net-new migration:** `0029_outbound_push_failures_operation_reschedule.sql`

```sql
-- Extend outbound_push_failures.operation CHECK to include 'reschedule'
-- (Day-29 §D(2) skip→SF outbound bug fix; variant 3 move-to-date routes to
-- /api/queue/reschedule-task-failed which writes operation='reschedule').
ALTER TABLE outbound_push_failures
  DROP CONSTRAINT outbound_push_failures_operation_check;

ALTER TABLE outbound_push_failures
  ADD CONSTRAINT outbound_push_failures_operation_check
    CHECK (operation IN ('update', 'cancel', 'bulk_cancel', 'reschedule'));
```

Tested at plan-PR open per schema-drift discipline (two prior catches: Day-25 migration drift, Day-27 0018/0019 ordering). **Integration spec opened in same plan-PR commit** — see §8.4.

Existing column inventory at [supabase/migrations/0023_outbound_push_failures.sql:99-120](../../supabase/migrations/0023_outbound_push_failures.sql#L99-L120) — no other columns need change; existing `failure_reason` enum already covers the wire-failure modes a reschedule call would hit.

---

## §6 UI pending-confirm signal — schema-escalation flag

### §6.1 The signal

When the operator clicks skip, local DB commits inside the transaction and the form action returns success. The SF outbound push is enqueued post-commit. Until SF responds + the webhook converges, the relevant surface (task popover, consignee calendar cell, day-action popover) MUST show a "pending on SuiteFleet" state — not silent optimistic success.

`pushed_to_external_at` cannot be reused. Per [src/modules/task-push/repository.ts:1096-1102](../../src/modules/task-push/repository.ts#L1096-L1102) it is set ONCE on first successful push (2xx) and is the implicit "task is on SF" filter for cron's unpushed-task selection. For a task we're now CANCELLING or RESCHEDULING, `pushed_to_external_at` is already non-NULL — that's WHY we need to call SF in the first place. Overloading it would break the cron filter.

### §6.2 SKIPPED-vs-CANCELED webhook state-collision guard (must-fix inside this plan)

Reading [apply-webhook-status-event.ts:163-168](../../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L163-L168):

```ts
await tx.execute(sqlTag`
  UPDATE tasks
  SET internal_status = ${newStatus}, updated_at = now()
  WHERE id = ${taskId} AND tenant_id = ${tenantId}
`);
```

This UPDATE is unconditional on `internal_status` (no `WHERE internal_status != 'SKIPPED'` guard). SF's `TASK_STATUS_UPDATED_TO_CANCELED` (variant 1+2 convergence) and `TASK_STATUS_UPDATED_TO_RESCHEDULED` (variant 3 convergence) would both overwrite local `SKIPPED` → `CANCELED` / `ON_HOLD`, erasing the brief §3.1.1 semantic distinction.

**Plan-fix:** add a WHERE-clause guard. Three options:

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| A — Status-precedence guard | `WHERE … AND internal_status NOT IN ('SKIPPED')` for inbound CANCELED; similar for ON_HOLD vs SKIPPED | Single-line SQL change, semantically clean ("local SKIPPED wins over SF cancel ack") | Loses ability to converge non-skip cancels that happen to land after some unrelated SKIPPED state (currently not a real codepath but increases surface area for future) |
| B — Derive convergence from skip-exception link | UPDATE only proceeds if no `subscription_exceptions` row exists with `(subscription_id, start_date) = (task.subscription_id, task.delivery_date)` and `type='skip'` | Explicit causation guard; survives if other status transitions are added later | Extra read inside the apply tx; couples webhook applier to subscription_exceptions table (boundary cross) |
| C — Add `tasks.skip_lock` boolean | New column flag set by `markTaskSkipped`; apply-webhook guards on it | Cleanest in isolation; future-proofs | New schema column; another migration; more blast radius |

**Plan recommendation:** option A. Smallest change, matches the brief §3.1.1 semantic ("`SKIPPED` = human-driven exception; takes precedence over SF reflecting our own cancel back"). The webhook event still INSERTs into `webhook_events` (audit trail preserved); only the `tasks.internal_status` UPDATE is gated. See §9 OQ-6 — reviewer rules.

### §6.3 Pending-confirm column on `tasks`

Three options for the per-task "outbound cancel/reschedule in flight" signal:

| Option | Surface change |
|---|---|
| A — `tasks.outbound_sync_state` enum | `'synced' \| 'pending_cancel' \| 'pending_reschedule' \| 'failed'`. Set on enqueue (`pending_*`), cleared by webhook convergence to `synced`. Set to `failed` by `outbound_push_failures` row insertion (or a trigger). New migration; ~3 read sites updated. |
| B — Derive at read time | JOIN `outbound_push_failures` on `task_id` for "failed" state; absence of webhook_events row with matching action since last skip exception INSERT → "pending". Zero schema change; expensive query; subtle semantics. |
| C — `tasks.last_outbound_intent` timestamp + `last_outbound_intent_kind` enum | Two new columns; on enqueue we stamp `(now(), 'cancel' | 'reschedule')`; on webhook convergence we clear (set to NULL). Schema change; cleaner audit trail; two columns instead of one. |

**Plan recommendation:** option A. Single new column on `tasks`, four enum values, default `'synced'`. Read-side queries already SELECT `tasks.*`; the UI render functions branch on the enum.

**Loud flag:** this IS a schema change. The Day-29 reviewer brief specifically said: "do NOT add schema unless genuinely required, and if schema IS required, flag it loudly because that escalates blast radius and the §3.6 review." Plan does flag it loudly. §3.6 alternatives include accepting option B (derived) to avoid the schema change, at the cost of complex read-time joins and harder pending-state TTL semantics. See §9 OQ-7.

Migration scaffold (option A, conditional on §3.6 ruling):

```sql
-- 0029b_tasks_outbound_sync_state.sql
ALTER TABLE tasks
  ADD COLUMN outbound_sync_state text NOT NULL DEFAULT 'synced'
    CHECK (outbound_sync_state IN ('synced','pending_cancel','pending_reschedule','failed'));

-- Backfill: existing rows are 'synced' by default. Tasks currently
-- internal_status='SKIPPED' (the bug-affected population) get a
-- one-time backfill to 'failed' so the read-side surfaces them as
-- "pending ops triage" rather than silently appearing as in-sync.
-- Volumetric note: production has fewer than 5 SKIPPED tasks per
-- the most recent observed data — backfill is trivial.
UPDATE tasks
  SET outbound_sync_state = 'failed'
  WHERE internal_status = 'SKIPPED'
    AND pushed_to_external_at IS NOT NULL;
```

Backfill rationale: the bug already produced live "Ordered" SF rows for production tasks DMB-24406181 and DMB-52660780. Stamping them `failed` surfaces them in the ops dashboard (Phase 2 — current MVP gets a DB-level marker for the existing operator to find via SQL). See §9 OQ-8 — ops may want to instead trigger a one-shot replay via the new DLQ row pattern; reviewer to rule whether backfill is "mark failed" or "kick a replay enqueue."

### §6.4 Read-side surfaces (file inventory for §11 blast radius)

UI components that render task state and need the pending-confirm indicator:

- [src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx](../../src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx) — per-day popover
- [src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx](../../src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx) — timeline drawer

Read-side data flow: each surface already SELECTs `tasks.*` via existing repository helpers. New column auto-flows. Render-side branch added per component; copy: "Pending SuiteFleet cancel" / "Pending SuiteFleet reschedule" / "SuiteFleet sync failed — see ops".

Convergence path: on webhook applier success (post-§6.2 guard), the applier writes BOTH `internal_status` (if guard allows) AND `outbound_sync_state = 'synced'`. A single UPDATE statement; no new tx.

---

## §7 Audit posture

Registered events relevant to this lane:
- [src/modules/audit/event-types.ts:728-737](../../src/modules/audit/event-types.ts#L728-L737) — `subscription.exception.created` (EXISTS, fits skip lifecycle metadata)
- [src/modules/audit/event-types.ts:739-748](../../src/modules/audit/event-types.ts#L739-L748) — `subscription.end_date.extended` (EXISTS, pairs with above via correlation_id)
- [src/modules/audit/event-types.ts:430-438](../../src/modules/audit/event-types.ts#L430-L438) — `task.push_failed` (EXISTS, system-only, failure-path only)

What this plan needs to surface:
- The outbound enqueue intent per skip exception (cancel vs reschedule), traceable via correlation_id back to the skip event
- The DLQ landing (failure path) — existing `task.push_failed` is createTask-specific, doesn't cover cancel/reschedule

**Options for capturing skip-cancel / skip-reschedule push lifecycle:**

| Option | Surface change |
|---|---|
| A — Extend `subscription.exception.created.metadata` | Add field `outbound_emission: { kind: 'cancel' | 'reschedule' | 'none', task_id?: uuid }`. Zero new event registrations; metadata schema migration noted in event-types.ts `metadataNotes` field. |
| B — Register net-new `task.outbound_cancel.requested` + `.confirmed` (or `.failed`) | Two/three net-new event registrations. Memory warning: brief §3.1.2 audit event count discipline (currently 9; net-new events bump the count and trigger discipline review per `project_brief_audit_event_count_correction.md`). |

**Plan recommendation:** option A. Smallest blast radius, preserves audit-count invariant, correlation_id-chained. The failed-push DLQ row carries the failure-side observability — duplicating it as an audit event is redundant noise.

**Loud flag:** the existing `subscription.exception.created` is registered with `systemOnly: false` and an exact `metadataNotes` field that lists current keys. Adding `outbound_emission` is a metadata-shape extension. Registered metadata wins per Day-29 reviewer brief — this plan needs to update the `metadataNotes` description AND tighten the runtime Zod schema (if any) in lock-step. See §9 OQ-3.

---

## §8 Test plan

### §8.1 Route-layer additions

File: [src/app/api/subscriptions/[id]/skip/tests/route.spec.ts](../../src/app/api/subscriptions/[id]/skip/tests/route.spec.ts)

Currently 16 tests, none assert outbound. The route already mocks `addSubscriptionException` service entirely — adding outbound assertions at the route layer would require mocking the publisher in the route's own dependency surface, which the route does not import (publisher is called from the service). So:

- No additions at the route layer for outbound-presence assertions (publisher is service-internal).
- ADD: if the response shape changes to include a pending-on-SF hint for the form action, route-layer test asserts the new response field per variant.

### §8.2 Service-layer integration additions

File: [tests/integration/subscription-exceptions/service.spec.ts](../../tests/integration/subscription-exceptions/service.spec.ts)

Current 2 tests (happy-path skip; idempotent replay). Neither mocks the publisher. ADD NEW `vi.mock("@/modules/task-outbound-queue/publish", ...)` per the pattern at [tests/integration/cron-decoupling-happy-path.spec.ts:83-86](../../tests/integration/cron-decoupling-happy-path.spec.ts#L83-L86).

New test cases (one per variant + cross-cutting):

1. `variant 1 (plain skip) on materialized task: enqueueCancelTask called once with correlation_id from exception row` — asserts publisher receives `{tenant_id, task_id, awb, correlation_id}` with correlation_id matching the audit emit's correlation_id.
2. `variant 2 (skip-without-append) on materialized task: enqueueCancelTask called once; end_date unchanged` — assert publisher called + assert subscription.end_date NOT extended.
3. `variant 3 (move-to-date) on materialized task: enqueueRescheduleTask called once with rescheduled_for=target_date_override` — assert publisher receives the target date.
4. `variant 1 on UNMATERIALIZED skip (date beyond horizon): no publisher called` — task is sub-case 13a (markTaskSkipped no-ops), no AWB to cancel.
5. `variant 1 on task without external_tracking_number: no publisher called` — gate on AWB presence.
6. `idempotent replay does not re-enqueue` — second POST with same idempotency_key: replay returns 409, publisher NOT called second time.
7. `publisher throws → service throws → local DB stays committed; form-action contract holds` — wraps publisher in mock that throws; assert exception row exists in DB post-throw + caller sees error.
8. `audit correlation_id matches outbound payload correlation_id across all variants` — single integration that cross-references.

### §8.3 End-to-end / webhook-collision regression

File: NEW — `tests/integration/skip-sf-outbound-and-webhook-convergence.spec.ts`

Reuses the QStash mock pattern from [tests/integration/exception-model-happy-path.spec.ts:69-86](../../tests/integration/exception-model-happy-path.spec.ts#L69-L86) + the publisher mock from §8.2.

Cases:

1. Variant 1 happy path with simulated SF webhook ack: skip → enqueue → simulate `TASK_STATUS_UPDATED_TO_CANCELED` webhook arrival → assert `tasks.internal_status` REMAINS `SKIPPED` (NOT overwritten to `CANCELED`); `webhook_events` row INSERTed (audit preserved); `outbound_sync_state` flips to `synced`.
2. Variant 3 happy path with simulated SF reschedule webhook: skip → enqueue → simulate `TASK_STATUS_UPDATED_TO_RESCHEDULED` → assert `tasks.internal_status` REMAINS `SKIPPED` (NOT overwritten to `ON_HOLD`); `outbound_sync_state` flips to `synced`.
3. Variant 1 with QStash failureCallback fired: enqueue → simulate retry exhaustion → `/api/queue/cancel-task-failed` fires → assert `outbound_push_failures` row exists with `operation='cancel'` + matching `correlation_id` + `tasks.outbound_sync_state = 'failed'`.

This is the regression suite that proves the §6.2 state-collision guard works.

### §8.4 Schema-drift integration spec (opened with plan-PR)

Per the Day-25 / Day-27 schema-drift discipline. File: NEW — `tests/integration/migrations/0029-outbound-sync-state-and-reschedule-op.spec.ts`

Cases:
- `migration 0029 adds outbound_push_failures.operation='reschedule' to CHECK constraint`
- `migration 0029 adds tasks.outbound_sync_state column with default 'synced'` (if §3.6 picks option A from §6.3)
- `migration 0029 backfills SKIPPED+pushed_to_external_at IS NOT NULL tasks to outbound_sync_state='failed'` (if option A)

Spec opens at plan-PR commit so any §3.6 ruling that flips schema posture is caught.

### §8.5 Adapter-layer additions for `rescheduleTask`

If §3.6 approves variant 3 net-new scope:

- New test file `src/modules/integration/providers/suitefleet/tests/task-client-reschedule.spec.ts` — unit test for the SF wire contract (mocks `fetch`, asserts request method/path/body/Content-Type)
- New test file `src/app/api/queue/reschedule-task/tests/route.spec.ts` — mirrors `cancel-task/tests/route.spec.ts`
- New test file `src/app/api/queue/reschedule-task-failed/tests/route.spec.ts` — DLQ insert assertion

---

## §9 Open questions (must-resolve before code-PR opens)

### OQ-1 — Reschedule SF API wire contract (must-resolve)
Brief §3.1.11 row 7 registers `task-resource:reschedule → POST` but the SF endpoint path + request body shape is not confirmed in code. Day-21 precedent: brief mappings can diverge from SF's actual wire contract; empirical probe matters. Either Aqib clarification or a Day-29-extended SF protocol read is required BEFORE the code-PR opens, otherwise we ship speculative field names that lock-in incorrectly.
→ **Action:** flag for Love to send Aqib query (template: same as Day-21 SF outbound clarification).

### OQ-2 — Idempotent-replay enqueue policy (reviewer rules)
Plan §3.4 proposes: replay returns 409 with existing exception_id and DOES NOT re-enqueue (mirrors replay-skips-audit-emit at [service.ts:562-565](../../src/modules/subscription-exceptions/service.ts#L562-L565)). Alternative: replay DOES re-enqueue with the SAME correlation_id (QStash dedup window catches it). Plan recommends NOT re-enqueue (cleaner semantics; operator-retry-after-publisher-failure is a separate ops-triage path).

### OQ-3 — Audit metadata extension vs net-new events (reviewer rules)
Plan §7 recommends extending `subscription.exception.created.metadata` with `outbound_emission` (option A). Alternative: register net-new `task.outbound_cancel.requested` + `.confirmed` (+ `.failed`?) events (option B). Net-new events bump the audit event count past 9 and trigger discipline review per `project_brief_audit_event_count_correction.md`. Plan recommends option A; reviewer to rule.

### OQ-4 — Webhook reflection for reschedule (reviewer rules)
Does SF emit a webhook on operator-initiated reschedule? If yes, which action? `TASK_STATUS_UPDATED_TO_RESCHEDULED` currently maps to `ON_HOLD`, which is wrong semantic for operator reschedule. If SF emits a DIFFERENT action (e.g., `TASK_STATUS_UPDATED_TO_UPDATED`), the convergence path is different. If SF emits nothing on reschedule (quiet success), the pending-confirm clear path needs a different trigger (e.g., the QStash consumer's 200 OK).
→ **Action:** part of OQ-1 SF clarification.

### OQ-5 — `TASK_STATUS_UPDATED_TO_RESCHEDULED` semantic split (reviewer rules)
Currently the action maps to `ON_HOLD` for the DRIVER-reschedule case (driver couldn't deliver, reattempt later). For OPERATOR-initiated reschedule (variant 3), the local task is already `SKIPPED` and the §6.2 guard prevents the inbound webhook from clobbering it. But — does the mapper need to learn the difference (the inbound payload may carry a `triggeredBy` field SF surfaces)? Or is "ignore inbound RESCHEDULED if local is SKIPPED" sufficient? Plan recommends the latter (simpler), but reviewer may want richer mapping semantics.

### OQ-6 — Webhook state-collision guard mechanism (reviewer rules)
§6.2 options A vs B vs C. Plan recommends option A (status-precedence SQL guard). Alternative B (subscription_exceptions join) is more explicit but couples the integration layer to subscription_exceptions. Alternative C (new boolean column) is cleanest but escalates schema. Reviewer to rule.

### OQ-7 — Pending-confirm signal mechanism (reviewer rules)
§6.3 options A vs B vs C. Plan recommends option A (single `outbound_sync_state` enum column). Alternative B (derive at read time, zero schema) is appealing for minimal-blast-radius but punishes the hot read path. Alternative C (timestamp + kind) is more granular but two columns. Reviewer to rule whether schema escalation is acceptable.

### OQ-8 — Backfill posture for existing broken-state tasks (reviewer rules)
§6.3 migration optionally backfills `outbound_sync_state='failed'` for the 2 known production tasks (DMB-24406181, DMB-52660780) plus any other `SKIPPED + pushed_to_external_at IS NOT NULL` rows. Alternative: instead of marking `failed`, kick a one-shot retroactive enqueue per row at migration time (auto-recovery). Plan recommends "mark failed, let ops trigger replay" — auto-replay at migration time has higher blast risk and may surprise operators. Reviewer to rule.

### OQ-9 — Move-to-date variant 3 idempotency on already-rescheduled
If operator skips a date with `target_date_override=X` then changes their mind and skips the same date with `target_date_override=Y`, the IDEMPOTENCY contract is keyed on `(subscription_id, idempotency_key)` — different idempotency_key = new exception row, new outbound enqueue with new correlation_id. The original task on SF would be RESCHEDULED twice. Is that intended? Plan-time: yes, it's intended — each operator intent gets its own correlation. But §3.6 may want to scope a "task already has unresolved outbound_sync_state='pending_reschedule'" guard at the service layer. Plan recommends no guard (each intent gets its own correlation).

### OQ-10 — Demo posture
The production bug-vector tasks (DMB-24406181 + DMB-52660780) are live now on SF. Once the code-PR ships, post-deploy: (a) does ops manually kick a replay via the DLQ row, or (b) does the code-PR migration auto-replay via §6.3 backfill, or (c) does ops manually call the cancelTask via the operator-cancel admin path? Plan recommends (a). Reviewer to rule.

---

## §10 Idempotency / retry posture (consolidated)

### §10.1 Local DB layer
- Exception INSERT: UNIQUE `(subscription_id, idempotency_key)` — second POST returns 409 with existing exception_id via the pre-INSERT SELECT path ([service.ts:467-471](../../src/modules/subscription-exceptions/service.ts#L467-L471)).
- Task UPDATE: `markTaskSkipped` is idempotent at the SQL level (sets `internal_status='SKIPPED'` from any non-terminal state; no-ops on terminal).

### §10.2 QStash layer
- `enqueueCancelTask` deduplicationId: `${task_id}:cancel:${correlation_id}` — collisions within the QStash dedup window collapse cleanly.
- `enqueueRescheduleTask` deduplicationId: `${task_id}:reschedule:${correlation_id}` — same posture.
- Replay (operator double-tap with same idempotency_key): NO re-enqueue (§9 OQ-2 default).

### §10.3 SF wire layer
- Cancel: SF returns 200 on already-CANCELED tasks (per Day-21 empirical probe). Retry safety: idempotent at the SF side.
- Reschedule: unconfirmed (OQ-1). Assume non-idempotent in plan; the QStash dedup is the safety net.

### §10.4 DLQ retry
- QStash native retries: 3 (per [publish.ts:62](../../src/modules/task-outbound-queue/publish.ts#L62)).
- Failure routes: write `outbound_push_failures` row with `failure_reason` enum + `retry_count`.
- Admin UI for retry: Phase 2 per [0023 header](../../supabase/migrations/0023_outbound_push_failures.sql#L80-L83). MVP: operators see the DB row + manual SQL or QStash console replay.

---

## §11 Blast radius (file inventory)

### §11.1 Code files changed

| File | Change |
|---|---|
| [src/modules/subscription-exceptions/service.ts](../../src/modules/subscription-exceptions/service.ts) | Post-commit enqueue block + minimum-surface task return from tx |
| [src/modules/subscription-exceptions/repository.ts](../../src/modules/subscription-exceptions/repository.ts) (or task helper) | `markTaskSkipped` signature returns affected `{ taskId, externalTrackingNumber } \| null` |
| [src/modules/integration/last-mile-adapter.ts](../../src/modules/integration/last-mile-adapter.ts) | NET-NEW `rescheduleTask` method on interface |
| [src/modules/integration/providers/suitefleet/task-client.ts](../../src/modules/integration/providers/suitefleet/task-client.ts) | NET-NEW `rescheduleTask` method |
| [src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts](../../src/modules/integration/providers/suitefleet/last-mile-adapter-factory.ts) | NET-NEW binding for `rescheduleTask` |
| [src/modules/task-outbound-queue/publish.ts](../../src/modules/task-outbound-queue/publish.ts) | NET-NEW `enqueueRescheduleTask` publisher |
| [src/modules/task-outbound-queue/types.ts](../../src/modules/task-outbound-queue/types.ts) | NET-NEW `RescheduleTaskPayload` type |
| `src/app/api/queue/reschedule-task/route.ts` | NET-NEW QStash consumer |
| `src/app/api/queue/reschedule-task-failed/route.ts` | NET-NEW DLQ failure handler |
| [src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts](../../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts) | §6.2 state-collision guard (single WHERE-clause addition) |
| [src/modules/audit/event-types.ts](../../src/modules/audit/event-types.ts) | §7 metadata extension for `subscription.exception.created.metadataNotes` |
| [src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx](../../src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx) | Read-side render branch for `outbound_sync_state` |
| [src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx](../../src/app/(app)/consignees/[id]/_components/TaskTimelineDrawer.tsx) | Read-side render branch for `outbound_sync_state` |

### §11.2 Schema/migration files

| File | Change |
|---|---|
| `supabase/migrations/0029_outbound_push_failures_operation_reschedule.sql` | NET-NEW: extend operation CHECK to include `'reschedule'` |
| `supabase/migrations/0029b_tasks_outbound_sync_state.sql` (conditional on §6.3 option A) | NET-NEW: add column + default + check + backfill |

### §11.3 Test files

| File | Change |
|---|---|
| [tests/integration/subscription-exceptions/service.spec.ts](../../tests/integration/subscription-exceptions/service.spec.ts) | ADD 8 new it() cases (§8.2) |
| `tests/integration/skip-sf-outbound-and-webhook-convergence.spec.ts` | NET-NEW (§8.3) |
| `tests/integration/migrations/0029-outbound-sync-state-and-reschedule-op.spec.ts` | NET-NEW (§8.4) |
| `src/modules/integration/providers/suitefleet/tests/task-client-reschedule.spec.ts` | NET-NEW (§8.5) |
| `src/app/api/queue/reschedule-task/tests/route.spec.ts` | NET-NEW (§8.5) |
| `src/app/api/queue/reschedule-task-failed/tests/route.spec.ts` | NET-NEW (§8.5) |
| [src/app/api/subscriptions/[id]/skip/tests/route.spec.ts](../../src/app/api/subscriptions/[id]/skip/tests/route.spec.ts) | Conditional ADD: 1-2 it() cases IF response shape changes (§8.1) |

Total files touched: ~22 (13 code + 2 migrations + 7 tests).

---

## §12 Phasing (proposed — reviewer rules)

The plan is fully scoped per the product-owner lock. However the variant-3 reschedule slice has a hard external dependency (Aqib SF clarification per OQ-1+OQ-4) that variants 1+2 do not have. Proposed phasing for the code-PR sequence:

- **Phase 1 (code-PR-A):** variants 1+2 (REUSE cancelTask) + §6.2 state-collision guard + §6.3 pending-confirm column + §7 audit metadata extension + tests §8.2 cases 1, 2, 4-8 + §8.3 cases 1+3 + §8.4. Lands without waiting on Aqib.
- **Phase 2 (code-PR-B):** variant 3 (NET-NEW reschedule adapter) + §5 DLQ enum extension + tests §8.2 case 3 + §8.3 case 2 + §8.5. Lands AFTER Aqib confirms SF reschedule wire contract.

The phasing keeps the production bug-fix on the variants-1+2 path off Aqib's calendar. Reviewer may rule otherwise (single bundled code-PR per the "bundle-or-split" preference in the memory note about Day-22n single-PR posture). Default: phased.

---

## §13 Production posture

Post-deploy (per §9 OQ-10 default):
1. Production bug-vector tasks DMB-24406181 + DMB-52660780 remain live "Ordered" on SF.
2. Backfill migration (§6.3 option A) stamps them `outbound_sync_state='failed'`.
3. Ops surfaces them via SQL on the production DB (Phase 2 admin UI to retry from DLQ is out of scope).
4. Ops triggers manual replay either by re-POSTing the skip (idempotency_key collision returns 409; need a fresh key per OQ-9 semantics) or by operator-initiated cancel via the existing cancelTask admin path.

Reviewer to rule on whether (a) is sufficient or (b) auto-replay-at-migration-time per OQ-8 is preferred.

---

## §14 References

- Brief: [memory/PLANNER_PRODUCT_BRIEF.md §3.1.4 / §3.1.5 / §3.1.6 / §3.1.11](../../memory/PLANNER_PRODUCT_BRIEF.md)
- Day-21 PR #227 cancelTask adapter ship: [memory/handoffs/day-21-eod.md:37-39](../../memory/handoffs/day-21-eod.md#L37-L39)
- Day-14 Part-2 plan (skip service flow): [memory/plans/day-14-part2-service-layer.md:243-266](../../memory/plans/day-14-part2-service-layer.md#L243-L266)
- Day-18 reschedule deferral: [memory/plans/day-18-a1-customer-id-resolver-swap.md:225-228](../../memory/plans/day-18-a1-customer-id-resolver-swap.md#L225-L228)
- Day-13 SKIPPED-is-Planner-only quote (inbound mapper scope, NOT outbound): [memory/plans/day-13-exception-model-part-1.md:552](../../memory/plans/day-13-exception-model-part-1.md#L552)
- Migration 0023 outbound_push_failures: [supabase/migrations/0023_outbound_push_failures.sql](../../supabase/migrations/0023_outbound_push_failures.sql)
- Optimistic-ack precedent (operator cancelTask service): [src/modules/tasks/service.ts:1263-1366](../../src/modules/tasks/service.ts#L1263-L1366)
- QStash publisher precedent: [src/modules/task-outbound-queue/publish.ts:135-187](../../src/modules/task-outbound-queue/publish.ts#L135-L187)
- QStash consumer precedent: [src/app/api/queue/cancel-task/route.ts](../../src/app/api/queue/cancel-task/route.ts)
- Webhook applier (collision-risk site): [src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts:163-168](../../src/modules/integration/providers/suitefleet/apply-webhook-status-event.ts#L163-L168)
- Status-mapper (reschedule = ON_HOLD inbound today): [src/modules/integration/providers/suitefleet/status-mapper.ts:89](../../src/modules/integration/providers/suitefleet/status-mapper.ts#L89)
- Memory feedback: [project_brief_audit_event_count_correction.md](../../memory/project_brief_audit_event_count_correction.md) — audit event count discipline (currently 9)
- Memory feedback: [feedback_t3_plan_prs_need_realtime_review.md](../../memory/feedback_t3_plan_prs_need_realtime_review.md) — T3 plan requires real-time counter-review (this PR)
- Memory feedback: [feedback_parallel_sessions_use_git_worktree.md](../../memory/feedback_parallel_sessions_use_git_worktree.md) — worktree discipline (this branch lives in /Users/lovemans/work/planner-d29-skip-outbound-plan)

---

**STOP — awaiting §3.6 review on the 10 open questions in §9 before any code-PR.**
