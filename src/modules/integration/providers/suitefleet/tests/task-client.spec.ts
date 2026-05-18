// SuiteFleet task client unit tests — Day 4 / S-8.
//
// Mocked fetch only; no live sandbox calls. Covers: body construction,
// header construction, optional-field handling, response parsing, retry
// policy, error mapping.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError, ValidationError } from "../../../../../shared/errors";

import {
  buildSuiteFleetTaskBody,
  buildSuiteFleetUpdatePatchBody,
  createSuiteFleetTaskClient,
  parseSuiteFleetBulkCancelResponse,
  parseSuiteFleetTaskActivitiesResponse,
  parseSuiteFleetTaskResponse,
  SuiteFleetAwbExistsError,
  SuiteFleetTimelineParseError,
} from "../task-client";

import {
  DOC_DERIVED_AWB,
  DOC_DERIVED_TASK_ACTIVITIES_RESPONSE,
  DOC_DERIVED_TASK_ID,
} from "./sf-task-activities-fixture";

import type {
  AuthenticatedSession,
  TaskCreateRequest,
} from "../../../types";

const SAMPLE_SESSION: AuthenticatedSession = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  token: "eyJ.access.token",
  renewalToken: "eyJ.refresh.token",
  tokenExpiresAt: "2026-04-30T08:58:15.295Z",
  renewalTokenExpiresAt: "2026-10-26T08:58:15.295Z",
};

const SAMPLE_REQUEST: TaskCreateRequest = {
  tenantId: SAMPLE_SESSION.tenantId,
  customerOrderNumber: "ORDER-001",
  referenceNumber: "REF-001",
  kind: "DELIVERY",
  consignee: {
    name: "Sample Consignee",
    contactPhone: "+971500000000",
    address: {
      addressLine1: "Villa 1",
      addressLine2: "Beach Road",
      city: "Dubai",
      district: "Jumeirah 3",
      countryCode: "AE",
      latitude: 25.1972,
      longitude: 55.2744,
      addressCode: "AXD",
    },
  },
  shipFrom: {
    addressLine1: "Warehouse 1",
    city: "Dubai",
    district: "Al Quoz Industrial 1",
    countryCode: "AE",
    latitude: 25.0,
    longitude: 55.0,
  },
  window: { date: "2026-04-30", startTime: "23:00:00", endTime: "02:00:00" },
  paymentMethod: "PrePaid",
  itemQuantity: 2,
  weightKg: 1.5,
  declaredValue: 250,
  notes: "Leave at door",
  signatureRequired: false,
  smsNotifications: true,
  deliverToCustomerOnly: true,
};

const FIXED_NOW = new Date("2026-04-29T09:00:00.000Z");

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function plainResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

function makeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  options: { baseUrl?: string } = {},
) {
  return createSuiteFleetTaskClient({
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    clientId: "transcorpsb",
    clock: () => FIXED_NOW,
    baseUrl: options.baseUrl ?? "https://api.suitefleet.com",
  });
}

describe("buildSuiteFleetTaskBody — required fields and shape", () => {
  it("includes customerId in body even though scoped in JWT", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588);
    expect(body.customerId).toBe(588);
  });

  it("sets creationSource: 'API' and status: 'ORDERED'", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588);
    expect(body.creationSource).toBe("API");
    expect(body.status).toBe("ORDERED");
  });

  it("splits the delivery window: date stays Dubai-local, times shift Dubai→UTC (Day-30 A3)", () => {
    // SAMPLE_REQUEST window = { date: 2026-04-30, start: 23:00, end: 02:00 } Dubai-local.
    // Post-A3 contract:
    //   - times shift −4h to UTC: 23:00 Dubai → 19:00 UTC; 02:00 Dubai → 22:00 UTC (wrap)
    //   - deliveryDate STAYS Dubai-local 2026-04-30 (cross-system operational anchor;
    //     reviewer ruling: do NOT decrement date even on cross-midnight wrap)
    //   - post-conversion window is NOT inverted (19:00 < 22:00) — buildWireWindow accepts
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588);
    expect(body.deliveryDate).toBe("2026-04-30");
    expect(body.deliveryStartTime).toBe("19:00:00");
    expect(body.deliveryEndTime).toBe("22:00:00");
  });

  it("builds the consignee with name, contactPhone, and a nested location", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588) as {
      consignee: { name: string; contactPhone: string; location: Record<string, unknown> };
    };
    expect(body.consignee.name).toBe("Sample Consignee");
    expect(body.consignee.contactPhone).toBe("+971500000000");
    expect(body.consignee.location.addressLine1).toBe("Villa 1");
    expect(body.consignee.location.latitude).toBe(25.1972);
    expect(body.consignee.location.longitude).toBe(55.2744);
    expect(body.consignee.location.contactPhone).toBe("+971500000000");
  });

  it("places paymentMethod at the top level of the body (un-nested per Aqib Group-1 prepaid path)", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588) as {
      paymentMethod: string;
    };
    expect(body.paymentMethod).toBe("PrePaid");
    // The deliveryInformation wrapper is gone for the prepaid path; a
    // future COD path may re-introduce it conditionally on payment kind,
    // but the prepaid path MUST send paymentMethod at the top level.
    expect("deliveryInformation" in body).toBe(false);
  });

  it("maps internal kind to type field (DELIVERY / PICKUP)", () => {
    const delivery = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588);
    expect(delivery.type).toBe("DELIVERY");
    const pickup = buildSuiteFleetTaskBody({ ...SAMPLE_REQUEST, kind: "PICKUP" }, 588);
    expect(pickup.type).toBe("PICKUP");
  });

  it("maps weightKg → totalDeclaredGrossWeight, declaredValue → totalShipmentValueAmount, itemQuantity → totalShipmentQuantity", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588);
    expect(body.totalDeclaredGrossWeight).toBe(1.5);
    expect(body.totalShipmentValueAmount).toBe(250);
    expect(body.totalShipmentQuantity).toBe(2);
  });

  it("sends coordinates as raw numbers, not strings", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588) as {
      consignee: { location: { latitude: unknown; longitude: unknown } };
    };
    expect(typeof body.consignee.location.latitude).toBe("number");
    expect(typeof body.consignee.location.longitude).toBe("number");
  });
});

