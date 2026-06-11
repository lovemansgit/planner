// SuiteFleet shipment-label client — Day 8 / D8-6.
//
// Implements `printLabels(session, taskIds)` against SuiteFleet's
// `GET https://shipment-label.suitefleet.com/generate-label` endpoint.
// Different subdomain than the regular SF API (api.suitefleet.com)
// — separate base URL constant; do NOT reuse DEFAULT_BASE_URL from
// task-client.ts.
//
// =============================================================================
// SECURITY — token-in-query MUST NEVER reach operator browsers
// =============================================================================
// The endpoint accepts the bearer token as a `?token=` query param,
// NOT as an `Authorization` header. URL-with-token leaks via:
//   - browser history
//   - HTTP server access logs (downstream proxies, CDN edges, SF's
//     own logs)
//   - `Referer` headers on outbound links
//   - screenshots / screen-share recordings
//   - browser extensions reading URL bars
//   - DevTools Network panel exports
//
// Architectural rule (memory/followup_suitefleet_label_endpoint.md
// load-bearing constraint): the operator browser MUST NEVER see this
// URL or the token in any form. The Transcorp planner backend
// fetches server-side and streams PDF bytes back to the operator as
// `application/pdf`. The token stays inside the Transcorp deploy
// boundary.
//
// THIS FILE IS WHERE THE URL IS BUILT. IF YOU MOVE THE URL
// CONSTRUCTION, MOVE THE SECURITY CONSTRAINT WITH IT — the
// downstream caller (route handler) MUST NOT receive a constructed
// URL string back; it receives the response Buffer.
//
// =============================================================================
// Constants — pilot scope
// =============================================================================
//   - type=indv-small      4x6 meal-plan label format. Only type
//                          used in pilot per Aqib Group-2. Hardcode;
//                          revisit when a non-meal-plan merchant
//                          onboards.
//   - tz_offset=4          Asia/Dubai is fixed UTC+4 year-round (no
//                          DST). Hardcode unless multi-region scope
//                          changes.
//
// =============================================================================
// Bulk semantics
// =============================================================================
// Comma-separated `taskId` list returns a single multi-page PDF in
// one round-trip. SF's actual upper bound on the list length is not
// documented; the route layer caps the request at 100 task IDs per
// call. If SF rejects long lists, lower the cap empirically; logged
// in the label-endpoint memo's "Bulk size limit" open question.

import { CredentialError, ValidationError } from "../../../../shared/errors";
import { logger } from "../../../../shared/logger";

import type { AuthenticatedSession } from "../../types";

const log = logger.with({ component: "suitefleet_label_client" });

const DEFAULT_LABEL_BASE_URL = "https://shipment-label.suitefleet.com";

const LABEL_TYPE_INDV_SMALL = "indv-small";

/** Asia/Dubai UTC+4 year-round; SF endpoint requires explicit tz_offset. */
const LABEL_TZ_OFFSET = 4;

export interface SuiteFleetLabelClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clientId: string;
  /**
   * Optional override for the label base URL. Production reads the
   * per-environment value from env or constant; tests pass a mock URL.
   */
  readonly baseUrl?: string;
}

export interface SuiteFleetLabelClient {
  printLabels(args: {
    session: AuthenticatedSession;
    taskIds: readonly string[];
  }): Promise<Buffer>;
}

/**
 * Build the label URL. Exposed for testing the URL shape; production
 * callers go through createSuiteFleetLabelClient.printLabels which
 * builds + fetches in one operation. Pure function — no side effects;
 * does NOT log the constructed URL (it carries the bearer token).
 */
