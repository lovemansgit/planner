// src/modules/task-outbound-queue/publish.ts
//
// Day-22 Phase 1 / SF outbound — service-layer publisher fns. Mirrors
// the `src/modules/task-materialization/queue.ts` publisher pattern
// (Day-14 Phase 5 cron-decoupling) but for the operator-initiated
// cancel / update flows landing as part of the Phase 1 merchant CRUD
// lane.
//
// Consumer side:
//   /api/queue/cancel-task   (Day-21 PR #227)
//   /api/queue/update-task   (Day-21 PR #227)
//   failureCallback URLs route to the *-failed twins which write
//   outbound_push_failures via the CONCERN B PII-strip path.
//
// Publishers per call shape:
//   - Single cancel  → enqueueCancelTask: 1 QStash message
//   - Single update  → enqueueUpdateTask: 1 QStash message
//   - Bulk variants  → fan-out to N single-task messages via batchJSON
//
// Bulk-fan-out rationale: plan §G.4 only spec'd single QStash routes
// (`/api/queue/cancel-task` + `/api/queue/update-task`). The bulk
// adapter method `bulkCancelTasks(session, sfTaskIds)` (Day-21 #227)
// uses a single SF bulk PATCH call, but the QStash route that would
// drive that single bulk PATCH does not yet exist. Until a dedicated
// `/api/queue/bulk-cancel-tasks` route lands, bulk service-layer fns
// fan out to N single-task messages — operator-facing UI works; loses
// the single-bulk-PATCH efficiency but stays rate-limit-friendly via
// the existing flowControl key (5 req/sec global per merchant; 100
// tasks ≈ 20s wall-clock).
//
// QStash conventions mirrored from queue.ts (do NOT diverge):
//   - deduplicationId — for cancel: `${taskId}:cancel:${correlationId}`;
//     for update: `${taskId}:update:${correlationId}`. Correlation_id is
//     the load-bearing dedup tail per cancellation/update — operator
//     re-clicks within the QStash dedup window collapse cleanly.
//   - flowControl — same env-resolved `QSTASH_FLOW_CONTROL_KEY` per §6.3
//     amendment 3 (`sf-push-global-mvp` prod / `sf-push-global-preview`
//     preview); rate=5 / period='1s'. Reused (NOT a new key) because SF
//     rate-limit is global per merchant, not per-operation-kind.
//   - retries=3 per §5.2 amendment.
//   - failureCallback — `/api/queue/cancel-task-failed` or
//     `/api/queue/update-task-failed` per route family.
//
// Side-effect posture: publishers run OUTSIDE the local DB tx
// (mirrors Phase 5). Already-committed local DB writes are durable;
// failed enqueue does NOT roll back. Caller propagates the error so
// the form action can surface "saved locally; SF push pending — try
// again or check ops triage".

import { Client } from "@upstash/qstash";

import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";

import type {
  CancelTaskPayload,
  UpdateTaskPayload,
} from "./types";

const log = logger.with({ component: "task_outbound_queue_publisher" });

const QSTASH_RETRIES = 3;
const QSTASH_FLOW_CONTROL_RATE = 5;
const QSTASH_FLOW_CONTROL_PERIOD = "1s" as const;
const QSTASH_BATCH_SIZE = 100;

// Module-level singleton QStash client. Constructed lazily on first
// call (NOT at module-init) so missing-env-var errors surface at
// invocation time. Mirrors task-materialization/queue.ts pattern.
let qstashClient: Client | null = null;

function getQStashClient(): Client {
  if (qstashClient) return qstashClient;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      "QSTASH_TOKEN env var required for task-outbound-queue publisher",
    );
  }
  qstashClient = new Client({ token });
  return qstashClient;
}

function getBaseUrl(): string {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "PUBLIC_BASE_URL env var required for task-outbound-queue publisher",
    );
  }
  return baseUrl;
}

function getFlowControlKey(): string {
  // Read on every invocation (not module-load) per the Phase 5
  // pattern at queue.ts:116-126 — env value differs across deploy
  // scopes (prod 'sf-push-global-mvp' / preview 'sf-push-global-preview').
  const flowControlKey = process.env.QSTASH_FLOW_CONTROL_KEY;
  if (!flowControlKey) {
    throw new Error(
      "QSTASH_FLOW_CONTROL_KEY env var required for task-outbound-queue publisher",
    );
  }
  return flowControlKey;
}

// =============================================================================
// Single-cancel publisher
// =============================================================================

/**
 * Publish one cancel-task message to QStash. The route consumer at
 * `/api/queue/cancel-task` decodes the payload, looks up the local
 * task, authenticates per-tenant, and calls
 * `adapter.cancelTask(session, awb, correlationId)`. The webhook
 * receiver drives local state convergence on success.
 *
 * Caller (service-layer cancelTask) commits the local DB write +
 * audit emit BEFORE invoking this publisher. A failed publish does
 * NOT roll back the local commit (per Phase 5 self-healing posture);
 * caller surfaces the publish error to the operator form action with
 * a "saved locally; SF push pending" message.
 *
 * Throws on QStash client error or on missing env vars. Caller is
 * expected to catch + log + Sentry; the form action then decides
 * whether to surface the error or absorb it.
 */
