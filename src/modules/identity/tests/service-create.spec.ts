// Day-24 — Unit tests for createUser + createRoleAssignment +
// listAllUsers permission gates and cross-tenant escalation rules.
//
// The auth-admin SDK is the third-party boundary and is mocked here;
// SQL-shape correctness is exercised against real Postgres in the
// sibling integration specs at tests/integration/identity-*.spec.ts
// per Day-23 §F discipline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../auth-admin", () => ({
  createOrFetchAuthUser: vi.fn(),
  AuthAdminError: class AuthAdminError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "AuthAdminError";
    }
  },
}));

import { withServiceRole, withTenant } from "../../../shared/db";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { createOrFetchAuthUser } from "../auth-admin";
import {
  createRoleAssignment,
  createUser,
  listAllUsers,
} from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockCreateAuthUser = vi.mocked(createOrFetchAuthUser);

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const AUTH_USER_ID = "11111111-1111-1111-1111-111111111111";

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
    path: "/test",
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockCreateAuthUser.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

describe("createUser — permission gate", () => {
  it("throws ForbiddenError when the actor lacks user:create", async () => {
    const ctx = userCtx([]);
    await expect(
      createUser(ctx, {
        email: "x@example.com",
        password: "longenough",
        fullName: "X",
        tenantId: TENANT_A,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockCreateAuthUser).not.toHaveBeenCalled();
  });
});

describe("createUser — input validation", () => {
  const baseInput = {
    email: "x@example.com",
    password: "longenough",
    fullName: "X",
    tenantId: TENANT_A,
  };
  const ctx = userCtx(["user:create"]);

  it("rejects malformed email", async () => {
    await expect(
      createUser(ctx, { ...baseInput, email: "not-an-email" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects empty email", async () => {
    await expect(
      createUser(ctx, { ...baseInput, email: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects passwords shorter than 8 chars", async () => {
    await expect(
      createUser(ctx, { ...baseInput, password: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("createUser — cross-tenant escalation gate", () => {
  const baseInput = {
    email: "x@example.com",
    password: "longenough",
    fullName: "X",
    tenantId: TENANT_B,
  };

  it("rejects cross-tenant write when actor lacks merchant:read_all", async () => {
    const ctx = userCtx(["user:create"], TENANT_A);
    await expect(createUser(ctx, baseInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockCreateAuthUser).not.toHaveBeenCalled();
  });

  it("allows cross-tenant write when actor carries merchant:read_all", async () => {
    const ctx = userCtx(["user:create", "merchant:read_all"], TENANT_A);
    mockCreateAuthUser.mockResolvedValueOnce({
      authUserId: AUTH_USER_ID,
      created: true,
    });
    mockWithServiceRole.mockImplementation(async (_label, fn) =>
      fn({ execute: vi.fn().mockResolvedValue([]) } as never),
    );

    const result = await createUser(ctx, baseInput);

    expect(result).toEqual({ userId: AUTH_USER_ID, authUserCreated: true });
    expect(mockWithServiceRole).toHaveBeenCalledTimes(1);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user.created",
        tenantId: TENANT_B,
      }),
    );
  });

  it("uses withTenant (not withServiceRole) when writing to actor's own tenant", async () => {
    const ctx = userCtx(["user:create"], TENANT_A);
    mockCreateAuthUser.mockResolvedValueOnce({
      authUserId: AUTH_USER_ID,
      created: true,
    });
    mockWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({ execute: vi.fn().mockResolvedValue([]) } as never),
    );

    await createUser(ctx, { ...baseInput, tenantId: TENANT_A });

    expect(mockWithTenant).toHaveBeenCalledTimes(1);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });
});

describe("createUser — auth admin error mapping", () => {
  it("maps AuthAdminError to ConflictError", async () => {
    const ctx = userCtx(["user:create"], TENANT_A);
    const { AuthAdminError } = await import("../auth-admin");
    mockCreateAuthUser.mockRejectedValueOnce(new AuthAdminError("downstream failed"));

    await expect(
      createUser(ctx, {
        email: "x@example.com",
        password: "longenough",
        fullName: "X",
        tenantId: TENANT_A,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// createRoleAssignment
// ---------------------------------------------------------------------------

describe("createRoleAssignment — permission gate", () => {
  it("throws ForbiddenError when the actor lacks role_assignment:create", async () => {
    const ctx = userCtx([]);
    await expect(
      createRoleAssignment(ctx, {
        userId: AUTH_USER_ID,
        roleSlug: "tenant-admin",
        tenantId: TENANT_A,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createRoleAssignment — cross-tenant escalation gate", () => {
  it("rejects cross-tenant write when actor lacks merchant:read_all", async () => {
    const ctx = userCtx(["role_assignment:create"], TENANT_A);
    await expect(
      createRoleAssignment(ctx, {
        userId: AUTH_USER_ID,
        roleSlug: "tenant-admin",
        tenantId: TENANT_B,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createRoleAssignment — role slug validation", () => {
  it("throws ValidationError for an unknown role slug", async () => {
    const ctx = userCtx(["role_assignment:create"], TENANT_A);
    await expect(
      createRoleAssignment(ctx, {
        userId: AUTH_USER_ID,
        roleSlug: "made-up-role" as never,
        tenantId: TENANT_A,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// listAllUsers
// ---------------------------------------------------------------------------

describe("listAllUsers — permission gate", () => {
  it("throws ForbiddenError when actor lacks merchant:read_all", async () => {
    const ctx = userCtx([]);
    await expect(listAllUsers(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("calls withServiceRole when actor carries merchant:read_all", async () => {
    const ctx = userCtx(["merchant:read_all"]);
    const stubTx = { execute: vi.fn().mockResolvedValueOnce([]) };
    mockWithServiceRole.mockImplementation(async (_label, fn) => fn(stubTx as never));

    const result = await listAllUsers(ctx);

    expect(result).toEqual([]);
    expect(mockWithServiceRole).toHaveBeenCalledTimes(1);
    // SQL shape is exercised against real Postgres in the integration
    // spec; here we just confirm the entry path runs through.
    expect(stubTx.execute).toHaveBeenCalledTimes(1);
  });
});
