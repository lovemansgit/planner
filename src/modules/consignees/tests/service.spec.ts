// Consignee service-layer unit tests.
//
// Mocks ../../shared/db (withTenant) and ../audit (emit) so we exercise
// permission, tenant-context, validation, and audit-emit flow without
// real Postgres or audit infra. Repository functions (insert, find,
// list, update, delete) are mocked at the source-module boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  insertConsignee: vi.fn(),
  findConsigneeById: vi.fn(),
  listConsigneesByTenant: vi.fn(),
  updateConsignee: vi.fn(),
  deleteConsignee: vi.fn(),
}));

import { withTenant } from "../../../shared/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import {
  deleteConsignee as deleteConsigneeRow,
  findConsigneeById,
  insertConsignee,
  listConsigneesByTenant,
  updateConsignee as updateConsigneeRow,
} from "../repository";
import {
  createConsignee,
  deleteConsignee,
  getConsignee,
  listConsignees,
  updateConsignee,
} from "../service";
import type { Consignee } from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockInsert = vi.mocked(insertConsignee);
const mockFindById = vi.mocked(findConsigneeById);
const mockListByTenant = vi.mocked(listConsigneesByTenant);
const mockUpdate = vi.mocked(updateConsigneeRow);
const mockDelete = vi.mocked(deleteConsigneeRow);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const FIXED_NOW = "2026-04-28T10:00:00.000Z";

function ctx(perms: readonly Permission[], tenantId: string | null = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/api/consignees",
  };
}

