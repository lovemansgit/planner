// Day 21 / Phase 1 — QStash queue handler for SuiteFleet outbound
// updateTask. See `/api/queue/cancel-task/route.ts` file header for
// the shared design rationale (signature gate, defensive guards,
// adapter singleton, retry posture, DLQ routing). Diff vs cancel-task:
//
//   1. Payload type is UpdateTaskPayload (carries the merge-patch).
//   2. Adapter call is `adapter.updateTask(session, awb, patch)`
//      instead of `cancelTask`. Patch crosses RFC 7396 merge-patch
//      semantics — only present fields land on SF wire.
//   3. Same fire-and-forget posture: SF webhook fires
//      TASK_HAS_BEEN_UPDATED (non-lifecycle, mapper returns null);
//      local state stays as-is unless the operator-side flow has
//      already written it (it does — service-layer commits before
//      enqueueing this message per plan §F.4).

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { withServiceRole } from "@/shared/db";
import { CredentialError, ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";

import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import { findTaskById } from "@/modules/tasks/repository";
import type { UpdateTaskPayload } from "@/modules/task-outbound-queue/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_update_task" });

// Module-level adapter singleton — mirrors push-task/route.ts pattern.
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

  let payload: UpdateTaskPayload;
  try {
    payload = (await request.json()) as UpdateTaskPayload;
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "queue update-task payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const {
    tenant_id: tenantId,
    task_id: taskId,
    awb,
    patch,
    correlation_id: correlationId,
  } = payload;
  const requestLog = log.with({
    tenant_id: tenantId,
    task_id: taskId,
    awb,
    correlation_id: correlationId,
    patch_keys: Object.keys(patch).join(","),
  });

  const task = await withServiceRole(
    `queue:update_task_lookup ${taskId}`,
    async (tx) => findTaskById(tx, taskId),
  );

  if (task === null) {
    requestLog.warn(
      { outcome: "task_not_found" satisfies Outcome, sf_latency_ms: Date.now() - startMs },
      "update-task: task not found at pre-call lookup",
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
      "update-task: tenant mismatch between payload and task row",
    );
    captureException(
      new Error(`update-task tenant mismatch: payload=${tenantId} task=${task.tenantId}`),
      { component: "queue_update_task", operation: "tenant_mismatch", tenant_id: tenantId, task_id: taskId },
    );
    return new Response(null, { status: 400 });
  }

  if (task.externalTrackingNumber !== awb) {
    requestLog.warn(
      {
        outcome: "awb_mismatch_rejected" satisfies Outcome,
        payload_awb: awb,
        task_awb: task.externalTrackingNumber,
        sf_latency_ms: Date.now() - startMs,
      },
      "update-task: payload AWB does not match task.external_tracking_number",
    );
    captureException(
      new Error(`update-task AWB mismatch: payload=${awb} task=${task.externalTrackingNumber}`),
      { component: "queue_update_task", operation: "awb_mismatch", tenant_id: tenantId, task_id: taskId },
    );
    return new Response(null, { status: 400 });
  }

  let session;
  try {
    session = await adapter.authenticate(tenantId);
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "update-task: authenticate threw — QStash will retry per native policy",
    );
    captureException(err, {
      component: "queue_update_task",
      operation: "authenticate",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }

  try {
    await adapter.updateTask(session, awb, patch);
  } catch (err) {
    if (err instanceof ValidationError) {
      requestLog.warn(
        {
          outcome: "validation_error" satisfies Outcome,
          error: err.message,
          sf_latency_ms: Date.now() - startMs,
        },
        "update-task: ValidationError from adapter — throwing for QStash retry/exhaustion",
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
        "update-task: CredentialError from adapter — throwing for QStash retry/exhaustion",
      );
      throw err;
    }
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "update-task: unexpected error from adapter — throwing for QStash retry/exhaustion",
    );
    captureException(err, {
      component: "queue_update_task",
      operation: "adapter_update_task",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }

  requestLog.info(
    { outcome: "success" satisfies Outcome, sf_latency_ms: Date.now() - startMs },
    "update-task: success",
  );
  return NextResponse.json({ outcome: "success" }, { status: 200 });
});
