// SuiteFleet task client — Day 4 / S-8.
//
// Implements `createTask` against SuiteFleet's `POST /api/tasks`
// endpoint. The internal-language `TaskCreateRequest` is mapped into
// SuiteFleet's wire shape; the response is mapped back into the
// internal-language `TaskCreateResult`.
//
// Wire facts (locked from real curls during Day 3 brief capture +
// confirmed by S-8 sandbox smoke):
//   - Method: POST /api/tasks
//   - Headers: Authorization: Bearer <token>, Clientid: <clientId>,
//     Content-Type: application/json
//   - Date split: deliveryDate (YYYY-MM-DD) + deliveryStartTime +
//     deliveryEndTime (both HH:MM:SS)
//   - customerId in body even though scoped in the JWT
//   - creationSource: "API"; initial status: "ORDERED"
//   - Coordinates as raw numbers, not strings
//   - Response uses `id` (numeric) and `awb` (string)
//   - Response timestamp field is `createdDate` (NOT `createdAt`)
//
// Optional-field handling: SuiteFleet expects absence of optional
// fields, not `null`. The body builder uses conditional spreads so
// undefined inputs produce field omission rather than null values.
//
// -------------------------------------------------------------------
// Idempotency status (load-bearing):
//
// Empirical sandbox dedupe probe on 2026-04-29 (S-8 review) confirmed
// that SuiteFleet sandbox does NOT dedupe by customerOrderNumber.
// Two POSTs with identical body 1 second apart created two distinct
// tasks (id=59019 / awb=MPS-58040211 vs id=59020 / awb=MPS-05267778).
//
// Implication: the retry block below CAN create duplicate tasks if a
// request reaches SuiteFleet successfully but the response is lost
// (gateway timeout, network drop). Sandbox behaviour ≠ production
// guarantee — vendor written confirmation required pre-pilot.
//
// Tracked in memory/followup_createtask_idempotency.md as a Day-14
// cutoff blocker. Hardening options: Idempotency-Key header probe,
// disable retry-on-uncertainty for POST surface, or pre-flight check
// by GET /api/tasks?customerOrderNumber=… before retry.
// -------------------------------------------------------------------
//
// S-8 sandbox capture also revealed: deliveryInformation.paymentMethod
// we send is NOT echoed in the response. S-9 must verify whether
// (a) we're sending it in the wrong shape, (b) SF stores it under a
// different field, or (c) SF silently ignores it. Verification path:
// GET /api/tasks/:id after creation, check whether paymentMethod
// surfaces under any field name. Tracked in
// memory/followup_paymentmethod_field_resolution.md.
//
// Retry: same policy as the auth client — 3 retries (4 total attempts)
// with delays [250, 500, 1000]ms on network errors and 5xx; 4xx
// surfaces immediately.

import { CredentialError, ValidationError } from "../../../../shared/errors";
import { logger } from "../../../../shared/logger";
import type { IsoTimestamp } from "../../../../shared/types";

import type {
  AuthenticatedSession,
  ConsigneeSnapshot,
  DeliveryAddress,
  TaskCreateRequest,
  TaskCreateResult,
} from "../../types";

const log = logger.with({ component: "suitefleet_task_client" });

const DEFAULT_BASE_URL = "https://api.suitefleet.com";
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [250, 500, 1000];

export interface SuiteFleetTaskClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clientId: string;
  readonly clock: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly baseUrl?: string;
  readonly retryDelaysMs?: readonly number[];
}

export interface SuiteFleetTaskClient {
  createTask(args: {
    session: AuthenticatedSession;
    customerId: number;
    request: TaskCreateRequest;
  }): Promise<TaskCreateResult>;
}

interface SuiteFleetLocationBody {
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly district?: string;
  readonly countryCode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly addressCode?: string;
  readonly contactPhone: string;
}

function buildLocation(
  address: DeliveryAddress,
  contactPhone: string,
): SuiteFleetLocationBody {
  return {
    addressLine1: address.addressLine1,
    ...(address.addressLine2 !== undefined && { addressLine2: address.addressLine2 }),
    city: address.city,
    ...(address.district !== undefined && { district: address.district }),
    countryCode: address.countryCode,
    latitude: address.latitude,
    longitude: address.longitude,
    ...(address.addressCode !== undefined && { addressCode: address.addressCode }),
    contactPhone,
  };
}

function buildConsignee(consignee: ConsigneeSnapshot): {
  name: string;
  contactPhone: string;
  location: SuiteFleetLocationBody;
} {
  return {
    name: consignee.name,
    contactPhone: consignee.contactPhone,
    location: buildLocation(consignee.address, consignee.contactPhone),
  };
}

export function buildSuiteFleetTaskBody(
  request: TaskCreateRequest,
  customerId: number,
): Record<string, unknown> {
  return {
    codAmount: request.codAmount ?? 0,
    consignee: buildConsignee(request.consignee),
    creationSource: "API",
    customerId,
    customerOrderNumber: request.customerOrderNumber,
    ...(request.referenceNumber !== undefined && {
      referenceNumber: request.referenceNumber,
    }),
    ...(request.deliverToCustomerOnly !== undefined && {
      deliverToCustomerOnly: request.deliverToCustomerOnly,
    }),
    deliveryDate: request.window.date,
    deliveryStartTime: request.window.startTime,
    deliveryEndTime: request.window.endTime,
    deliveryType: "STANDARD",
    deliveryInformation: { paymentMethod: request.paymentMethod },
    ...(request.notes !== undefined && { notes: request.notes }),
    shipFrom: buildLocation(request.shipFrom, request.consignee.contactPhone),
    ...(request.signatureRequired !== undefined && {
      signatureRequired: request.signatureRequired,
    }),
    ...(request.smsNotifications !== undefined && {
      smsNotifications: request.smsNotifications,
    }),
    status: "ORDERED",
    totalDeclaredGrossWeight: request.weightKg ?? 0,
    totalShipmentQuantity: request.itemQuantity,
    totalShipmentValueAmount: request.declaredValue ?? 0,
    type: request.kind,
    validDeliveryTime: true,
    volume: 0,
  };
}

