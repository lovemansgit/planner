// Item 2 (22 Jun 2026) — unit tests for the admin user-edit write path:
// getUserById (detail view), updateUser (display name), changeUserRole
// (cross-tenant role swap with the C-21 last-tenant-admin invariant).
//
// Mirrors service-disable-enable.spec.ts: the DB layer (withServiceRole /
// withTenant) and the C-21 invariant helper are mocked so the service
// flow — permission gate, cross-tenant gate, target resolution, the
// genuine-tenant hide on getUserById, the role-swap ordering, and the
// audit emits — is exercised without real Postgres.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../tenant-admin-invariant", () => ({
  assertCanRemoveAssignments: vi.fn().mockResolvedValue(undefined),
}));

import { withServiceRole, withTenant } from "../../../shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { changeUserRole, getUserById, updateUser } from "../service";
import { assertCanRemoveAssignments } from "../tenant-admin-invariant";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockAssertCanRemove = vi.mocked(assertCanRemoveAssignments);

const TENANT_A = "00000000-0000-0000-0000-00000000000a"; // actor's tenant (transcorp)
const TENANT_M = "00000000-0000-0000-0000-00000000000m"; // a merchant tenant
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const TARGET_USER_ID = "11111111-1111-1111-1111-111111111111";
const ASSIGNMENT_ID = "22222222-2222-2222-2222-222222222222";
const NEW_ASSIGNMENT_ID = "33333333-3333-3333-3333-333333333333";

function userCtx(
  perms: readonly Permission[],
  tenantId: string | null = TENANT_A,
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
    path: "/admin/users",
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockAssertCanRemove.mockReset();
  mockAssertCanRemove.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getUserById
// ---------------------------------------------------------------------------

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: TARGET_USER_ID,
    email: "ops@demo-bistro.test",
    display_name: "Ops One",
    tenant_id: TENANT_M,
    tenant_slug: "demo-bistro",
    tenant_name: "Demo Bistro",
    tenant_status: "active",
    role_slugs: ["ops-manager"],
    created_at: "2026-06-01T00:00:00.000Z",
    disabled_at: null,
    ...overrides,
  };
}

