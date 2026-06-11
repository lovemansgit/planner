// Unit tests for /api/consignees/[id]/crm-state — Day-16 Block 4-F
// Commit 3.
//
// Pins:
//   - POST verb (per merged plan §6.1 row 7 + brief §3.1.9 + §D
//     ruling — state-transition action with side effects)
//   - Body shape (snake_case wire `to_state` → camelCase service
//     `toState`; reason is required non-empty)
//   - Permission gate at the service layer (consignee:change_crm_state)
//   - Status 200 for both 'updated' and 'no_op' (state-transition
//     semantic)
//   - Service C maps BOTH reactivation_keyword_required AND
//     invalid_transition to ConflictError per service.ts:437-444
//     (pre-flight WATCH 1 verified) — both → 409 at the route
//   - 6 enum spelling exact-match (pre-flight WATCH 2 verified)
//   - Error mapping: ValidationError → 400, ForbiddenError → 403,
//     NotFoundError → 404, ConflictError → 409, unknown rethrown

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// vi.hoisted ensures these vi.fn() refs are initialized BEFORE the
// vi.mock factories run — see skip/tests/route.spec.ts header for
// the TDZ trap details.
const { mockChangeCrmState, mockBuildCtx } = vi.hoisted(() => ({
  mockChangeCrmState: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/consignees", () => ({
  changeConsigneeCrmState: vi.fn((ctx: unknown, id: unknown, input: unknown) =>
    mockChangeCrmState(ctx, id, input),
  ),
}));

vi.mock("@/shared/request-context", () => ({
  buildRequestContext: vi.fn((path: string, requestId: string) =>
    mockBuildCtx(path, requestId),
  ),
}));

import { ConflictError, ForbiddenError, NotFoundError } from "@/shared/errors";

import { POST } from "../route";

// v4-shaped UUIDs — Zod 4's .uuid() rejects all-zeros placeholders.
const CONSIGNEE_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID = "00000000-0000-0000-0000-000000000aaa";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";
const EVENT_ID = "aaaaaaaa-1111-4222-8333-444444444444";

function fakeCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(["consignee:change_crm_state"]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: `/api/consignees/${CONSIGNEE_ID}/crm-state`,
  };
}

