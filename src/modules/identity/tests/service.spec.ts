// Identity service — deleteRoleAssignment + deleteUser unit tests.
//
// Mocks ../../shared/db (withTenant) and ../audit (emit) so we exercise
// the service-method flow — permission check, tenant context check,
// invariant precheck, mutation, post-commit audit — without standing
// up real Postgres or audit infra.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
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
import { deleteRoleAssignment, deleteUser } from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const ASSIGNMENT_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_USER_ID = "22222222-2222-2222-2222-222222222222";

function userCtx(
  perms: readonly Permission[],
  tenantId: string | null = TENANT_ID
): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/test",
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// deleteRoleAssignment
// -----------------------------------------------------------------------------

describe("deleteRoleAssignment", () => {
  it("throws ForbiddenError when the actor lacks role_assignment:delete", async () => {
    const ctx = userCtx([]);
    await expect(deleteRoleAssignment(ctx, ASSIGNMENT_ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null (system actor without tenant)", async () => {
    const ctx = userCtx(["role_assignment:delete"], null);
    await expect(deleteRoleAssignment(ctx, ASSIGNMENT_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("looks up the assignment, runs the invariant check, deletes, then audits", async () => {
    const ctx = userCtx(["role_assignment:delete"]);

    // The withTenant mock runs its callback against a stub tx whose
    // execute returns:
    //   1. assignment lookup (role_slug, user_id)
    //   2. invariant check #1 (total tenant-admins) — our test has 2
    //   3. invariant check #2 (removing-tenant-admins among ids) — our test has 0 (not an admin)
    //   4. DELETE FROM role_assignments
    const executed: unknown[] = [];
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi
          .fn()
          .mockResolvedValueOnce([{ role_slug: "ops-manager", user_id: TARGET_USER_ID }])
          .mockResolvedValueOnce([{ n: 2 }])
          .mockResolvedValueOnce([{ n: 0 }])
          .mockImplementation(async (q: unknown) => {
            executed.push(q);
            return [];
          }),
      };
      return fn(tx as never);
    });

    await deleteRoleAssignment(ctx, ASSIGNMENT_ID);

    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitCall = mockEmit.mock.calls[0][0];
    expect(emitCall.eventType).toBe("role_assignment.deleted");
    expect(emitCall.actorKind).toBe("user");
    expect(emitCall.actorId).toBe(ACTOR_USER_ID);
    expect(emitCall.tenantId).toBe(TENANT_ID);
    expect(emitCall.resourceId).toBe(ASSIGNMENT_ID);
    expect(emitCall.metadata).toEqual({
      role_slug: "ops-manager",
      target_user_id: TARGET_USER_ID,
    });
  });

  it("throws NotFoundError when the assignment id does not exist (and does NOT audit)", async () => {
    const ctx = userCtx(["role_assignment:delete"]);
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi.fn().mockResolvedValueOnce([]), // assignment lookup returns no rows
      };
      return fn(tx as never);
    });

    await expect(deleteRoleAssignment(ctx, ASSIGNMENT_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("propagates ConflictError from the invariant check (and does NOT audit)", async () => {
    const ctx = userCtx(["role_assignment:delete"]);
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi
          .fn()
          // assignment lookup — the assignment IS a tenant-admin
          .mockResolvedValueOnce([{ role_slug: "tenant-admin", user_id: TARGET_USER_ID }])
          // invariant: total=1 admin
          .mockResolvedValueOnce([{ n: 1 }])
          // invariant: removingAdmins=1 (this assignment IS the admin)
          .mockResolvedValueOnce([{ n: 1 }]),
      };
      return fn(tx as never);
    });

    await expect(deleteRoleAssignment(ctx, ASSIGNMENT_ID)).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// deleteUser
// -----------------------------------------------------------------------------

describe("deleteUser", () => {
  it("throws ForbiddenError when the actor lacks user:delete", async () => {
    const ctx = userCtx([]);
    await expect(deleteUser(ctx, TARGET_USER_ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    const ctx = userCtx(["user:delete"], null);
    await expect(deleteUser(ctx, TARGET_USER_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("captures the email pre-delete and emits user.deleted with email metadata", async () => {
    const ctx = userCtx(["user:delete"]);
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi
          .fn()
          // user lookup
          .mockResolvedValueOnce([{ email: "alice@example.test" }])
          // assignments lookup (the user has none — non-admin user)
          .mockResolvedValueOnce([])
          // (no invariant calls because assignmentIds is empty)
          // DELETE FROM users
          .mockResolvedValueOnce([]),
      };
      return fn(tx as never);
    });

    await deleteUser(ctx, TARGET_USER_ID);

    expect(mockEmit).toHaveBeenCalledOnce();
    const emitCall = mockEmit.mock.calls[0][0];
    expect(emitCall.eventType).toBe("user.deleted");
    expect(emitCall.resourceId).toBe(TARGET_USER_ID);
    expect(emitCall.metadata).toEqual({ email: "alice@example.test" });
  });

  it("throws NotFoundError when the user does not exist", async () => {
    const ctx = userCtx(["user:delete"]);
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi.fn().mockResolvedValueOnce([]), // user lookup empty
      };
      return fn(tx as never);
    });
    await expect(deleteUser(ctx, TARGET_USER_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("propagates ConflictError when deleting the user would orphan the tenant", async () => {
    const ctx = userCtx(["user:delete"]);
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi
          .fn()
          // user lookup
          .mockResolvedValueOnce([{ email: "lastadmin@example.test" }])
          // user has 1 assignment
          .mockResolvedValueOnce([{ id: ASSIGNMENT_ID }])
          // invariant: total tenant-admins = 1
          .mockResolvedValueOnce([{ n: 1 }])
          // invariant: removingAdmins = 1 (the user's only assignment IS the last admin)
          .mockResolvedValueOnce([{ n: 1 }]),
      };
      return fn(tx as never);
    });

    await expect(deleteUser(ctx, TARGET_USER_ID)).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("permits deletion when the user is not the last tenant-admin", async () => {
    const ctx = userCtx(["user:delete"]);
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi
          .fn()
          .mockResolvedValueOnce([{ email: "bob@example.test" }])
          .mockResolvedValueOnce([{ id: ASSIGNMENT_ID }])
          // total tenant-admins = 2, removingAdmins = 1 → 1 remains, OK
          .mockResolvedValueOnce([{ n: 2 }])
          .mockResolvedValueOnce([{ n: 1 }])
          .mockResolvedValueOnce([]),
      };
      return fn(tx as never);
    });

    await expect(deleteUser(ctx, TARGET_USER_ID)).resolves.toBeUndefined();
    expect(mockEmit).toHaveBeenCalledOnce();
  });
});
