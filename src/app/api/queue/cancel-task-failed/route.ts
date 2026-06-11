// Day 21 / Phase 1 — QStash failureCallback for `/api/queue/cancel-task`.
// Mirrors `/api/queue/push-task-failed` (Day-14 cron-decoupling §5.2
// amendment 5) but writes to the *outbound_push_failures* DLQ
// (0023) instead of the createTask-side `failed_pushes` (0008).
//
// CONCERN B PII strip runs inside `insertOutboundPushFailure`
// (`src/modules/outbound-push-failures/repository.ts`) — the response
// body excerpt SF returns on 4xx (often echoes the task entity
// including consignee.* PII) is stripped at write time before the
// jsonb column lands on disk.

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";
import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

import { insertOutboundPushFailure } from "@/modules/outbound-push-failures";
import type { OutboundFailureReason } from "@/modules/outbound-push-failures";
import type { CancelTaskPayload } from "@/modules/task-outbound-queue/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_cancel_task_failed" });

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
      "cancel-task-failed: payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const sourceBodyEncoded = qstashFailure.sourceBody;
  if (sourceBodyEncoded === undefined) {
    log.error(
      { qstash_failure: qstashFailure },
      "cancel-task-failed: missing sourceBody — cannot derive task identifiers",
    );
    return new Response(null, { status: 400 });
  }

  let payload: CancelTaskPayload;
  try {
    const decoded = Buffer.from(sourceBodyEncoded, "base64").toString("utf-8");
    payload = JSON.parse(decoded) as CancelTaskPayload;
  } catch (err) {
    log.error(
      {
        error: err instanceof Error ? err.message : String(err),
        source_body_length: sourceBodyEncoded.length,
      },
      "cancel-task-failed: sourceBody decode/parse failed",
    );
    captureException(err, {
      component: "queue_cancel_task_failed",
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

  // failurePayload — adapter-context wrapper. The PII strip helper
  // redacts the SF response body subtree before the jsonb column
  // hits disk (CONCERN B). `correlation_id`, `http_status`, and
  // `source_message_id` survive the strip; the body excerpt has
  // PII subtrees / leaf keys redacted.
  const failurePayload: Record<string, unknown> = {
    source: "qstash_failure_callback",
    operation: "cancel",
    correlation_id: correlationId,
    awb: payload.awb,
    source_message_id: qstashFailure.sourceMessageId,
    source_url: qstashFailure.sourceUrl,
    qstash_dlq_id: qstashFailure.dlqId,
    qstash_retried_count: qstashFailure.retried,
    http_status: qstashFailure.status,
    sf_response_body: qstashFailure.body,
  };

  try {
    const dlqRow = await withServiceRole(
      `queue:cancel_task_failed insert ${taskId}`,
      async (tx) => {
        const row = await insertOutboundPushFailure(tx, tenantId, {
          taskId,
          operation: "cancel",
          correlationId,
          failureReason,
          failurePayload,
          retryCount: qstashFailure.retried ?? 0,
        });

        // Day-29 §D(2) Phase-1 (plan-PR #302 §6.3 + §3.6 OQ-7 ruling
        // Option A): flip outbound_sync_state to 'failed' alongside
        // the DLQ row insert, in the same withServiceRole tx. Gates
        // on the pending state so a row already 'failed' (rare repeat
        // failure for the same task) is unchanged, and a row 'synced'
        // (the operator-initiated cancel path which Phase 1 does not
        // touch) is unchanged. The DLQ row IS the authoritative
        // failure record; the column flip is the read-side UI signal.
        await tx.execute(sqlTag`
          UPDATE tasks
          SET outbound_sync_state = 'failed'
          WHERE id = ${taskId} AND tenant_id = ${tenantId}
            AND outbound_sync_state IN ('pending_cancel', 'pending_reschedule')
        `);

        return row;
      },
    );
    requestLog.warn(
      {
        event: "queue.cancel_task_failed_recorded",
        outbound_push_failure_id: dlqRow.id,
        failure_reason: failureReason,
        http_status: qstashFailure.status,
        retried_count: qstashFailure.retried,
      },
      "cancel-task-failed: recorded to outbound_push_failures DLQ + outbound_sync_state flipped to 'failed'",
    );
    return NextResponse.json(
      { outcome: "recorded", outbound_push_failure_id: dlqRow.id },
      { status: 200 },
    );
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "cancel-task-failed: insertOutboundPushFailure threw",
    );
    captureException(err, {
      component: "queue_cancel_task_failed",
      operation: "insertOutboundPushFailure",
      tenant_id: tenantId,
      task_id: taskId,
    });
    throw err;
  }
});