function makeRequest(body: unknown | null | undefined): Request {
  const url = `http://localhost/api/consignees/${CONSIGNEE_ID}/crm-state`;
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

const ROUTE_PARAMS = { params: Promise.resolve({ id: CONSIGNEE_ID }) };

beforeEach(() => {
  mockChangeCrmState.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/consignees/[id]/crm-state — happy paths", () => {
  it("default transition (ACTIVE → ON_HOLD) → 200 'updated' with snake-to-camel mapping", async () => {
    mockChangeCrmState.mockResolvedValue({
      status: "updated",
      consigneeId: CONSIGNEE_ID,
      fromState: "ACTIVE",
      toState: "ON_HOLD",
      eventId: EVENT_ID,
    });

    const res = await POST(
      makeRequest({
        to_state: "ON_HOLD",
        reason: "consignee on holiday for the week",
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("updated");
    expect(body.fromState).toBe("ACTIVE");
    expect(body.toState).toBe("ON_HOLD");
    expect(body.eventId).toBe(EVENT_ID);

    expect(mockChangeCrmState).toHaveBeenCalledOnce();
    const [ctx, id, input] = mockChangeCrmState.mock.calls[0];
    expect(id).toBe(CONSIGNEE_ID);
    // Wire-to-service mapping: snake_case to_state → camelCase toState.
    expect(input).toEqual({
      toState: "ON_HOLD",
      reason: "consignee on holiday for the week",
    });
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      `/api/consignees/${CONSIGNEE_ID}/crm-state`,
      expect.any(String),
    );
  });

  it("CHURNED → ACTIVE with 'reactivation' keyword in reason → 200 'updated' (locks §10.4 happy path)", async () => {
    // The keyword guard is enforced inside Service C via
    // transitions.ts:canTransition. The route forwards the reason
    // string verbatim; the service's keyword test is case-insensitive
    // substring per §10.4. This test pins the happy path: when the
    // keyword IS present, the route succeeds (no rejection at route
    // boundary on this content).
    mockChangeCrmState.mockResolvedValue({
      status: "updated",
      consigneeId: CONSIGNEE_ID,
      fromState: "CHURNED",
      toState: "ACTIVE",
      eventId: EVENT_ID,
    });

    const res = await POST(
      makeRequest({
        to_state: "ACTIVE",
        reason: "Customer reached out; manual reactivation approved by tenant admin",
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("updated");
    expect(body.fromState).toBe("CHURNED");
    expect(body.toState).toBe("ACTIVE");
    // The reason is forwarded to the service verbatim; keyword check
    // is the service's responsibility, not the route's.
    expect(mockChangeCrmState.mock.calls[0][2].reason).toMatch(/reactivation/i);
  });

  it("no_op replay (current state === to_state) → 200 'no_op' (no eventId)", async () => {
    mockChangeCrmState.mockResolvedValue({
      status: "no_op",
      consigneeId: CONSIGNEE_ID,
      fromState: "ON_HOLD",
      toState: "ON_HOLD",
    });

    const res = await POST(
      makeRequest({
        to_state: "ON_HOLD",
        reason: "redundant call after operator double-tap",
      }),
      ROUTE_PARAMS,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("no_op");
    expect(body.eventId).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Body validation — 400 paths
// -----------------------------------------------------------------------------

describe("POST /api/consignees/[id]/crm-state — body validation", () => {
  it("returns 400 when body is missing entirely", async () => {
    const res = await POST(makeRequest(undefined), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/crm-state endpoint requires a body/i);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });

  it("returns 400 when body is malformed JSON", async () => {
    const res = await POST(makeRequest(null), ROUTE_PARAMS);
    expect(res.status).toBe(400);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });

  it("returns 400 when to_state is missing", async () => {
    const res = await POST(
      makeRequest({ reason: "operator note" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is missing", async () => {
    const res = await POST(
      makeRequest({ to_state: "ON_HOLD" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is empty string", async () => {
    const res = await POST(
      makeRequest({ to_state: "ON_HOLD", reason: "" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });

  it("returns 400 when to_state is not a member of the 6-enum", async () => {
    const res = await POST(
      makeRequest({ to_state: "PENDING", reason: "operator note" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });

  it("returns 400 when to_state has wrong casing (e.g., 'active' lowercase)", async () => {
    // Brief §3.1.1 + migration 0016 CHECK uses UPPERCASE only.
    // Lowercase 'active' is a different enum (tenants.status); mixing
    // would silently corrupt the matrix gate. Locked at route boundary.
    const res = await POST(
      makeRequest({ to_state: "active", reason: "operator note" }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when route id is not a uuid", async () => {
    const res = await POST(
      makeRequest({ to_state: "ON_HOLD", reason: "operator note" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/id must be a uuid/i);
    expect(mockChangeCrmState).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Service-layer error → HTTP status mapping
// -----------------------------------------------------------------------------

describe("POST /api/consignees/[id]/crm-state — service error → HTTP mapping", () => {
  const validBody = () => ({
    to_state: "ON_HOLD",
    reason: "operator note",
  });

  it("ForbiddenError (lacks consignee:change_crm_state) → 403", async () => {
    mockChangeCrmState.mockRejectedValue(
      new ForbiddenError("permission denied: consignee:change_crm_state"),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("NotFoundError (consignee doesn't exist) → 404", async () => {
    mockChangeCrmState.mockRejectedValue(
      new NotFoundError(`consignee not found: ${CONSIGNEE_ID}`),
    );
    const res = await POST(makeRequest(validBody()), ROUTE_PARAMS);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("ConflictError (invalid_transition — e.g., SUBSCRIPTION_ENDED → ACTIVE) → 409", async () => {
    // SUBSCRIPTION_ENDED is terminal per Service C transitions.ts.
    // The errorCode is invalid_transition; service maps to ConflictError.
    mockChangeCrmState.mockRejectedValue(
      new ConflictError(
        "CRM state transition not allowed: SUBSCRIPTION_ENDED → ACTIVE",
      ),
    );
    const res = await POST(
      makeRequest({
        to_state: "ACTIVE",
        reason: "operator wants to revive",
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("ConflictError (reactivation_keyword_required — CHURNED → ACTIVE without keyword) → 409 (LOCKED §10.4)", async () => {
    // WATCH 1 from pre-flight: Service C maps BOTH
    // reactivation_keyword_required AND invalid_transition to
    // ConflictError per service.ts:437-444. This test pins the
    // route's 409 mapping for the keyword-guard variant — anyone
    // changing Service C to ValidationError here breaks both this
    // test and the Service C unit tests, in that order.
    mockChangeCrmState.mockRejectedValue(
      new ConflictError(
        "CHURNED → ACTIVE requires 'reactivation' keyword in reason",
      ),
    );
    const res = await POST(
      makeRequest({
        to_state: "ACTIVE",
        reason: "won them back",
      }),
      ROUTE_PARAMS,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toMatch(/reactivation/i);
  });

  it("re-throws unknown errors so the framework's 500 handler renders", async () => {
    mockChangeCrmState.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makeRequest(validBody()), ROUTE_PARAMS)).rejects.toThrow(/DB connection lost/);
  });
});
