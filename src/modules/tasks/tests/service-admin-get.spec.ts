// Item 3 (22 Jun 2026) — getAdminTaskById: cross-tenant single-task
// fetch for /admin/tasks/[id]. Gates task:read_all, runs findTaskById
// inside withServiceRole.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock("../repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository")>();
  return { ...actual, findTaskById: vi.fn() };
});

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { findTaskById } from "../repository";
import { getAdminTaskById } from "../service";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockFind = vi.mocked(findTaskById);
const ID = "33333333-3333-3333-3333-333333333333";

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
    path: "/admin/tasks",
  };
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockFind.mockReset();
  mockWithServiceRole.mockImplementation((async (_l: string, fn: (tx: unknown) => unknown) =>
    fn({})) as never);
});

describe("getAdminTaskById", () => {
  it("throws ForbiddenError without task:read_all", async () => {
    await expect(getAdminTaskById(ctx([]), ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns the task via withServiceRole when permitted", async () => {
    const sentinel = { id: ID, internalStatus: "SCHEDULED" } as never;
    mockFind.mockResolvedValue(sentinel);
    const result = await getAdminTaskById(ctx(["task:read_all"]), ID);
    expect(result).toBe(sentinel);
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockFind).toHaveBeenCalledWith(expect.anything(), ID);
  });

  it("returns null when the task does not exist", async () => {
    mockFind.mockResolvedValue(null);
    expect(await getAdminTaskById(ctx(["task:read_all"]), ID)).toBeNull();
  });
});