describe("buildSuiteFleetTaskBody — optional-field absence", () => {
  it("omits referenceNumber when not provided (NOT sent as null)", () => {
    const minimal: TaskCreateRequest = { ...SAMPLE_REQUEST, referenceNumber: undefined };
    const body = buildSuiteFleetTaskBody(minimal, 588);
    expect("referenceNumber" in body).toBe(false);
  });

  it("omits notes when not provided", () => {
    const minimal: TaskCreateRequest = { ...SAMPLE_REQUEST, notes: undefined };
    const body = buildSuiteFleetTaskBody(minimal, 588);
    expect("notes" in body).toBe(false);
  });

  it("omits signatureRequired / smsNotifications / deliverToCustomerOnly when not provided", () => {
    const minimal: TaskCreateRequest = {
      ...SAMPLE_REQUEST,
      signatureRequired: undefined,
      smsNotifications: undefined,
      deliverToCustomerOnly: undefined,
    };
    const body = buildSuiteFleetTaskBody(minimal, 588);
    expect("signatureRequired" in body).toBe(false);
    expect("smsNotifications" in body).toBe(false);
    expect("deliverToCustomerOnly" in body).toBe(false);
  });

  it("defaults codAmount, weightKg, declaredValue to 0 when undefined", () => {
    const minimal: TaskCreateRequest = {
      ...SAMPLE_REQUEST,
      codAmount: undefined,
      weightKg: undefined,
      declaredValue: undefined,
    };
    const body = buildSuiteFleetTaskBody(minimal, 588);
    expect(body.codAmount).toBe(0);
    expect(body.totalDeclaredGrossWeight).toBe(0);
    expect(body.totalShipmentValueAmount).toBe(0);
  });

  it("omits consignee.location.latitude / longitude when undefined (SF resolves via WhatsApp post-push)", () => {
    // D8-3 contract relaxation: lat/lng are optional. When omitted on
    // the input, the buildLocation conditional spread MUST drop them
    // from the wire body (parallel to district / addressLine2 /
    // addressCode pattern). SF resolves consignee coordinates server-
    // side via WhatsApp when absent.
    const consigneeNoCoords: TaskCreateRequest["consignee"] = {
      ...SAMPLE_REQUEST.consignee,
      address: {
        ...SAMPLE_REQUEST.consignee.address,
        latitude: undefined,
        longitude: undefined,
      },
    };
    const body = buildSuiteFleetTaskBody(
      { ...SAMPLE_REQUEST, consignee: consigneeNoCoords },
      588,
    ) as { consignee: { location: Record<string, unknown> } };

    expect("latitude" in body.consignee.location).toBe(false);
    expect("longitude" in body.consignee.location).toBe(false);
  });

  it("omits shipFrom.latitude / longitude when undefined (warehouse address fixed in SF merchant master)", () => {
    // The shipFrom side never carries lat/lng either — the warehouse
    // address is registered in SF's merchant master at onboarding.
    // Same conditional-spread behaviour as the consignee location.
    const shipFromNoCoords: TaskCreateRequest["shipFrom"] = {
      ...SAMPLE_REQUEST.shipFrom,
      latitude: undefined,
      longitude: undefined,
    };
    const body = buildSuiteFleetTaskBody(
      { ...SAMPLE_REQUEST, shipFrom: shipFromNoCoords },
      588,
    ) as { shipFrom: Record<string, unknown> };

    expect("latitude" in body.shipFrom).toBe(false);
    expect("longitude" in body.shipFrom).toBe(false);
  });

  it("omits shipFrom entirely from the body when request.shipFrom is undefined (D8-4a wire-pollution fix)", () => {
    // Per memory/followup_webhook_auth_architecture.md, SF auto-
    // populates shipFrom from the merchant master when the create
    // payload omits it entirely. Cron-path callers use a mapped
    // Omit<TaskCreateRequest, 'shipFrom'> + cast to bypass the
    // type-level requirement; the runtime omission MUST land on the
    // wire so SF's merchant-master auto-population kicks in
    // (instead of receiving a synthetic placeholder).
    //
    // Cast-bypass at runtime mirrors the cron-push service's
    // call-site shape: `as TaskCreateRequest` with shipFrom undefined.
    const requestNoShipFrom = {
      ...SAMPLE_REQUEST,
      shipFrom: undefined,
    } as unknown as TaskCreateRequest;

    const body = buildSuiteFleetTaskBody(requestNoShipFrom, 588);
    expect("shipFrom" in body).toBe(false);
  });

  it("still passes through latitude / longitude when provided (additive relaxation)", () => {
    // Type relaxation is additive. Existing callers that DO supply
    // coordinates must continue to land them on the wire body as
    // numbers.
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588) as {
      consignee: { location: { latitude: unknown; longitude: unknown } };
      shipFrom: { latitude: unknown; longitude: unknown };
    };
    expect(body.consignee.location.latitude).toBe(25.1972);
    expect(body.consignee.location.longitude).toBe(55.2744);
    expect(body.shipFrom.latitude).toBe(25.0);
    expect(body.shipFrom.longitude).toBe(55.0);
  });

  it("omits address.addressLine2 / addressCode when not provided", () => {
    // district is REQUIRED on the contract (and on the wire) per
    // Aqib Group-1 + D8-2 schema migration; it always lands. Only
    // addressLine2 and addressCode are truly optional.
    const minimal: TaskCreateRequest = {
      ...SAMPLE_REQUEST,
      consignee: {
        ...SAMPLE_REQUEST.consignee,
        address: {
          addressLine1: "Plot 1",
          city: "Dubai",
          district: "Al Quoz Industrial 1",
          countryCode: "AE",
          latitude: 25,
          longitude: 55,
        },
      },
    };
    const body = buildSuiteFleetTaskBody(minimal, 588) as {
      consignee: { location: Record<string, unknown> };
    };
    expect("addressLine2" in body.consignee.location).toBe(false);
    expect("addressCode" in body.consignee.location).toBe(false);
  });

  it("passes district through to body.consignee.location and body.shipFrom (required field, never dropped)", () => {
    // Regression guard: district is required on the contract + on the
    // wire per Aqib Group-1, so the unconditional spread in
    // buildLocation MUST land it on every body it produces. Mirrors
    // the additive lat/lng pass-through test pattern.
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588) as {
      consignee: { location: { district: unknown } };
      shipFrom: { district: unknown };
    };
    expect(body.consignee.location.district).toBe("Jumeirah 3");
    expect(body.shipFrom.district).toBe("Al Quoz Industrial 1");
  });
});

