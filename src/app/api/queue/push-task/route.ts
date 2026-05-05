// Day-14 cron decoupling — queue-side push handler per
// memory/plans/day-14-cron-decoupling.md §5.1.
//
// QStash POSTs to this endpoint per `batchJSON` message published by
// the materialization-cron handler at Phase 5. This handler validates
// the payload, looks up the task, applies §5.1 amendment 1 + 2 + 6
// guards, and delegates SF push to `pushSingleTask` (NOT the SF
// adapter directly — preserves the §1.3 retirement-table contract
// that pushSingleTask becomes the only post-cutover caller of
// markTaskPushed and the only path through the D8-4b reconcile branch).
//
// 10-value observability outcome enum (replaces §5.5 sketch's 5-value
// version, which was simplified — actual implementation has more
// distinct states). All 10 are emitted via the per-handler structured
// log alongside sf_latency_ms.
//
// Coupled-deploy gate per §11.2 row 2: `export const maxDuration = 300;`
// at top is a runtime-bug guard. Without it, Vercel non-cron API routes
// default to 60s on Pro; the handler dies at 60s mid-SF-call. CI grep
// test fails if absent (per §7.2 row 1).

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Actor, RequestContext } from "@/shared/tenant-context";

import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import { pushSingleTask } from "@/modules/task-push";
import { findTaskById } from "@/modules/tasks/repository";
import type { PushTaskPayload } from "@/modules/task-materialization/queue";

// §5.1 amendment 3 + §11.2 row 2 — RUNTIME BUG GUARD. Without this
// declaration, Vercel non-cron API routes default to 60s on Pro;
// handler dies at 60s mid-SF-call on slow responses. The §1.1
// per-message timeout envelope claim depends on this. CI grep test
// fails if this line is absent (per §7.2 row 1). DO NOT remove.
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Node runtime required for SF adapter's HTTPS calls; Edge runtime's
// fetch surface differs and the postgres-js driver inside withServiceRole
// is Node-only.
export const runtime = "nodejs";

const log = logger.with({ component: "queue_push_task" });

// Module-level adapter singleton. Mirrors cron handler pattern at the
// pre-Day-14 route.ts:172-175 — adapter is stateless after construction
// (per-tenant credentials resolve inside on each call); reconstructing
// per-request would burn cold-start time for no benefit.
const adapter = createSuiteFleetLastMileAdapter({
  fetch: globalThis.fetch,
  clock: () => new Date(),
});

/**
 * 10-value observability outcome enum. Emitted in the per-handler
 * structured log at handler exit alongside sf_latency_ms. Maps:
 *   - 3 pre-pushSingleTask guard outcomes (tenant_mismatch, address_id_null,
 *     task_already_pushed_pre_check)
 *   - 1 task-not-found defensive outcome (pre-call task lookup)
 *   - 6 of 8 SinglePushOutcome kinds mapped to terminal HTTP+log paths
 *     (the 7th kind 'awb_exists' throws for QStash retry; the 8th kind
 *     'task_not_found' from pushSingleTask collapses to the same outcome
 *     as the pre-call task-not-found case)
 */
type Outcome =
  | "tenant_mismatch_rejected"
  | "address_id_null_rejected"
  | "task_already_pushed_pre_check"
  | "success"
  | "awb_exists_reconciled"
  | "awb_reconcile_failed_retry_throw"
  | "failed_to_dlq"
  | "skipped_district"
  | "tenant_skipped_no_credentials"
  | "task_already_pushed_in_push"
  | "task_not_found";

