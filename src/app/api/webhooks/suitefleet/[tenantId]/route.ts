// SuiteFleet webhook receiver — dynamic per-tenant route. Day 6 / W-1.
//
// POST /api/webhooks/suitefleet/[tenantId]
//
// Migrated from the Day-4 flat route + DAY_4_SINGLE_TENANT_SENTINEL.
// The tenantId now travels in the URL: SF portal config (Love-executed
// post-merge operational step) updates each tenant's webhook URL on
// the SuiteFleet side to embed its own tenantId. Day-7+ rolls per-
// tenant URL configuration out across the merchant fleet; pilot
// sandbox merchant 588's tenantId is seeded via supabase/seed.sql
// against an idempotent v4 UUID for sandbox-merchant-588.
//
// Status semantics:
//   200 — verified, async processing kicked
//   400 — tenantId in URL is not a UUID (Zod parse failure, ValidationError)
//   401 — webhook clientId/clientSecret mismatch
//   500 — credential resolution failure (env missing / Secrets Manager
//         unreachable). Bare 500 (not the typed-error 502 mapping) to
//         match Day-4 webhook-receiver behaviour for SF retry semantics.
//
// DOS surface: body is NOT read until verification succeeds. Unverified
// requests return 401 with no body read. The adapter's
// verifyWebhookRequest signature accepts a body argument for forward
// compatibility with HMAC-style providers, but the SuiteFleet
// implementation only inspects headers — passing null is safe and
// preserves the no-body-before-verify guarantee.

import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getSuiteFleetAdapter } from "@/modules/integration/providers/suitefleet/get-adapter";
import { CredentialError, ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TenantIdSchema = z.string().uuid({ message: "tenantId must be a uuid" });

type RouteContext = { params: Promise<{ tenantId: string }> };

const log = logger.with({ component: "suitefleet_webhook_receiver" });

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const requestLog = log.with({ request_id: requestId });

  const { tenantId: rawTenantId } = await params;
  const parsed = TenantIdSchema.safeParse(rawTenantId);
  if (!parsed.success) {
    return errorResponse(new ValidationError(`tenantId must be a uuid, got '${rawTenantId}'`));
  }
  const tenantId = parsed.data as Uuid;

  let verification;
  try {
    const adapter = getSuiteFleetAdapter();
    verification = await adapter.verifyWebhookRequest(tenantId, req.headers, null);
  } catch (err) {
    if (err instanceof CredentialError) {
      requestLog.error({
        operation: "resolve_creds",
        tenant_id: tenantId,
        error_code: "webhook_creds_unavailable",
      });
      return new Response(null, { status: 500 });
    }
    throw err;
  }

  if (!verification.ok) {
    requestLog.warn({
      operation: "verify",
      tenant_id: tenantId,
      reason: verification.reason,
    });
    return new Response(null, { status: 401 });
  }

  const body = await req.text();

  // SQS wiring is a Day-7+ concern (cron + retry-with-audit-trail).
  // Until then, in-process fire-and-forget — same shape as Day-4.
  void processWebhookAsync(body, requestId, tenantId).catch((err) => {
    requestLog.error({
      operation: "async_process",
      tenant_id: tenantId,
      error_code: "async_processing_failed",
      message: err instanceof Error ? err.message : "unknown",
    });
  });

  return new Response("ok", { status: 200 });
}

async function processWebhookAsync(body: string, requestId: string, tenantId: Uuid): Promise<void> {
  log.info({
    request_id: requestId,
    tenant_id: tenantId,
    operation: "process_webhook",
    body_length: body.length,
  });
}
