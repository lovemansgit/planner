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
  findMerchantById: vi.fn(),
  findMerchantForStatusUpdate: vi.fn(),
  insertMerchant: vi.fn(),
  listMerchants: vi.fn(),
  updateMerchantFields: vi.fn(),
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
  findMerchantById,
  findMerchantForStatusUpdate,
  insertMerchant,
  listMerchants as listMerchantsRows,
  updateMerchantFields,
  updateMerchantStatus,
} from "../repository";
import {
  activateMerchant,
  createMerchant,
  deactivateMerchant,
  getMerchantById,
  listMerchants,
  updateMerchant,
} from "../service";
import type { Merchant } from "../types";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockFindById = vi.mocked(findMerchantById);
const mockFindForStatusUpdate = vi.mocked(findMerchantForStatusUpdate);
const mockInsert = vi.mocked(insertMerchant);
const mockListRows = vi.mocked(listMerchantsRows);
const mockUpdateFields = vi.mocked(updateMerchantFields);
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
    suitefleetCustomerCode: "588",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockFindById.mockReset();
  mockFindForStatusUpdate.mockReset();
  mockInsert.mockReset();
  mockListRows.mockReset();
  mockUpdateFields.mockReset();
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
    suitefleetCustomerCode: "588",
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
      // Day-22 §5.3 Gate 2 closure — added at audit-metadata level.
      suitefleet_customer_code: "588",
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
      suitefleetCustomerCode: "588",
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

  it("forwards the optional searchTerm filter to the repository", async () => {
    mockListRows.mockResolvedValue([]);
    await listMerchants(ctx([PERM]), { searchTerm: "demo" });
    expect(mockListRows).toHaveBeenCalledOnce();
    expect(mockListRows.mock.calls[0][1]).toEqual({ searchTerm: "demo" });
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
      suitefleetCustomerCode: "588",
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
      suitefleetCustomerCode: "588",
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

// -----------------------------------------------------------------------------
// getMerchantById (Day 25 / T2 — read gate relaxed to merchant:read_all)
//
// Originally shipped Day 25 AM (PR #264 / C-3) gated on merchant:update
// per a route-specific tightness argument. PR #270 plan §9.2 inverted
// the ruling: the new read-only /admin/merchants/[id] detail page
// legitimately needs read access without the update permission, so the
// gate relaxed to merchant:read_all (the broader legitimate need).
// Discipline carry-forward: gate service-layer fns at the broadest
// legitimate need, not the tightest single-caller posture.
// -----------------------------------------------------------------------------

describe("getMerchantById", () => {
  it("throws ForbiddenError when actor lacks merchant:read_all", async () => {
    await expect(getMerchantById(ctx([]), TENANT_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("returns the mapped row when found (with merchant:read_all perm)", async () => {
    mockFindById.mockResolvedValue(merchantFixture());
    const result = await getMerchantById(
      ctx(["merchant:read_all" as const]),
      TENANT_ID,
    );
    expect(result?.tenantId).toBe(TENANT_ID);
    expect(mockFindById).toHaveBeenCalledOnce();
  });

  it("also accepts merchant:update-holding actor (transcorp-sysadmin holds both via ALL)", async () => {
    // The sysadmin role auto-grants every permission via roles.ts ALL
    // pattern, so an actor reaching the edit page (merchant:update)
    // ALSO has merchant:read_all in practice. Pin both code paths
    // green — the gate requires read_all, NOT the absence of update.
    mockFindById.mockResolvedValue(merchantFixture());
    const result = await getMerchantById(
      ctx(["merchant:read_all" as const, "merchant:update" as const]),
      TENANT_ID,
    );
    expect(result?.tenantId).toBe(TENANT_ID);
  });

  it("returns null when the merchant is not found", async () => {
    mockFindById.mockResolvedValue(null);
    expect(
      await getMerchantById(ctx(["merchant:read_all" as const]), TENANT_ID),
    ).toBeNull();
  });

  it("does NOT accept merchant:update alone (gate is read_all, not update)", async () => {
    // The inverted gate (PR #270 plan §9.2) requires read_all
    // specifically; merchant:update alone is not sufficient. In
    // practice no role holds update without also holding read_all
    // (transcorp-sysadmin has ALL); this pin is the contract for
    // future role-mix changes.
    await expect(
      getMerchantById(ctx(["merchant:update" as const]), TENANT_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// -----------------------------------------------------------------------------
// updateMerchant (Day 25 / T3)
// -----------------------------------------------------------------------------

describe("updateMerchant", () => {
  const PERM = "merchant:update" as const;

  function setupHappyPath(current: Merchant) {
    mockFindForStatusUpdate.mockResolvedValue(current);
    mockUpdateFields.mockResolvedValue(current);
  }

  it("throws ForbiddenError when actor lacks merchant:update", async () => {
    await expect(
      updateMerchant(ctx([]), TENANT_ID, { name: "Updated" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when no fields supplied (no-fields-to-update gate)", async () => {
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, {}),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it("throws ValidationError on empty name after trim", async () => {
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { name: "  " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on slug with uppercase or invalid chars", async () => {
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { slug: "Demo-Bistro" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { slug: "demo_bistro" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on slug longer than 60 chars", async () => {
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { slug: "a".repeat(61) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when any pickup_address sub-field is empty", async () => {
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, {
        pickupAddress: { line: "  ", district: "x", emirate: "Dubai" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, {
        pickupAddress: { line: "x", district: "", emirate: "Dubai" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on suitefleet_customer_code with leading zero", async () => {
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { suitefleetCustomerCode: "0588" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when merchant id not found", async () => {
    mockFindForStatusUpdate.mockResolvedValue(null);
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { name: "Updated" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockUpdateFields).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError 'no changes' when normalized patch produces empty diff", async () => {
    // Operator submits name = current name (no real change). Service
    // computes the diff, sees zero fields, throws before UPDATE.
    setupHappyPath(merchantFixture({ name: "Demo Bistro" }));
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { name: "Demo Bistro" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockUpdateFields).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("happy path single-field — name change emits merchant.updated with flat diff payload", async () => {
    setupHappyPath(merchantFixture({ name: "Old Name" }));

    const result = await updateMerchant(ctx([PERM]), TENANT_ID, {
      name: "New Name",
    });

    expect(result).toEqual({
      status: "updated",
      tenantId: TENANT_ID,
      changedFields: ["name"],
    });
    expect(mockUpdateFields).toHaveBeenCalledOnce();
    expect(mockUpdateFields).toHaveBeenCalledWith(expect.anything(), TENANT_ID, {
      name: "New Name",
    });
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("merchant.updated");
    expect(emitArg.tenantId).toBeNull();
    expect(emitArg.resourceType).toBe("merchant");
    expect(emitArg.resourceId).toBe(TENANT_ID);
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      changes: {
        name: { before: "Old Name", after: "New Name" },
      },
    });
  });

  it("happy path multi-field — name + slug + customer code emit 3 keys in changes", async () => {
    setupHappyPath(
      merchantFixture({
        name: "Old Name",
        slug: "old-slug",
        suitefleetCustomerCode: "588",
      }),
    );

    const result = await updateMerchant(ctx([PERM]), TENANT_ID, {
      name: "New Name",
      slug: "new-slug",
      suitefleetCustomerCode: "612",
    });

    expect(result.changedFields).toEqual(["name", "slug", "suitefleet_customer_code"]);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      changes: {
        name: { before: "Old Name", after: "New Name" },
        slug: { before: "old-slug", after: "new-slug" },
        suitefleet_customer_code: { before: "588", after: "612" },
      },
    });
  });

  it("pickup-address diff keys each sub-field with dot-notation; only changed sub-fields surface", async () => {
    setupHappyPath(
      merchantFixture({
        pickupAddress: {
          line: "Building 1",
          district: "Al Quoz",
          emirate: "Dubai",
        },
      }),
    );

    // Operator changes only the district; line + emirate match current
    // values via the pre-fill (this is what the form does in practice).
    await updateMerchant(ctx([PERM]), TENANT_ID, {
      pickupAddress: {
        line: "Building 1",
        district: "Business Bay",
        emirate: "Dubai",
      },
    });

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      changes: {
        "pickup_address.district": {
          before: "Al Quoz",
          after: "Business Bay",
        },
      },
    });
  });

  it("pre-existing null pickup → populated: diff shows before=null, after=<value> for each sub-field", async () => {
    setupHappyPath(merchantFixture({ pickupAddress: null }));

    await updateMerchant(ctx([PERM]), TENANT_ID, {
      pickupAddress: {
        line: "Building 1",
        district: "Al Quoz",
        emirate: "Dubai",
      },
    });

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toEqual({
      tenant_id: TENANT_ID,
      changes: {
        "pickup_address.line": { before: null, after: "Building 1" },
        "pickup_address.district": { before: null, after: "Al Quoz" },
        "pickup_address.emirate": { before: null, after: "Dubai" },
      },
    });
  });

  it("maps SQLSTATE 23505 from updateMerchantFields to ConflictError; no audit emitted", async () => {
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture({ slug: "old-slug" }));
    const err = new Error("duplicate key value violates unique constraint") as Error & {
      code?: string;
    };
    err.code = "23505";
    mockUpdateFields.mockRejectedValue(err);

    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { slug: "new-slug-but-taken" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("propagates a non-23505 error from updateMerchantFields unchanged", async () => {
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture());
    mockUpdateFields.mockRejectedValue(new Error("connection lost"));
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { name: "Updated" }),
    ).rejects.toThrow(/connection lost/);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("findMerchantForStatusUpdate returning null mid-tx (after diff) surfaces as NotFound", async () => {
    // Defensive — FOR UPDATE lock should prevent this, but if the
    // repo returns null after a vanished row, the service surfaces
    // it as NotFound for caller-consistent semantics.
    mockFindForStatusUpdate.mockResolvedValue(merchantFixture());
    mockUpdateFields.mockResolvedValue(null);
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { name: "Updated" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("trims input strings — leading/trailing whitespace doesn't trigger spurious diff", async () => {
    setupHappyPath(merchantFixture({ name: "Demo Bistro" }));
    // Operator-supplied "  Demo Bistro  " normalizes to "Demo Bistro";
    // diff sees no change → ValidationError("no changes").
    await expect(
      updateMerchant(ctx([PERM]), TENANT_ID, { name: "  Demo Bistro  " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requirePermission runs first — invalid input never reaches validation when actor lacks perm", async () => {
    // Defensive ordering check: a ForbiddenError-throwing actor calling
    // with an obviously-bad slug should still get ForbiddenError, not
    // ValidationError. Permission gate is the first thing the service
    // does (plan §3.3 step 1).
    await expect(
      updateMerchant(ctx([]), TENANT_ID, { slug: "INVALID UPPERCASE" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

