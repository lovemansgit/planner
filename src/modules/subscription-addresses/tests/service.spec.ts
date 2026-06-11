// Service-layer unit tests — Service E `changeAddressRotation`.
//
// Mocks ../../../shared/db (withTenant), ../../audit (emit, for the
// no-emit assertion), and ../repository (the 5 helpers). Exercises
// permission, validation, cross-consignee ownership rejection,
// no_op short-circuit, full-replace UPSERT/DELETE composition, and
// the §10.6 no-audit-emit lock.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  deleteRotationEntries: vi.fn(),
  findAddressForConsignee: vi.fn(),
  findSubscriptionForRotation: vi.fn(),
  selectCurrentRotation: vi.fn(),
  upsertRotationEntries: vi.fn(),
}));

import { withTenant } from "../../../shared/db";
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
  deleteRotationEntries,
  findAddressForConsignee,
  findSubscriptionForRotation,
  selectCurrentRotation,
  upsertRotationEntries,
} from "../repository";
import { changeAddressRotation } from "../service";
import type {
  AddressOwnershipRow,
  CurrentRotationRow,
  RotationEntry,
  SubscriptionForRotation,
} from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockDeleteRotation = vi.mocked(deleteRotationEntries);
const mockFindAddress = vi.mocked(findAddressForConsignee);
const mockFindSub = vi.mocked(findSubscriptionForRotation);
const mockSelectCurrent = vi.mocked(selectCurrentRotation);
const mockUpsertRotation = vi.mocked(upsertRotationEntries);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CONSIGNEE_ID = "11111111-1111-1111-1111-1111111111ff";
const SUBSCRIPTION_ID = "33333333-3333-3333-3333-333333333333";
const ADDR_HOME = "aaaaaaaa-0000-0000-0000-000000000001";
const ADDR_OFFICE = "aaaaaaaa-0000-0000-0000-000000000002";
const ADDR_OTHER = "aaaaaaaa-0000-0000-0000-000000000003";

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
    path: "/api/subscriptions/x/address-rotation",
  };
}

function subFixture(overrides: Partial<SubscriptionForRotation> = {}): SubscriptionForRotation {
  return {
    id: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    status: "active",
    ...overrides,
  };
}

function ownedAddress(overrides: Partial<AddressOwnershipRow> = {}): AddressOwnershipRow {
  return {
    id: ADDR_HOME,
    consigneeId: CONSIGNEE_ID,
    tenantId: TENANT_ID,
    label: "home",
    isPrimary: true,
    ...overrides,
  };
}

