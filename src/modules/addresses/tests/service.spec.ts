// Addresses service-layer unit tests — Day 53 / add-a-second-address lane.
//
// First spec file for this module (the v1 surface was read-only).
// Mocks ../../shared/db (withTenant) and ../../audit (emit) so we
// exercise permission, tenant-context, validation, and audit-emit flow
// without real Postgres — same pattern as consignees/tests/service.spec.ts.
// Repository functions are mocked at the source-module boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  insertAddress: vi.fn(),
  listAddressesByConsignee: vi.fn(),
  findAddressById: vi.fn(),
  consigneeExistsInTenant: vi.fn(),
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

import { consigneeExistsInTenant, insertAddress } from "../repository";
import { createAddress } from "../service";
import type { Address } from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);
const mockInsertAddress = vi.mocked(insertAddress);
const mockConsigneeExists = vi.mocked(consigneeExistsInTenant);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const ADDRESS_ID = "33333333-3333-3333-3333-333333333333";

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
    path: `/consignees/${CONSIGNEE_ID}`,
  };
}

function addressFixture(overrides: Partial<Address> = {}): Address {
  return {
    id: ADDRESS_ID,
    consigneeId: CONSIGNEE_ID,
    tenantId: TENANT_ID,
    label: "office",
    isPrimary: false,
    line: "Office Tower 3, Floor 12",
    district: "DIFC",
    emirate: "Dubai",
    lat: null,
    lng: null,
    createdAt: "2026-06-11T10:00:00.000Z",
    updatedAt: "2026-06-11T10:00:00.000Z",
    ...overrides,
  };
}

const VALID_INPUT = {
  label: "office" as const,
  line: "Office Tower 3, Floor 12",
  district: "DIFC",
  emirate: "Dubai",
};

beforeEach(() => {
  vi.clearAllMocks();
  // withTenant runs its callback against a stub tx — RLS behavior is
  // integration-tested; unit scope is the service-layer flow.
  mockWithTenant.mockImplementation(async (_tenantId, fn) =>
    fn({} as never),
  );
  mockConsigneeExists.mockResolvedValue(true);
  mockInsertAddress.mockResolvedValue(addressFixture());
});

describe("createAddress", () => {
  it("inserts a non-primary address and returns it", async () => {
    const result = await createAddress(ctx(["consignee:update"]), CONSIGNEE_ID, VALID_INPUT);

    expect(result.id).toBe(ADDRESS_ID);
    expect(result.isPrimary).toBe(false);
    expect(mockInsertAddress).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      CONSIGNEE_ID,
      expect.objectContaining({
        label: "office",
        isPrimary: false,
        line: "Office Tower 3, Floor 12",
        district: "DIFC",
        emirate: "Dubai",
      }),
    );
  });

  it("never passes isPrimary: true to the repository, whatever the input claims", async () => {
    // The add-address surface is non-primary by design (plan §4) — the
    // partial UNIQUE on (consignee_id) WHERE is_primary=true must be
    // unreachable from here even if a caller smuggles a flag in.
    await createAddress(
      ctx(["consignee:update"]),
      CONSIGNEE_ID,
      { ...VALID_INPUT, isPrimary: true } as typeof VALID_INPUT,
    );
    const input = mockInsertAddress.mock.calls[0][3];
    expect(input.isPrimary).toBe(false);
  });

  it("emits consignee.address.added post-commit with the typed metadata", async () => {
    await createAddress(ctx(["consignee:update"]), CONSIGNEE_ID, VALID_INPUT);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "consignee.address.added",
        actorKind: "user",
        actorId: ACTOR_USER_ID,
        tenantId: TENANT_ID,
        resourceType: "consignee",
        resourceId: CONSIGNEE_ID,
        metadata: {
          consignee_id: CONSIGNEE_ID,
          address_id: ADDRESS_ID,
          label: "office",
          is_primary: false,
        },
        requestId: "test-request",
      }),
    );
  });

  it("throws ForbiddenError without consignee:update and does not insert or emit", async () => {
    await expect(
      createAddress(ctx(["consignee:read"]), CONSIGNEE_ID, VALID_INPUT),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockInsertAddress).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError without a tenant context", async () => {
    await expect(
      createAddress(ctx(["consignee:update"], null), CONSIGNEE_ID, VALID_INPUT),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsertAddress).not.toHaveBeenCalled();
  });

  it("rejects an invalid label", async () => {
    await expect(
      createAddress(ctx(["consignee:update"]), CONSIGNEE_ID, {
        ...VALID_INPUT,
        label: "warehouse" as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsertAddress).not.toHaveBeenCalled();
  });

  it.each([
    ["line", { ...VALID_INPUT, line: "   " }],
    ["district", { ...VALID_INPUT, district: "" }],
    ["emirate", { ...VALID_INPUT, emirate: "  " }],
  ])("rejects empty/whitespace-only %s", async (_field, input) => {
    await expect(
      createAddress(ctx(["consignee:update"]), CONSIGNEE_ID, input),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsertAddress).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the consignee is missing or RLS-hidden, and does not insert or emit", async () => {
    // Cross-tenant consignee ids land here too: the existence probe runs
    // under withTenant, so RLS hides other tenants' rows (default-deny —
    // indistinguishable from "no such consignee").
    mockConsigneeExists.mockResolvedValue(false);
    await expect(
      createAddress(ctx(["consignee:update"]), CONSIGNEE_ID, VALID_INPUT),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockInsertAddress).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("trims whitespace from text fields before insert", async () => {
    await createAddress(ctx(["consignee:update"]), CONSIGNEE_ID, {
      label: "other",
      line: "  Unit 7  ",
      district: " Al Quoz ",
      emirate: " Dubai ",
    });
    const input = mockInsertAddress.mock.calls[0][3];
    expect(input.line).toBe("Unit 7");
    expect(input.district).toBe("Al Quoz");
    expect(input.emirate).toBe("Dubai");
  });
});
