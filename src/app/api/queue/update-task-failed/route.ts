// Day 21 / Phase 1 — QStash failureCallback for `/api/queue/update-task`.
// See `/api/queue/cancel-task-failed/route.ts` file header for shared
// design rationale. Diff vs cancel-task-failed:
//
//   1. Decoded sourceBody parses to UpdateTaskPayload (carries the
//      merge-patch). The patch shape lands in the failurePayload
//      wrapper for forensic visibility — its consignee subtree (if
//      present) is PII-stripped at write time per CONCERN B.
//   2. operation = "update" instead of "cancel".

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

import { insertOutboundPushFailure } from "@/modules/outbound-push-failures";
import type { OutboundFailureReason } from "@/modules/outbound-push-failures";
import type { UpdateTaskPayload } from "@/modules/task-outbound-queue/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_update_task_failed" });

interface QStashFailureCallbackBody {
  sourceMessageId?: string;
  sourceUrl?: string;
  sourceBody?: string;
  status?: number;
  body?: string;
  retried?: number;
  dlqId?: string;
}

function deriveFailureReason(status: number | undefined): OutboundFailureReason {
  if (status === undefined) return "unknown";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 && status < 600) return "server_5xx";
  if (status >= 400 && status < 500) return "client_4xx";
  return "unknown";
}

export const POST = verifySignatureAppRouter(async (request: Request) => {
  let qstashFailure: QStashFailureCallbackBody;
  try {
    qstashFailure = (await request.json()) as QStashFailureCallbackBody;
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "update-task-failed: payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const sourceBodyEncoded = qstashFailure.sourceBody;
  if (sourceBodyEncoded === undefined) {
    log.error(
      { qstash_failure: qstashFailure },
      "update-task-failed: missing sourceBody — cannot derive task identifiers",
    );
    return new Response(null, { status: 400 });
  }

  let payload: UpdateTaskPayload;
  try {
    const decoded = Buffer.from(sourceBodyEncoded, "base64").toString("utf-8");
    payload = JSON.parse(decoded) as UpdateTaskPayload;
  } catch (err) {
    log.error(
      {
        error: err instanceof Error ? err.message : String(err),
        source_body_length: sourceBodyEncoded.length,
      },
      "update-task-failed: sourceBody decode/parse failed",
    );
    captureException(err, {
      component: "queue_update_task_failed",
      operation: "source_body_decode",
    });
    return new Response(null, { status: 400 });
  }

  const tenantId = payload.tenant_id as Uuid;
  const taskId = payload.task_id as Uuid;
  const correlationId = payload.correlation_id as Uuid;
  const requestLog = log.with({
    tenant_id: tenantId,
    task_id: taskId,
    correlation_id: correlationId,
    source_message_id: qstashFailure.sourceMessageId,
  });

  const failureReason = deriveFailureReason(qstashFailure.status);

  const failurePayload: Record<string, unknown> = {
    source: "qstash_failure_callback",
    operation: "update",
    correlation_id: correlationId,
    awb: payload.awb,
    patch_keys: Object.keys(payload.patch),
    // The patch itself MAY contain PII (consignee snapshot). Redaction
    // happens inside insertOutboundPushFailure → stripPiiObject.
    patch: payload.patch as unknown as Record<string, unknown>,
    source_message_id: qstashFailure.sourceMessageId,
    source_url: qstashFailure.sourceUrl,
    qstash_dlq_id: qstashFailure.dlqId,
    qstash_retried_count: qstashFailure.retried,
    http_status: qstashFailure.status,
    sf_response_body: qstashFailure.body,
  };

  try {
    const dlqRow = await withServiceRole(
      `queue:update_task_failed insert ${taskId}`,
      async (tx) =>
        insertOutboundPushFailure(tx, tenantId, {
          taskId,
          operation: "update",
          correlationId,
          failureReason,
          failurePayload,
          retryCount: qstashFailure.retried ?? 0,
        }),
    );
    requestLog.warn(
      {
        event: "queue.update_task_failed_recorded",
        outbound_push_failure_id: dlqRow.id,
        failure_reason: failureReason,
        http_status: qstashFailure.status,
        retried_count: qstashFailure.retried,
      },
      "update-task-failed: recorded to outbound_push_failures DLQ",
    );
    return NextResponse.json(
      { outcome: "recorded", outbound_push_failure_id: dlqRow.id },
      { status: 200 },
    );
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "update-task-failed: insertOutboundPushFailure threw",
    );
    captureException(err, {
      component: "queue_update_task_failed",
      operation: "insertOutboundPushFailure",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }
});
