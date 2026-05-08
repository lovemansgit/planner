// SuiteFleet webhook receiver — dynamic per-tenant route.
//
// POST /api/webhooks/suitefleet/[tenantId]
//
// =============================================================================
// Day 8 / D8-8 hardening — verification chain (in order)
// =============================================================================
//
//   1. UUID well-formedness               → 400 (ValidationError envelope)
//   2. Tenant exists + accepts webhooks   → 401 (silent — existence-oracle masking)
//   3. Body read + JSON parse             → 400
//   4. Body shape (SF schema)             → 400 (parser ValidationError)
//   5. Verify creds (resolver returns null = Tier 1; row present = Tier 2):
//      5a. Tier 1 (no row)                → log auth_tier=tier_1_only, proceed
//      5b. Tier 2 success                 → log auth_tier=tier_2_passed, proceed
//      5c. Tier 2 mismatch                → 401 + audit emit webhook.auth_failed
//   6. Idempotency keys present (parser-emitted SHA256 keys)  [keys logged; persistence is Day-9+]
//   7. Side-effect path (process events)  → OUT OF SCOPE; processWebhookAsync stub
//   8. Return 200
//
// Status-code policy:
//   200 — verified + well-shaped (Tier 1 or Tier 2)
//   400 — UUID malformed OR body not JSON OR body not SF-shape array
//   401 — unknown/non-accepting tenant (silent, body NOT read) OR Tier-2 creds mismatch
//   500 — only on unexpected errors (DB connection failure, etc.)
//
// =============================================================================
// DOS posture (revised from Day-4 receiver scaffold)
// =============================================================================
//
// Day-4: "body not read until verification succeeds." That guarantee
// is preserved for unknown/non-accepting tenants — those 401 with
// zero body read (step 2 short-circuits before step 3). For known
// tenants we DO read the body before credential check (step 3 before
// step 5) because shape validation needs the body and is cheap; the
// credential check (which costs a bcrypt) is paid only on bodies that
// passed shape validation.
//
// Net DOS impact: hot-path probe traffic (random URLs hitting the
// receiver) still gets the zero-body-read guarantee. An attacker who
// can guess a live tenant UUID forces one body read per attempt,
// same cost as the previous receiver's processWebhookAsync would
// have imposed asynchronously.
//
// =============================================================================
// Existence-oracle masking
// =============================================================================
//
// Steps 2 and 5c both return 401. This is deliberate — distinguishing
// "unknown tenant" from "known tenant, wrong creds" with different
// status codes would let an attacker probe for live tenant UUIDs
// (high-entropy v4 UUIDs are not enumerable in practice, but the
// principle from D8-6's existence-oracle review applies). The audit
// event fires only on path 5c, not 2, because Tier-2 mismatch is
// load-bearing forensic signal whereas unknown-tenant probes would
// flood the audit table.

