// Day 22 / Phase 1 forms lane — createConsigneeWithSubscription
// orchestration unit tests.
//
// Mocks shared/db withTenant + audit emit + each repository fn so we
// exercise permission, validation, single-tx semantics, and audit-emit
// flow without real Postgres. Pattern mirrors consignees/tests/service.spec.ts.

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
  findConsigneeForCrmUpdate: vi.fn(),
  insertConsigneeCrmEvent: vi.fn(),
  listConsigneesByTenant: vi.fn(),
  updateConsignee: vi.fn(),
  updateConsigneeCrmState: vi.fn(),
  deleteConsignee: vi.fn(),
  selectCrmHistoryForConsignee: vi.fn(),
  listAllConsigneesRows: vi.fn(),
}));

vi.mock("../../addresses", async () => {
  const actual = await vi.importActual<typeof import("../../addresses")>(
    "../../addresses",
  );
  return {
    ...actual,
    insertAddress: vi.fn(),
  };
});

vi.mock("../../subscriptions", async () => {
  const actual = await vi.importActual<typeof import("../../subscriptions")>(
    "../../subscriptions",
  );
  return {
    ...actual,
    insertSubscription: vi.fn(),
  };
});

import { withTenant } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { insertAddress } from "../../addresses";
import { insertSubscription } from "../../subscriptions";

import { insertConsignee } from "../repository";
import { createConsigneeWithSubscription } from "../onboarding";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const SUBSCRIPTION_ID = "22222222-2222-2222-2222-222222222222";
const ADDRESS_ID = "33333333-3333-3333-3333-333333333333";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockInsertConsignee = vi.mocked(insertConsignee);
const mockInsertAddress = vi.mocked(insertAddress);
const mockInsertSubscription = vi.mocked(insertSubscription);

function ctx(
  perms: readonly Permission[],
  tenantId: string | null = TENANT_ID,
): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/consignees/new",
  };
}

