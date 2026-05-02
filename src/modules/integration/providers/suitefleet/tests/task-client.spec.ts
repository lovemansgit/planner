// SuiteFleet task client unit tests — Day 4 / S-8.
//
// Mocked fetch only; no live sandbox calls. Covers: body construction,
// header construction, optional-field handling, response parsing, retry
// policy, error mapping.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CredentialError, ValidationError } from "../../../../../shared/errors";

import {
  buildSuiteFleetTaskBody,
  createSuiteFleetTaskClient,
  parseSuiteFleetTaskResponse,
  SuiteFleetAwbExistsError,
} from "../task-client";

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

  it("splits the delivery window into deliveryDate / deliveryStartTime / deliveryEndTime", () => {
    const body = buildSuiteFleetTaskBody(SAMPLE_REQUEST, 588);
    expect(body.deliveryDate).toBe("2026-04-30");
    expect(body.deliveryStartTime).toBe("23:00:00");
    expect(body.deliveryEndTime).toBe("02:00:00");
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
    expect(body.deliveryDate).toBe("2026-04-30");
    expect(body.deliveryStartTime).toBe("23:00:00");
    expect(body.deliveryEndTime).toBe("02:00:00");
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