import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { emit as auditEmit } from "@/modules/audit";
import { tenantAcceptsWebhooks } from "@/modules/identity";
import { applyWebhookEditEvent } from "@/modules/integration/providers/suitefleet/apply-webhook-edit-event";
import { applyWebhookStatusEvent } from "@/modules/integration/providers/suitefleet/apply-webhook-status-event";
import { getSuiteFleetAdapter } from "@/modules/integration/providers/suitefleet/get-adapter";
import type { WebhookEvent } from "@/modules/integration/types";
import { ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TenantIdSchema = z.string().uuid({ message: "tenantId must be a uuid" });

// Header names the verifier checks — used here only for the Tier-2
// mismatch audit metadata's `header_keys_present`. Mirrors the verifier
// constants without coupling the modules.
const CRED_HEADER_NAMES = ["clientid", "clientsecret"] as const;

type RouteContext = { params: Promise<{ tenantId: string }> };

const log = logger.with({ component: "suitefleet_webhook_receiver" });

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  const requestLog = log.with({ request_id: requestId });

  // -------------------------------------------------------------------
  // Step 1 — UUID well-formedness
  // -------------------------------------------------------------------
  const { tenantId: rawTenantId } = await params;
  const parsed = TenantIdSchema.safeParse(rawTenantId);
  if (!parsed.success) {
    return errorResponse(new ValidationError(`tenantId must be a uuid, got '${rawTenantId}'`));
  }
  const tenantId = parsed.data as Uuid;

  // -------------------------------------------------------------------
  // Step 2 — Tenant exists + accepts webhooks
  // Silent 401 (existence-oracle masking). Body NOT read.
  // -------------------------------------------------------------------
  let accepts: boolean;
  try {
    accepts = await tenantAcceptsWebhooks(tenantId);
  } catch (err) {
    requestLog.error({
      operation: "tenant_lookup",
      tenant_id: tenantId,
      error_code: "tenant_lookup_failed",
      message: err instanceof Error ? err.message : "unknown",
    });
    captureException(err, {
      component: "suitefleet_webhook_receiver",
      operation: "tenant_lookup",
      tenant_id: tenantId,
      request_id: requestId,
    });
    return new Response(null, { status: 500 });
  }

  if (!accepts) {
    requestLog.warn({
      operation: "tenant_gate",
      tenant_id: tenantId,
      reason: "unknown_or_not_accepting",
    });
    return new Response(null, { status: 401 });
  }

  // -------------------------------------------------------------------
  // Step 3 + 4 — Read body, JSON-parse, validate SF-array shape
  // -------------------------------------------------------------------
  const bodyText = await req.text();

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    return errorResponse(new ValidationError("webhook body is not valid JSON"));
  }

  if (!Array.isArray(bodyJson)) {
    return errorResponse(new ValidationError("webhook body must be a JSON array"));
  }

  // Per the parser contract, callers may inspect the parsed events for
  // shape validation pre-side-effect. The parser is permissive (skips
  // malformed entries with a log warn rather than throwing per-entry),
  // so this call returns an empty array for entirely-malformed bodies
  // — a vacuously-valid empty batch returns 200 below, matching SF's
  // expectation that retries on 5xx are by-batch not by-entry.
  let events: ReturnType<ReturnType<typeof getSuiteFleetAdapter>["parseWebhookEvents"]>;
  try {
    events = getSuiteFleetAdapter().parseWebhookEvents(bodyJson);
  } catch (err) {
    if (err instanceof ValidationError) {
      return errorResponse(err);
    }
    throw err;
  }

  // -------------------------------------------------------------------
  // Step 5 — Verify creds (Tier 1 or Tier 2)
  // -------------------------------------------------------------------
  let verification;
  try {
    verification = await getSuiteFleetAdapter().verifyWebhookRequest(
      tenantId,
      req.headers,
      null,
    );
  } catch (err) {
    requestLog.error({
      operation: "verify",
      tenant_id: tenantId,
      error_code: "verify_threw",
      message: err instanceof Error ? err.message : "unknown",
    });
    captureException(err, {
      component: "suitefleet_webhook_receiver",
      operation: "verify",
      tenant_id: tenantId,
      request_id: requestId,
    });
    return new Response(null, { status: 500 });
  }

  if (!verification.ok) {
    // Step 5c — Tier-2 mismatch. Audit emit + 401.
    requestLog.warn({
      operation: "verify",
      tenant_id: tenantId,
      auth_tier: "tier_2_failed",
      reason: verification.reason,
    });

    const headerKeysPresent = CRED_HEADER_NAMES.filter(
      (name) => req.headers.get(name) !== null && req.headers.get(name) !== "",
    );

    try {
      await auditEmit({
        eventType: "webhook.auth_failed",
        actorKind: "system",
        actorId: "system:webhook_receiver",
        tenantId,
        requestId,
        metadata: {
          failure: "creds_mismatch",
          tenant_id: tenantId,
          header_keys_present: headerKeysPresent,
        },
      });
    } catch (err) {
      // Audit-emit failures are non-blocking — the 401 still goes back
      // to SF. Log + Sentry so operators can detect audit pipeline
      // health drift.
      requestLog.error({
        operation: "audit_emit",
        tenant_id: tenantId,
        error_code: "audit_emit_failed",
        message: err instanceof Error ? err.message : "unknown",
      });
      captureException(err, {
        component: "suitefleet_webhook_receiver",
        operation: "audit_emit",
        tenant_id: tenantId,
        request_id: requestId,
      });
    }

    return new Response(null, { status: 401 });
  }

  // -------------------------------------------------------------------
  // Step 6 + 7 — Log auth_tier + idempotency-key surface; processing deferred
  // -------------------------------------------------------------------
  requestLog.info({
    operation: "verified",
    tenant_id: tenantId,
    auth_tier: verification.authTier,
    event_count: events.length,
    idempotency_keys: events.map((e) => e.idempotencyKey),
  });

  // Day 18 / A2 — process events synchronously within the request handler.
  // Per plan §3.5, processWebhookAsync iterates events with per-event
  // try/catch isolation: one failing event must not poison the loop for
  // the rest of the batch. SF retries on non-2xx; we always return 200
  // here when verification succeeded, so individual-event errors do
  // NOT cause SF to retry the whole batch (they go to Sentry instead).
  await processWebhookAsync(events, requestId, tenantId);

  return new Response("ok", { status: 200 });
}

async function processWebhookAsync(
  events: readonly WebhookEvent[],
  requestId: string,
  tenantId: Uuid,
): Promise<void> {
  for (const event of events) {
    try {
      const rawAction = isRecord(event.raw) ? event.raw.action : null;
      if (typeof rawAction !== "string") {
        // Parser already filtered missing/empty actions; defensive log.
        log.warn({
          request_id: requestId,
          tenant_id: tenantId,
          operation: "process_webhook_event",
          error_code: "missing_action_in_raw",
        });
        continue;
      }

      // Layer 3 handles TASK_HAS_BEEN_UPDATED (non-lifecycle edit event);
      // Layer 2 handles all 14 lifecycle codes + the unknown-action skip.
      const result =
        rawAction === "TASK_HAS_BEEN_UPDATED"
          ? await applyWebhookEditEvent(tenantId, event, rawAction)
          : await applyWebhookStatusEvent(tenantId, event, rawAction);

      log.info({
        request_id: requestId,
        tenant_id: tenantId,
        operation: "process_webhook_event",
        idempotency_key: event.idempotencyKey,
        sf_action: rawAction,
        applied: result.applied,
        reason: "reason" in result ? result.reason : null,
      });
    } catch (err) {
      // Per-event error isolation — log + Sentry-capture the failure
      // for THIS event, then continue with the rest of the batch.
      log.error({
        request_id: requestId,
        tenant_id: tenantId,
        operation: "process_webhook_event",
        error_code: "event_dispatch_failed",
        idempotency_key: event.idempotencyKey,
        message: err instanceof Error ? err.message : "unknown",
      });
      captureException(err, {
        component: "suitefleet_webhook_receiver",
        operation: "process_webhook_event",
        tenant_id: tenantId,
        request_id: requestId,
        idempotency_key: event.idempotencyKey,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