const VALID_INPUT = {
  consignee: {
    name: "Sarah Khouri",
    phone: "+971501234567",
    email: "sarah@example.com",
  },
  primaryAddress: {
    label: "home" as const,
    line: "Building 4, Apt 12",
    district: "Al Quoz",
    emirate: "Dubai",
  },
  subscription: {
    startDate: "2026-05-12",
    endDate: null,
    daysOfWeek: [1, 2, 3, 4, 5] as const,
    deliveryWindowStart: "09:00:00",
    deliveryWindowEnd: "11:00:00",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: withTenant invokes the inner callback with a stub tx.
  mockWithTenant.mockImplementation(async (_tenantId, fn) => {
    return fn({} as never);
  });
  mockInsertConsignee.mockResolvedValue({
    id: CONSIGNEE_ID,
    tenantId: TENANT_ID,
    name: "Sarah Khouri",
    phone: "+971501234567",
    email: "sarah@example.com",
    addressLine: "Building 4, Apt 12",
    emirateOrRegion: "Dubai",
    district: "Al Quoz",
    deliveryNotes: null,
    externalRef: null,
    notesInternal: null,
    crmState: "ACTIVE",
    createdAt: "2026-05-11T07:00:00.000Z",
    updatedAt: "2026-05-11T07:00:00.000Z",
  });
  mockInsertAddress.mockResolvedValue({
    id: ADDRESS_ID,
    consigneeId: CONSIGNEE_ID,
    tenantId: TENANT_ID,
    label: "home",
    isPrimary: true,
    line: "Building 4, Apt 12",
    district: "Al Quoz",
    emirate: "Dubai",
    lat: null,
    lng: null,
    createdAt: "2026-05-11T07:00:00.000Z",
    updatedAt: "2026-05-11T07:00:00.000Z",
  });
  mockInsertSubscription.mockResolvedValue({
    id: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    status: "active",
    startDate: "2026-05-12",
    endDate: null,
    daysOfWeek: [1, 2, 3, 4, 5],
    deliveryWindowStart: "09:00:00",
    deliveryWindowEnd: "11:00:00",
    deliveryAddressOverride: null,
    mealPlanName: null,
    externalRef: null,
    notesInternal: null,
    pausedAt: null,
    endedAt: null,
    createdAt: "2026-05-11T07:00:00.000Z",
    updatedAt: "2026-05-11T07:00:00.000Z",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConsigneeWithSubscription", () => {
  it("happy path: writes consignee + address + subscription in one tx + emits both audits", async () => {
    const result = await createConsigneeWithSubscription(
      ctx(["consignee:create", "subscription:create"]),
      VALID_INPUT,
    );

    expect(result.consignee.id).toBe(CONSIGNEE_ID);
    expect(result.subscription.id).toBe(SUBSCRIPTION_ID);
    expect(result.subscription.consigneeId).toBe(CONSIGNEE_ID);

    // Single withTenant call for atomicity.
    expect(mockWithTenant).toHaveBeenCalledTimes(1);
    expect(mockWithTenant).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));

    // 3 inserts inside the tx, in order.
    expect(mockInsertConsignee).toHaveBeenCalledTimes(1);
    expect(mockInsertAddress).toHaveBeenCalledTimes(1);
    expect(mockInsertSubscription).toHaveBeenCalledTimes(1);

    // Address row carries is_primary=true and references the new consignee.
    const addressCall = mockInsertAddress.mock.calls[0];
    expect(addressCall[1]).toBe(TENANT_ID);
    expect(addressCall[2]).toBe(CONSIGNEE_ID);
    expect(addressCall[3].isPrimary).toBe(true);
    expect(addressCall[3].label).toBe("home");

    // Two audit emits, post-commit, in order: consignee then subscription.
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit.mock.calls[0][0].eventType).toBe("consignee.created");
    expect(mockEmit.mock.calls[0][0].metadata).toMatchObject({
      onboarded_via: "wizard",
    });
    expect(mockEmit.mock.calls[1][0].eventType).toBe("subscription.created");
    expect(mockEmit.mock.calls[1][0].metadata).toMatchObject({
      onboarded_via: "wizard",
      consignee_id: CONSIGNEE_ID,
    });
  });

  it("denies when actor lacks consignee:create", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["subscription:create"]),
        VALID_INPUT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("denies when actor lacks subscription:create", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create"]),
        VALID_INPUT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects when ctx has no tenant", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"], null),
        VALID_INPUT,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("rejects empty consignee name", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"]),
        { ...VALID_INPUT, consignee: { ...VALID_INPUT.consignee, name: "  " } },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty days of week", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"]),
        { ...VALID_INPUT, subscription: { ...VALID_INPUT.subscription, daysOfWeek: [] } },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid weekday ordinal", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"]),
        {
          ...VALID_INPUT,
          subscription: { ...VALID_INPUT.subscription, daysOfWeek: [0, 1, 2] as never },
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects invalid address label", async () => {
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"]),
        {
          ...VALID_INPUT,
          primaryAddress: { ...VALID_INPUT.primaryAddress, label: "warehouse" as never },
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rolls back without emitting audits when insertSubscription throws inside tx", async () => {
    mockInsertSubscription.mockRejectedValueOnce(new Error("FK violation"));
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"]),
        VALID_INPUT,
      ),
    ).rejects.toThrow("FK violation");
    // The withTenant wrapper rolled the tx back; the audit emits live
    // post-commit, so they do NOT fire on the failed path.
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("invariant guard catches consigneeId mismatch from insertSubscription", async () => {
    mockInsertSubscription.mockResolvedValueOnce({
      id: SUBSCRIPTION_ID,
      tenantId: TENANT_ID,
      consigneeId: "deadbeef-dead-beef-dead-beefdeadbeef",
      status: "active",
      startDate: "2026-05-12",
      endDate: null,
      daysOfWeek: [1, 2, 3, 4, 5],
      deliveryWindowStart: "09:00:00",
      deliveryWindowEnd: "11:00:00",
      deliveryAddressOverride: null,
      mealPlanName: null,
      externalRef: null,
      notesInternal: null,
      pausedAt: null,
      endedAt: null,
      createdAt: "2026-05-11T07:00:00.000Z",
      updatedAt: "2026-05-11T07:00:00.000Z",
    });
    await expect(
      createConsigneeWithSubscription(
        ctx(["consignee:create", "subscription:create"]),
        VALID_INPUT,
      ),
    ).rejects.toThrow(/invariant/);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("mirrors primaryAddress fields into the consignee row inline columns", async () => {
    await createConsigneeWithSubscription(
      ctx(["consignee:create", "subscription:create"]),
      VALID_INPUT,
    );
    const consigneeCall = mockInsertConsignee.mock.calls[0];
    expect(consigneeCall[2].addressLine).toBe("Building 4, Apt 12");
    expect(consigneeCall[2].district).toBe("Al Quoz");
    expect(consigneeCall[2].emirateOrRegion).toBe("Dubai");
  });
});
