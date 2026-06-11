// Unit tests for /api/subscriptions/[id]/skip — Day-16 Block 4-F Commit 1.
//
// Pins:
//   - Body shape (snake_case wire → camelCase service input)
//   - idempotency_key REQUIRED in body per merged plan §6.5 (locked
//     Zod contract)
//   - Permission gating happens at the service layer (Service A's
//     resolveRequiredPermission); route does NOT pre-gate
//   - Status code passthrough from result.httpStatus (201 inserted /
//     409 idempotent_replay)
//   - Error mapping per `errorResponse`: ValidationError → 400,
//     ForbiddenError → 403, NotFoundError → 404, ConflictError → 409
//   - id param Zod gate (uuid required)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// vi.hoisted ensures these vi.fn() refs are initialized BEFORE the
// vi.mock factories run (factories capture them via closure). Without
// hoisting, the const is in TDZ when the route module is first
// imported and the factory's closure-bound reference is undefined,
// which silently breaks subsequent mock-based assertions.
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

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";

import { POST } from "../route";

// v4-shaped UUIDs for fields that pass through Zod uuid validation
// at the route boundary (SUBSCRIPTION_ID via IdParamSchema;
// IDEMPOTENCY_KEY via body schema). Zod 4's .uuid() rejects
// all-zeros placeholders that the service-layer tests use; the
// route layer needs RFC 4122 v4 format (xxxxxxxx-xxxx-4xxx-yxxx-...
// with y ∈ {8,9,a,b}).
const SUBSCRIPTION_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "00000000-0000-0000-0000-000000000aaa";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";
const IDEMPOTENCY_KEY = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";
const FUTURE_DATE = "2026-05-13";

function fakeCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(["subscription:skip"]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/subscriptions/${SUBSCRIPTION_ID}/skip`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/subscriptions/${SUBSCRIPTION_ID}/skip`;
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

describe("POST /api/subscriptions/[id]/skip — happy paths", () => {
  it("maps a default-skip body to type='skip' camelCase service input + returns 201", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      compensatingDate: "2026-07-01",
      newEndDate: "2026-07-01",
      status: "inserted",
      httpStatus: 201,
    });

    const res = await POST(
      makeRequest({
        date: FUTURE_DATE,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("inserted");

    expect(mockAddException).toHaveBeenCalledOnce();
    const [ctx, id, input] = mockAddException.mock.calls[0];
    expect(id).toBe(SUBSCRIPTION_ID);
    expect(input).toEqual({
      type: "skip",
      date: FUTURE_DATE,
      reason: undefined,
      idempotencyKey: IDEMPOTENCY_KEY,
      targetDateOverride: undefined,
      skipWithoutAppend: undefined,
    });
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/subscriptions/${SUBSCRIPTION_ID}/skip`,
      expect.any(String),
    );
  });

  it("forwards target_date_override (snake_case) → targetDateOverride (camelCase)", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      compensatingDate: "2026-05-20",
      newEndDate: null,
      status: "inserted",
      httpStatus: 201,
    });

    await POST(
      makeRequest({
        date: FUTURE_DATE,
        idempotency_key: IDEMPOTENCY_KEY,
        target_date_override: "2026-05-20",
      }),
      ROUTE_PARAMS,
    );

    const [, , input] = mockAddException.mock.calls[0];
    expect(input.targetDateOverride).toBe("2026-05-20");
    expect(input.skipWithoutAppend).toBeUndefined();
  });

  it("forwards skip_without_append (snake_case) → skipWithoutAppend (camelCase)", async () => {
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
        date: FUTURE_DATE,
        idempotency_key: IDEMPOTENCY_KEY,
        skip_without_append: true,
      }),
      ROUTE_PARAMS,
    );

    const [, , input] = mockAddException.mock.calls[0];
    expect(input.skipWithoutAppend).toBe(true);
  });

  it("forwards optional reason field", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      compensatingDate: "2026-07-01",
      newEndDate: "2026-07-01",
      status: "inserted",
      httpStatus: 201,
    });

    await POST(
      makeRequest({
        date: FUTURE_DATE,
        idempotency_key: IDEMPOTENCY_KEY,
        reason: "consignee travelling",
      }),
      ROUTE_PARAMS,
    );

    const [, , input] = mockAddException.mock.calls[0];
    expect(input.reason).toBe("consignee travelling");
  });

  it("returns 409 with idempotent_replay status when service returns httpStatus=409", async () => {
    mockAddException.mockResolvedValue({
      exceptionId: "exc-existing",
      correlationId: "corr-existing",
      compensatingDate: "2026-07-01",
      newEndDate: "2026-07-01",
      status: "idempotent_replay",
      httpStatus: 409,
    });

    const res = await POST(
      makeRequest({
        date: FUTURE_DATE,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("idempotent_replay");
  });
});

// -----------------------------------------------------------------------------
// Body / id validation — 400 paths
// -----------------------------------------------------------------------------

describe("POST /api/subscriptions/[id]/skip — body validation", () => {
  it("returns 400 ValidationError when body is missing entirely", async () => {
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/skip endpoint requires a body/i);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 ValidationError when body is malformed JSON", async () => {
    const res = await POST(makeRequest(null), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 ValidationError when idempotency_key is omitted (locked Zod contract per §6.5)", async () => {
    const res = await POST(
      makeRequest({ date: FUTURE_DATE }), // no idempotency_key
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/idempotency_key/i);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 ValidationError when idempotency_key is not a uuid", async () => {
    const res = await POST(
      makeRequest({
        date: FUTURE_DATE,
        idempotency_key: "not-a-uuid",
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 ValidationError when date is empty string", async () => {
    const res = await POST(
      makeRequest({
        date: "",
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAddException).not.toHaveBeenCalled();
  });

  it("returns 400 ValidationError when route id is not a uuid", async () => {
    const res = await POST(
      makeRequest({ date: FUTURE_DATE, idempotency_key: IDEMPOTENCY_KEY }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockAddException).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Service-layer error → HTTP status mapping
// -----------------------------------------------------------------------------

describe("POST /api/subscriptions/[id]/skip — service error → HTTP mapping", () => {
  const validBody = () => ({
    date: FUTURE_DATE,
    idempotency_key: IDEMPOTENCY_KEY,
  });

  it("ForbiddenError → 403", async () => {
    mockAddException.mockRejectedValue(new ForbiddenError("permission denied: subscription:skip"));
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("NotFoundError → 404", async () => {
    mockAddException.mockRejectedValue(new NotFoundError(`subscription not found: ${SUBSCRIPTION_ID}`));
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("ConflictError (subscription not active) → 409", async () => {
    mockAddException.mockRejectedValue(
      new ConflictError("subscription must be active to accept exception; current status is 'paused'"),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("ValidationError (cut-off elapsed, days-of-week mismatch, address ownership) → 400", async () => {
    // Service A maps cut-off + eligibility + ownership to ValidationError
    // per shipped semantic. The route doesn't distinguish — all 400.
    mockAddException.mockRejectedValue(
      new ValidationError("delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception"),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
  });

  it("re-throws unknown errors so the framework's 500 handler renders", async () => {
    mockAddException.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makeRequest(validBody()), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
