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
// Idempotency policy (load-bearing):
//
// `createTask` is intentionally SINGLE-ATTEMPT. Two empirical sandbox
// probes on 2026-04-29 confirmed:
//
//   (1) SuiteFleet does NOT dedupe by `customerOrderNumber`.
//       Two POSTs with identical body 1 second apart created two
//       distinct tasks (id=59019 / awb=MPS-58040211 vs
//                       id=59020 / awb=MPS-05267778).
//
//   (2) SuiteFleet does NOT honour the `Idempotency-Key` HTTP header.
//       Two POSTs with same body + same UUID created two distinct
//       tasks (id=59022 / awb=MPS-56635891 vs
//              id=59023 / awb=MPS-23006236).
//
// Therefore: retrying on 5xx or network errors would create duplicate
// physical deliveries when a request reaches SF but the response is
// lost (gateway timeout, NAT drop, process crash). The cost of one
// duplicate physical delivery is operationally serious; the cost of
// one transient SF outage on a single task is one re-attempt by the
// cron worker on the next pass. Trade-off favours single-attempt.
//
// The auth client (S-2) retains retry behaviour because auth flows
// are idempotent on the server side — repeated logins return fresh
// tokens, not duplicates of anything physical.
//
// Sandbox behaviour ≠ production guarantee. Vendor written
// confirmation required pre-pilot (Day-14 list):
//   "request from SF account manager: written commitment to honour
//    Idempotency-Key OR documented dedupe behaviour on
//    customerOrderNumber."
// Tracked in memory/followup_createtask_idempotency.md.
// -------------------------------------------------------------------
//
// S-8 sandbox capture revealed deliveryInformation.paymentMethod was
// NOT echoed in the response — RESOLVED per Aqib Group-1 confirmation
// (3 May 2026): for the prepaid path SF expects `paymentMethod` at
// the TOP LEVEL of the create body, NOT nested under
// `deliveryInformation`. D8-3 un-nests it accordingly. The COD path
// may re-introduce a wrapper later (open scope, not pilot-blocking);
// when that lands, conditional placement based on payment kind, not
// a blanket re-nest. Tracked in
// memory/followup_paymentmethod_field_resolution.md.

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

export interface SuiteFleetTaskClientDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly clientId: string;
  readonly clock: () => Date;
  readonly baseUrl?: string;
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
  readonly district: string;
  readonly countryCode: string;
  readonly latitude?: number;
  readonly longitude?: number;
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
    district: address.district,
    countryCode: address.countryCode,
    ...(address.latitude !== undefined && { latitude: address.latitude }),
    ...(address.longitude !== undefined && { longitude: address.longitude }),
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
    paymentMethod: request.paymentMethod,
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

  return {
    async createTask({ session, customerId, request }) {
      const url = `${baseUrl}/api/tasks`;
      const body = buildSuiteFleetTaskBody(request, customerId);

      // SAFETY: single-attempt by design. See file-header
      // "Idempotency policy" block. No retry helper here — any 5xx or
      // network error surfaces directly to the caller, who decides
      // whether to re-attempt at a higher level (e.g. the next cron
      // pass for a missed task). Retry-on-uncertainty would create
      // duplicate physical deliveries.
      let response: Response;
      try {
        response = await deps.fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.token}`,
            Clientid: deps.clientId,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        log.warn({
          operation: "create_task",
          error_code: "network_error",
          tenant_id: session.tenantId,
          customer_order_number: request.customerOrderNumber,
          message: err instanceof Error ? err.message : "unknown",
        });
        throw new CredentialError(
          "SuiteFleet createTask network error — single-attempt policy, no retry",
          err instanceof Error ? { cause: err } : undefined,
        );
      }

      if (response.status >= 500) {
        log.warn({
          operation: "create_task",
          status: response.status,
          error_code: "server_5xx",
          tenant_id: session.tenantId,
          customer_order_number: request.customerOrderNumber,
        });
        throw new CredentialError(
          `SuiteFleet createTask returned ${response.status} — single-attempt policy, no retry`,
        );
      }

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