export async function enqueueCancelTask(payload: CancelTaskPayload): Promise<void> {
  const baseUrl = getBaseUrl();
  const flowControlKey = getFlowControlKey();
  const client = getQStashClient();

  const url = `${baseUrl}/api/queue/cancel-task`;
  const failureCallbackUrl = `${baseUrl}/api/queue/cancel-task-failed`;

  try {
    await client.publishJSON({
      url,
      body: payload,
      // Dedup by (task_id, correlation_id). Operator re-clicks within
      // the QStash dedup window collapse to one message; cross-correlation
      // re-cancels (rare) get a separate message.
      deduplicationId: `${payload.task_id}:cancel:${payload.correlation_id}`,
      flowControl: {
        key: flowControlKey,
        rate: QSTASH_FLOW_CONTROL_RATE,
        period: QSTASH_FLOW_CONTROL_PERIOD,
      },
      retries: QSTASH_RETRIES,
      failureCallback: failureCallbackUrl,
    });
    log.info(
      {
        operation: "enqueue_cancel_task",
        tenant_id: payload.tenant_id,
        task_id: payload.task_id,
        awb: payload.awb,
        correlation_id: payload.correlation_id,
      },
      "enqueued cancel-task message",
    );
  } catch (err) {
    log.error(
      {
        operation: "enqueue_cancel_task",
        tenant_id: payload.tenant_id,
        task_id: payload.task_id,
        error: err instanceof Error ? err.message : String(err),
      },
      "QStash publish failed for cancel-task",
    );
    captureException(err, {
      component: "task_outbound_queue_publisher",
      operation: "enqueue_cancel_task",
      tenant_id: payload.tenant_id,
      task_id: payload.task_id,
    });
    throw err;
  }
}

// =============================================================================
// Single-update publisher
// =============================================================================

/**
 * Publish one update-task message to QStash. Same posture as
 * `enqueueCancelTask`. The patch crosses the wire as JSON; consumer
 * route reconstructs the merge-patch body via
 * `buildSuiteFleetUpdatePatchBody` (#227).
 */
export async function enqueueUpdateTask(payload: UpdateTaskPayload): Promise<void> {
  const baseUrl = getBaseUrl();
  const flowControlKey = getFlowControlKey();
  const client = getQStashClient();

  const url = `${baseUrl}/api/queue/update-task`;
  const failureCallbackUrl = `${baseUrl}/api/queue/update-task-failed`;

  try {
    await client.publishJSON({
      url,
      body: payload,
      deduplicationId: `${payload.task_id}:update:${payload.correlation_id}`,
      flowControl: {
        key: flowControlKey,
        rate: QSTASH_FLOW_CONTROL_RATE,
        period: QSTASH_FLOW_CONTROL_PERIOD,
      },
      retries: QSTASH_RETRIES,
      failureCallback: failureCallbackUrl,
    });
    log.info(
      {
        operation: "enqueue_update_task",
        tenant_id: payload.tenant_id,
        task_id: payload.task_id,
        awb: payload.awb,
        correlation_id: payload.correlation_id,
        patch_keys: Object.keys(payload.patch).join(","),
      },
      "enqueued update-task message",
    );
  } catch (err) {
    log.error(
      {
        operation: "enqueue_update_task",
        tenant_id: payload.tenant_id,
        task_id: payload.task_id,
        error: err instanceof Error ? err.message : String(err),
      },
      "QStash publish failed for update-task",
    );
    captureException(err, {
      component: "task_outbound_queue_publisher",
      operation: "enqueue_update_task",
      tenant_id: payload.tenant_id,
      task_id: payload.task_id,
    });
    throw err;
  }
}

// =============================================================================
// Bulk fan-out publishers
// =============================================================================

export interface BulkEnqueueResult {
  /** Total messages successfully enqueued across all chunks. */
  readonly enqueuedCount: number;
  /** Number of batchJSON chunks that failed (continue-on-error per Phase 5 §1.1). */
  readonly failedChunks: number;
  /** Total payloads supplied. */
  readonly totalCount: number;
}

/**
 * Bulk-cancel fan-out: publishes N single-task cancel messages via
 * batchJSON. Each message routes to `/api/queue/cancel-task` with its
 * own deduplicationId + failureCallback.
 *
 * Empty payloads array is a no-op — no batchJSON call (matches Phase 5
 * convention; SDK quirks on empty arrays).
 *
 * On per-chunk failure: log + Sentry + continue (per §1.1 self-healing).
 * Caller surfaces the partial-success result; for v1 the operator UI
 * doesn't yet retry the failed chunks (Day-22+ optimisation candidate
 * via a dedicated bulk QStash route).
 */