export const POST = verifySignatureAppRouter(async (request: Request) => {
  const sfStartMs = Date.now();

  let payload: PushTaskPayload;
  try {
    payload = (await request.json()) as PushTaskPayload;
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "queue handler payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const { tenant_id: tenantId, task_id: taskId } = payload;
  const requestLog = log.with({ tenant_id: tenantId, task_id: taskId });

  // ---------------------------------------------------------------------------
  // Pre-call task read for §5.1 guards (Steps 1.4, 1.5, Layer 2 idempotency).
  //
  // Two-read pattern per Q2 direction: this read validates the 3 pre-guards
  // before pushSingleTask runs its own internal task read. The cost is one
  // extra SELECT on the happy path; the benefit is fail-fast at 400 on
  // tenant-mismatch / address_id NULL without involving the SF adapter.
  // ---------------------------------------------------------------------------
  const task = await withServiceRole(
    `queue:push_task_lookup ${taskId}`,
    async (tx) => findTaskById(tx, taskId),
  );

  // task_not_found — defensive ack (200, don't retry per Q4). The task
  // could be missing because (a) deleted between materialization and push,
  // or (b) RLS hiding due to tenant mismatch (which Step 1.4 would catch
  // if task were visible). Either way, retrying won't help.
  if (task === null) {
    requestLog.warn(
      {
        outcome: "task_not_found" satisfies Outcome,
        sf_latency_ms: Date.now() - sfStartMs,
      },
      "queue handler — task not found at pre-call lookup",
    );
    return NextResponse.json({ outcome: "task_not_found" }, { status: 200 });
  }

  // Step 1.4 — tenant scoping defense-in-depth (§5.1 amendment 1).
  // QStash signature gate prevents external spoofing; this prevents
  // payload-construction bugs in our own materialization handler.
  if (task.tenantId !== tenantId) {
    requestLog.warn(
      {
        outcome: "tenant_mismatch_rejected" satisfies Outcome,
        task_tenant_id: task.tenantId,
        sf_latency_ms: Date.now() - sfStartMs,
      },
      "queue handler — tenant mismatch between payload and task row",
    );
    captureException(
      new Error(
        `queue handler tenant mismatch: payload=${tenantId} task=${task.tenantId}`,
      ),
      {
        component: "queue_push_task",
        operation: "tenant_mismatch",
        tenant_id: tenantId,
        task_id: taskId,
        task_tenant_id: task.tenantId,
      },
    );
    return new Response(null, { status: 400 });
  }

  // Step 1.5 — address_id null guard (§5.1 amendment 2). Defense-in-depth
  // against the §2.2 refuse-to-materialize policy lapsing in future
  // hardening. Don't crash; QStash retry won't help (the row's null state
  // is durable); let it land in DLQ via failureCallback for ops triage.
  if (task.addressId === null) {
    requestLog.warn(
      {
        event: "push.address_id_null",
        outcome: "address_id_null_rejected" satisfies Outcome,
        sf_latency_ms: Date.now() - sfStartMs,
      },
      "queue handler — task.address_id IS NULL; rejecting to DLQ via failureCallback",
    );
    captureException(
      new Error(`push.address_id_null: tenant=${tenantId} task=${taskId}`),
      {
        component: "queue_push_task",
        operation: "address_id_null",
        tenant_id: tenantId,
        task_id: taskId,
      },
    );
    return new Response(null, { status: 400 });
  }

  // Layer 2 idempotency — pre-check (§5.3). pushSingleTask also has this
  // check internally, but checking on the same row we already read is free.
  if (task.pushedToExternalAt !== null) {
    requestLog.info(
      {
        outcome: "task_already_pushed_pre_check" satisfies Outcome,
        sf_latency_ms: Date.now() - sfStartMs,
      },
      "queue handler — task already pushed; pre-check skip",
    );
    return NextResponse.json(
      { outcome: "task_already_pushed_pre_check" },
      { status: 200 },
    );
  }

  // Build system-actor RequestContext for pushSingleTask. The ctx
  // tenantId is now verified equal to the task's tenantId (Step 1.4
  // assertion above); pushSingleTask resolves the task via RLS scoped
  // to ctx.tenantId.
  const actor: Actor = {
    kind: "system",
    system: "queue:push_task",
    tenantId,
    permissions: new Set(),
  };
  const ctx: RequestContext = {
    actor,
    tenantId,
    requestId:
      request.headers.get("upstash-message-id") ?? `queue-${taskId}`,
    path: "/api/queue/push-task",
  };

  // Step 4 — pushSingleTask (NOT adapter directly per §5.1 amendment 6 +
  // §11.2 row 6). This preserves the D8-4b reconcile branch at line 1002
  // and the §1.3 retirement-table contract that pushSingleTask becomes
  // the only post-cutover caller of markTaskPushed.
  let result;
  try {
    result = await pushSingleTask(ctx, taskId, adapter);
  } catch (err) {
    requestLog.error(
      {
        outcome: "awb_reconcile_failed_retry_throw" satisfies Outcome,
        error: err instanceof Error ? err.message : String(err),
        sf_latency_ms: Date.now() - sfStartMs,
      },
      "queue handler — pushSingleTask threw; QStash will retry per §5.2",
    );
    captureException(err, {
      component: "queue_push_task",
      operation: "pushSingleTask_throw",
      tenant_id: tenantId,
      task_id: taskId,
    });
    // Re-throw to trigger QStash retry per §5.2 native retry semantics.
    // Final-retry-exhausted lands via failureCallback at /api/queue/push-task-failed.
    throw err;
  }

  const sfLatencyMs = Date.now() - sfStartMs;

  // ---------------------------------------------------------------------------
  // Map SinglePushOutcome → HTTP + observability outcome (§5.5 enum).
  // Switch is exhaustive over the 8-kind union from
  // src/modules/task-push/types.ts:102-138; TS narrows on each case.
  // ---------------------------------------------------------------------------
  switch (result.kind) {
    case "succeeded":
      requestLog.info(
        { outcome: "success" satisfies Outcome, sf_latency_ms: sfLatencyMs },
        "queue handler — success",
      );
      return NextResponse.json({ outcome: "success" }, { status: 200 });

    case "awb_reconciled":
      requestLog.info(
        {
          outcome: "awb_exists_reconciled" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
          prior_failed_push_resolved: result.priorFailedPushResolved,
        },
        "queue handler — awb_exists reconciled to externalId",
      );
      return NextResponse.json(
        { outcome: "awb_exists_reconciled" },
        { status: 200 },
      );

    case "awb_exists":
      // Reconcile failed — could be transient (SF mid-flight) or
      // persistent (data integrity). Throw to trigger QStash retry per
      // §5.2; if persistent, eventually lands in DLQ via failureCallback.
      requestLog.warn(
        {
          outcome: "awb_reconcile_failed_retry_throw" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
          reconcile_error: result.reconcileErrorMessage,
        },
        "queue handler — awb_exists reconcile failed; throwing for QStash retry",
      );
      throw new Error(
        `awb_exists reconcile failed for tenant=${tenantId} task=${taskId}: ${result.reconcileErrorMessage}`,
      );

    case "failed_to_dlq":
      // pushSingleTask already wrote the row to failed_pushes via the
      // existing DLQ surface. Return 200 to ack the QStash message; no
      // retry — the row is in the DLQ for ops triage via /admin/failed-pushes.
      requestLog.info(
        {
          outcome: "failed_to_dlq" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
          failure_reason: result.failureReason,
          failure_detail: result.failureDetail,
          http_status: result.httpStatus,
        },
        "queue handler — pushSingleTask routed to failed_pushes DLQ",
      );
      return NextResponse.json(
        { outcome: "failed_to_dlq" },
        { status: 200 },
      );

    case "skipped_district":
      requestLog.info(
        {
          outcome: "skipped_district" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
          district: result.district,
        },
        "queue handler — skipped_district",
      );
      return NextResponse.json(
        { outcome: "skipped_district" },
        { status: 200 },
      );

    case "tenant_skipped":
      // Defensive — should never reach here post-cron-eligibility filter
      // (cron filters on suitefleet_customer_code present at enumeration
      // layer). If this fires, something has changed between cron tick
      // and message delivery.
      requestLog.warn(
        {
          outcome: "tenant_skipped_no_credentials" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
          reason: result.reason,
        },
        "queue handler — tenant_skipped (defensive — should not reach here post-cron-eligibility filter)",
      );
      return NextResponse.json(
        { outcome: "tenant_skipped_no_credentials" },
        { status: 200 },
      );

    case "task_already_pushed":
      // Race: our pre-check passed but pushSingleTask saw the row already
      // pushed by another path (e.g., DLQ retry UI ran concurrently).
      requestLog.info(
        {
          outcome: "task_already_pushed_in_push" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
          external_id: result.externalId,
        },
        "queue handler — task_already_pushed inside pushSingleTask (race after pre-check)",
      );
      return NextResponse.json(
        { outcome: "task_already_pushed_in_push" },
        { status: 200 },
      );

    case "task_not_found":
      // pushSingleTask saw no task — defensive (could be RLS hiding due
      // to tenant mismatch slipping past Step 1.4, or task deleted
      // between pre-check and pushSingleTask read). Ack message; don't
      // retry.
      requestLog.warn(
        {
          outcome: "task_not_found" satisfies Outcome,
          sf_latency_ms: sfLatencyMs,
        },
        "queue handler — task_not_found inside pushSingleTask (RLS or race)",
      );
      return NextResponse.json(
        { outcome: "task_not_found" },
        { status: 200 },
      );
  }
});
