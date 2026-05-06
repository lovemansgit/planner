// Unit tests for /api/admin/merchants — POST + GET — Day-16 Block 4-F
// Commit 4.
//
// Pins:
//   - POST: snake_case wire `pickup_address` → camelCase service
//     `pickupAddress` (nested per Block 4-D §A Option C); 201 status
//     for resource creation
//   - GET: ?status= query param (status-only filter per Service D
//     ListMerchantsFilters; reviewer prompt mentioned slug filter
//     but Service D types declare status only — registered source wins)
//   - Permission gate at the service layer via Service D's
//     requirePermission(merchant:* perms). The route does NOT pre-gate.
//   - §A Option A non-staff actor lock: explicit pin that a non-
//     transcorp_staff actor reaching the route gets 403 via the
//     service-layer-only path. Anyone adding route-level role checks
//     (well-intentioned defense-in-depth that would create a
//     duplicate gate prone to drift) breaks this test.
//   - Slug UNIQUE collision → ConflictError 409 (Service D maps 23505)
//   - Error mapping per errorResponse: ValidationError → 400,
//     ForbiddenError → 403, NotFoundError → 404, ConflictError → 409

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mockCreateMerchant, mockListMerchants, mockBuildCtx } = vi.hoisted(() => ({
  mockCreateMerchant: vi.fn(),
  mockListMerchants: vi.fn(),
  mockBuildCtx: vi.fn(),
}));

vi.mock("@/modules/merchants", () => ({
  createMerchant: vi.fn((ctx: unknown, input: unknown) =>
    mockCreateMerchant(ctx, input),
  ),
  listMerchants: vi.fn((ctx: unknown, filters: unknown) =>
    mockListMerchants(ctx, filters),
  ),
}));

vi.mock("@/shared/request-context", () => ({
  buildRequestContext: vi.fn((path: string, requestId: string) =>
    mockBuildCtx(path, requestId),
  ),
}));

import { ConflictError, ForbiddenError, ValidationError } from "@/shared/errors";

import { GET, POST } from "../route";

// v4-shaped UUIDs — Zod 4's .uuid() rejects all-zeros placeholders.
const TENANT_ID = "11111111-2222-4333-8444-555555555555";
const ACTOR_USER_ID = "00000000-0000-0000-0000-000000000ccc";

function fakeStaffCtx() {
  return {
    actor: {
      kind: "user" as const,
      userId: ACTOR_USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set([
        "merchant:create",
        "merchant:read_all",
        "merchant:activate",
        "merchant:deactivate",
      ]),
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: "/api/admin/merchants",
  };
}

function makePostRequest(body: unknown | null | undefined): Request {
  const url = "http://localhost/api/admin/merchants";
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json" } };
  if (body !== undefined) {
    init.body = body === null ? "not-json" : JSON.stringify(body);
  }
  return new Request(url, init);
}

function makeGetRequest(query?: string): Request {
  const url = query ? `http://localhost/api/admin/merchants?${query}` : "http://localhost/api/admin/merchants";
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  mockCreateMerchant.mockReset();
  mockListMerchants.mockReset();
  mockBuildCtx.mockReset();
  mockBuildCtx.mockResolvedValue(fakeStaffCtx());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// POST /api/admin/merchants — happy paths
// =============================================================================

describe("POST /api/admin/merchants — happy paths", () => {
  const validBody = () => ({
    slug: "demo-bistro",
    name: "Demo Bistro",
    pickup_address: {
      line: "Building 1, Al Quoz",
      district: "Al Quoz Industrial 1",
      emirate: "Dubai",
    },
  });

  it("maps snake_case pickup_address → camelCase pickupAddress; returns 201 + tenantId", async () => {
    mockCreateMerchant.mockResolvedValue({
      status: "created",
      tenantId: TENANT_ID,
    });

    const res = await POST(makePostRequest(validBody()));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ status: "created", tenantId: TENANT_ID });

    expect(mockCreateMerchant).toHaveBeenCalledOnce();
    const [ctx, input] = mockCreateMerchant.mock.calls[0];
    expect(input).toEqual({
      slug: "demo-bistro",
      name: "Demo Bistro",
      pickupAddress: {
        line: "Building 1, Al Quoz",
        district: "Al Quoz Industrial 1",
        emirate: "Dubai",
      },
    });
    expect(ctx.requestId).toBe("req-test");

    expect(mockBuildCtx).toHaveBeenCalledWith(
      "/api/admin/merchants",
      expect.any(String),
    );
  });
});