describe("getUserById — permission gate", () => {
  it("throws ForbiddenError when the actor lacks merchant:read_all", async () => {
    await expect(getUserById(userCtx([]), TARGET_USER_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });
});

describe("getUserById — fetch + mapping", () => {
  it("returns the mapped AdminUserRow for a genuine-tenant user", async () => {
    mockWithServiceRole.mockImplementation(async (_label, fn) =>
      fn({ execute: vi.fn().mockResolvedValueOnce([userRow()]) } as never),
    );
    const result = await getUserById(userCtx(["merchant:read_all"]), TARGET_USER_ID);
    expect(result).toEqual({
      userId: TARGET_USER_ID,
      email: "ops@demo-bistro.test",
      displayName: "Ops One",
      tenantId: TENANT_M,
      tenantSlug: "demo-bistro",
      tenantName: "Demo Bistro",
      roleSlugs: ["ops-manager"],
      createdAt: "2026-06-01T00:00:00.000Z",
      disabledAt: null,
    });
  });

  it("returns null when the user does not exist", async () => {
    mockWithServiceRole.mockImplementation(async (_label, fn) =>
      fn({ execute: vi.fn().mockResolvedValueOnce([]) } as never),
    );
    expect(
      await getUserById(userCtx(["merchant:read_all"]), TARGET_USER_ID),
    ).toBeNull();
  });

  it("returns null for a user belonging to an automated-test tenant (respects Item 1)", async () => {
    mockWithServiceRole.mockImplementation(async (_label, fn) =>
      fn({
        execute: vi
          .fn()
          .mockResolvedValueOnce([
            userRow({ tenant_slug: "churn-09f782ed", tenant_name: "CHURN TEST" }),
          ]),
      } as never),
    );
    expect(
      await getUserById(userCtx(["merchant:read_all"]), TARGET_USER_ID),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateUser (display name)
// ---------------------------------------------------------------------------

/** withServiceRole call #1 = fetchUserForDisableEnable lookup; call #2 = the UPDATE writer. */
function setupUpdateLookup(args: { tenantId: string; email?: string }) {
  let lookupCalled = false;
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    if (!lookupCalled) {
      lookupCalled = true;
      return fn({
        execute: vi.fn().mockResolvedValueOnce([
          { tenant_id: args.tenantId, email: args.email ?? "x@y.test", disabled_at: null },
        ]),
      } as never);
    }
    return fn({ execute: vi.fn().mockResolvedValue([{ id: TARGET_USER_ID }]) } as never);
  });
}

describe("updateUser — permission + cross-tenant gates", () => {
  it("throws ForbiddenError when the actor lacks user:update", async () => {
    await expect(
      updateUser(userCtx([]), { userId: TARGET_USER_ID, displayName: "X" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the user does not exist", async () => {
    mockWithServiceRole.mockImplementation(async (_label, fn) =>
      fn({ execute: vi.fn().mockResolvedValueOnce([]) } as never),
    );
    await expect(
      updateUser(userCtx(["user:update", "merchant:read_all"]), {
        userId: TARGET_USER_ID,
        displayName: "X",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ForbiddenError on a cross-tenant edit without merchant:read_all", async () => {
    mockWithServiceRole.mockImplementation(async (_label, fn) =>
      fn({
        execute: vi
          .fn()
          .mockResolvedValueOnce([{ tenant_id: TENANT_M, email: "x@y.test", disabled_at: null }]),
      } as never),
    );
    await expect(
      updateUser(userCtx(["user:update"], TENANT_A), {
        userId: TARGET_USER_ID,
        displayName: "X",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("updateUser — display-name write", () => {
  it("updates display_name and emits user.updated (cross-tenant → withServiceRole)", async () => {
    setupUpdateLookup({ tenantId: TENANT_M, email: "ops@demo.test" });
    await updateUser(userCtx(["user:update", "merchant:read_all"], TENANT_A), {
      userId: TARGET_USER_ID,
      displayName: "  New Name  ",
    });
    expect(mockEmit).toHaveBeenCalledOnce();
    const event = mockEmit.mock.calls[0][0];
    expect(event.eventType).toBe("user.updated");
    expect(event.resourceId).toBe(TARGET_USER_ID);
    expect(event.metadata).toMatchObject({ display_name: "New Name" });
  });

  it("normalises an all-whitespace name to null (clears it)", async () => {
    setupUpdateLookup({ tenantId: TENANT_M });
    await updateUser(userCtx(["user:update", "merchant:read_all"], TENANT_A), {
      userId: TARGET_USER_ID,
      displayName: "   ",
    });
    const event = mockEmit.mock.calls[0][0];
    expect(event.metadata).toMatchObject({ display_name: null });
  });
});

// ---------------------------------------------------------------------------
// changeUserRole
// ---------------------------------------------------------------------------

/**
 * withServiceRole call #1 = fetchUserForDisableEnable lookup.
 * call #2 = runChangeUserRole, whose tx.execute is called in this order:
 *   1. SELECT tenant slug
 *   2. SELECT new role id
 *   3. SELECT current assignments
 *   4. INSERT new assignment RETURNING id
 *   5. DELETE removed assignments
 */
function setupRoleChange(args: {
  tenantId: string;
  tenantSlug: string;
  current: ReadonlyArray<{ id: string; slug: string }>;
}) {
  let lookupCalled = false;
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    if (!lookupCalled) {
      lookupCalled = true;
      return fn({
        execute: vi.fn().mockResolvedValueOnce([
          { tenant_id: args.tenantId, email: "x@y.test", disabled_at: null },
        ]),
      } as never);
    }
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ slug: args.tenantSlug }]) // tenant slug
      .mockResolvedValueOnce([{ id: "role-id-new" }]) // new role id
      .mockResolvedValueOnce(args.current.map((a) => ({ id: a.id, slug: a.slug }))) // current
      .mockResolvedValueOnce([{ id: NEW_ASSIGNMENT_ID }]) // insert
      .mockResolvedValueOnce([]); // delete
    return fn({ execute } as never);
  });
}

describe("changeUserRole — gates + validation", () => {
  it("throws ForbiddenError when the actor lacks role_assignment perms", async () => {
    await expect(
      changeUserRole(userCtx(["user:update"]), {
        userId: TARGET_USER_ID,
        roleSlug: "ops-manager",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError for an unknown role slug", async () => {
    await expect(
      changeUserRole(
        userCtx(["role_assignment:create", "role_assignment:delete", "merchant:read_all"]),
        // @ts-expect-error — deliberately invalid slug
        { userId: TARGET_USER_ID, roleSlug: "wizard" },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ConflictError assigning transcorp-sysadmin to a merchant tenant", async () => {
    setupRoleChange({
      tenantId: TENANT_M,
      tenantSlug: "demo-bistro",
      current: [{ id: ASSIGNMENT_ID, slug: "ops-manager" }],
    });
    await expect(
      changeUserRole(
        userCtx(["role_assignment:create", "role_assignment:delete", "merchant:read_all"]),
        { userId: TARGET_USER_ID, roleSlug: "transcorp-sysadmin" },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("changeUserRole — swap behaviour", () => {
  const perms: Permission[] = [
    "role_assignment:create",
    "role_assignment:delete",
    "merchant:read_all",
  ];

  it("no-ops (no emit) when the user already holds exactly the target role", async () => {
    setupRoleChange({
      tenantId: TENANT_M,
      tenantSlug: "demo-bistro",
      current: [{ id: ASSIGNMENT_ID, slug: "ops-manager" }],
    });
    await changeUserRole(userCtx(perms), {
      userId: TARGET_USER_ID,
      roleSlug: "ops-manager",
    });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("swaps role: checks C-21, creates the new assignment, emits created + deleted", async () => {
    setupRoleChange({
      tenantId: TENANT_M,
      tenantSlug: "demo-bistro",
      current: [{ id: ASSIGNMENT_ID, slug: "ops-manager" }],
    });
    await changeUserRole(userCtx(perms), {
      userId: TARGET_USER_ID,
      roleSlug: "tenant-admin",
    });
    expect(mockAssertCanRemove).toHaveBeenCalledOnce();
    const events = mockEmit.mock.calls.map((c) => c[0].eventType);
    expect(events).toContain("role_assignment.created");
    expect(events).toContain("role_assignment.deleted");
  });

  it("propagates the C-21 ConflictError (last tenant-admin demotion) and emits nothing", async () => {
    setupRoleChange({
      tenantId: TENANT_M,
      tenantSlug: "demo-bistro",
      current: [{ id: ASSIGNMENT_ID, slug: "tenant-admin" }],
    });
    mockAssertCanRemove.mockRejectedValueOnce(
      new ConflictError("cannot remove the last Tenant Admin"),
    );
    await expect(
      changeUserRole(userCtx(perms), {
        userId: TARGET_USER_ID,
        roleSlug: "ops-manager",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