function consigneeFixture(overrides: Partial<Consignee> = {}): Consignee {
  return {
    id: CONSIGNEE_ID,
    tenantId: TENANT_ID,
    name: "Falafel House",
    phone: "+971501234567",
    email: null,
    addressLine: "Building 12, Al Quoz",
    emirateOrRegion: "Dubai",
    deliveryNotes: null,
    externalRef: null,
    notesInternal: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockInsert.mockReset();
  mockFindById.mockReset();
  mockListByTenant.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  // Default: withTenant runs its callback against an opaque tx stub.
  // Each test that needs specific repo behaviour sets it via the
  // repository mocks rather than through withTenant.
  mockWithTenant.mockImplementation(async (_tenantId, fn) => {
    return fn({} as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// createConsignee
// -----------------------------------------------------------------------------

describe("createConsignee", () => {
  it("throws ForbiddenError when actor lacks consignee:create", async () => {
    await expect(
      createConsignee(ctx([]), {
        name: "n",
        phone: "+971501234567",
        addressLine: "a",
        emirateOrRegion: "Dubai",
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      createConsignee(ctx(["consignee:create"], null), {
        name: "n",
        phone: "+971501234567",
        addressLine: "a",
        emirateOrRegion: "Dubai",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws ValidationError when required fields are empty", async () => {
    await expect(
      createConsignee(ctx(["consignee:create"]), {
        name: "  ",
        phone: "+971501234567",
        addressLine: "a",
        emirateOrRegion: "Dubai",
      })
    ).rejects.toThrow(/name is required/);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("normalises the phone before insert and emits with source: planner", async () => {
    mockInsert.mockResolvedValue(consigneeFixture({ phone: "+971501234567" }));

    const result = await createConsignee(ctx(["consignee:create"]), {
      name: "Falafel House",
      phone: "0501234567", // local UAE shape — should normalise
      addressLine: "Building 12",
      emirateOrRegion: "Dubai",
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0][2]; // (tx, tenantId, input)
    expect(insertArg.phone).toBe("+971501234567");
    expect(result.id).toBe(CONSIGNEE_ID);

    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("consignee.created");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceId).toBe(CONSIGNEE_ID);
    expect(emitArg.metadata).toEqual({ consignee_id: CONSIGNEE_ID, source: "planner" });
  });

  it("strips empty optional strings to undefined before insert", async () => {
    mockInsert.mockResolvedValue(consigneeFixture());

    await createConsignee(ctx(["consignee:create"]), {
      name: "n",
      phone: "+971501234567",
      addressLine: "a",
      emirateOrRegion: "Dubai",
      email: "   ",
      deliveryNotes: "",
    });

    const insertArg = mockInsert.mock.calls[0][2];
    expect(insertArg.email).toBeUndefined();
    expect(insertArg.deliveryNotes).toBeUndefined();
  });

  it("does NOT audit when phone normalisation throws (denied path produces no event)", async () => {
    await expect(
      createConsignee(ctx(["consignee:create"]), {
        name: "n",
        phone: "not-a-phone",
        addressLine: "a",
        emirateOrRegion: "Dubai",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// getConsignee / listConsignees — reads, not audited
// -----------------------------------------------------------------------------

describe("getConsignee", () => {
  it("throws ForbiddenError when actor lacks consignee:read", async () => {
    await expect(getConsignee(ctx([]), CONSIGNEE_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      getConsignee(ctx(["consignee:read"], null), CONSIGNEE_ID)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns the row from the repository", async () => {
    const fixture = consigneeFixture();
    mockFindById.mockResolvedValue(fixture);
    const result = await getConsignee(ctx(["consignee:read"]), CONSIGNEE_ID);
    expect(result).toEqual(fixture);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns null when the repository returns null", async () => {
    mockFindById.mockResolvedValue(null);
    const result = await getConsignee(ctx(["consignee:read"]), CONSIGNEE_ID);
    expect(result).toBeNull();
  });
});

describe("listConsignees", () => {
  it("throws ForbiddenError when actor lacks consignee:read", async () => {
    await expect(listConsignees(ctx([]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(listConsignees(ctx(["consignee:read"], null))).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("returns rows from the repository, no audit", async () => {
    const rows = [consigneeFixture({ id: "row-1" }), consigneeFixture({ id: "row-2" })];
    mockListByTenant.mockResolvedValue(rows);
    const result = await listConsignees(ctx(["consignee:read"]));
    expect(result).toEqual(rows);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// updateConsignee
// -----------------------------------------------------------------------------

describe("updateConsignee", () => {
  it("throws ForbiddenError when actor lacks consignee:update", async () => {
    await expect(updateConsignee(ctx([]), CONSIGNEE_ID, { name: "x" })).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      updateConsignee(ctx(["consignee:update"], null), CONSIGNEE_ID, { name: "x" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when the row does not exist", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(
      updateConsignee(ctx(["consignee:update"]), CONSIGNEE_ID, { name: "x" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("normalises phone and emits with the actually-changed fields only", async () => {
    const before = consigneeFixture({ phone: "+971501234567", name: "Old Name" });
    const after = consigneeFixture({ phone: "+971501234567", name: "New Name" });
    mockFindById.mockResolvedValue(before);
    mockUpdate.mockResolvedValue(after);

    const result = await updateConsignee(ctx(["consignee:update"]), CONSIGNEE_ID, {
      name: "New Name",
      // Re-submitting the same phone in raw local shape — normalises
      // to the SAME E.164 — must NOT count as a change.
      phone: "0501234567",
    });

    expect(result).toEqual(after);
    expect(mockUpdate).toHaveBeenCalledOnce();
    const patchArg = mockUpdate.mock.calls[0][3]; // (tx, tenantId, id, patch)
    // Only `name` should be in the applied patch; `phone` is a no-op
    // because the normalised values match.
    expect(patchArg).toEqual({ name: "New Name" });

    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("consignee.updated");
    expect(emitArg.metadata).toEqual({ changed_fields: ["name"] });
  });

  it("treats a phone that re-normalises to a DIFFERENT E.164 as a real change", async () => {
    const before = consigneeFixture({ phone: "+971501234567" });
    const after = consigneeFixture({ phone: "+971502222222" });
    mockFindById.mockResolvedValue(before);
    mockUpdate.mockResolvedValue(after);

    await updateConsignee(ctx(["consignee:update"]), CONSIGNEE_ID, {
      phone: "0502222222",
    });

    const patchArg = mockUpdate.mock.calls[0][3];
    expect(patchArg).toEqual({ phone: "+971502222222" });
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toEqual({ changed_fields: ["phone"] });
  });

  it("returns the current row and does NOT emit when no field actually changed", async () => {
    const before = consigneeFixture();
    mockFindById.mockResolvedValue(before);
    // Re-submitting every field at its current value.
    const result = await updateConsignee(ctx(["consignee:update"]), CONSIGNEE_ID, {
      name: before.name,
      phone: before.phone,
      addressLine: before.addressLine,
      emirateOrRegion: before.emirateOrRegion,
    });

    expect(result).toEqual(before);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws NotFoundError if the row vanishes between the find and the update (race)", async () => {
    const before = consigneeFixture();
    mockFindById.mockResolvedValue(before);
    mockUpdate.mockResolvedValue(null);

    await expect(
      updateConsignee(ctx(["consignee:update"]), CONSIGNEE_ID, { name: "X" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects malformed phone before touching the DB", async () => {
    await expect(
      updateConsignee(ctx(["consignee:update"]), CONSIGNEE_ID, { phone: "not-a-phone" })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// deleteConsignee
// -----------------------------------------------------------------------------

describe("deleteConsignee", () => {
  it("throws ForbiddenError when actor lacks consignee:delete", async () => {
    await expect(deleteConsignee(ctx([]), CONSIGNEE_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      deleteConsignee(ctx(["consignee:delete"], null), CONSIGNEE_ID)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when the row is missing (and does NOT audit)", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("deletes and emits consignee.deleted with consignee_id metadata", async () => {
    mockFindById.mockResolvedValue(consigneeFixture());
    mockDelete.mockResolvedValue(true);

    await deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID);

    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("consignee.deleted");
    expect(emitArg.resourceId).toBe(CONSIGNEE_ID);
    expect(emitArg.metadata).toEqual({ consignee_id: CONSIGNEE_ID });
  });

  it("throws NotFoundError if delete returns false (race) and does NOT audit", async () => {
    mockFindById.mockResolvedValue(consigneeFixture());
    mockDelete.mockResolvedValue(false);

    await expect(deleteConsignee(ctx(["consignee:delete"]), CONSIGNEE_ID)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
