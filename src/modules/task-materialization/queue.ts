// src/modules/task-materialization/queue.ts
//
// Day-14 Phase 5 — post-commit QStash batchJSON enqueue per
// memory/plans/day-14-cron-decoupling.md §1.1 + §5.2 + §6.3. Takes the
// union of Phase 1 reconciliation tuples and Phase 2 newly-inserted
// task IDs, chunks at 100 messages per call, publishes to QStash with:
//   - deduplicationId: task_id (load-bearing for §1.1 self-healing —
//     re-enqueue from next-tick Phase 1 reconciliation collapses at
//     QStash side)
//   - flowControl: { key: env-var, rate: 5, period: '1s' } per §6.3
//     amendment — egress rate-limit at QStash → push-handler edge
//   - retries: 3 per §5.2 amendment — QStash owns retry state
//   - failureCallback: ${PUBLIC_BASE_URL}/api/queue/push-task-failed
//     per §5.2 amendment 5 — terminal-retry-exhausted writes
//     failed_pushes via the existing DLQ surface
//
// Phase 5 runs OUTSIDE the Phase 2-4 tx (separate withServiceRole exit
// boundary). Already-committed materialization rows are durable; failed
// Phase 5 enqueue does NOT roll back. Per §1.1 self-healing, next-tick
// reconciliation re-discovers unenqueued rows via pushed_to_external_at
// IS NULL and re-enqueues — QStash dedup absorbs the duplicate.

import { Client } from "@upstash/qstash";

import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

const log = logger.with({ component: "task_materialization_queue" });

const QSTASH_BATCH_SIZE = 100;
const QSTASH_RETRIES = 3;
const QSTASH_FLOW_CONTROL_RATE = 5;
const QSTASH_FLOW_CONTROL_PERIOD = "1s" as const;

/**
 * Push-task handler payload shape — contract surface between this
 * module (Phase 5 publisher) and the future `/api/queue/push-task`
 * handler (Phase 5 consumer per §5.1).
 *
 * The push-task handler MUST import this type rather than defining
 * its own. The §5.1 Step 1.4 tenant-scoping guard validates the
 * payload's `tenant_id` matches the task row's `tenant_id`; that
 * guard's input shape is this interface.
 *
 * Changing this shape requires a coordinated update across both
 * sides — ANY Phase 5 publisher emitting a different shape will
 * break the queue handler's payload parsing at runtime, and QStash
 * will retry the malformed message until exhaustion lands it in
 * failed_pushes.
 */
export interface PushTaskPayload {
  tenant_id: Uuid;
  task_id: Uuid;
}

// Module-level singleton QStash client. Constructed lazily on first
// call (NOT at module-init) so missing-env-var errors surface during
// the cron invocation rather than at import time — module imports
// happen on every cold-start; lazy construction avoids spurious init
// errors on routes that don't actually use QStash.
let qstashClient: Client | null = null;

function getQStashClient(): Client {
  if (qstashClient) return qstashClient;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      "QSTASH_TOKEN env var required for materialization-cron Phase 5 enqueue",
    );
  }
  qstashClient = new Client({ token });
  return qstashClient;
}

export interface EnqueueTaskPushBatchInput {
  tenantId: Uuid;
  /** Union of Phase 1 reconciliation tuples + Phase 2 newly-inserted IDs. */
  taskIds: readonly Uuid[];
  requestId: string;
}

export interface EnqueueTaskPushBatchResult {
  enqueuedCount: number;
  failedChunks: number;
}

/**
 * Phase 5 — post-commit batchJSON enqueue. Caller is the cron route
 * handler, AFTER materializeTenant returns (i.e., AFTER the Phase 2-4
 * tx commits). On chunk failure, logs + Sentry + continues to next
 * chunk per Q5 (b) direction; failed chunks are re-discovered by
 * next-tick reconciliation per §1.1.
 *
 * Empty taskIds skips the QStash call entirely (avoids potential
 * SDK quirks on empty batchJSON arrays).
 */
