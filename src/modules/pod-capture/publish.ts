// POD capture publisher — one QStash message per delivered task.
// Mirrors task-outbound-queue/publish.ts conventions exactly (lazy
// client, env-resolved flow control, retries 3, failure twin).

import { Client } from "@upstash/qstash";

import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";

import type { CapturePodPayload } from "./types";

const log = logger.with({ component: "pod_capture_publisher" });

const QSTASH_RETRIES = 3;
const QSTASH_FLOW_CONTROL_RATE = 5;
const QSTASH_FLOW_CONTROL_PERIOD = "1s" as const;

let qstashClient: Client | null = null;

function getQStashClient(): Client {
  if (qstashClient) return qstashClient;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error("QSTASH_TOKEN env var required for the pod-capture publisher");
  }
  qstashClient = new Client({ token });
  return qstashClient;
}

function getBaseUrl(): string {
  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!baseUrl) {
    throw new Error(
      "PUBLIC_BASE_URL or VERCEL_URL env var required for the pod-capture publisher",
    );
  }
  return baseUrl;
}

function getFlowControlKey(): string {
  const flowControlKey = process.env.QSTASH_FLOW_CONTROL_KEY;
  if (!flowControlKey) {
    throw new Error(
      "QSTASH_FLOW_CONTROL_KEY env var required for the pod-capture publisher",
    );
  }
  return flowControlKey;
}

/**
 * Publish one capture-pod message. Caller is the DELIVERED-webhook
 * apply path, post-commit and best-effort: a publish failure logs +
 * Sentry-captures but never fails the webhook 200 (the TTL-bounded
 * loss window on a missed capture is a documented accepted risk; the
 * Sentry event is the ops signal).
 */
export async function enqueuePodCapture(payload: CapturePodPayload): Promise<void> {
  const baseUrl = getBaseUrl();
  const flowControlKey = getFlowControlKey();
  const client = getQStashClient();

  try {
    await client.publishJSON({
      url: `${baseUrl}/api/queue/capture-pod`,
      body: payload,
      // One capture per (task, delivering event): webhook replays
      // within the dedup window collapse to one message.
      deduplicationId: `${payload.task_id}_podcapture_${payload.correlation_id}`,
      flowControl: {
        key: flowControlKey,
        rate: QSTASH_FLOW_CONTROL_RATE,
        period: QSTASH_FLOW_CONTROL_PERIOD,
      },
      retries: QSTASH_RETRIES,
      failureCallback: `${baseUrl}/api/queue/capture-pod-failed`,
    });
    log.info({
      operation: "enqueue_pod_capture",
      tenant_id: payload.tenant_id,
      task_id: payload.task_id,
      correlation_id: payload.correlation_id,
    });
  } catch (err) {
    log.error({
      operation: "enqueue_pod_capture",
      tenant_id: payload.tenant_id,
      task_id: payload.task_id,
      error: err instanceof Error ? err.message : String(err),
    });
    captureException(err, {
      component: "pod_capture_publisher",
      operation: "enqueue_pod_capture",
      tenant_id: payload.tenant_id,
      task_id: payload.task_id,
    });
    throw err;
  }
}
