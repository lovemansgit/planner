// Unit tests for /api/subscriptions/[id]/address-override — Day-16
// Block 4-F Commit 2.
//
// Pins:
//   - Discriminated body parsing via z.discriminatedUnion("scope", ...)
//     (first codebase use; verified Day-16 pre-flight probe)
//   - scope='one_off' → service input type='address_override_one_off';
//     scope='forward' → type='address_override_forward'
//   - YYYY-MM-DD date validation via z.string().date()
//   - snake_case wire (address_id, idempotency_key) → camelCase
//     service input (addressOverrideId, idempotencyKey)
//   - Permission gate happens at the service layer (Service A
//     resolveRequiredPermission per type)
//   - Status 201 on inserted; 409 on idempotent_replay
//   - Error mapping per errorResponse

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockAddException, mockBuildCtx } = vi.hoisted(() => ({
  mockAddException: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/subscription-exceptions", () => ({
  addSubscriptionException: vi.fn((ctx: unknown, id: unknown, input: unknown) =>
    mockAddException(ctx, id, input),
  ),
}));

vi.mock("@/shared/request-context", () => ({
  buildRequestContext: vi.fn((path: string, requestId: string) =>
    mockBuildCtx(path, requestId),
  ),
}));

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";

import { POST } from "../route";

// v4-shaped UUIDs per the Block 4-F Zod-strictness pattern.
const SUBSCRIPTION_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "00000000-0000-0000-0000-000000000aaa";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";
const ADDRESS_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const IDEMPOTENCY_KEY = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";
const FUTURE_DATE = "2026-05-13";

function fakeCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set([
        "subscription:change_address_one_off",
        "subscription:change_address_forward",
      ]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/subscriptions/${SUBSCRIPTION_ID}/address-override`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/subscriptions/${SUBSCRIPTION_ID}/address-override`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

const ROUTE_PARAMS = { params: Promise.resolve({ id: SUBSCRIPTION_ID }) };

beforeEach(() => {
  mockAddException.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/subscriptions/[id]/address-override — happy paths", () => {
  it("scope='one_off' → service type='address_override_one_off'; returns 201 on inserted", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      compensatingDate: null,
      newEndDate: null,
      status: "inserted",
      httpStatus: 201,
    });

    const res = await POST(
      makeRequest({
        scope: "one_off",
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("inserted");

    expect(mockAddException).toHaveBeenCalledOnce();
    const [, id, input] = mockAddException.mock.calls[0];
    expect(id).toBe(SUBSCRIPTION_ID);
    expect(input).toEqual({
      type: "address_override_one_off",
      date: FUTURE_DATE,
      idempotencyKey: IDEMPOTENCY_KEY,
      addressOverrideId: ADDRESS_ID,
    });
  });

  it("scope='forward' → service type='address_override_forward'; returns 201 on inserted", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-2",
      correlationId: "corr-2",
      compensatingDate: null,
      newEndDate: null,
      status: "inserted",
      httpStatus: 201,
    });

    await POST(
      makeRequest({
        scope: "forward",
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    const [, , input] = mockAddException.mock.calls[0];
    expect(input.type).toBe("address_override_forward");
    expect(input.date).toBe(FUTURE_DATE);
    expect(input.addressOverrideId).toBe(ADDRESS_ID);
  });

  it("scope='one_off' replay returns 409 with idempotent_replay status (passthrough)", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-existing",
      correlationId: "corr-existing",
      compensatingDate: null,
      newEndDate: null,
      status: "idempotent_replay",
      httpStatus: 409,
    });

    const res = await POST(
      makeRequest({
        scope: "one_off",
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("idempotent_replay");
  });

  it("scope='forward' replay returns 409", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-existing",
      correlationId: "corr-existing",
      compensatingDate: null,
      newEndDate: null,
      status: "idempotent_replay",
      httpStatus: 409,
    });

    const res = await POST(
      makeRequest({
        scope: "forward",
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(409);
  });

  it("buildRequestContext receives the correct route path string", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      compensatingDate: null,
      newEndDate: null,
      status: "inserted",
      httpStatus: 201,
    });

    await POST(
      makeRequest({
        scope: "one_off",
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/subscriptions/${SUBSCRIPTION_ID}/address-override`,
      expect.any(String),
    );
  });
});

// -----------------------------------------------------------------------------
// Body validation — discriminator + per-branch fields
// -----------------------------------------------------------------------------

describe("POST /api/subscriptions/[id]/address-override — body validation", () => {
  const validOneOff = () => ({
    scope: "one_off",
    date: FUTURE_DATE,
    address_id: ADDRESS_ID,
    idempotency_key: IDEMPOTENCY_KEY,
  });

  it("returns 400 when body is missing entirely", async () => {
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/address-override endpoint requires a body/i);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 when body is malformed JSON", async () => {
    const res = await POST(makeRequest(null), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 when scope is missing (discriminator absent)", async () => {
    const res = await POST(
      makeRequest({
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 when scope is invalid (not one_off | forward)", async () => {
    const res = await POST(
      makeRequest({ ...validOneOff(), scope: "sometime" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 when date is missing", async () => {
    const res = await POST(
      makeRequest({
        scope: "one_off",
        address_id: ADDRESS_ID,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when date is malformed (not YYYY-MM-DD)", async () => {
    const res = await POST(
      makeRequest({ ...validOneOff(), date: "13-05-2026" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when date has impossible day (2026-05-32)", async () => {
    const res = await POST(
      makeRequest({ ...validOneOff(), date: "2026-05-32" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when address_id is missing", async () => {
    const res = await POST(
      makeRequest({
        scope: "one_off",
        date: FUTURE_DATE,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when address_id is not a uuid", async () => {
    const res = await POST(
      makeRequest({ ...validOneOff(), address_id: "not-a-uuid" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when idempotency_key is missing (locked Zod contract per §6.5)", async () => {
    const res = await POST(
      makeRequest({
        scope: "one_off",
        date: FUTURE_DATE,
        address_id: ADDRESS_ID,
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/idempotency_key/i);
  });

  it("returns 400 when idempotency_key is not a uuid", async () => {
    const res = await POST(
      makeRequest({ ...validOneOff(), idempotency_key: "not-a-uuid" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when route id is not a uuid", async () => {
    const res = await POST(
      makeRequest(validOneOff()),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("discriminator integrity — scope='forward' body without all required fields rejected by Zod", async () => {
    // Per-branch fields: even on the forward branch, address_id +
    // date + idempotency_key are required. Zod's discriminatedUnion
    // narrows on `scope` and applies the matching object schema.
    const res = await POST(
      makeRequest({ scope: "forward", date: FUTURE_DATE }),
      // missing address_id + idempotency_key
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Service-layer error → HTTP status mapping
// -----------------------------------------------------------------------------

describe("POST /api/subscriptions/[id]/address-override — service error → HTTP mapping", () => {
  const validBody = () => ({
    scope: "one_off",
    date: FUTURE_DATE,
    address_id: ADDRESS_ID,
    idempotency_key: IDEMPOTENCY_KEY,
  });

  it("ForbiddenError (lacks the resolved permission) → 403", async () => {
    mockAddException.mockRejectedValue(
      new ForbiddenError("permission denied: subscription:change_address_one_off"),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(403);
  });

  it("NotFoundError → 404", async () => {
    mockAddException.mockRejectedValue(
      new NotFoundError(`subscription not found: ${SUBSCRIPTION_ID}`),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(404);
  });

  it("ConflictError (subscription not active) → 409", async () => {
    mockAddException.mockRejectedValue(
      new ConflictError(
        "subscription must be active to accept exception; current status is 'paused'",
      ),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(409);
  });

  it("ValidationError (cross-consignee ownership per Block 4-E §B B1) → 400", async () => {
    mockAddException.mockRejectedValue(
      new ValidationError(
        `address_not_found_for_consignee: address ${ADDRESS_ID} does not belong to consignee X`,
      ),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/address_not_found_for_consignee/);
  });

  it("ValidationError (cut-off elapsed) → 400 per shipped reality §C", async () => {
    mockAddException.mockRejectedValue(
      new ValidationError(
        "delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception",
      ),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(400);
  });

  it("re-throws unknown errors so the framework's 500 handler renders", async () => {
    mockAddException.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makeRequest(validBody()), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