export function buildSuiteFleetLabelUrl(args: {
  baseUrl: string;
  taskIds: readonly string[];
  token: string;
  clientId: string;
}): string {
  const trimmedBase = args.baseUrl.replace(/\/+$/, "");
  // taskIds are uuids — alphanumeric + hyphen, safe for query
  // values without further escaping. Join with comma per SF's
  // bulk semantics.
  const taskIdsParam = args.taskIds.join(",");
  // URLSearchParams handles encoding for the dynamic values (token
  // contains `.` and base64 chars; clientId is alphanumeric).
  const params = new URLSearchParams({
    taskId: taskIdsParam,
    type: LABEL_TYPE_INDV_SMALL,
    tz_offset: String(LABEL_TZ_OFFSET),
    token: args.token,
    clientId: args.clientId,
  });
  return `${trimmedBase}/generate-label?${params.toString()}`;
}

export function createSuiteFleetLabelClient(
  deps: SuiteFleetLabelClientDeps,
): SuiteFleetLabelClient {
  const baseUrl = deps.baseUrl ?? DEFAULT_LABEL_BASE_URL;

  return {
    async printLabels({ session, taskIds }) {
      if (taskIds.length === 0) {
        // Caller should have filtered already; defence-in-depth.
        throw new ValidationError(
          "SuiteFleet printLabels: taskIds must be non-empty",
        );
      }

      const url = buildSuiteFleetLabelUrl({
        baseUrl,
        taskIds,
        token: session.token,
        clientId: deps.clientId,
      });

      // CRITICAL — log the operation but NOT the URL (carries the
      // bearer token). Log the host + task-count for forensic
      // traceability without leaking the secret.
      const hostOnly = (() => {
        try {
          return new URL(url).host;
        } catch {
          return "unknown";
        }
      })();
      log.info({
        operation: "print_labels",
        tenant_id: session.tenantId,
        host: hostOnly,
        task_count: taskIds.length,
      });

      let response: Response;
      try {
        response = await deps.fetch(url, { method: "GET" });
      } catch (err) {
        // Mirror task-client.ts's no-retry posture — labels are
        // stateless GETs but a network blip could happen mid-stream;
        // keeping single-attempt for consistency with the rest of
        // the SF surface.
        log.warn({
          operation: "print_labels",
          error_code: "network_error",
          tenant_id: session.tenantId,
          message: err instanceof Error ? err.message : "unknown",
        });
        throw new CredentialError(
          "SuiteFleet printLabels network error — single-attempt policy, no retry",
          err instanceof Error ? { cause: err } : undefined,
        );
      }

      if (response.status >= 500) {
        // Day 17 — capture response body excerpt to parity with the
        // 4xx branch below. SF returns small JSON envelopes
        // (e.g. {"message":"Internal server error"}) for unknown task
        // IDs; without capturing the body, diagnosis took 30 minutes
        // instead of 5 (see
        // memory/followup_planner_uuid_to_sf_external_id_translation.md).
        let responseText: string;
        try {
          responseText = await response.text();
        } catch {
          responseText = "";
        }
        log.warn({
          operation: "print_labels",
          status: response.status,
          error_code: "server_5xx",
          tenant_id: session.tenantId,
          response_excerpt: responseText.slice(0, 400),
        });
        throw new CredentialError(
          `SuiteFleet printLabels returned ${response.status} — single-attempt policy, no retry`,
        );
      }

      if (response.status >= 400) {
        let responseText: string;
        try {
          responseText = await response.text();
        } catch {
          responseText = "";
        }
        log.warn({
          operation: "print_labels",
          status: response.status,
          error_code: "client_4xx",
          tenant_id: session.tenantId,
          response_excerpt: responseText.slice(0, 400),
        });
        if (response.status === 401) {
          throw new CredentialError(
            "SuiteFleet printLabels rejected — credentials invalid or session expired",
          );
        }
        throw new ValidationError(
          `SuiteFleet printLabels rejected with status ${response.status}: ${responseText.slice(0, 400)}`,
        );
      }

      // Pilot scope: ≤100 tasks per request, few-MB PDFs. Buffer is
      // simpler than streaming; future commit can lift the cap and
      // switch to a stream return type. arrayBuffer() reads the full
      // body into memory.
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      log.info({
        operation: "print_labels",
        tenant_id: session.tenantId,
        task_count: taskIds.length,
        bytes: buffer.byteLength,
      });

      return buffer;
    },
  };
}
