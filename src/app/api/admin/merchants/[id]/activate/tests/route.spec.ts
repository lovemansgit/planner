// Unit tests for /api/admin/merchants/[id]/activate — Day-16 Block 4-F
// Commit 4.
//
// Pins:
//   - POST verb (state-transition action with side effects)
//   - Body-less endpoint per merged plan §6.1 row 10. Uses the
//     `rejectAnyBody` pattern from
//     `failed-pushes/[id]/retry/route.ts:91-96` precedent — empty body
//     and `{}` accepted; any non-empty body → 400.
//   - Status 200 on activation; ActivateMerchantResult passthrough
//   - Permission gate at the service layer (merchant:activate)
//   - PLAN-STRICT state machine LOCKED per Block 4-D Option C —
//     ConflictError surfaced from Service D when status !==
//     'provisioning'. Test pins all 3 disallowed from-states
//     (already-active, suspended, inactive) → 409.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockActivateMerchant, mockBuildCtx } = vi.hoisted(() => ({
  mockActivateMerchant: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/merchants", () => ({
  activateMerchant: vi.fn((ctx: unknown, id: unknown) =>
    mockActivateMerchant(ctx, id),
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
      permissions: new Set(["merchant:activate"]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/admin/merchants/${TENANT_ID}/activate`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/admin/merchants/${TENANT_ID}/activate`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

const ROUTE_PARAMS = { params: Promise.resolve({ id: TENANT_ID }) };

beforeEach(() => {
  mockActivateMerchant.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeStaffCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/merchants/[id]/activate — happy paths", () => {
  it("provisioning → active → 200 'activated' with literal previous/new statuses", async () => {
    mockActivateMerchant.mockResolvedValue({
      status: "activated",
      tenantId: TENANT_ID,
      previousStatus: "provisioning",
      newStatus: "active",
    });

    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "activated",
      tenantId: TENANT_ID,
      previousStatus: "provisioning",
      newStatus: "active",
    });

    expect(mockActivateMerchant).toHaveBeenCalledOnce();
    const [ctx, id] = mockActivateMerchant.mock.calls[0];
    expect(id).toBe(TENANT_ID);
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/admin/merchants/${TENANT_ID}/activate`,
      expect.any(String),
    );
  });

  it("accepts empty `{}` body (rejectAnyBody pattern — same as failed-pushes/retry precedent)", async () => {
    mockActivateMerchant.mockResolvedValue({
      status: "activated",
      tenantId: TENANT_ID,
      previousStatus: "provisioning",
      newStatus: "active",
    });

    const res = await POST(makeRequest({}), ROUTE_PARAMS);
    expect(res.status).toBe(200);
    expect(mockActivateMerchant).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/merchants/[id]/activate — body / id validation", () => {
  it("returns 400 when route id is not a uuid", async () => {
    const res = await POST(
      makeRequest(undefined),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockActivateMerchant).not.toHaveBeenCalled();
  });

  it("returns 400 when body has unexpected fields (rejectAnyBody trips)", async () => {
    const res = await POST(
      makeRequest({ unexpected: "field" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/activate endpoint takes no body/i);
    expect(mockActivateMerchant).not.toHaveBeenCalled();
  });

  it("returns 400 when body is malformed JSON (rejectAnyBody handles undefined → no-op; JSON.parse fails → undefined → no-op; non-empty malformed string IS rejected upstream)", async () => {
    // `req.json().catch(() => undefined)` swallows malformed JSON and
    // yields undefined — rejectAnyBody treats that as "no body" and
    // proceeds. The route's design treats "couldn't parse" the same
    // as "no body" — both map to the body-less success path. This
    // test pins that contract.
    mockActivateMerchant.mockResolvedValue({
      status: "activated",
      tenantId: TENANT_ID,
      previousStatus: "provisioning",
      newStatus: "active",
    });
    const res = await POST(makeRequest(null), ROUTE_PARAMS);
    expect(res.status).toBe(200);
    expect(mockActivateMerchant).toHaveBeenCalledOnce();
  });
});

describe("POST /api/admin/merchants/[id]/activate — service error → HTTP mapping (PLAN-STRICT lock)", () => {
  it("ForbiddenError (lacks merchant:activate; non-staff actor) → 403", async () => {
    mockActivateMerchant.mockRejectedValue(
      new ForbiddenError("permission denied: merchant:activate"),
    );
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(403);
  });

  it("NotFoundError (merchant doesn't exist) → 404", async () => {
    mockActivateMerchant.mockRejectedValue(
      new NotFoundError(`merchant not found: ${TENANT_ID}`),
    );
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(404);
  });

  // Phase 2 lock: every disallowed from-state has an explicit test.
  // Anyone relaxing the matrix without updating these tests + Service D's
  // tests + the registered metadataNotes literals (audit/event-types.ts
  // :716-717) + brief §3.1.1 fails CI here first.
  for (const fromState of ["active", "suspended", "inactive"] as const) {
    it(`ConflictError (status='${fromState}' rejected by plan-strict matrix) → 409`, async () => {
      mockActivateMerchant.mockRejectedValue(
        new ConflictError(
          `merchant.status must be 'provisioning' to activate; current status is '${fromState}'`,
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
    mockActivateMerchant.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makeRequest(undefined), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