export async function enqueueTaskPushBatch(
  input: EnqueueTaskPushBatchInput,
): Promise<EnqueueTaskPushBatchResult> {
  const { tenantId, taskIds, requestId } = input;
  const tenantLog = log.with({ tenant_id: tenantId, request_id: requestId });

  if (taskIds.length === 0) {
    tenantLog.info({}, "phase 5 empty batch — skipping enqueue");
    return { enqueuedCount: 0, failedChunks: 0 };
  }

  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "PUBLIC_BASE_URL env var required for Phase 5 enqueue URL construction",
    );
  }

  // QSTASH_FLOW_CONTROL_KEY is read on EVERY invocation, not at module
  // load. This is intentional — the value can differ between Production
  // ('sf-push-global-mvp') and Preview ('sf-push-global-preview') per
  // §6.3 amendment 3 + §11.2 row 6, and Vercel resolves env vars at
  // runtime per deploy scope. A module-load-time read would lock the
  // value at the first cold-start instance and could leak Preview
  // values into Production-tier instances if the function is hot-reloaded
  // across env-var changes. Future contributors should NOT "optimize"
  // this read out — per-invocation resolution is the load-bearing
  // pattern that keeps the egress rate-limit budget correctly scoped.
  const flowControlKey = process.env.QSTASH_FLOW_CONTROL_KEY;
  if (!flowControlKey) {
    throw new Error(
      "QSTASH_FLOW_CONTROL_KEY env var required for Phase 5 enqueue (per §6.3 amendment 3)",
    );
  }

  const pushTaskUrl = `${baseUrl}/api/queue/push-task`;
  const failureCallbackUrl = `${baseUrl}/api/queue/push-task-failed`;
  const client = getQStashClient();

  let enqueuedCount = 0;
  let failedChunks = 0;

  // Chunk at 100 messages per batchJSON call per §1.1 amendment.
  for (let i = 0; i < taskIds.length; i += QSTASH_BATCH_SIZE) {
    const chunk = taskIds.slice(i, i + QSTASH_BATCH_SIZE);
    const messages = chunk.map((taskId) => {
      const body: PushTaskPayload = { tenant_id: tenantId, task_id: taskId };
      return {
        url: pushTaskUrl,
        body,
        deduplicationId: taskId,
        flowControl: {
          key: flowControlKey,
          rate: QSTASH_FLOW_CONTROL_RATE,
          period: QSTASH_FLOW_CONTROL_PERIOD,
        },
        retries: QSTASH_RETRIES,
        failureCallback: failureCallbackUrl,
      };
    });

    try {
      await client.batchJSON(messages);
      enqueuedCount += chunk.length;
    } catch (err) {
      tenantLog.error(
        {
          error: err instanceof Error ? err.message : String(err),
          chunk_index: Math.floor(i / QSTASH_BATCH_SIZE),
          chunk_size: chunk.length,
        },
        "phase 5 batchJSON chunk failed — continuing to next chunk per Q5 (b)",
      );
      captureException(err, {
        component: "task_materialization_queue",
        operation: "batchJSON_chunk",
        tenant_id: tenantId,
        chunk_size: chunk.length,
        request_id: requestId,
      });
      failedChunks += 1;
      // Per Q5 (b): continue to next chunk. Next-tick reconciliation
      // re-discovers the unenqueued rows via pushed_to_external_at IS
      // NULL filter. No in-handler retry — QStash itself isn't down
      // (we got partial success across the batch); the granularity is
      // per-message via QStash's own retry, not per-batch.
    }
  }

  tenantLog.info(
    {
      enqueued_count: enqueuedCount,
      failed_chunks: failedChunks,
      total_count: taskIds.length,
    },
    "phase 5 batchJSON enqueue complete",
  );
  return { enqueuedCount, failedChunks };
}
