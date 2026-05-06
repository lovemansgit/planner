// Service-layer unit tests — Service D.
//
// Mocks ../../../shared/db (withServiceRole) and ../../audit (emit) +
// the repository layer so we exercise permission, validation,
// state-machine, and audit-emit flow without real Postgres or audit
// infra.
//
// PLAN-STRICT state-machine coverage (per Block 4-D Option C ruling):
// every rejected from-state has its own explicit test cell. They're
// the lock-in for the Phase 2 expansion question — anyone expanding
// the matrix without updating these tests + audit/event-types.ts
// metadataNotes literals + brief §3.1.1 gets a CI failure.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  findMerchantForStatusUpdate: vi.fn(),
  insertMerchant: vi.fn(),
  listMerchants: vi.fn(),
  updateMerchantStatus: vi.fn(),
}));

import { withServiceRole } from "../../../shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import {
  findMerchantForStatusUpdate,
  insertMerchant,
  listMerchants as listMerchantsRows,
  updateMerchantStatus,
} from "../repository";
import {
  activateMerchant,
  createMerchant,
  deactivateMerchant,
  listMerchants,
} from "../service";
import type { Merchant } from "../types";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockFindForStatusUpdate = vi.mocked(findMerchantForStatusUpdate);
const mockInsert = vi.mocked(insertMerchant);
const mockListRows = vi.mocked(listMerchantsRows);
const mockUpdateStatus = vi.mocked(updateMerchantStatus);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const FIXED_NOW = "2026-05-06T10:00:00.000Z";

function ctx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      // Cross-tenant operation; ctx.tenantId is not used by Service D.
      // Use a sentinel uuid that satisfies the Actor.tenantId required
      // field (sysadmin actors carry their assigned tenant id).
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: "test-request",
    path: "/api/admin/merchants",
  };
}

