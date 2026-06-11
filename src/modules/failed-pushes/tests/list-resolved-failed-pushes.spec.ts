// listResolvedFailedPushes unit tests — Day-53 R12 (resolved-rows page).
//
// Mocks shared/db (withTenant) and the repository boundary
// (listResolvedByTenant) so we exercise the permission gate +
// tenant-context flow without real Postgres. Mirrors
// list-failed-push-task-ids-for-tenant.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../repository", () => ({
  listResolvedByTenant: vi.fn(),
}));

import { withTenant } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { listResolvedByTenant } from "../repository";
import { listResolvedFailedPushes, type ResolvedFailedPush } from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockList = vi.mocked(listResolvedByTenant);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";

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
    path: "/admin/failed-pushes/resolved",
  };
}

const ROW: ResolvedFailedPush = {
  id: "22222222-2222-2222-2222-222222222222",
  taskId: "11111111-1111-1111-1111-111111111111",
  failureReason: "network",
  httpStatus: null,
  attemptCount: 2,
  firstFailedAt: "2026-06-10T09:00:00.000Z",
  resolvedAt: "2026-06-11T12:00:00.000Z",
  resolvedByEmail: "ops@mpl.example",
  resolutionNotes: "verified fixed upstream",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWithTenant.mockImplementation(async (_tenantId, fn) => fn({} as never));
  mockList.mockResolvedValue([ROW]);
});

describe("listResolvedFailedPushes", () => {
  it("returns repository rows verbatim for a permitted tenant actor", async () => {
    const rows = await listResolvedFailedPushes(ctx(["failed_pushes:retry"]));
    expect(rows).toEqual([ROW]);
    expect(mockWithTenant).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(mockList).toHaveBeenCalledWith(expect.anything(), TENANT_ID);
  });

  it("throws ForbiddenError without failed_pushes:retry (the work-queue page's own gate)", async () => {
    await expect(
      listResolvedFailedPushes(ctx(["failed_pushes:read"])),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("throws ValidationError without a tenant context", async () => {
    await expect(
      listResolvedFailedPushes(ctx(["failed_pushes:retry"], null)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockList).not.toHaveBeenCalled();
  });
});
