// Day 21 / Phase 1 — QStash queue handler for SuiteFleet outbound
// cancelTask. Consumes `CancelTaskPayload` from
// `src/modules/task-outbound-queue/types.ts` published by the
// service-layer cancel flow (Day 22+).
//
// Mirrors the `/api/queue/push-task` pattern (CONCERN A from the
// Day-19 plan-PR §3.6) verbatim:
//   - QStash signature gate via verifySignatureAppRouter
//   - Pre-call task lookup for tenant-mismatch + task-not-found defense
//   - Adapter singleton constructed at module load
//   - 200 OK ack on terminal outcomes; throw to trigger QStash retry
//     on transient failures; failureCallback at /cancel-task-failed
//     handles retry exhaustion → outbound_push_failures DLQ
//   - maxDuration=300 + dynamic + nodejs runtime declarations to
//     prevent the Vercel 60s timeout that would kill mid-SF-call
//
// The cancel path is fire-and-forget at the adapter layer — SF
// webhook (TASK_STATUS_UPDATED_TO_CANCELED, ~1s post-PATCH) drives
// local state convergence via the existing apply-webhook-status-event
// receiver. This route does NOT write local DB.

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { withServiceRole } from "@/shared/db";
import { CredentialError, ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";

import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import { findTaskById } from "@/modules/tasks/repository";
import type { CancelTaskPayload } from "@/modules/task-outbound-queue/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_cancel_task" });

// Module-level adapter singleton — mirrors push-task/route.ts pattern.
// Stateless after construction (per-tenant credentials resolve inside
// on each call); reconstructing per-request would burn cold-start time.
const adapter = createSuiteFleetLastMileAdapter({
  fetch: globalThis.fetch,
  clock: () => new Date(),
});

type Outcome =
  | "success"
  | "tenant_mismatch_rejected"
  | "task_not_found"
  | "awb_mismatch_rejected"
  | "validation_error"
  | "credential_error_retry_throw";

export const POST = verifySignatureAppRouter(async (request: Request) => {
  const startMs = Date.now();

  let payload: CancelTaskPayload;
  try {
    payload = (await request.json()) as CancelTaskPayload;
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "queue cancel-task payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const { tenant_id: tenantId, task_id: taskId, awb, correlation_id: correlationId } = payload;
  const requestLog = log.with({
    tenant_id: tenantId,
    task_id: taskId,
    awb,
    correlation_id: correlationId,
  });

  // Pre-call task lookup — defensive validation before SF mutation.
  const task = await withServiceRole(
    `queue:cancel_task_lookup ${taskId}`,
    async (tx) => findTaskById(tx, taskId),
  );

  if (task === null) {
    requestLog.warn(
      { outcome: "task_not_found" satisfies Outcome, sf_latency_ms: Date.now() - startMs },
      "cancel-task: task not found at pre-call lookup",
    );
    return NextResponse.json({ outcome: "task_not_found" }, { status: 200 });
  }

  if (task.tenantId !== tenantId) {
    requestLog.warn(
      {
        outcome: "tenant_mismatch_rejected" satisfies Outcome,
        task_tenant_id: task.tenantId,
        sf_latency_ms: Date.now() - startMs,
      },
      "cancel-task: tenant mismatch between payload and task row",
    );
    captureException(
      new Error(`cancel-task tenant mismatch: payload=${tenantId} task=${task.tenantId}`),
      { component: "queue_cancel_task", operation: "tenant_mismatch", tenant_id: tenantId, task_id: taskId },
    );
    return new Response(null, { status: 400 });
  }

  if (task.externalTrackingNumber !== awb) {
    // Defence against the rare race where the local task's AWB has
    // been overwritten between message publish and consumption.
    // Cancelling the wrong AWB would mutate someone else's delivery.
    requestLog.warn(
      {
        outcome: "awb_mismatch_rejected" satisfies Outcome,
        payload_awb: awb,
        task_awb: task.externalTrackingNumber,
        sf_latency_ms: Date.now() - startMs,
      },
      "cancel-task: payload AWB does not match task.external_tracking_number",
    );
    captureException(
      new Error(`cancel-task AWB mismatch: payload=${awb} task=${task.externalTrackingNumber}`),
      { component: "queue_cancel_task", operation: "awb_mismatch", tenant_id: tenantId, task_id: taskId },
    );
    return new Response(null, { status: 400 });
  }

  let session;
  try {
    session = await adapter.authenticate(tenantId);
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "cancel-task: authenticate threw — QStash will retry per native policy",
    );
    captureException(err, {
      component: "queue_cancel_task",
      operation: "authenticate",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }

  try {
    await adapter.cancelTask(session, awb, correlationId);
  } catch (err) {
    if (err instanceof ValidationError) {
      // 4xx — non-retryable. Ack message, route to DLQ via
      // failureCallback by re-throwing so QStash retry+exhaust path
      // fires. (We could short-circuit to DLQ here directly, but
      // mirroring push-task's QStash-owns-retry-state posture keeps
      // the queue routes uniform.)
      requestLog.warn(
        {
          outcome: "validation_error" satisfies Outcome,
          error: err.message,
          sf_latency_ms: Date.now() - startMs,
        },
        "cancel-task: ValidationError from adapter — throwing for QStash retry/exhaustion",
      );
      throw err;
    }
    if (err instanceof CredentialError) {
      requestLog.warn(
        {
          outcome: "credential_error_retry_throw" satisfies Outcome,
          error: err.message,
          sf_latency_ms: Date.now() - startMs,
        },
        "cancel-task: CredentialError from adapter — throwing for QStash retry/exhaustion",
      );
      throw err;
    }
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "cancel-task: unexpected error from adapter — throwing for QStash retry/exhaustion",
    );
    captureException(err, {
      component: "queue_cancel_task",
      operation: "adapter_cancel_task",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }

  requestLog.info(
    { outcome: "success" satisfies Outcome, sf_latency_ms: Date.now() - startMs },
    "cancel-task: success — webhook will converge local state",
  );
  return NextResponse.json({ outcome: "success" }, { status: 200 });
});