function rotationRow(weekday: 1|2|3|4|5|6|7, addressId: string): CurrentRotationRow {
  return {
    weekday,
    addressId,
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockDeleteRotation.mockReset();
  mockFindAddress.mockReset();
  mockFindSub.mockReset();
  mockSelectCurrent.mockReset();
  mockUpsertRotation.mockReset();
  // Default: withTenant runs its callback against an opaque tx stub.
  mockWithTenant.mockImplementation(async (_tenantId, fn) => fn({} as never));
  // Default: every address is owned by CONSIGNEE_ID. Tests override
  // for cross-consignee rejection cases.
  mockFindAddress.mockImplementation(async (_tx, _tenantId, _consigneeId, addressId) =>
    ownedAddress({ id: addressId }),
  );
  // Default: subscription exists, active, owned by CONSIGNEE_ID.
  mockFindSub.mockResolvedValue(subFixture());
  // Default: empty current rotation.
  mockSelectCurrent.mockResolvedValue([]);
  mockDeleteRotation.mockResolvedValue(undefined);
  mockUpsertRotation.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PERM = "subscription:change_address_rotation" as const;

// -----------------------------------------------------------------------------
// changeAddressRotation
// -----------------------------------------------------------------------------

describe("changeAddressRotation — auth + tenant + input validation", () => {
  it("throws ForbiddenError when actor lacks subscription:change_address_rotation", async () => {
    await expect(
      changeAddressRotation(ctx([]), SUBSCRIPTION_ID, { rotation: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      changeAddressRotation(ctx([PERM], null), SUBSCRIPTION_ID, { rotation: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws ValidationError on weekday out of 1-7 range", async () => {
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [{ weekday: 8 as never, addressId: ADDR_HOME }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFindSub).not.toHaveBeenCalled();
  });

  it("throws ValidationError on duplicate weekday in input", async () => {
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [
          { weekday: 1, addressId: ADDR_HOME },
          { weekday: 1, addressId: ADDR_OFFICE },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFindSub).not.toHaveBeenCalled();
  });

  it("throws ValidationError on empty addressId", async () => {
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [{ weekday: 1, addressId: "" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockFindSub).not.toHaveBeenCalled();
  });
});

describe("changeAddressRotation — subscription state checks", () => {
  it("throws NotFoundError when the subscription is missing", async () => {
    mockFindSub.mockResolvedValue(null);
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [{ weekday: 1, addressId: ADDR_HOME }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockUpsertRotation).not.toHaveBeenCalled();
    expect(mockDeleteRotation).not.toHaveBeenCalled();
  });

  it("throws ConflictError when the subscription is paused", async () => {
    mockFindSub.mockResolvedValue(subFixture({ status: "paused" }));
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [{ weekday: 1, addressId: ADDR_HOME }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockFindAddress).not.toHaveBeenCalled();
    expect(mockUpsertRotation).not.toHaveBeenCalled();
  });

  it("throws ConflictError when the subscription is ended", async () => {
    mockFindSub.mockResolvedValue(subFixture({ status: "ended" }));
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [{ weekday: 1, addressId: ADDR_HOME }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changeAddressRotation — cross-consignee address ownership (Block 4-E §B B1)", () => {
  it("rejects when an entry's addressId belongs to another consignee in the same tenant", async () => {
    // First call: ADDR_HOME belongs to CONSIGNEE_ID — owned. Second
    // call: ADDR_OFFICE returns null (helper says "not for this
    // consignee"). Service should reject ValidationError.
    mockFindAddress.mockImplementation(async (_tx, _tenantId, _consigneeId, addressId) => {
      if (addressId === ADDR_HOME) return ownedAddress({ id: ADDR_HOME });
      return null; // ADDR_OFFICE not owned by CONSIGNEE_ID
    });

    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [
          { weekday: 1, addressId: ADDR_HOME },
          { weekday: 3, addressId: ADDR_OFFICE },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Atomic — no DB writes on partial success.
    expect(mockUpsertRotation).not.toHaveBeenCalled();
    expect(mockDeleteRotation).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("error message names the offending address + weekday for operator triage", async () => {
    mockFindAddress.mockResolvedValue(null);
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [{ weekday: 4, addressId: ADDR_OTHER }],
      }),
    ).rejects.toThrow(/address_not_found_for_consignee/);
  });

  it("validates EVERY entry — does not stop at first owned, must check all", async () => {
    // 3 entries: first 2 owned, 3rd not owned. Service must reject.
    mockFindAddress.mockImplementation(async (_tx, _tenantId, _consigneeId, addressId) => {
      if (addressId === ADDR_HOME || addressId === ADDR_OFFICE) {
        return ownedAddress({ id: addressId });
      }
      return null;
    });
    await expect(
      changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
        rotation: [
          { weekday: 1, addressId: ADDR_HOME },
          { weekday: 2, addressId: ADDR_OFFICE },
          { weekday: 3, addressId: ADDR_OTHER },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("passes consigneeId from the subscription (not from input) to the helper", async () => {
    // Subscription belongs to CONSIGNEE_ID; the helper must be called
    // with that, not OTHER_CONSIGNEE_ID. This test pins that the
    // service uses the subscription's consigneeId, not any
    // operator-supplied value (defence against operator-spoof).
    mockFindSub.mockResolvedValue(subFixture({ consigneeId: CONSIGNEE_ID }));
    mockFindAddress.mockResolvedValue(ownedAddress());

    await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [{ weekday: 1, addressId: ADDR_HOME }],
    });

    expect(mockFindAddress).toHaveBeenCalledOnce();
    const call = mockFindAddress.mock.calls[0];
    // helper signature: (tx, tenantId, consigneeId, addressId)
    expect(call[1]).toBe(TENANT_ID);
    expect(call[2]).toBe(CONSIGNEE_ID);
    expect(call[3]).toBe(ADDR_HOME);
    expect(call[2]).not.toBe(OTHER_CONSIGNEE_ID);
  });
});

describe("changeAddressRotation — no_op short-circuit", () => {
  it("returns no_op when input matches current state byte-for-byte", async () => {
    mockSelectCurrent.mockResolvedValue([
      rotationRow(1, ADDR_HOME),
      rotationRow(3, ADDR_OFFICE),
    ]);

    const result = await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [
        { weekday: 1, addressId: ADDR_HOME },
        { weekday: 3, addressId: ADDR_OFFICE },
      ],
    });

    expect(result).toEqual({
      status: "no_op",
      subscriptionId: SUBSCRIPTION_ID,
      rotation: [
        { weekday: 1, addressId: ADDR_HOME },
        { weekday: 3, addressId: ADDR_OFFICE },
      ],
    });
    expect(mockUpsertRotation).not.toHaveBeenCalled();
    expect(mockDeleteRotation).not.toHaveBeenCalled();
  });

  it("returns no_op when input matches current state in different ORDER (set-equality)", async () => {
    mockSelectCurrent.mockResolvedValue([
      rotationRow(1, ADDR_HOME),
      rotationRow(3, ADDR_OFFICE),
    ]);

    const result = await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      // Same set of pairs, different order in input.
      rotation: [
        { weekday: 3, addressId: ADDR_OFFICE },
        { weekday: 1, addressId: ADDR_HOME },
      ],
    });

    expect(result.status).toBe("no_op");
    expect(mockUpsertRotation).not.toHaveBeenCalled();
    expect(mockDeleteRotation).not.toHaveBeenCalled();
  });

  it("does NOT match when one weekday's address differs", async () => {
    mockSelectCurrent.mockResolvedValue([rotationRow(1, ADDR_HOME)]);

    const result = await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [{ weekday: 1, addressId: ADDR_OFFICE }],
    });

    expect(result.status).toBe("updated");
    expect(mockUpsertRotation).toHaveBeenCalledOnce();
  });

  it("does NOT match when input has more entries than current", async () => {
    mockSelectCurrent.mockResolvedValue([rotationRow(1, ADDR_HOME)]);

    const result = await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [
        { weekday: 1, addressId: ADDR_HOME },
        { weekday: 3, addressId: ADDR_OFFICE },
      ],
    });

    expect(result.status).toBe("updated");
  });
});

describe("changeAddressRotation — full-replace UPSERT/DELETE composition", () => {
  it("UPSERTs every input entry when current is empty", async () => {
    mockSelectCurrent.mockResolvedValue([]);

    const input: RotationEntry[] = [
      { weekday: 1, addressId: ADDR_HOME },
      { weekday: 5, addressId: ADDR_OFFICE },
    ];
    const result = await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: input,
    });

    expect(result.status).toBe("updated");
    expect(mockUpsertRotation).toHaveBeenCalledOnce();
    expect(mockUpsertRotation.mock.calls[0][1]).toBe(TENANT_ID);
    expect(mockUpsertRotation.mock.calls[0][2]).toBe(SUBSCRIPTION_ID);
    expect(mockUpsertRotation.mock.calls[0][3]).toEqual(input);
    // No deletes — current is empty, nothing to delete.
    expect(mockDeleteRotation).not.toHaveBeenCalled();
  });

  it("DELETEs current weekdays not present in input + UPSERTs input entries", async () => {
    mockSelectCurrent.mockResolvedValue([
      rotationRow(1, ADDR_HOME),
      rotationRow(3, ADDR_OFFICE),
      rotationRow(5, ADDR_OTHER),
    ]);

    // Input only has weekday 1 + 3; weekday 5 should be deleted.
    await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [
        { weekday: 1, addressId: ADDR_HOME },
        { weekday: 3, addressId: ADDR_OTHER }, // change ADDR_OFFICE → ADDR_OTHER
      ],
    });

    expect(mockDeleteRotation).toHaveBeenCalledOnce();
    expect(mockDeleteRotation.mock.calls[0][3]).toEqual([5]);

    expect(mockUpsertRotation).toHaveBeenCalledOnce();
    expect(mockUpsertRotation.mock.calls[0][3]).toEqual([
      { weekday: 1, addressId: ADDR_HOME },
      { weekday: 3, addressId: ADDR_OTHER },
    ]);
  });

  it("empty input rotation deletes ALL current rows + does NOT call upsert", async () => {
    mockSelectCurrent.mockResolvedValue([
      rotationRow(1, ADDR_HOME),
      rotationRow(2, ADDR_OFFICE),
      rotationRow(7, ADDR_OTHER),
    ]);

    const result = await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [],
    });

    expect(result).toEqual({
      status: "updated",
      subscriptionId: SUBSCRIPTION_ID,
      rotation: [],
    });
    expect(mockDeleteRotation).toHaveBeenCalledOnce();
    // All 3 weekdays in delete list (order may vary; sort for stable assertion).
    const deletedWeekdays = [...mockDeleteRotation.mock.calls[0][3]].sort();
    expect(deletedWeekdays).toEqual([1, 2, 7]);
    expect(mockUpsertRotation).not.toHaveBeenCalled();
  });

  it("input weekdays superset of current — only UPSERTs, no DELETEs", async () => {
    mockSelectCurrent.mockResolvedValue([rotationRow(1, ADDR_HOME)]);

    await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [
        { weekday: 1, addressId: ADDR_HOME },
        { weekday: 2, addressId: ADDR_OFFICE },
        { weekday: 3, addressId: ADDR_OTHER },
      ],
    });

    expect(mockDeleteRotation).not.toHaveBeenCalled();
    expect(mockUpsertRotation).toHaveBeenCalledOnce();
  });
});

