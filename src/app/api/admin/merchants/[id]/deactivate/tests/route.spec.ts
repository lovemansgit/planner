// Unit tests for /api/admin/merchants/[id]/deactivate — Day-16 Block 4-F
// Commit 4.
//
// Pins:
//   - POST verb (state-transition; mirrors activate route)
//   - Body-less endpoint via rejectAnyBody pattern
//   - Status 200 on deactivation; DeactivateMerchantResult passthrough
//   - Permission gate at the service layer (merchant:deactivate)
//   - PLAN-STRICT state machine LOCKED — only active → inactive is
//     allowed. Test pins all 3 disallowed from-states (provisioning,
//     suspended, inactive) → 409.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockDeactivateMerchant, mockBuildCtx } = vi.hoisted(() => ({
  mockDeactivateMerchant: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/merchants", () => ({
  deactivateMerchant: vi.fn((ctx: unknown, id: unknown) =>
    mockDeactivateMerchant(ctx, id),
  ),
}));

vi.mock("@/shared/request-context", () => ({
  buildRequestContext: vi.fn((path: string, requestId: string) =>
    mockBuildCtx(path, requestId),
  ),
}));

import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";

import { POST } from "../route";

const TENANT_ID = "11111111-2222-4333-8444-555555555555";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";

function fakeStaffCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(["merchant:deactivate"]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/admin/merchants/${TENANT_ID}/deactivate`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/admin/merchants/${TENANT_ID}/deactivate`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

const ROUTE_PARAMS = { params: Promise.resolve({ id: TENANT_ID }) };

beforeEach(() => {
  mockDeactivateMerchant.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeStaffCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/merchants/[id]/deactivate — happy paths", () => {
  it("active → inactive → 200 'deactivated' with literal previous/new statuses", async () => {
    mockDeactivateMerchant.mockResolvedValue({
      status: "deactivated",
      tenantId: TENANT_ID,
      previousStatus: "active",
      newStatus: "inactive",
    });

    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "deactivated",
      tenantId: TENANT_ID,
      previousStatus: "active",
      newStatus: "inactive",
    });

    expect(mockDeactivateMerchant).toHaveBeenCalledOnce();
    const [ctx, id] = mockDeactivateMerchant.mock.calls[0];
    expect(id).toBe(TENANT_ID);
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/admin/merchants/${TENANT_ID}/deactivate`,
      expect.any(String),
    );
  });

  it("accepts empty `{}` body", async () => {
    mockDeactivateMerchant.mockResolvedValue({
      status: "deactivated",
      tenantId: TENANT_ID,
      previousStatus: "active",
      newStatus: "inactive",
    });
    const res = await POST(makeRequest({}), ROUTE_PARAMS);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/merchants/[id]/deactivate — body / id validation", () => {
  it("returns 400 when route id is not a uuid", async () => {
    const res = await POST(
      makeRequest(undefined),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockDeactivateMerchant).not.toHaveBeenCalled();
  });

  it("returns 400 when body has unexpected fields", async () => {
    const res = await POST(
      makeRequest({ unexpected: "field" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/deactivate endpoint takes no body/i);
    expect(mockDeactivateMerchant).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/merchants/[id]/deactivate — service error → HTTP mapping (PLAN-STRICT lock)", () => {
  it("ForbiddenError (lacks merchant:deactivate) → 403", async () => {
    mockDeactivateMerchant.mockRejectedValue(
      new ForbiddenError("permission denied: merchant:deactivate"),
    );
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(403);
  });

  it("NotFoundError → 404", async () => {
    mockDeactivateMerchant.mockRejectedValue(
      new NotFoundError(`merchant not found: ${TENANT_ID}`),
    );
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(404);
  });

  // Phase 2 lock: each disallowed from-state explicit.
  for (const fromState of ["provisioning", "suspended", "inactive"] as const) {
    it(`ConflictError (status='${fromState}' rejected by plan-strict matrix) → 409`, async () => {
      mockDeactivateMerchant.mockRejectedValue(
        new ConflictError(
          `merchant.status must be 'active' to deactivate; current status is '${fromState}'`,
        ),
      );
      const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toMatch(new RegExp(`current status is '${fromState}'`));
    });
  }

  it("re-throws unknown errors", async () => {
    mockDeactivateMerchant.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makeRequest(undefined), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
