// Item 3 (22 Jun 2026) — getAdminSubscriptionById: cross-tenant single-
// subscription fetch for /admin/subscriptions/[id]. Gates
// subscription:read_all, runs findSubscriptionById inside withServiceRole.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("../repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository")>();
  return { ...actual, findSubscriptionById: vi.fn() };
});

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { findSubscriptionById } from "../repository";
import { getAdminSubscriptionById } from "../service";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockFind = vi.mocked(findSubscriptionById);
const ID = "22222222-2222-2222-2222-222222222222";

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
    path: "/admin/subscriptions",
  };
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockFind.mockReset();
  mockWithServiceRole.mockImplementation((async (_l: string, fn: (tx: unknown) => unknown) =>
    fn({})) as never);
});

describe("getAdminSubscriptionById", () => {
  it("throws ForbiddenError without subscription:read_all", async () => {
    await expect(getAdminSubscriptionById(ctx([]), ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns the subscription via withServiceRole when permitted", async () => {
    const sentinel = { id: ID, status: "active" } as never;
    mockFind.mockResolvedValue(sentinel);
    const result = await getAdminSubscriptionById(ctx(["subscription:read_all"]), ID);
    expect(result).toBe(sentinel);
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockFind).toHaveBeenCalledWith(expect.anything(), ID);
  });

  it("returns null when the subscription does not exist", async () => {
    mockFind.mockResolvedValue(null);
    expect(await getAdminSubscriptionById(ctx(["subscription:read_all"]), ID)).toBeNull();
  });
});
