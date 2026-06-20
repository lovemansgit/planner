// SuiteFleet asset-tracking client — Day 6 / B-1.
//
// Implements `fetchAssetTrackingByAwb` against
// `GET /api/task-asset-tracking?awbs=<AWB>`. Returns the unwrapped
// `content[]` array, mapping each record onto the internal-language
// `AssetTrackingPackage` shape. Pagination wrapper handling lives
// here (provider-specific concern), not at the adapter interface.
//
// Wire facts (per
// memory/followup_suitefleet_asset_tracking_api.md and the empirical
// 1 May 2026 probe):
//   - Method: GET
//   - URL: /api/task-asset-tracking?awbs=<AWB>
//   - Headers: Authorization: Bearer <token>, Clientid: <clientId>,
//     Accept: application/json
//   - Response: Spring Data paginated wrapper (content[] + page meta).
//     Default `size: 50`. Empty content[] is normal — most tasks have
//     no records.
//
// The query parameter is `awbs=`, NOT `taskId=` (correction history
// in the memo). One AWB lookup at a time for now; comma-separated
// batch is doc-flagged unconfirmed (vendor question 4).
//
// Pagination: `totalPages > 1` logs a warning and returns the first
// page only. Pagination wiring is a B-2 follow-up if it ever surfaces
// in production. Sandbox merchant 588 has no records, so this is
// untested-in-anger; the warning + first-page-only behaviour is the
// safe bet until empirical samples land.
//
// Inner-record shape: per the SF doc, NOT empirically pinned. Every
// field is mapped defensively — type coercion at the boundary,
// validation throws for missing required fields. When the first real
// record lands, the test fixture replaces these doc-derived
// assumptions.

import { CredentialError, ValidationError } from "../../../../shared/errors";
import { logger } from "../../../../shared/logger";

import type {
  AssetTrackingPackage,
  AssetTrackingState,
  AssetType,
  AuthenticatedSession,
} from "../../types";

const log = logger.with({ component: "suitefleet_asset_tracking_client" });

const DEFAULT_BASE_URL = "https://api.suitefleet.com";

const ASSET_TYPES: ReadonlySet<string> = new Set<AssetType>(["BAGS"]);
const ASSET_STATES: ReadonlySet<string> = new Set<AssetTrackingState>([
  "COLLECTED",
  "EN_ROUTE",
  "RECEIVED",
  "RETURNED",
  // Vendor-confirmed fifth state (Aqib, 2026-06-12): present on SF's
  // own report screens, confirmed part of the complete enum.
  "SORTED",
]);

export interface SuiteFleetAssetTrackingClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clientId: string;
  readonly baseUrl?: string;
}

export interface SuiteFleetAssetTrackingClient {
  fetchByAwb(args: {
    session: AuthenticatedSession;
    awb: string;
  }): Promise<readonly AssetTrackingPackage[]>;
  /**
   * Batch lookup: one GET with comma-separated `awbs=`. The separator
   * was probe-verified ACCEPTED on 2026-06-12 (200 + valid wrapper);
   * merged multi-AWB content is unproven until the first non-empty
   * batch response (sandbox has zero records). Each record's `awb`
   * derives from its own trackingId — no single-AWB hint applies.
   */
  fetchByAwbs(args: {
    session: AuthenticatedSession;
    awbs: readonly string[];
  }): Promise<readonly AssetTrackingPackage[]>;
}

interface SpringDataPage<T> {
  readonly content?: readonly T[];
  readonly totalPages?: number;
  readonly totalElements?: number;
}