// =============================================================================
// POST /api/admin/merchants — body validation (400 paths)
// =============================================================================

describe("POST /api/admin/merchants — body validation", () => {
  it("returns 400 when body is missing entirely", async () => {
    const res = await POST(makePostRequest(undefined));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/merchants endpoint requires a body/i);
    expect(mockCreateMerchant).not.toHaveBeenCalled();
  });

  it("returns 400 when body is malformed JSON", async () => {
    const res = await POST(makePostRequest(null));
    expect(res.status).toBe(400);
    expect(mockCreateMerchant).not.toHaveBeenCalled();
  });

  it("returns 400 when slug is missing", async () => {
    const res = await POST(
      makePostRequest({
        name: "X",
        pickup_address: { line: "a", district: "b", emirate: "c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when slug is empty string", async () => {
    const res = await POST(
      makePostRequest({
        slug: "",
        name: "X",
        pickup_address: { line: "a", district: "b", emirate: "c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(
      makePostRequest({
        slug: "x",
        pickup_address: { line: "a", district: "b", emirate: "c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await POST(
      makePostRequest({
        slug: "x",
        name: "",
        pickup_address: { line: "a", district: "b", emirate: "c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when pickup_address is missing", async () => {
    const res = await POST(makePostRequest({ slug: "x", name: "X" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when pickup_address.line is missing", async () => {
    const res = await POST(
      makePostRequest({
        slug: "x",
        name: "X",
        pickup_address: { district: "b", emirate: "c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when pickup_address.district is empty", async () => {
    const res = await POST(
      makePostRequest({
        slug: "x",
        name: "X",
        pickup_address: { line: "a", district: "", emirate: "c" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when pickup_address.emirate is missing", async () => {
    const res = await POST(
      makePostRequest({
        slug: "x",
        name: "X",
        pickup_address: { line: "a", district: "b" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /api/admin/merchants — service error → HTTP mapping
// =============================================================================

describe("POST /api/admin/merchants — service error → HTTP mapping", () => {
  const validBody = () => ({
    slug: "demo-bistro",
    name: "Demo Bistro",
    pickup_address: { line: "a", district: "b", emirate: "c" },
  });

  it("§A Option A LOCK — non-staff actor blocked by service-layer requirePermission (no route-level role check)", async () => {
    // This test is the lock-in for the §A ruling:
    //   - Service D's requirePermission(merchant:create) is the ONLY gate.
    //   - The route does NOT pre-gate by checking ctx.actor.role or
    //     similar — it forwards to the service unconditionally.
    //   - A non-transcorp_staff actor reaches the service, fails the
    //     permission check, throws ForbiddenError, gets 403 via
    //     errorResponse.
    // Anyone adding a route-level role check in a future PR
    // (well-intentioned defense-in-depth that would create a
    // duplicate gate prone to drift) breaks this test by either:
    //   (a) Returning 403 BEFORE Service D is called → mockCreateMerchant
    //       not invoked → assertion fails; OR
    //   (b) Returning 403 with a different error code/message than
    //       Service D's → the assertion below fails.
    mockCreateMerchant.mockRejectedValue(
      new ForbiddenError("permission denied: merchant:create"),
    );

    const res = await POST(makePostRequest(validBody()));

    expect(res.status).toBe(403);
    expect(mockCreateMerchant).toHaveBeenCalledOnce();
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("ConflictError (slug UNIQUE collision via 23505 mapping) → 409", async () => {
    mockCreateMerchant.mockRejectedValue(
      new ConflictError("merchant slug already exists: demo-bistro"),
    );
    const res = await POST(makePostRequest(validBody()));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("ValidationError (Service D's slug regex / length rules) → 400", async () => {
    // Service D's requireValidSlug enforces lowercase + [a-z0-9-]+
    // + ≤60 chars. Route boundary's z.string().min(1) catches
    // missing/empty only; deeper rules surface from Service D.
    mockCreateMerchant.mockRejectedValue(
      new ValidationError(
        "slug must be lowercase-kebab '[a-z0-9-]' of length 1-60",
      ),
    );
    const res = await POST(makePostRequest(validBody()));
    expect(res.status).toBe(400);
  });

  it("re-throws unknown errors so the framework's 500 handler renders", async () => {
    mockCreateMerchant.mockRejectedValue(new Error("DB connection lost"));
    await expect(POST(makePostRequest(validBody()))).rejects.toThrow(/DB connection lost/);
  });
});

// =============================================================================
// GET /api/admin/merchants — happy paths
// =============================================================================

describe("GET /api/admin/merchants — happy paths", () => {
  it("no filters → 200 with { merchants: [] } (empty array passthrough)", async () => {
    mockListMerchants.mockResolvedValue([]);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ merchants: [] });
    expect(mockListMerchants).toHaveBeenCalledOnce();
    // Empty filter object passed when no query param.
    expect(mockListMerchants.mock.calls[0][1]).toEqual({});
  });

  it("returns nested pickupAddress in the JSON response (Block 4-D §A Option C lock)", async () => {
    mockListMerchants.mockResolvedValue([
      {
        tenantId: TENANT_ID,
        slug: "demo-bistro",
        name: "Demo Bistro",
        status: "active",
        pickupAddress: {
          line: "Building 1, Al Quoz",
          district: "Al Quoz Industrial 1",
          emirate: "Dubai",
        },
        createdAt: "2026-05-06T10:00:00.000Z",
        updatedAt: "2026-05-06T10:00:00.000Z",
      },
    ]);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.merchants).toHaveLength(1);
    // pickupAddress STAYS NESTED on the wire — JSON serialization
    // preserves the structure; route does NOT flatten.
    expect(body.merchants[0].pickupAddress).toEqual({
      line: "Building 1, Al Quoz",
      district: "Al Quoz Industrial 1",
      emirate: "Dubai",
    });
  });

  it("forwards ?status=active filter to Service D", async () => {
    mockListMerchants.mockResolvedValue([]);
    await GET(makeGetRequest("status=active"));
    expect(mockListMerchants.mock.calls[0][1]).toEqual({ status: "active" });
  });

  it("forwards ?status=provisioning filter", async () => {
    mockListMerchants.mockResolvedValue([]);
    await GET(makeGetRequest("status=provisioning"));
    expect(mockListMerchants.mock.calls[0][1]).toEqual({ status: "provisioning" });
  });

  it("forwards ?status=suspended filter", async () => {
    mockListMerchants.mockResolvedValue([]);
    await GET(makeGetRequest("status=suspended"));
    expect(mockListMerchants.mock.calls[0][1]).toEqual({ status: "suspended" });
  });

  it("forwards ?status=inactive filter", async () => {
    mockListMerchants.mockResolvedValue([]);
    await GET(makeGetRequest("status=inactive"));
    expect(mockListMerchants.mock.calls[0][1]).toEqual({ status: "inactive" });
  });

  it("treats empty ?status= as absent filter (no-op, not 400)", async () => {
    mockListMerchants.mockResolvedValue([]);
    await GET(makeGetRequest("status="));
    expect(mockListMerchants.mock.calls[0][1]).toEqual({});
  });

  it("ignores unknown query params (only ?status= is read; any others passed through unprocessed)", async () => {
    // ListMerchantsFilters declares status only per Service D types.ts:
    // 133-135. Reviewer prompt mentioned a slug filter; Service D
    // doesn't accept one. Route treats unknown query params as no-op
    // — they don't error, they don't get forwarded.
    mockListMerchants.mockResolvedValue([]);
    await GET(makeGetRequest("slug=demo&random=value"));
    expect(mockListMerchants.mock.calls[0][1]).toEqual({});
  });
});

// =============================================================================
// GET /api/admin/merchants — query validation
// =============================================================================

describe("GET /api/admin/merchants — query validation", () => {
  it("returns 400 ValidationError when ?status= is an invalid enum value", async () => {
    const res = await GET(makeGetRequest("status=PENDING"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.message).toMatch(/status query param invalid/i);
    expect(mockListMerchants).not.toHaveBeenCalled();
  });

  it("returns 400 when ?status= uses wrong casing (uppercase 'ACTIVE')", async () => {
    // tenants.status is lowercase per migration 0001 + brief §3.1.1.
    // Reject uppercase at the boundary to lock the convention.
    const res = await GET(makeGetRequest("status=ACTIVE"));
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// GET /api/admin/merchants — service error → HTTP mapping
// =============================================================================

describe("GET /api/admin/merchants — service error → HTTP mapping", () => {
  it("ForbiddenError (lacks merchant:read_all) → 403", async () => {
    mockListMerchants.mockRejectedValue(
      new ForbiddenError("permission denied: merchant:read_all"),
    );
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
  });

  it("re-throws unknown errors", async () => {
    mockListMerchants.mockRejectedValue(new Error("DB connection lost"));
    await expect(GET(makeGetRequest())).rejects.toThrow(/DB connection lost/);
  });
});
