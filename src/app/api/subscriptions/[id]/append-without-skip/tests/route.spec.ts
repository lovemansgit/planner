// Unit tests for /api/subscriptions/[id]/append-without-skip — Day-16
// Block 4-F Commit 1.
//
// Pins:
//   - Body shape (snake_case wire → camelCase service input)
//   - reason REQUIRED (distinct from skip's optional reason)
//   - idempotency_key REQUIRED in body per merged plan §6.5
//   - Permission gate is unconditional 'subscription:override_skip_rules'
//     at the service layer (no input-shape resolution like skip variant)
//   - Status code passthrough from result.httpStatus
//   - Error mapping via errorResponse

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// See skip/tests/route.spec.ts header — vi.hoisted ensures these
// vi.fn() refs are initialized before the vi.mock factories run.
const { mockAppend, mockBuildCtx } = vi.hoisted(() => ({
  mockAppend: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/subscription-exceptions", () => ({
  appendWithoutSkip: vi.fn((ctx: unknown, id: unknown, input: unknown) =>
    mockAppend(ctx, id, input),
  ),
}));

vi.mock("@/shared/request-context", () => ({
  buildRequestContext: vi.fn((path: string, requestId: string) =>
    mockBuildCtx(path, requestId),
  ),
}));

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";

import { POST } from "../route";

// v4-shaped UUIDs — Zod 4's .uuid() rejects all-zeros placeholders.
// See skip/tests/route.spec.ts header for full reasoning.
const SUBSCRIPTION_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "00000000-0000-0000-0000-000000000aaa";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";
const IDEMPOTENCY_KEY = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee";

function fakeCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(["subscription:override_skip_rules"]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/subscriptions/${SUBSCRIPTION_ID}/append-without-skip`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/subscriptions/${SUBSCRIPTION_ID}/append-without-skip`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

const ROUTE_PARAMS = { params: Promise.resolve({ id: SUBSCRIPTION_ID }) };

beforeEach(() => {
  mockAppend.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/subscriptions/[id]/append-without-skip — happy paths", () => {
  it("maps a default-append body to camelCase service input + returns 201", async () => {
    mockAppend.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      newEndDate: "2026-07-01",
      status: "inserted",
      httpStatus: 201,
    });

    const res = await POST(
      makeRequest({
        reason: "goodwill — operator-initiated tail-end addition",
        idempotency_key: IDEMPOTENCY_KEY,
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("inserted");

    expect(mockAppend).toHaveBeenCalledOnce();
    const [ctx, id, input] = mockAppend.mock.calls[0];
    expect(id).toBe(SUBSCRIPTION_ID);
    expect(input).toEqual({
      reason: "goodwill — operator-initiated tail-end addition",
      idempotencyKey: IDEMPOTENCY_KEY,
      targetDateOverride: undefined,
    });
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/subscriptions/${SUBSCRIPTION_ID}/append-without-skip`,
      expect.any(String),
    );
  });

  it("forwards target_date_override → targetDateOverride", async () => {
    mockAppend.mockResolvedValue({
      exceptionId: "exc-1",
      correlationId: "corr-1",
      newEndDate: "2026-05-20",
      status: "inserted",
      httpStatus: 201,
    });

    await POST(
      makeRequest({
        reason: "operator picked a specific date",
        idempotency_key: IDEMPOTENCY_KEY,
        target_date_override: "2026-05-20",
      }),
      ROUTE_PARAMS,
    );

    const [, , input] = mockAppend.mock.calls[0];
    expect(input.targetDateOverride).toBe("2026-05-20");
  });

  it("returns 409 with idempotent_replay status when service returns httpStatus=409", async () => {
    mockAppend.mockResolvedValue({
      exceptionId: "exc-existing",
      correlationId: "corr-existing",
      newEndDate: "2026-07-01",
      status: "idempotent_replay",
      httpStatus: 409,
    });

    const res = await POST(
      makeRequest({
        reason: "replay test",
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
// Body validation — 400 paths (reason required + idempotency_key required)
// -----------------------------------------------------------------------------

describe("POST /api/subscriptions/[id]/append-without-skip — body validation", () => {
  it("returns 400 when body is missing entirely", async () => {
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/append-without-skip endpoint requires a body/i);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("returns 400 when body is malformed JSON", async () => {
    const res = await POST(makeRequest(null), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is omitted (required field)", async () => {
    const res = await POST(
      makeRequest({ idempotency_key: IDEMPOTENCY_KEY }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is an empty string", async () => {
    const res = await POST(
      makeRequest({ reason: "", idempotency_key: IDEMPOTENCY_KEY }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("returns 400 when idempotency_key is omitted (locked Zod contract per §6.5)", async () => {
    const res = await POST(
      makeRequest({ reason: "goodwill" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/idempotency_key/i);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("returns 400 when idempotency_key is not a uuid", async () => {
    const res = await POST(
      makeRequest({ reason: "goodwill", idempotency_key: "not-a-uuid" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it("returns 400 when route id is not a uuid", async () => {
    const res = await POST(
      makeRequest({ reason: "goodwill", idempotency_key: IDEMPOTENCY_KEY }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockAppend).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Service-layer error → HTTP status mapping
// -----------------------------------------------------------------------------

describe("POST /api/subscriptions/[id]/append-without-skip — service error → HTTP mapping", () => {
  const validBody = () => ({ reason: "goodwill", idempotency_key: IDEMPOTENCY_KEY });

  it("ForbiddenError (lacks subscription:override_skip_rules) → 403", async () => {
    mockAppend.mockRejectedValue(
      new ForbiddenError("permission denied: subscription:override_skip_rules"),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("NotFoundError → 404", async () => {
    mockAppend.mockRejectedValue(new NotFoundError(`subscription not found: ${SUBSCRIPTION_ID}`));
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(404);
  });

  it("ConflictError → 409", async () => {
    mockAppend.mockRejectedValue(
      new ConflictError("subscription must be active to append; current status is 'paused'"),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(409);
  });

  it("ValidationError → 400", async () => {
    mockAppend.mockRejectedValue(new ValidationError("targetDateOverride is not eligible"));
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(400);
  });

  it("re-throws unknown errors", async () => {
    mockAppend.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makeRequest(validBody()), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
