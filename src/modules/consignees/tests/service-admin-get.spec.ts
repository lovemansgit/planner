// Item 3 (22 Jun 2026) — getAdminConsigneeById: cross-tenant single-
// consignee fetch for the /admin/consignees/[id] detail view. Mirrors
// getMerchantById: gates consignee:read_all, runs findConsigneeById
// inside withServiceRole (RLS bypassed). Repository is mocked so the
// service contract is exercised without Postgres.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("../repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository")>();
  return { ...actual, findConsigneeById: vi.fn() };
});

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { findConsigneeById } from "../repository";
import { getAdminConsigneeById } from "../service";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockFind = vi.mocked(findConsigneeById);
const ID = "11111111-1111-1111-1111-111111111111";

function ctx(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: "00000000-0000-0000-0000-0000000000aa",
      tenantId: "00000000-0000-0000-0000-0000000000a0",
      permissions: new Set(perms),
    },
    tenantId: "00000000-0000-0000-0000-0000000000a0",
    requestId: "test",
    path: "/admin/consignees",
  };
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockFind.mockReset();
  mockWithServiceRole.mockImplementation((async (_l: string, fn: (tx: unknown) => unknown) =>
    fn({})) as never);
});

describe("getAdminConsigneeById", () => {
  it("throws ForbiddenError without consignee:read_all", async () => {
    await expect(getAdminConsigneeById(ctx([]), ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns the consignee via withServiceRole when permitted", async () => {
    const sentinel = { id: ID, name: "Aroma" } as never;
    mockFind.mockResolvedValue(sentinel);
    const result = await getAdminConsigneeById(ctx(["consignee:read_all"]), ID);
    expect(result).toBe(sentinel);
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockFind).toHaveBeenCalledWith(expect.anything(), ID);
  });

  it("returns null when the consignee does not exist", async () => {
    mockFind.mockResolvedValue(null);
    expect(await getAdminConsigneeById(ctx(["consignee:read_all"]), ID)).toBeNull();
  });
});