interface SuiteFleetTaskCreateResponseBody {
  readonly id?: string | number;
  readonly taskId?: string | number;
  readonly awb?: string;
  readonly trackingNumber?: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly createdDate?: string;
  readonly creationDate?: string;
}

function isResponseBody(value: unknown): value is SuiteFleetTaskCreateResponseBody {
  return typeof value === "object" && value !== null;
}

export function parseSuiteFleetTaskResponse(
  body: unknown,
  fallbackClock: () => Date,
): TaskCreateResult {
  if (!isResponseBody(body)) {
    throw new ValidationError("SuiteFleet task response body is not an object");
  }

  const externalIdRaw = body.id ?? body.taskId;
  if (externalIdRaw === undefined || externalIdRaw === null) {
    throw new ValidationError("SuiteFleet task response missing id / taskId");
  }
  const externalId = typeof externalIdRaw === "number"
    ? String(externalIdRaw)
    : externalIdRaw;

  const trackingNumber = body.awb ?? body.trackingNumber;
  if (typeof trackingNumber !== "string" || trackingNumber.length === 0) {
    throw new ValidationError("SuiteFleet task response missing awb / trackingNumber");
  }

  // Empirical sandbox capture (S-8 smoke) shows SuiteFleet returns
  // `createdDate`, not `createdAt`. Try all three known variants.
  const createdAtRaw = body.createdDate ?? body.createdAt ?? body.creationDate;
  const createdAt =
    typeof createdAtRaw === "string" && createdAtRaw.length > 0
      ? (createdAtRaw as IsoTimestamp)
      : (fallbackClock().toISOString() as IsoTimestamp);

  return {
    externalId,
    trackingNumber,
    status: "CREATED",
    createdAt,
  };
}

export function createSuiteFleetTaskClient(
  deps: SuiteFleetTaskClientDeps,
): SuiteFleetTaskClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // TODO(pre-pilot): retry-on-uncertainty currently unsafe — empirical
  // 2026-04-29 sandbox dedupe probe confirmed SuiteFleet does not dedupe
  // by customerOrderNumber, so a network blip after SF processed the
  // request creates a duplicate task on retry. Disable retry for POSTs
  // OR add Idempotency-Key header probe OR pre-flight GET before retry.
  // Vendor confirmation also required. Day-14 cutoff blocker; tracked
  // in memory/followup_createtask_idempotency.md.
  async function callWithRetry(
    operation: "create_task",
    request: () => Promise<Response>,
  ): Promise<Response> {
    const maxAttempts = retryDelays.length + 1;
    let lastNetworkError: unknown = null;
    let lastServerStatus: number | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response | null = null;
      try {
        response = await request();
      } catch (err) {
        lastNetworkError = err;
        log.warn({
          operation,
          attempt,
          error_code: "network_error",
          message: err instanceof Error ? err.message : "unknown",
        });
      }

      if (response !== null) {
        if (response.status < 500) return response;
        lastServerStatus = response.status;
        lastNetworkError = null;
        log.warn({ operation, attempt, status: response.status, error_code: "server_5xx" });
      }

      if (attempt === maxAttempts) {
        const cause = lastNetworkError instanceof Error ? lastNetworkError : undefined;
        const reason =
          lastServerStatus !== null
            ? `SuiteFleet ${operation} returned ${lastServerStatus} after ${maxAttempts} attempts`
            : `SuiteFleet ${operation} unreachable after ${maxAttempts} attempts`;
        throw new CredentialError(reason, cause ? { cause } : undefined);
      }

      await sleep(retryDelays[attempt - 1]);
    }

    throw new CredentialError(`SuiteFleet ${operation} retry loop exhausted unexpectedly`);
  }

  return {
    async createTask({ session, customerId, request }) {
      const url = `${baseUrl}/api/tasks`;
      const body = buildSuiteFleetTaskBody(request, customerId);

      const response = await callWithRetry("create_task", () =>
        deps.fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.token}`,
            Clientid: deps.clientId,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        }),
      );

      if (response.status >= 400) {
        log.warn({
          operation: "create_task",
          status: response.status,
          error_code: "client_4xx",
          tenant_id: session.tenantId,
          customer_order_number: request.customerOrderNumber,
        });
        if (response.status === 401) {
          throw new CredentialError(
            "SuiteFleet createTask rejected — credentials invalid or session expired",
          );
        }
        throw new ValidationError(
          `SuiteFleet createTask rejected with status ${response.status}`,
        );
      }

      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch (err) {
        throw new ValidationError("SuiteFleet createTask response was not valid JSON", {
          cause: err instanceof Error ? err : undefined,
        });
      }

      const result = parseSuiteFleetTaskResponse(parsedBody, deps.clock);

      log.info({
        operation: "create_task",
        tenant_id: session.tenantId,
        customer_order_number: request.customerOrderNumber,
        external_id: result.externalId,
        tracking_number: result.trackingNumber,
      });

      return result;
    },
  };
}
