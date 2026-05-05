// Day-14 cron decoupling — QStash failureCallback receiver per
// memory/plans/day-14-cron-decoupling.md §5.2 amendment 5.
//
// QStash POSTs to this endpoint when a push-task message exhausts its
// retries (per §5.2: 3 retries, exponential backoff, 30s per-call
// timeout). The handler extracts the original push-task payload from
// the QStash failure metadata, derives a failure_reason from the
// response status, and INSERTs a row into the existing failed_pushes
// table — same DLQ surface ops already see at /admin/failed-pushes
// (no new operator surface per §5.2 amendment 5).
//
// failureCallback is the canonical QStash retry-exhaustion signal
// source per the §5.2 amendment 5 lock; client-side retry counting
// was REJECTED at plan time (same failure class as §4.4 stale-running:
// client-side state under crash conditions). QStash owns the retry
// state.
//
// Coupled-deploy gate: same maxDuration=300 + signature gate posture
// as /api/queue/push-task. Without maxDuration declaration, Vercel
// non-cron API routes default to 60s on Pro and the handler dies
// mid-INSERT on slow responses.

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

import { insertFailedPush } from "@/modules/failed-pushes/repository";
import type { FailureReason } from "@/modules/failed-pushes/types";
import type { PushTaskPayload } from "@/modules/task-materialization/queue";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_push_task_failed" });

/**
 * QStash failureCallback request body shape. Documented at
 * upstash.com/docs/qstash/features/callbacks#failure-callback (prose,
 * not a strictly-typed SDK export — defining the relevant subset here
 * for the queue-side contract).
 *
 * sourceBody is the BASE64-encoded original message body (the
 * `{ tenant_id, task_id }` PushTaskPayload published by the
 * materialization-cron Phase 5 enqueue). Parsing requires
 * base64-decode + JSON.parse.
 */
interface QStashFailureCallbackBody {
  /** QStash message id of the original (now-exhausted) message. */
  sourceMessageId?: string;
  /** Original target URL — should be ${PUBLIC_BASE_URL}/api/queue/push-task. */
  sourceUrl?: string;
  /** BASE64-encoded original message body — decode + parse to PushTaskPayload. */
  sourceBody?: string;
  /** HTTP status of the last failed retry attempt. */
  status?: number;
  /** Response body of the last failed retry attempt (informational). */
  body?: string;
  /** Number of retries before exhaustion (informational). */
  retried?: number;
  /** DLQ id within QStash's own DLQ surface (informational). */
  dlqId?: string;
}

/**
 * Map QStash retry-exhaustion HTTP status to the failed_pushes
 * failure_reason CHECK enum from 0008:144-151:
 *   network / server_5xx / client_4xx / timeout / unknown
 */
function deriveFailureReason(status: number | undefined): FailureReason {
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
      "failureCallback payload parse failed",
    );
    return new Response(null, { status: 400 });
  }

  const sourceBodyEncoded = qstashFailure.sourceBody;
  if (sourceBodyEncoded === undefined) {
    log.error(
      { qstash_failure: qstashFailure },
      "failureCallback missing sourceBody — cannot derive task_id",
    );
    return new Response(null, { status: 400 });
  }

  // Decode + parse the original PushTaskPayload from base64 sourceBody.
  let payload: PushTaskPayload;
  try {
    const decoded = Buffer.from(sourceBodyEncoded, "base64").toString("utf-8");
    payload = JSON.parse(decoded) as PushTaskPayload;
  } catch (err) {
    log.error(
      {
        error: err instanceof Error ? err.message : String(err),
        source_body_length: sourceBodyEncoded.length,
      },
      "failureCallback sourceBody decode/parse failed",
    );
    captureException(err, {
      component: "queue_push_task_failed",
      operation: "source_body_decode",
    });
    return new Response(null, { status: 400 });
  }

  const tenantId = payload.tenant_id as Uuid;
  const taskId = payload.task_id as Uuid;
  const requestLog = log.with({
    tenant_id: tenantId,
    task_id: taskId,
    source_message_id: qstashFailure.sourceMessageId,
  });

  const failureReason = deriveFailureReason(qstashFailure.status);
  // task_payload column is jsonb NOT NULL — store the QStash failure
  // metadata snapshot for ops triage. Sparse but informative; ops
  // sees source_message_id, status, retried, response body excerpt,
  // and the original payload context (tenant_id + task_id).
  const taskPayloadSnapshot: Record<string, unknown> = {
    source: "qstash_failure_callback",
    source_message_id: qstashFailure.sourceMessageId,
    source_url: qstashFailure.sourceUrl,
    qstash_dlq_id: qstashFailure.dlqId,
    qstash_retried_count: qstashFailure.retried,
    qstash_response_body: qstashFailure.body,
    original_push_payload: payload,
  };

  // INSERT failed_pushes row via existing repo (mirrors the legacy
  // pushTasksForTenant DLQ-emission pattern; see
  // src/modules/failed-pushes/repository.ts:105 insertFailedPush).
  try {
    const failedPush = await withServiceRole(
      `queue:push_task_failed insert ${taskId}`,
      async (tx) =>
        insertFailedPush(tx, tenantId, {
          taskId,
          taskPayload: taskPayloadSnapshot,
          failureReason,
          failureDetail:
            typeof qstashFailure.body === "string"
              ? qstashFailure.body.slice(0, 1000)
              : undefined,
          httpStatus: qstashFailure.status,
        }),
    );

    requestLog.warn(
      {
        event: "queue.push_task_failed_recorded",
        failed_push_id: failedPush.id,
        failure_reason: failureReason,
        http_status: qstashFailure.status,
        retried_count: qstashFailure.retried,
      },
      "queue handler — failureCallback recorded to failed_pushes DLQ",
    );

    return NextResponse.json(
      { outcome: "recorded", failed_push_id: failedPush.id },
      { status: 200 },
    );
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "failureCallback insertFailedPush threw",
    );
    captureException(err, {
      component: "queue_push_task_failed",
      operation: "insertFailedPush",
      tenant_id: tenantId,
      task_id: taskId,
    });
    // Throw so QStash retries the failureCallback itself per its own
    // retry policy. If the failed_pushes INSERT keeps failing (e.g.,
    // task_id FK violation because the task was deleted), QStash will
    // exhaust and the failure becomes visible in QStash's own DLQ
    // surface — last-resort observability.
    throw err;
  }
});