interface SuiteFleetAssetTrackingRecord {
  readonly id?: number;
  readonly taskId?: number;
  readonly trackingId?: string;
  readonly type?: string;
  // Wire field is `status` (empirically confirmed 20 Jun 2026 against the
  // first real record — task 61970 / AWB MLU-97015852). The SF doc and
  // this parser originally read `state`; that field does not exist on the
  // wire, which is what produced the "Refresh failed" HTTP 400. The value
  // maps onto our internal `AssetTrackingPackage.state`.
  readonly status?: string;
  readonly photos?: unknown;
  readonly notes?: string | null;
  readonly supplementaryQuantity?: number | null;
  readonly containerId?: number | null;
  readonly collectedBy?: unknown;
  readonly enrouteBy?: unknown;
  readonly receivedBy?: unknown;
  readonly returnedBy?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Derive the AWB component from a `<awb>-<index>` trackingId. The doc
 * flags this format; the format constraint is also part of the cache
 * uniqueness invariant. Returns the raw trackingId if no `-` is
 * present (defensive — the empirical probe never returned content,
 * so we cannot be certain every trackingId carries the suffix).
 */
function deriveAwb(trackingId: string): string {
  const lastDash = trackingId.lastIndexOf("-");
  if (lastDash <= 0) return trackingId;
  return trackingId.slice(0, lastDash);
}

export function parseAssetTrackingRecord(
  record: SuiteFleetAssetTrackingRecord,
  awbHint: string,
): AssetTrackingPackage {
  if (typeof record.id !== "number") {
    throw new ValidationError(
      "SuiteFleet asset-tracking record missing numeric `id`",
    );
  }
  if (typeof record.taskId !== "number") {
    throw new ValidationError(
      "SuiteFleet asset-tracking record missing numeric `taskId`",
    );
  }
  if (typeof record.trackingId !== "string" || record.trackingId.length === 0) {
    throw new ValidationError(
      "SuiteFleet asset-tracking record missing `trackingId`",
    );
  }
  if (typeof record.type !== "string" || !ASSET_TYPES.has(record.type)) {
    throw new ValidationError(
      `SuiteFleet asset-tracking record has unknown type '${String(record.type)}'`,
    );
  }
  if (typeof record.status !== "string" || !ASSET_STATES.has(record.status)) {
    throw new ValidationError(
      `SuiteFleet asset-tracking record has unknown status '${String(record.status)}'`,
    );
  }

  const trackingId = record.trackingId;
  const derivedAwb = deriveAwb(trackingId);
  const awb = derivedAwb.length > 0 ? derivedAwb : awbHint;

  return {
    externalRecordId: record.id,
    taskIdExternal: record.taskId,
    trackingId,
    awb,
    type: record.type as AssetType,
    state: record.status as AssetTrackingState,
    photos: record.photos ?? null,
    notes: typeof record.notes === "string" ? record.notes : null,
    supplementaryQuantity:
      typeof record.supplementaryQuantity === "number"
        ? record.supplementaryQuantity
        : null,
    containerId:
      typeof record.containerId === "number" ? record.containerId : null,
    collectedBy: record.collectedBy ?? null,
    enrouteBy: record.enrouteBy ?? null,
    receivedBy: record.receivedBy ?? null,
    returnedBy: record.returnedBy ?? null,
  };
}

export function parseAssetTrackingPage(
  body: unknown,
  awbHint: string,
): readonly AssetTrackingPackage[] {
  if (!isObject(body)) {
    throw new ValidationError(
      "SuiteFleet asset-tracking response body is not an object",
    );
  }
  const page = body as SpringDataPage<SuiteFleetAssetTrackingRecord>;
  const content = page.content;
  if (content === undefined) {
    throw new ValidationError(
      "SuiteFleet asset-tracking response missing `content` array",
    );
  }
  if (!Array.isArray(content)) {
    throw new ValidationError(
      "SuiteFleet asset-tracking response `content` is not an array",
    );
  }

  if (typeof page.totalPages === "number" && page.totalPages > 1) {
    log.warn({
      operation: "fetch_asset_tracking",
      awb: awbHint,
      total_pages: page.totalPages,
      total_elements: page.totalElements ?? null,
      message:
        "asset-tracking response paginated beyond first page; pagination wiring is a B-2 follow-up — only first page returned",
    });
  }

  return content.map((record) => parseAssetTrackingRecord(record, awbHint));
}

export function createSuiteFleetAssetTrackingClient(
  deps: SuiteFleetAssetTrackingClientDeps,
): SuiteFleetAssetTrackingClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  // Shared request core for single + batch lookups. `awbsParam` is the
  // raw (pre-encoding) value of the `awbs=` query parameter; `awbHint`
  // feeds parseAssetTrackingRecord's defensive AWB fallback (single
  // mode only — batch mode derives per-record from each trackingId).
  async function requestRecords(
    session: AuthenticatedSession,
    awbsParam: string,
    awbHint: string,
  ): Promise<readonly AssetTrackingPackage[]> {
    const url = `${baseUrl}/api/task-asset-tracking?awbs=${encodeURIComponent(awbsParam)}`;

    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.token}`,
          Clientid: deps.clientId,
          Accept: "application/json",
        },
      });
    } catch (err) {
      log.warn({
        operation: "fetch_asset_tracking",
        awb: awbsParam,
        tenant_id: session.tenantId,
        error_code: "network_error",
        message: err instanceof Error ? err.message : "unknown",
      });
      throw new CredentialError(
        "SuiteFleet asset-tracking fetch network error",
        err instanceof Error ? { cause: err } : undefined,
      );
    }

    if (response.status === 401) {
      throw new CredentialError(
        "SuiteFleet asset-tracking fetch rejected — credentials invalid or session expired",
      );
    }
    if (response.status >= 500) {
      // Plan #317 §3.1 / F-1: read 5xx body before throwing — mirrors
      // task-client.ts's 5xx branches so downstream failure_detail
      // (via CredentialError.message) carries SF's own error text.
      let responseText: string;
      try { responseText = await response.text(); } catch { responseText = ""; }
      log.warn({
        operation: "fetch_asset_tracking",
        awb: awbsParam,
        tenant_id: session.tenantId,
        status: response.status,
        error_code: "server_5xx",
        response_excerpt: responseText.slice(0, 400),
      });
      throw new CredentialError(
        `SuiteFleet asset-tracking fetch returned ${response.status}: ${responseText.slice(0, 2000)}`,
      );
    }
    if (response.status >= 400) {
      log.warn({
        operation: "fetch_asset_tracking",
        awb: awbsParam,
        tenant_id: session.tenantId,
        status: response.status,
        error_code: "client_4xx",
      });
      throw new ValidationError(
        `SuiteFleet asset-tracking fetch rejected with status ${response.status}`,
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch (err) {
      throw new ValidationError(
        "SuiteFleet asset-tracking response was not valid JSON",
        { cause: err instanceof Error ? err : undefined },
      );
    }

    const records = parseAssetTrackingPage(parsedBody, awbHint);

    log.info({
      operation: "fetch_asset_tracking",
      awb: awbsParam,
      tenant_id: session.tenantId,
      record_count: records.length,
    });

    return records;
  }

  return {
    async fetchByAwb({ session, awb }) {
      if (typeof awb !== "string" || awb.length === 0) {
        throw new ValidationError("fetchAssetTrackingByAwb requires non-empty awb");
      }
      return requestRecords(session, awb, awb);
    },

    async fetchByAwbs({ session, awbs }) {
      if (!Array.isArray(awbs) || awbs.length === 0) {
        throw new ValidationError("fetchAssetTrackingByAwbs requires a non-empty awb list");
      }
      for (const awb of awbs) {
        if (typeof awb !== "string" || awb.length === 0) {
          throw new ValidationError("fetchAssetTrackingByAwbs requires non-empty awbs");
        }
      }
      // Batch mode: per-record AWB derives from each trackingId; the
      // empty hint is never reached for SF-shaped trackingIds.
      return requestRecords(session, awbs.join(","), "");
    },
  };
}