describe("createTask — request wire shape", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /api/tasks with Authorization, Clientid, Content-Type headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: "sf-task-1", awb: "AWB123" }),
    );
    await makeClient(fetchMock).createTask({
      session: SAMPLE_SESSION,
      customerId: 588,
      request: SAMPLE_REQUEST,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // D8-4a: customerId is now a query parameter on the URL (defensive
    // add per SF API docs reading 4 May 2026, suitefleet.readme.io —
    // empirical sandbox probes worked without it but docs say required).
    expect(url).toBe("https://api.suitefleet.com/api/tasks?customerId=588");
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SAMPLE_SESSION.token}`);
    expect(headers.Clientid).toBe("transcorpsb");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("serialises the body as JSON with the expected shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: "sf-task-1", awb: "AWB123" }),
    );
    await makeClient(fetchMock).createTask({
      session: SAMPLE_SESSION,
      customerId: 588,
      request: SAMPLE_REQUEST,
    });

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init?.body as string);
    expect(body.customerId).toBe(588);
    expect(body.creationSource).toBe("API");
    expect(body.status).toBe("ORDERED");
    // Day-30 A3: wire body carries Dubai-local date + UTC-shifted times.
    expect(body.deliveryDate).toBe("2026-04-30");
    expect(body.deliveryStartTime).toBe("19:00:00");
    expect(body.deliveryEndTime).toBe("22:00:00");
  });
});

describe("createTask — response parsing", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns TaskCreateResult with externalId, trackingNumber, status: 'CREATED', createdAt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 12345,
        awb: "AWB-DXB-12345",
        createdAt: "2026-04-29T09:30:00.000Z",
      }),
    );
    const result = await makeClient(fetchMock).createTask({
      session: SAMPLE_SESSION,
      customerId: 588,
      request: SAMPLE_REQUEST,
    });

    expect(result.externalId).toBe("12345");
    expect(result.trackingNumber).toBe("AWB-DXB-12345");
    expect(result.status).toBe("CREATED");
    expect(result.createdAt).toBe("2026-04-29T09:30:00.000Z");
  });

  it("accepts taskId as an alternative to id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ taskId: "sf-1", trackingNumber: "TRK-1" }),
    );
    const result = await makeClient(fetchMock).createTask({
      session: SAMPLE_SESSION,
      customerId: 588,
      request: SAMPLE_REQUEST,
    });
    expect(result.externalId).toBe("sf-1");
    expect(result.trackingNumber).toBe("TRK-1");
  });

  it("falls back to clock for createdAt when not in response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: "sf-1", awb: "AWB-1" }),
    );
    const result = await makeClient(fetchMock).createTask({
      session: SAMPLE_SESSION,
      customerId: 588,
      request: SAMPLE_REQUEST,
    });
    expect(result.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it("uses createdDate from response (SuiteFleet's actual field name per S-8 smoke)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: 12345,
        awb: "AWB-DXB-12345",
        createdDate: "2026-04-29T07:16:31.149Z",
      }),
    );
    const result = await makeClient(fetchMock).createTask({
      session: SAMPLE_SESSION,
      customerId: 588,
      request: SAMPLE_REQUEST,
    });
    expect(result.createdAt).toBe("2026-04-29T07:16:31.149Z");
  });

  it("throws ValidationError when response is missing id / taskId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ awb: "AWB-1" }));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when response is missing awb / trackingNumber", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "sf-1" }));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when response is not valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("not-json", 200));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("createTask — error mapping", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("throws CredentialError on 401 (session expired) without retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("unauthorized", 401));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws ValidationError on 400 without retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("bad request", 400));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws CredentialError on 5xx WITHOUT retry (single-attempt by design — see Idempotency policy)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("oops", 503));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws CredentialError on network error WITHOUT retry (single-attempt by design)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("ECONNRESET"));
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the underlying network error as cause on the single-attempt failure", async () => {
    const networkError = new TypeError("ECONNRESET");
    const fetchMock = vi.fn().mockRejectedValue(networkError);
    let captured: unknown = null;
    try {
      await makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CredentialError);
    expect((captured as Error).cause).toBe(networkError);
  });

  // D8-4a: AWB-exists detection branch.
  it("throws SuiteFleetAwbExistsError with the parsed AWB when SF returns 'Awb with value X exists already'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      plainResponse("Awb with value MPL-12345678 exists already", 400),
    );
    let captured: unknown = null;
    try {
      await makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(SuiteFleetAwbExistsError);
    expect((captured as SuiteFleetAwbExistsError).awb).toBe("MPL-12345678");
    expect((captured as SuiteFleetAwbExistsError).httpStatus).toBe(400);
    expect((captured as SuiteFleetAwbExistsError).responseBody).toContain("MPL-12345678");
  });

  it("falls through to ValidationError on a 4xx that does NOT match the AWB-exists pattern", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      plainResponse("validation failed: missing district", 400),
    );
    await expect(
      makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Negative-case guarantee: not the AWB-exists branch.
    let captured: unknown = null;
    try {
      await makeClient(fetchMock).createTask({
        session: SAMPLE_SESSION,
        customerId: 588,
        request: SAMPLE_REQUEST,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).not.toBeInstanceOf(SuiteFleetAwbExistsError);
  });
});

describe("parseSuiteFleetTaskResponse — response shape variants", () => {
  it("rejects null / non-object body", () => {
    expect(() => parseSuiteFleetTaskResponse(null, () => FIXED_NOW)).toThrow(
      ValidationError,
    );
    expect(() => parseSuiteFleetTaskResponse("string", () => FIXED_NOW)).toThrow(
      ValidationError,
    );
  });

  it("coerces numeric id to string", () => {
    const result = parseSuiteFleetTaskResponse(
      { id: 42, awb: "AWB-42" },
      () => FIXED_NOW,
    );
    expect(result.externalId).toBe("42");
    expect(typeof result.externalId).toBe("string");
  });
});

// =============================================================================
// D8-4b — task-activities parser + getTaskByAwb adapter
// =============================================================================

describe("parseSuiteFleetTaskActivitiesResponse — D8-4b doc-derived parser", () => {
  it("extracts task.id from the doc-derived fixture and stringifies", () => {
    // Happy path: shape matches the doc-derived expectation. Parser
    // returns the minimal `{ externalId }` (string) with the SF task
    // id stringified — same convention as parseSuiteFleetTaskResponse.
    const result = parseSuiteFleetTaskActivitiesResponse(
      DOC_DERIVED_TASK_ACTIVITIES_RESPONSE,
    );
    expect(result.externalId).toBe(String(DOC_DERIVED_TASK_ID));
    expect(typeof result.externalId).toBe("string");
  });

  it("throws SuiteFleetTimelineParseError when body is not an object", () => {
    // Strict shape rejection — null, primitives, arrays. The fixture
    // caveat header rules: silent mis-extraction is the failure mode
    // we avoid. A non-object body means SF responded with something
    // other than the documented JSON shape (e.g. an HTML error page,
    // or a string error message).
    expect(() => parseSuiteFleetTaskActivitiesResponse(null)).toThrow(
      SuiteFleetTimelineParseError,
    );
    expect(() => parseSuiteFleetTaskActivitiesResponse("not-an-object")).toThrow(
      SuiteFleetTimelineParseError,
    );
    expect(() => parseSuiteFleetTaskActivitiesResponse(42)).toThrow(
      SuiteFleetTimelineParseError,
    );
  });

  it("throws SuiteFleetTimelineParseError when body is missing the task object", () => {
    // Mis-shape case the fixture caveat directly covers: SF docs
    // describe a `task` field at the top level. If the production
    // response uses a different envelope (e.g. Spring Data
    // `{ content: [...] }` like the asset-tracking endpoint), the
    // parser MUST reject rather than silently extract from the
    // wrong path.
    let captured: unknown = null;
    try {
      parseSuiteFleetTaskActivitiesResponse({ activities: [] });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(SuiteFleetTimelineParseError);
    expect((captured as SuiteFleetTimelineParseError).message).toContain("`task`");
    // The body excerpt is captured for forensic logging — operators
    // see what SF actually returned in the failure_detail.
    expect((captured as SuiteFleetTimelineParseError).bodyExcerpt).toContain("activities");
  });

  it("throws SuiteFleetTimelineParseError when task.id is missing or non-numeric", () => {
    // SF returns task ids as numbers (confirmed by the third cron
    // trigger empirical capture: id=59254 numeric). The parser
    // accepts only finite numbers — string ids, NaN, missing values
    // all reject. Stringification happens in the parser AFTER the
    // type check, not as a coercion shortcut.
    expect(() =>
      parseSuiteFleetTaskActivitiesResponse({ task: {} }),
    ).toThrow(SuiteFleetTimelineParseError);
    expect(() =>
      parseSuiteFleetTaskActivitiesResponse({ task: { id: "59254" } }),
    ).toThrow(SuiteFleetTimelineParseError);
    expect(() =>
      parseSuiteFleetTaskActivitiesResponse({ task: { id: NaN } }),
    ).toThrow(SuiteFleetTimelineParseError);
  });
});

describe("createTask client — getTaskByAwb (D8-4b)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /api/tasks/awb/{awb}/task-activities with the AWB as a path param and customerId as a query param", async () => {
    // Reviewer-load-bearing assertion: URL shape exactly matches the
    // documented endpoint. AWB encoded into the path; customerId in
    // a query param mirrors createTask's defensive add (D8-4a).
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(DOC_DERIVED_TASK_ACTIVITIES_RESPONSE),
    );
    const result = await makeClient(fetchMock).getTaskByAwb({
      session: SAMPLE_SESSION,
      customerId: 588,
      awb: DOC_DERIVED_AWB,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.suitefleet.com/api/tasks/awb/${DOC_DERIVED_AWB}/task-activities?customerId=588`,
    );
    expect(init?.method).toBe("GET");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SAMPLE_SESSION.token}`);
    expect(headers.Clientid).toBe("transcorpsb");

    // Result is the parsed minimal shape — id stringified.
    expect(result).toEqual({ externalId: String(DOC_DERIVED_TASK_ID) });
  });

  it("URL-encodes special characters in the AWB (defensive — AWBs are alphanumeric in pilot but encoding is correct)", async () => {
    // Pilot AWBs are `[A-Z]+-[0-9]+` (no encoding-sensitive
    // characters) but `encodeURIComponent` is the correct call for
    // path params. Pin the encoding behaviour with a synthetic
    // AWB-like string that includes a slash; if a future merchant
    // produces such an AWB, the URL stays well-formed.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(DOC_DERIVED_TASK_ACTIVITIES_RESPONSE),
    );
    await makeClient(fetchMock).getTaskByAwb({
      session: SAMPLE_SESSION,
      customerId: 588,
      awb: "MPL/8761",
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("MPL%2F8761");
  });

  it("throws CredentialError on 401 and on 5xx without retry (single-attempt policy applies to read side)", async () => {
    const fetchMock401 = vi.fn().mockResolvedValue(plainResponse("expired", 401));
    await expect(
      makeClient(fetchMock401).getTaskByAwb({
        session: SAMPLE_SESSION,
        customerId: 588,
        awb: DOC_DERIVED_AWB,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock401).toHaveBeenCalledTimes(1);

    const fetchMock503 = vi.fn().mockResolvedValue(plainResponse("oops", 503));
    await expect(
      makeClient(fetchMock503).getTaskByAwb({
        session: SAMPLE_SESSION,
        customerId: 588,
        awb: DOC_DERIVED_AWB,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock503).toHaveBeenCalledTimes(1);
  });

  it("throws ValidationError on 4xx (e.g. 404 — vendor-side AWB inconsistency)", async () => {
    // 404 is the operationally interesting case: SF's createTask just
    // told us the AWB exists (the 23505/AWB-exists branch), then SF's
    // task-activities endpoint says no task. Vendor-side
    // inconsistency. ValidationError carries the response body for
    // forensics (lands in failure_detail via classifyAdapterError).
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("not found", 404));
    await expect(
      makeClient(fetchMock).getTaskByAwb({
        session: SAMPLE_SESSION,
        customerId: 588,
        awb: DOC_DERIVED_AWB,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws CredentialError on network error without retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("ECONNRESET"));
    await expect(
      makeClient(fetchMock).getTaskByAwb({
        session: SAMPLE_SESSION,
        customerId: 588,
        awb: DOC_DERIVED_AWB,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws SuiteFleetTimelineParseError on non-JSON response body", async () => {
    // 200 status + unparseable body = vendor returned a 200 page
    // (HTML, plain text, etc.) where JSON was expected. Distinct
    // from a 5xx (which would CredentialError) — surface the parse
    // failure with a typed error so the cron records it under the
    // `awb_exists_reconcile_failed:` prefix.
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("<html>", 200));
    await expect(
      makeClient(fetchMock).getTaskByAwb({
        session: SAMPLE_SESSION,
        customerId: 588,
        awb: DOC_DERIVED_AWB,
      }),
    ).rejects.toBeInstanceOf(SuiteFleetTimelineParseError);
  });
});

// =============================================================================
// Day 21 / Phase 1 — updateTask / cancelTask / bulkCancelTasks
// =============================================================================
// Empirical anchors locked at Day-21 sandbox probe (see code-PR §3.6 thread):
//   - cancel field name: { status: "CANCELED" } — variant A 200 OK first attempt
//   - bulk endpoint takes NUMERIC SF task ids, not AWBs (Q3 memo correction)
//   - bulk response is aggregate job summary, not per-task results
//   - SF returns 200 + full task entity on cancel/update, NOT 204
// All three methods are single-attempt (mirrors createTask).

const SAMPLE_AWB = "MPL-72915243";

describe("buildSuiteFleetUpdatePatchBody — RFC 7396 merge-patch shape", () => {
  it("returns an empty object when no fields are present", () => {
    expect(buildSuiteFleetUpdatePatchBody({})).toEqual({});
  });

  it("splits window: date stays Dubai-local, times shift Dubai→UTC (Day-30 A3)", () => {
    // Dubai-local 09:00→11:00 on 2026-05-12.
    // Post-A3: 09:00 Dubai → 05:00 UTC; 11:00 Dubai → 07:00 UTC; date unchanged.
    const body = buildSuiteFleetUpdatePatchBody({
      window: { date: "2026-05-12", startTime: "09:00:00", endTime: "11:00:00" },
    });
    expect(body).toEqual({
      deliveryDate: "2026-05-12",
      deliveryStartTime: "05:00:00",
      deliveryEndTime: "07:00:00",
    });
  });

  it("preserves explicit null on notes (clear-field semantic)", () => {
    const body = buildSuiteFleetUpdatePatchBody({ notes: null });
    expect(body).toHaveProperty("notes", null);
  });

  it("omits notes when undefined (RFC 7396 absence vs explicit null)", () => {
    const body = buildSuiteFleetUpdatePatchBody({ notes: undefined });
    expect(body).not.toHaveProperty("notes");
  });

  it("rebuilds full consignee snapshot via buildConsignee", () => {
    const body = buildSuiteFleetUpdatePatchBody({
      consignee: SAMPLE_REQUEST.consignee,
    });
    expect(body).toHaveProperty("consignee");
    expect((body.consignee as { name: string }).name).toBe("Sample Consignee");
  });

  it("composes multiple patch fields without leaking absent keys (Day-30 A3 times in UTC)", () => {
    const body = buildSuiteFleetUpdatePatchBody({
      window: { date: "2026-05-12", startTime: "09:00:00", endTime: "11:00:00" },
      notes: "Updated note",
    });
    expect(body).toEqual({
      deliveryDate: "2026-05-12",
      deliveryStartTime: "05:00:00",
      deliveryEndTime: "07:00:00",
      notes: "Updated note",
    });
    expect(body).not.toHaveProperty("consignee");
  });
});

// =============================================================================
// Day-30 / Fix-A3 (Aqib UAT 2026-05-18) — outbound TZ conversion contract
// =============================================================================
// Asserts the reviewer-ruled contract: times shift Dubai→UTC, deliveryDate
// stays Dubai-local (NEVER decremented even on cross-midnight wrap), and
// post-conversion inverted windows throw ValidationError rather than emit
// silently.

describe("Day-30 A3 — outbound TZ conversion contract", () => {
  // Construct a TaskCreateRequest fixture builder so each case below can
  // pass its own window without re-declaring the full payload shape.
  function requestWithWindow(window: {
    date: string;
    startTime: string;
    endTime: string;
  }): TaskCreateRequest {
    return { ...SAMPLE_REQUEST, window };
  }

  describe("createTask wire body", () => {
    it("(a) Aqib UAT case — 10:00-12:00 Dubai becomes 06:00-08:00 UTC; date unchanged", () => {
      // The exact case Aqib pushed during UAT 2026-05-18. Load-bearing:
      // it proves the time-shift + the date-stays-Dubai-local ruling
      // simultaneously.
      const body = buildSuiteFleetTaskBody(
        requestWithWindow({ date: "2026-05-20", startTime: "10:00:00", endTime: "12:00:00" }),
        588,
      );
      expect(body.deliveryDate).toBe("2026-05-20");
      expect(body.deliveryStartTime).toBe("06:00:00");
      expect(body.deliveryEndTime).toBe("08:00:00");
    });

    it("(b) cross-midnight — 22:00-23:30 Dubai → 18:00-19:30 UTC; date stays 2026-05-20", () => {
      // Reviewer ruling check: even when conversion shifts both times into
      // the prior UTC day's clock value, the deliveryDate (Dubai-local
      // operational anchor) is NOT decremented.
      const body = buildSuiteFleetTaskBody(
        requestWithWindow({ date: "2026-05-20", startTime: "22:00:00", endTime: "23:30:00" }),
        588,
      );
      expect(body.deliveryDate).toBe("2026-05-20");
      expect(body.deliveryStartTime).toBe("18:00:00");
      expect(body.deliveryEndTime).toBe("19:30:00");
    });

    it("(b2) cross-midnight wrap — 01:00-03:00 Dubai → 21:00-23:00 UTC; date stays 2026-05-20", () => {
      // Both times wrap past midnight (subtracted hour is negative, +24).
      // The date STAYS 2026-05-20 — even though the UTC clock values
      // correspond to "2026-05-19 evening", we send the Dubai-local
      // operational date verbatim per reviewer ruling.
      const body = buildSuiteFleetTaskBody(
        requestWithWindow({ date: "2026-05-20", startTime: "01:00:00", endTime: "03:00:00" }),
        588,
      );
      expect(body.deliveryDate).toBe("2026-05-20");
      expect(body.deliveryStartTime).toBe("21:00:00");
      expect(body.deliveryEndTime).toBe("23:00:00");
    });

    it("(c) inverted-after-conversion window throws ValidationError (does NOT silently emit)", () => {
      // Dubai-local 02:00-04:00: start wraps to 22:00 UTC, end becomes
      // 00:00 UTC → numerically inverted (22:00 > 00:00). Reviewer ruling:
      // surface the inversion, do NOT emit. ValidationError lands the
      // row in DLQ via the cron failureCallback path for ops triage.
      expect(() =>
        buildSuiteFleetTaskBody(
          requestWithWindow({ date: "2026-05-20", startTime: "02:00:00", endTime: "04:00:00" }),
          588,
        ),
      ).toThrow(/post-UTC-conversion window is inverted/);
    });

    it("rejects malformed time string (defensive validator boundary)", () => {
      // The TaskCreateRequest type carries `startTime: string` without HMS
      // regex validation, so a malformed value can slip through at the
      // type boundary. buildWireWindow catches it before it hits the wire.
      expect(() =>
        buildSuiteFleetTaskBody(
          requestWithWindow({ date: "2026-05-20", startTime: "10:00", endTime: "12:00:00" }),
          588,
        ),
      ).toThrow(/time string must be HH:MM:SS/);
    });
  });

  describe("updateTask wire body", () => {
    it("(a) Aqib UAT case mirrored on update patch", () => {
      const body = buildSuiteFleetUpdatePatchBody({
        window: { date: "2026-05-20", startTime: "10:00:00", endTime: "12:00:00" },
      });
      expect(body).toEqual({
        deliveryDate: "2026-05-20",
        deliveryStartTime: "06:00:00",
        deliveryEndTime: "08:00:00",
      });
    });

    it("(c) inverted-after-conversion window throws on update path", () => {
      expect(() =>
        buildSuiteFleetUpdatePatchBody({
          window: { date: "2026-05-20", startTime: "02:00:00", endTime: "04:00:00" },
        }),
      ).toThrow(/post-UTC-conversion window is inverted/);
    });
  });
});

describe("parseSuiteFleetBulkCancelResponse — aggregate job summary", () => {
  const SAMPLE_BULK_OK = {
    id: 1764,
    tasksExecutedCount: 2,
    expectedTasksCount: 2,
    executionTimeInSeconds: 0,
    status: "COMPLETED",
    bulkUpdateSource: "BULK_UPDATE",
  };

  it("extracts jobId / executedCount / expectedCount / status from happy response", () => {
    const result = parseSuiteFleetBulkCancelResponse(SAMPLE_BULK_OK);
    expect(result).toEqual({
      jobId: "1764",
      executedCount: 2,
      expectedCount: 2,
      status: "COMPLETED",
    });
  });

  it("stringifies numeric jobId for storage parity (matches TaskCreateResult.externalId)", () => {
    const result = parseSuiteFleetBulkCancelResponse({ ...SAMPLE_BULK_OK, id: 9999 });
    expect(result.jobId).toBe("9999");
    expect(typeof result.jobId).toBe("string");
  });

  it("throws ValidationError on null body", () => {
    expect(() => parseSuiteFleetBulkCancelResponse(null)).toThrow(ValidationError);
  });

  it("throws ValidationError on missing tasksExecutedCount", () => {
    const rest = { ...SAMPLE_BULK_OK } as Record<string, unknown>;
    delete rest.tasksExecutedCount;
    expect(() => parseSuiteFleetBulkCancelResponse(rest)).toThrow(ValidationError);
  });

  it("throws ValidationError on missing status", () => {
    const rest = { ...SAMPLE_BULK_OK } as Record<string, unknown>;
    delete rest.status;
    expect(() => parseSuiteFleetBulkCancelResponse(rest)).toThrow(ValidationError);
  });

  it("throws ValidationError on non-finite executedCount", () => {
    expect(() =>
      parseSuiteFleetBulkCancelResponse({ ...SAMPLE_BULK_OK, tasksExecutedCount: NaN }),
    ).toThrow(ValidationError);
  });
});

describe("SuiteFleetTaskClient.updateTask — wire posture + error mapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function happyResponse(): Response {
    // Empirically observed: SF returns 200 + the full task entity on
    // updateTask. Adapter discards the body but tests assert on it via
    // the fetch mock to lock the wire contract.
    return jsonResponse({ id: 59383, awb: SAMPLE_AWB, status: "ORDERED" });
  }

  it("issues PATCH /api/tasks/awb/{awb} with merge-patch+json content type", async () => {
    const fetchMock = vi.fn().mockResolvedValue(happyResponse());
    await makeClient(fetchMock).updateTask({
      session: SAMPLE_SESSION,
      awb: SAMPLE_AWB,
      patch: { window: { date: "2026-05-12", startTime: "09:00:00", endTime: "11:00:00" } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.suitefleet.com/api/tasks/awb/${SAMPLE_AWB}`);
    expect(init.method).toBe("PATCH");
    expect(init.headers["Content-Type"]).toBe("application/merge-patch+json");
    expect(init.headers.Authorization).toBe(`Bearer ${SAMPLE_SESSION.token}`);
    expect(init.headers.Clientid).toBe("transcorpsb");
  });

  it("URL-encodes the AWB into the path segment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(happyResponse());
    await makeClient(fetchMock).updateTask({
      session: SAMPLE_SESSION,
      awb: "MPL/with slash",
      patch: { notes: "x" },
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("MPL%2Fwith%20slash");
  });

  it("does not parse the 200 response body — discards explicitly", async () => {
    // LANE 1 reviewer ruling: parser must not crash on body presence.
    // Lock the contract: HTML or any non-JSON 200 should not throw.
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("<html>not-json", 200));
    await expect(
      makeClient(fetchMock).updateTask({
        session: SAMPLE_SESSION,
        awb: SAMPLE_AWB,
        patch: { notes: "x" },
      }),
    ).resolves.toBeUndefined();
  });

  it("maps 4xx to ValidationError carrying response excerpt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("Bad Request", 400));
    await expect(
      makeClient(fetchMock).updateTask({
        session: SAMPLE_SESSION,
        awb: SAMPLE_AWB,
        patch: { notes: "x" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 401 to CredentialError (auth-level)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("Unauthorized", 401));
    await expect(
      makeClient(fetchMock).updateTask({
        session: SAMPLE_SESSION,
        awb: SAMPLE_AWB,
        patch: { notes: "x" },
      }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("maps 5xx to CredentialError without retry (single-attempt policy)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("oops", 502));
    await expect(
      makeClient(fetchMock).updateTask({
        session: SAMPLE_SESSION,
        awb: SAMPLE_AWB,
        patch: { notes: "x" },
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps network error to CredentialError (single-attempt)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("ECONNRESET"));
    await expect(
      makeClient(fetchMock).updateTask({
        session: SAMPLE_SESSION,
        awb: SAMPLE_AWB,
        patch: { notes: "x" },
      }),
    ).rejects.toBeInstanceOf(CredentialError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("SuiteFleetTaskClient.cancelTask — locked field name + fire-and-forget posture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends body { status: 'CANCELED' } verbatim — Day-21 probe-locked", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 59383, status: "CANCELED" }));
    await makeClient(fetchMock).cancelTask({
      session: SAMPLE_SESSION,
      awb: SAMPLE_AWB,
      correlationId: "corr-xyz",
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ status: "CANCELED" });
  });

  it("does NOT put correlationId on the wire (SF ignores Idempotency-Key)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "CANCELED" }));
    await makeClient(fetchMock).cancelTask({
      session: SAMPLE_SESSION,
      awb: SAMPLE_AWB,
      correlationId: "corr-LEAK-CHECK",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("corr-LEAK-CHECK");
    expect(init.headers["Idempotency-Key"]).toBeUndefined();
    expect(init.body).not.toContain("corr-LEAK-CHECK");
  });

  it("returns void on 200 (fire-and-forget; webhook drives state convergence)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "CANCELED" }));
    const result = await makeClient(fetchMock).cancelTask({
      session: SAMPLE_SESSION,
      awb: SAMPLE_AWB,
      correlationId: "corr-1",
    });
    expect(result).toBeUndefined();
  });

  it("maps 401 to CredentialError, 4xx to ValidationError, 5xx to CredentialError, network to CredentialError", async () => {
    const fetch401 = vi.fn().mockResolvedValue(plainResponse("nope", 401));
    const fetch4xx = vi.fn().mockResolvedValue(plainResponse("nope", 422));
    const fetch5xx = vi.fn().mockResolvedValue(plainResponse("oops", 503));
    const fetchNet = vi.fn().mockRejectedValue(new TypeError("net"));

    const args = { session: SAMPLE_SESSION, awb: SAMPLE_AWB, correlationId: "c" };
    await expect(makeClient(fetch401).cancelTask(args)).rejects.toBeInstanceOf(CredentialError);
    await expect(makeClient(fetch4xx).cancelTask(args)).rejects.toBeInstanceOf(ValidationError);
    await expect(makeClient(fetch5xx).cancelTask(args)).rejects.toBeInstanceOf(CredentialError);
    await expect(makeClient(fetchNet).cancelTask(args)).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("SuiteFleetTaskClient.bulkCancelTasks — numeric ids + aggregate parsing + partial-failure", () => {
  const HAPPY = {
    id: 1764,
    tasksExecutedCount: 2,
    expectedTasksCount: 2,
    status: "COMPLETED",
    bulkUpdateSource: "BULK_UPDATE",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects empty sfTaskIds with ValidationError (no SF call)", async () => {
    const fetchMock = vi.fn();
    await expect(
      makeClient(fetchMock).bulkCancelTasks({
        session: SAMPLE_SESSION,
        sfTaskIds: [],
        correlationId: "c",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects AWB-shaped strings with ValidationError (defensive — bulk takes numeric ids)", async () => {
    const fetchMock = vi.fn();
    await expect(
      makeClient(fetchMock).bulkCancelTasks({
        session: SAMPLE_SESSION,
        sfTaskIds: ["MPL-12345"],
        correlationId: "c",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects leading-zero ids (canonical positive-integer regex)", async () => {
    const fetchMock = vi.fn();
    await expect(
      makeClient(fetchMock).bulkCancelTasks({
        session: SAMPLE_SESSION,
        sfTaskIds: ["059414"],
        correlationId: "c",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues PATCH /api/tasks/bulk/{ids} with comma-separated numeric ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(HAPPY));
    await makeClient(fetchMock).bulkCancelTasks({
      session: SAMPLE_SESSION,
      sfTaskIds: ["59414", "59421"],
      correlationId: "c",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.suitefleet.com/api/tasks/bulk/59414,59421");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "CANCELED" });
    expect(init.headers["Content-Type"]).toBe("application/merge-patch+json");
  });

  it("returns aggregate BulkCancelResult on full-success 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(HAPPY));
    const result = await makeClient(fetchMock).bulkCancelTasks({
      session: SAMPLE_SESSION,
      sfTaskIds: ["59414", "59421"],
      correlationId: "c",
    });
    expect(result).toEqual({
      jobId: "1764",
      executedCount: 2,
      expectedCount: 2,
      status: "COMPLETED",
    });
  });

  it("throws ValidationError on partial failure (executedCount < expectedCount)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...HAPPY, tasksExecutedCount: 1, expectedTasksCount: 2 }),
    );
    await expect(
      makeClient(fetchMock).bulkCancelTasks({
        session: SAMPLE_SESSION,
        sfTaskIds: ["59414", "59421"],
        correlationId: "c",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on non-JSON 200 body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(plainResponse("<html>", 200));
    await expect(
      makeClient(fetchMock).bulkCancelTasks({
        session: SAMPLE_SESSION,
        sfTaskIds: ["59414"],
        correlationId: "c",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps 4xx / 5xx / network errors to ValidationError / CredentialError respectively", async () => {
    const args = {
      session: SAMPLE_SESSION,
      sfTaskIds: ["59414", "59421"],
      correlationId: "c",
    };
    await expect(
      makeClient(vi.fn().mockResolvedValue(plainResponse("nope", 422))).bulkCancelTasks(args),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      makeClient(vi.fn().mockResolvedValue(plainResponse("nope", 401))).bulkCancelTasks(args),
    ).rejects.toBeInstanceOf(CredentialError);
    await expect(
      makeClient(vi.fn().mockResolvedValue(plainResponse("oops", 502))).bulkCancelTasks(args),
    ).rejects.toBeInstanceOf(CredentialError);
    await expect(
      makeClient(vi.fn().mockRejectedValue(new TypeError("net"))).bulkCancelTasks(args),
    ).rejects.toBeInstanceOf(CredentialError);
  });
});