function merchantFixture(overrides: Partial<Merchant> = {}): Merchant {
  return {
    tenantId: TENANT_ID,
    slug: "demo-bistro",
    name: "Demo Bistro",
    status: "provisioning",
    pickupAddress: {
      line: "Building 1, Al Quoz",
      district: "Al Quoz Industrial 1",
      emirate: "Dubai",
    },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockFindForStatusUpdate.mockReset();
  mockInsert.mockReset();
  mockListRows.mockReset();
  mockUpdateStatus.mockReset();
  // Default: withServiceRole runs its callback against an opaque tx
  // stub. Each test that needs specific repo behaviour sets it via
  // the repository mocks rather than through withServiceRole.
  mockWithServiceRole.mockImplementation(async (_reason, fn) => {
    return fn({} as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// createMerchant
// -----------------------------------------------------------------------------

describe("createMerchant", () => {
  const PERM = "merchant:create" as const;

  const validInput = {
    slug: "demo-bistro",
    name: "Demo Bistro",
    pickupAddress: {
      line: "Building 1, Al Quoz",
      district: "Al Quoz Industrial 1",
      emirate: "Dubai",
    },
  };

  it("throws ForbiddenError when actor lacks merchant:create", async () => {
    await expect(createMerchant(ctx([]), validInput)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError on empty name", async () => {
    await expect(
      createMerchant(ctx([PERM]), { ...validInput, name: "  " }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws ValidationError on empty slug", async () => {
    await expect(
      createMerchant(ctx([PERM]), { ...validInput, slug: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws ValidationError on slug with uppercase or invalid chars", async () => {
    await expect(
      createMerchant(ctx([PERM]), { ...validInput, slug: "Demo-Bistro" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createMerchant(ctx([PERM]), { ...validInput, slug: "demo_bistro" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createMerchant(ctx([PERM]), { ...validInput, slug: "demo bistro" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on slug longer than 60 chars", async () => {
    await expect(
      createMerchant(ctx([PERM]), { ...validInput, slug: "a".repeat(61) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when any pickup_address sub-field is empty", async () => {
    await expect(
      createMerchant(ctx([PERM]), {
        ...validInput,
        pickupAddress: { line: "  ", district: "x", emirate: "Dubai" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createMerchant(ctx([PERM]), {
        ...validInput,
        pickupAddress: { line: "x", district: "", emirate: "Dubai" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createMerchant(ctx([PERM]), {
        ...validInput,
        pickupAddress: { line: "x", district: "y", emirate: "  " },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("inserts and emits merchant.created with NESTED pickup_address per Option C audit body shape", async () => {
    mockInsert.mockResolvedValue(merchantFixture());

    const result = await createMerchant(ctx([PERM]), validInput);

    expect(result).toEqual({ status: "created", tenantId: TENANT_ID });
    expect(mockInsert).toHaveBeenCalledOnce();

    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("merchant.created");
    expect(emitArg.tenantId).toBeNull();
    expect(emitArg.resourceType).toBe("merchant");
    expect(emitArg.resourceId).toBe(TENANT_ID);
    // Critical: nested pickup_address shape per Block 4-D Gate 4
    // Option C ruling. Plan §2.1 + Gate 4 mixed-flat is drift; the
    // registered metadataNotes is the contract.
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      slug: "demo-bistro",
      name: "Demo Bistro",
      pickup_address: {
        line: "Building 1, Al Quoz",
        district: "Al Quoz Industrial 1",
        emirate: "Dubai",
      },
    });
  });

  it("maps SQLSTATE 23505 unique-violation to ConflictError; no audit emitted", async () => {
    const err = new Error("duplicate key value violates unique constraint") as Error & {
      code?: string;
    };
    err.code = "23505";
    mockInsert.mockRejectedValue(err);

    await expect(createMerchant(ctx([PERM]), validInput)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("propagates a non-23505 error from insertMerchant unchanged", async () => {
    const err = new Error("connection lost");
    mockInsert.mockRejectedValue(err);

    await expect(createMerchant(ctx([PERM]), validInput)).rejects.toThrow(
      /connection lost/,
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("trims input strings before insert + audit", async () => {
    mockInsert.mockResolvedValue(merchantFixture());
    await createMerchant(ctx([PERM]), {
      slug: "  demo-bistro  ",
      name: "   Demo Bistro   ",
      pickupAddress: {
        line: "  Building 1  ",
        district: "  Al Quoz  ",
        emirate: "  Dubai  ",
      },
    });
    const insertArg = mockInsert.mock.calls[0][1];
    expect(insertArg.slug).toBe("demo-bistro");
    expect(insertArg.name).toBe("Demo Bistro");
    expect(insertArg.pickupAddress).toEqual({
      line: "Building 1",
      district: "Al Quoz",
      emirate: "Dubai",
    });
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toMatchObject({
      slug: "demo-bistro",
      name: "Demo Bistro",
      pickup_address: { line: "Building 1", district: "Al Quoz", emirate: "Dubai" },
    });
  });
});

// -----------------------------------------------------------------------------
// activateMerchant — PLAN-STRICT only provisioning → active
// -----------------------------------------------------------------------------

describe("activateMerchant", () => {
  const PERM = "merchant:activate" as const;

  it("throws ForbiddenError when actor lacks merchant:activate", async () => {
    await expect(activateMerchant(ctx([]), TENANT_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the merchant is missing", async () => {
    mockFindForStatusUpdate.mockResolvedValue(null);
    await expect(activateMerchant(ctx([PERM]), TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("flips provisioning → active and emits merchant.activated with literal from_status='provisioning'", async () => {
    mockFindForStatusUpdate.mockResolvedValue(
      merchantFixture({ status: "provisioning" }),
    );
    mockUpdateStatus.mockResolvedValue(true);

    const result = await activateMerchant(ctx([PERM]), TENANT_ID);

    expect(result).toEqual({
      status: "activated",
      tenantId: TENANT_ID,
      previousStatus: "provisioning",
      newStatus: "active",
    });
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      "active",
    );
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("merchant.activated");
    expect(emitArg.tenantId).toBeNull();
    expect(emitArg.resourceId).toBe(TENANT_ID);
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      from_status: "provisioning",
      to_status: "active",
    });
  });

  // Phase 2 lock — every rejected from-state has an explicit test.
  // Anyone relaxing the matrix without updating the registered
  // metadataNotes literals + brief amendment fails CI here first.
  for (const rejectedFrom of ["active", "suspended", "inactive"] as const) {
    it(`rejects ${rejectedFrom} → active with ConflictError (PLAN-STRICT lock)`, async () => {
      mockFindForStatusUpdate.mockResolvedValue(
        merchantFixture({ status: rejectedFrom }),
      );
      await expect(activateMerchant(ctx([PERM]), TENANT_ID)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(mockUpdateStatus).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  }

  it("throws NotFoundError if the row vanishes between FOR UPDATE and the UPDATE", async () => {
    mockFindForStatusUpdate.mockResolvedValue(
      merchantFixture({ status: "provisioning" }),
    );
    mockUpdateStatus.mockResolvedValue(false);
    await expect(activateMerchant(ctx([PERM]), TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// deactivateMerchant — PLAN-STRICT only active → inactive
// -----------------------------------------------------------------------------

describe("deactivateMerchant", () => {
  const PERM = "merchant:deactivate" as const;

  it("throws ForbiddenError when actor lacks merchant:deactivate", async () => {
    await expect(deactivateMerchant(ctx([]), TENANT_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the merchant is missing", async () => {
    mockFindForStatusUpdate.mockResolvedValue(null);
    await expect(deactivateMerchant(ctx([PERM]), TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("flips active → inactive and emits merchant.deactivated with literal from_status='active'", async () => {
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ status: "active" }));
    mockUpdateStatus.mockResolvedValue(true);

    const result = await deactivateMerchant(ctx([PERM]), TENANT_ID);

    expect(result).toEqual({
      status: "deactivated",
      tenantId: TENANT_ID,
      previousStatus: "active",
      newStatus: "inactive",
    });
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      "inactive",
    );
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("merchant.deactivated");
    expect(emitArg.tenantId).toBeNull();
    expect(emitArg.resourceId).toBe(TENANT_ID);
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      from_status: "active",
      to_status: "inactive",
    });
  });

  // Phase 2 lock — every rejected from-state explicit.
  for (const rejectedFrom of ["provisioning", "suspended", "inactive"] as const) {
    it(`rejects ${rejectedFrom} → inactive with ConflictError (PLAN-STRICT lock)`, async () => {
      mockFindForStatusUpdate.mockResolvedValue(
        merchantFixture({ status: rejectedFrom }),
      );
      await expect(deactivateMerchant(ctx([PERM]), TENANT_ID)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(mockUpdateStatus).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  }

  it("throws NotFoundError if the row vanishes between FOR UPDATE and the UPDATE", async () => {
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ status: "active" }));
    mockUpdateStatus.mockResolvedValue(false);
    await expect(deactivateMerchant(ctx([PERM]), TENANT_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// listMerchants — read-only, no audit
// -----------------------------------------------------------------------------

describe("listMerchants", () => {
  const PERM = "merchant:read_all" as const;

  it("throws ForbiddenError when actor lacks merchant:read_all", async () => {
    await expect(listMerchants(ctx([]))).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockListRows).not.toHaveBeenCalled();
  });

  it("returns rows from the repository, no audit", async () => {
    const rows = [
      merchantFixture({ tenantId: "t-1", slug: "first" }),
      merchantFixture({ tenantId: "t-2", slug: "second", status: "active" }),
    ];
    mockListRows.mockResolvedValue(rows);
    const result = await listMerchants(ctx([PERM]));
    expect(result).toEqual(rows);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("forwards the optional status filter to the repository", async () => {
    const rows = [merchantFixture({ status: "active" })];
    mockListRows.mockResolvedValue(rows);
    await listMerchants(ctx([PERM]), { status: "active" });
    expect(mockListRows).toHaveBeenCalledOnce();
    expect(mockListRows.mock.calls[0][1]).toEqual({ status: "active" });
  });

  it("returns an empty array when no rows match", async () => {
    mockListRows.mockResolvedValue([]);
    expect(await listMerchants(ctx([PERM]))).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// withServiceRole reason-string convention
// -----------------------------------------------------------------------------
// Reason strings flow into the audit observer; we want them stable for
// log-grep + the recursion-skip contract from
// src/modules/audit/emit.ts:14-31 (anything NOT prefixed with
// `audit:emit:` triggers a db.service_role.use event). These tests
// pin the prefix so a future rename would surface here loudly.

describe("withServiceRole reason-string convention", () => {
  it("createMerchant uses 'transcorp_staff:create_merchant' (no tenant id)", async () => {
    mockInsert.mockResolvedValue(merchantFixture());
    await createMerchant(ctx(["merchant:create"]), {
      slug: "x",
      name: "y",
      pickupAddress: { line: "a", district: "b", emirate: "c" },
    });
    expect(mockWithServiceRole.mock.calls[0][0]).toBe(
      "transcorp_staff:create_merchant",
    );
  });

  it("activateMerchant reason includes the tenant id for traceability", async () => {
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ status: "provisioning" }));
    mockUpdateStatus.mockResolvedValue(true);
    await activateMerchant(ctx(["merchant:activate"]), TENANT_ID);
    expect(mockWithServiceRole.mock.calls[0][0]).toBe(
      `transcorp_staff:activate_merchant ${TENANT_ID}`,
    );
  });

  it("deactivateMerchant reason includes the tenant id", async () => {
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ status: "active" }));
    mockUpdateStatus.mockResolvedValue(true);
    await deactivateMerchant(ctx(["merchant:deactivate"]), TENANT_ID);
    expect(mockWithServiceRole.mock.calls[0][0]).toBe(
      `transcorp_staff:deactivate_merchant ${TENANT_ID}`,
    );
  });

  it("listMerchants uses 'transcorp_staff:list_merchants'", async () => {
    mockListRows.mockResolvedValue([]);
    await listMerchants(ctx(["merchant:read_all"]));
    expect(mockWithServiceRole.mock.calls[0][0]).toBe("transcorp_staff:list_merchants");
  });

  it("none of the four reasons collide with the audit:emit: recursion-skip prefix", async () => {
    // Defensive: if anyone accidentally prefixes a service reason with
    // `audit:emit:`, the audit observer would skip the
    // db.service_role.use event for that withServiceRole call —
    // silent telemetry loss. Pin the four service reasons against
    // the prefix.
    mockInsert.mockResolvedValue(merchantFixture());
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ status: "provisioning" }));
    mockUpdateStatus.mockResolvedValue(true);
    mockListRows.mockResolvedValue([]);

    await createMerchant(ctx(["merchant:create"]), {
      slug: "x",
      name: "y",
      pickupAddress: { line: "a", district: "b", emirate: "c" },
    });
    await activateMerchant(ctx(["merchant:activate"]), TENANT_ID);

    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ status: "active" }));
    await deactivateMerchant(ctx(["merchant:deactivate"]), TENANT_ID);
    await listMerchants(ctx(["merchant:read_all"]));

    const reasons = mockWithServiceRole.mock.calls.map((call) => call[0]);
    expect(reasons).toHaveLength(4);
    for (const r of reasons) {
      expect(r.startsWith("audit:emit:")).toBe(false);
    }
  });
});