// -----------------------------------------------------------------------------
// Audit-emit absence — locks the §10.6 default per merged plan
// -----------------------------------------------------------------------------
// Per merged plan PR #155 §10.6 default: rotation changes are NOT
// audit-grade ("rotation changes are routine config, not audit-grade").
// Service E does not emit on rotation. Anyone adding rotation audit
// emission must register the event in audit/event-types.ts FIRST,
// then update brief §3.1.2's 9-event vocabulary, THEN update the
// service code. This test fails loud if any of the above are
// silently bypassed.

describe("changeAddressRotation — §10.6 no-audit-emit lock", () => {
  it("does NOT emit any audit event on a successful update", async () => {
    mockSelectCurrent.mockResolvedValue([]);

    await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [{ weekday: 1, addressId: ADDR_HOME }],
    });

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("does NOT emit any audit event on no_op", async () => {
    mockSelectCurrent.mockResolvedValue([rotationRow(1, ADDR_HOME)]);
    await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [{ weekday: 1, addressId: ADDR_HOME }],
    });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("does NOT emit any audit event on the empty-input-deletes-all path", async () => {
    mockSelectCurrent.mockResolvedValue([rotationRow(1, ADDR_HOME), rotationRow(3, ADDR_OFFICE)]);
    await changeAddressRotation(ctx([PERM]), SUBSCRIPTION_ID, {
      rotation: [],
    });
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