export async function enqueueBulkCancelTasks(
  payloads: readonly CancelTaskPayload[],
): Promise<BulkEnqueueResult> {
  if (payloads.length === 0) {
    return { enqueuedCount: 0, failedChunks: 0, totalCount: 0 };
  }

  const baseUrl = getBaseUrl();
  const flowControlKey = getFlowControlKey();
  const client = getQStashClient();

  const url = `${baseUrl}/api/queue/cancel-task`;
  const failureCallbackUrl = `${baseUrl}/api/queue/cancel-task-failed`;

  let enqueuedCount = 0;
  let failedChunks = 0;

  for (let i = 0; i < payloads.length; i += QSTASH_BATCH_SIZE) {
    const chunk = payloads.slice(i, i + QSTASH_BATCH_SIZE);
    const messages = chunk.map((payload) => ({
      url,
      body: payload,
      deduplicationId: `${payload.task_id}:cancel:${payload.correlation_id}`,
      flowControl: {
        key: flowControlKey,
        rate: QSTASH_FLOW_CONTROL_RATE,
        period: QSTASH_FLOW_CONTROL_PERIOD,
      },
      retries: QSTASH_RETRIES,
      failureCallback: failureCallbackUrl,
    }));

    try {
      await client.batchJSON(messages);
      enqueuedCount += chunk.length;
    } catch (err) {
      log.error(
        {
          operation: "enqueue_bulk_cancel_tasks",
          chunk_index: Math.floor(i / QSTASH_BATCH_SIZE),
          chunk_size: chunk.length,
          error: err instanceof Error ? err.message : String(err),
        },
        "bulk-cancel chunk batchJSON failed — continuing to next chunk",
      );
      captureException(err, {
        component: "task_outbound_queue_publisher",
        operation: "enqueue_bulk_cancel_tasks",
        chunk_size: chunk.length,
      });
      failedChunks += 1;
    }
  }

  log.info(
    {
      operation: "enqueue_bulk_cancel_tasks",
      enqueued_count: enqueuedCount,
      failed_chunks: failedChunks,
      total_count: payloads.length,
    },
    "bulk-cancel batchJSON enqueue complete",
  );
  return { enqueuedCount, failedChunks, totalCount: payloads.length };
}

/**
 * Bulk-update fan-out: same pattern as `enqueueBulkCancelTasks` but
 * routes to `/api/queue/update-task`. Each payload carries its own
 * patch; bulk-update across heterogeneous patches is supported.
 *
 * The common case (apply same patch to N tasks) is handled by the
 * service-layer caller `bulkUpdateTasks(ctx, taskIds, patch)`, which
 * builds N payloads with the same patch shape and invokes this fn.
 */
export async function enqueueBulkUpdateTasks(
  payloads: readonly UpdateTaskPayload[],
): Promise<BulkEnqueueResult> {
  if (payloads.length === 0) {
    return { enqueuedCount: 0, failedChunks: 0, totalCount: 0 };
  }

  const baseUrl = getBaseUrl();
  const flowControlKey = getFlowControlKey();
  const client = getQStashClient();

  const url = `${baseUrl}/api/queue/update-task`;
  const failureCallbackUrl = `${baseUrl}/api/queue/update-task-failed`;

  let enqueuedCount = 0;
  let failedChunks = 0;

  for (let i = 0; i < payloads.length; i += QSTASH_BATCH_SIZE) {
    const chunk = payloads.slice(i, i + QSTASH_BATCH_SIZE);
    const messages = chunk.map((payload) => ({
      url,
      body: payload,
      deduplicationId: `${payload.task_id}:update:${payload.correlation_id}`,
      flowControl: {
        key: flowControlKey,
        rate: QSTASH_FLOW_CONTROL_RATE,
        period: QSTASH_FLOW_CONTROL_PERIOD,
      },
      retries: QSTASH_RETRIES,
      failureCallback: failureCallbackUrl,
    }));

    try {
      await client.batchJSON(messages);
      enqueuedCount += chunk.length;
    } catch (err) {
      log.error(
        {
          operation: "enqueue_bulk_update_tasks",
          chunk_index: Math.floor(i / QSTASH_BATCH_SIZE),
          chunk_size: chunk.length,
          error: err instanceof Error ? err.message : String(err),
        },
        "bulk-update chunk batchJSON failed — continuing to next chunk",
      );
      captureException(err, {
        component: "task_outbound_queue_publisher",
        operation: "enqueue_bulk_update_tasks",
        chunk_size: chunk.length,
      });
      failedChunks += 1;
    }
  }

  log.info(
    {
      operation: "enqueue_bulk_update_tasks",
      enqueued_count: enqueuedCount,
      failed_chunks: failedChunks,
      total_count: payloads.length,
    },
    "bulk-update batchJSON enqueue complete",
  );
  return { enqueuedCount, failedChunks, totalCount: payloads.length };
}

// Test-only: reset the cached QStash client so tests can re-stub the
// constructor. Production code never calls this.
export function __resetQStashClientForTest(): void {
  qstashClient = null;
}
