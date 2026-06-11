// Unit tests for /api/subscriptions/[id]/address-rotation — Day-16
// Block 4-F Commit 2.
//
// Pins:
//   - PATCH verb (full-replace mutation, not resource creation)
//   - Body shape (snake_case wire address_id → camelCase service addressId;
//     rotation field name unchanged at boundary)
//   - Empty rotation array IS valid (full-delete semantic per Service E §B)
//   - Permission gate happens at the service layer (subscription:change_address_rotation)
//   - Status code 200 for both 'updated' and 'no_op' (PATCH semantic)
//   - Error mapping per errorResponse: ValidationError → 400 (incl
//     cross-consignee per shipped-reality §C); ForbiddenError → 403;
//     NotFoundError → 404; ConflictError → 409

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// vi.hoisted ensures these vi.fn() refs are initialized BEFORE the
// vi.mock factories run — see skip/tests/route.spec.ts header for
// the TDZ trap details. Same pattern across all route specs.
const { mockChangeRotation, mockBuildCtx } = vi.hoisted(() => ({
  mockChangeRotation: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/subscription-addresses", () => ({
  changeAddressRotation: vi.fn((ctx: unknown, id: unknown, input: unknown) =>
    mockChangeRotation(ctx, id, input),
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

import { PATCH } from "../route";

// v4-shaped UUIDs — Zod 4's .uuid() rejects all-zeros placeholders.
// See skip/tests/route.spec.ts header for full reasoning.
const SUBSCRIPTION_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "00000000-0000-0000-0000-000000000aaa";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";
const ADDR_HOME = "aaaaaaaa-1111-4222-8333-444444444444";
const ADDR_OFFICE = "aaaaaaaa-1111-4222-8333-555555555555";

function fakeCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(["subscription:change_address_rotation"]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/subscriptions/${SUBSCRIPTION_ID}/address-rotation`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/subscriptions/${SUBSCRIPTION_ID}/address-rotation`;
  const init: RequestInit = { method: "PATCH", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

const ROUTE_PARAMS = { params: Promise.resolve({ id: SUBSCRIPTION_ID }) };

beforeEach(() => {
  mockChangeRotation.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/subscriptions/[id]/address-rotation — happy paths", () => {
  it("maps single-weekday body to service input + returns 200 status='updated'", async () => {
    mockChangeRotation.mockResolvedValue({
      status: "updated",
      subscriptionId: SUBSCRIPTION_ID,
      rotation: [{ weekday: 1, addressId: ADDR_HOME }],
    });

    const res = await PATCH(
      makeRequest({
        rotation: [{ weekday: 1, address_id: ADDR_HOME }],
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("updated");
    expect(body.rotation).toEqual([{ weekday: 1, addressId: ADDR_HOME }]);

    expect(mockChangeRotation).toHaveBeenCalledOnce();
    const [ctx, id, input] = mockChangeRotation.mock.calls[0];
    expect(id).toBe(SUBSCRIPTION_ID);
    expect(input).toEqual({
      rotation: [{ weekday: 1, addressId: ADDR_HOME }],
    });
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/subscriptions/${SUBSCRIPTION_ID}/address-rotation`,
      expect.any(String),
    );
  });

  it("forwards multi-weekday rotation, mapping snake_case address_id → camelCase addressId", async () => {
    mockChangeRotation.mockResolvedValue({
      status: "updated",
      subscriptionId: SUBSCRIPTION_ID,
      rotation: [
        { weekday: 1, addressId: ADDR_HOME },
        { weekday: 3, addressId: ADDR_OFFICE },
        { weekday: 5, addressId: ADDR_HOME },
      ],
    });

    await PATCH(
      makeRequest({
        rotation: [
          { weekday: 1, address_id: ADDR_HOME },
          { weekday: 3, address_id: ADDR_OFFICE },
          { weekday: 5, address_id: ADDR_HOME },
        ],
      }),
      ROUTE_PARAMS,
    );

    const [, , input] = mockChangeRotation.mock.calls[0];
    expect(input.rotation).toEqual([
      { weekday: 1, addressId: ADDR_HOME },
      { weekday: 3, addressId: ADDR_OFFICE },
      { weekday: 5, addressId: ADDR_HOME },
    ]);
  });

  it("accepts empty rotation array → 200 status='updated' (full-delete semantic per Service E §B)", async () => {
    // WATCH 3: empty rotation is the full-delete signal. If a future
    // PR adds .min(1) to the route Zod schema, this test fails loud.
    mockChangeRotation.mockResolvedValue({
      status: "updated",
      subscriptionId: SUBSCRIPTION_ID,
      rotation: [],
    });

    const res = await PATCH(makeRequest({ rotation: [] }), ROUTE_PARAMS);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rotation).toEqual([]);
    expect(mockChangeRotation).toHaveBeenCalledOnce();
    expect(mockChangeRotation.mock.calls[0][2]).toEqual({ rotation: [] });
  });

  it("returns 200 status='no_op' when service detects byte-for-byte match", async () => {
    mockChangeRotation.mockResolvedValue({
      status: "no_op",
      subscriptionId: SUBSCRIPTION_ID,
      rotation: [{ weekday: 1, addressId: ADDR_HOME }],
    });

    const res = await PATCH(
      makeRequest({ rotation: [{ weekday: 1, address_id: ADDR_HOME }] }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no_op");
  });
});

// -----------------------------------------------------------------------------
// Body validation — 400 paths
// -----------------------------------------------------------------------------

describe("PATCH /api/subscriptions/[id]/address-rotation — body validation", () => {
  it("returns 400 when body is missing entirely", async () => {
    const res = await PATCH(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/address-rotation endpoint requires a body/i);
    expect(mockChangeRotation).not.toHaveBeenCalled();
  });

  it("returns 400 when body is malformed JSON", async () => {
    const res = await PATCH(makeRequest(null), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockChangeRotation).not.toHaveBeenCalled();
  });

  it("returns 400 when rotation field is missing", async () => {
    const res = await PATCH(makeRequest({}), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockChangeRotation).not.toHaveBeenCalled();
  });

  it("returns 400 when rotation is not an array", async () => {
    const res = await PATCH(
      makeRequest({ rotation: "not-an-array" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockChangeRotation).not.toHaveBeenCalled();
  });

  it("returns 400 when weekday is below range (0)", async () => {
    const res = await PATCH(
      makeRequest({ rotation: [{ weekday: 0, address_id: ADDR_HOME }] }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when weekday is above range (8)", async () => {
    const res = await PATCH(
      makeRequest({ rotation: [{ weekday: 8, address_id: ADDR_HOME }] }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when weekday is not an integer", async () => {
    const res = await PATCH(
      makeRequest({ rotation: [{ weekday: 1.5, address_id: ADDR_HOME }] }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when address_id is not a uuid", async () => {
    const res = await PATCH(
      makeRequest({ rotation: [{ weekday: 1, address_id: "not-a-uuid" }] }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when route id is not a uuid", async () => {
    const res = await PATCH(
      makeRequest({ rotation: [] }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockChangeRotation).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Service-layer error → HTTP status mapping
// -----------------------------------------------------------------------------

describe("PATCH /api/subscriptions/[id]/address-rotation — service error → HTTP mapping", () => {
  const validBody = () => ({
    rotation: [{ weekday: 1, address_id: ADDR_HOME }],
  });

  it("ForbiddenError → 403", async () => {
    mockChangeRotation.mockRejectedValue(
      new ForbiddenError("permission denied: subscription:change_address_rotation"),
    );
    const res = await PATCH(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(403);
  });

  it("NotFoundError → 404 (subscription doesn't exist)", async () => {
    mockChangeRotation.mockRejectedValue(
      new NotFoundError(`subscription not found: ${SUBSCRIPTION_ID}`),
    );
    const res = await PATCH(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(404);
  });

  it("ConflictError → 409 (subscription paused or ended)", async () => {
    mockChangeRotation.mockRejectedValue(
      new ConflictError(
        "subscription must be active to change address rotation; current status is 'paused'",
      ),
    );
    const res = await PATCH(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(409);
  });

  it("ValidationError (cross-consignee address ownership) → 400", async () => {
    // Service E §B B1 maps cross-consignee to ValidationError per
    // shipped semantic; route surface unchanged. Locks Block 4-F §C
    // followup ruling that cut-off + ownership use 400, not 422.
    mockChangeRotation.mockRejectedValue(
      new ValidationError(
        `address_not_found_for_consignee: address ${ADDR_HOME} does not belong to consignee X (weekday 1)`,
      ),
    );
    const res = await PATCH(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/address_not_found_for_consignee/);
  });

  it("re-throws unknown errors so the framework's 500 handler renders", async () => {
    mockChangeRotation.mockRejectedValue(new Error("DB connection lost"));
    await expect(PATCH(makeRequest(validBody()), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
