// Day-53 EVE — QStash failureCallback for /api/queue/capture-pod.
// Mirrors /api/queue/cancel-task-failed: records the exhausted-retries
// failure to the outbound_push_failures DLQ with operation='pod_capture'
// (CHECK extension in migration 0031). No outbound_sync_state flip —
// POD capture does not own that column; the DLQ row is the full signal.
//
// A row here means the photos were NOT captured and the 7-day SF TTL
// clock is running — the ops surface (failed-pushes work queue) is the
// place a human can act before the photos die at the vendor.

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

import { insertOutboundPushFailure } from "@/modules/outbound-push-failures";
import type { OutboundFailureReason } from "@/modules/outbound-push-failures";
import type { CapturePodPayload } from "@/modules/pod-capture";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_capture_pod_failed" });

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
      "capture-pod-failed: payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const sourceBodyEncoded = qstashFailure.sourceBody;
  if (sourceBodyEncoded === undefined) {
    log.error(
      { qstash_failure: qstashFailure },
      "capture-pod-failed: missing sourceBody — cannot derive task identifiers",
    );
    return new Response(null, { status: 400 });
  }

  let payload: CapturePodPayload;
  try {
    const decoded = Buffer.from(sourceBodyEncoded, "base64").toString("utf-8");
    payload = JSON.parse(decoded) as CapturePodPayload;
  } catch (err) {
    log.error(
      {
        error: err instanceof Error ? err.message : String(err),
        source_body_length: sourceBodyEncoded.length,
      },
      "capture-pod-failed: sourceBody decode/parse failed",
    );
    captureException(err, {
      component: "queue_capture_pod_failed",
      operation: "source_body_decode",
    });
    return new Response(null, { status: 400 });
  }

  const tenantId = payload.tenant_id as Uuid;
  const taskId = payload.task_id as Uuid;
  const requestLog = log.with({
    tenant_id: tenantId,
    task_id: taskId,
    correlation_id: payload.correlation_id,
    source_message_id: qstashFailure.sourceMessageId,
  });

  const failureReason = deriveFailureReason(qstashFailure.status);
  const failurePayload: Record<string, unknown> = {
    source: "qstash_failure_callback",
    operation: "pod_capture",
    correlation_id: payload.correlation_id,
    source_message_id: qstashFailure.sourceMessageId,
    source_url: qstashFailure.sourceUrl,
    qstash_dlq_id: qstashFailure.dlqId,
    qstash_retried_count: qstashFailure.retried,
    http_status: qstashFailure.status,
    response_body: qstashFailure.body,
    ttl_note:
      "POD photos NOT captured — SF pre-signed URLs die 7 days after delivery; act before then.",
  };

  try {
    const dlqRow = await withServiceRole(
      `queue:capture_pod_failed insert ${taskId}`,
      async (tx) =>
        insertOutboundPushFailure(tx, tenantId, {
          taskId,
          operation: "pod_capture",
          correlationId: payload.correlation_id as Uuid,
          failureReason,
          failurePayload,
          retryCount: qstashFailure.retried ?? 0,
        }),
    );
    requestLog.warn(
      {
        event: "queue.capture_pod_failed_recorded",
        outbound_push_failure_id: dlqRow.id,
        failure_reason: failureReason,
        http_status: qstashFailure.status,
        retried_count: qstashFailure.retried,
      },
      "capture-pod-failed: recorded to outbound_push_failures DLQ (operation=pod_capture)",
    );
    return NextResponse.json(
      { outcome: "recorded", outbound_push_failure_id: dlqRow.id },
      { status: 200 },
    );
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "capture-pod-failed: insertOutboundPushFailure threw",
    );
    captureException(err, {
      component: "queue_capture_pod_failed",
      operation: "insertOutboundPushFailure",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }
});
