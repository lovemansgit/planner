// SuiteFleet webhook receiver — Day 4 / S-4.
//
// POST /api/webhooks/suitefleet
//
// Brief §10:
//   1. Verify X-Client-Id / X-Client-Secret via crypto.timingSafeEqual
//   2. On mismatch: 401, no audit emit, no body read (DDoS surface)
//   3. On match: read body, return 200 immediately, kick async processing
//   4. Async path is stubbed for Day 4; SQS wiring lands Day 5+
//
// Day-4 single-tenant note — the route is mounted at a flat path; the
// receiver passes a sentinel tenantId to the credential resolver,
// which currently ignores it. Day 5+ will introduce the dynamic-route
// form `/api/webhooks/suitefleet/[tenantId]/route.ts`, at which point
// the resolver starts honouring the value (in lock-step with the
// AWS Secrets Manager swap). The resolver's signature stays stable
// across the change.

import "server-only";

import { randomUUID } from "node:crypto";

import { resolveSuiteFleetWebhookCredentials } from "@/modules/credentials";
import { verifySuiteFleetWebhook } from "@/modules/integration";
import { CredentialError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// TODO(Day-5): swap sentinel for URL-derived tenantId when /api/webhooks/suitefleet/[tenantId] lands.
const DAY_4_SINGLE_TENANT_SENTINEL: Uuid = "00000000-0000-0000-0000-000000000000";

const log = logger.with({ component: "suitefleet_webhook_receiver" });

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const requestLog = log.with({ request_id: requestId });

  let expected;
  try {
    expected = await resolveSuiteFleetWebhookCredentials(DAY_4_SINGLE_TENANT_SENTINEL);
  } catch (err) {
    if (err instanceof CredentialError) {
      requestLog.error({
        operation: "resolve_creds",
        error_code: "webhook_creds_unavailable",
      });
      return new Response(null, { status: 500 });
    }
    throw err;
  }

  const verification = verifySuiteFleetWebhook(req.headers, expected);

  if (!verification.ok) {
    requestLog.warn({
      operation: "verify",
      reason: verification.reason,
    });
    return new Response(null, { status: 401 });
  }

  const body = await req.text();

  // TODO(Day-5): replace this in-process fire-and-forget with SQS enqueue.
  // S-5 adds JSON parse + event extraction, S-6 adds status mapping,
  // S-8 wires the internal task-state update.
  void processWebhookAsync(body, requestId).catch((err) => {
    requestLog.error({
      operation: "async_process",
      error_code: "async_processing_failed",
      message: err instanceof Error ? err.message : "unknown",
    });
  });

  return new Response("ok", { status: 200 });
}

async function processWebhookAsync(body: string, requestId: string): Promise<void> {
  log.info({
    request_id: requestId,
    operation: "process_webhook",
    body_length: body.length,
  });
}
