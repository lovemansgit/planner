// Day-24 — Unit tests for disableUser + enableUser permission gates,
// self-disable block, cross-tenant escalation, idempotency
// transitioned-flag computation, and auth admin SDK error mapping.
//
// The auth-admin SDK is the third-party boundary and is mocked here;
// the pure-Postgres disableUserInDb / enableUserInDb SQL paths are
// exercised against real Postgres in the integration spec at
// tests/integration/identity-disable-enable-flow.spec.ts per Day-23
// §F discipline.

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
  disableAuthUser: vi.fn(),
  enableAuthUser: vi.fn(),
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
  NotFoundError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { disableAuthUser, enableAuthUser } from "../auth-admin";
import { disableUser, enableUser } from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockDisableAuth = vi.mocked(disableAuthUser);
const mockEnableAuth = vi.mocked(enableAuthUser);

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const TARGET_USER_ID = "11111111-1111-1111-1111-111111111111";

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

/**
 * Sets up `withServiceRole` to first return the user-lookup row
 * (`fetchUserForDisableEnable`), and then defer to the writer fn for
 * the actual disable / enable. The first call to withServiceRole is
 * always the lookup; the second call (if any) is the mutation under
 * the cross-tenant branch.
 */
function setupLookupAndMutation(args: {
  readonly targetTenantId: string;
  readonly email: string;
  readonly disabledAt: string | null;
}) {
  let lookupCalled = false;
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    if (!lookupCalled) {
      lookupCalled = true;
      const stubTx = {
        execute: vi.fn().mockResolvedValueOnce([
          {
            tenant_id: args.targetTenantId,
            email: args.email,
            disabled_at: args.disabledAt,
          },
        ]),
      };
      return fn(stubTx as never);
    }
    // Subsequent calls = the disable/enable mutation under the
    // cross-tenant branch.
    return fn({ execute: vi.fn().mockResolvedValue([]) } as never);
  });
}

function setupLookupMissing() {
  mockWithServiceRole.mockImplementation(async (_label, fn) =>
    fn({ execute: vi.fn().mockResolvedValueOnce([]) } as never),
  );
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockDisableAuth.mockReset();
  mockEnableAuth.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// disableUser
// ---------------------------------------------------------------------------

describe("disableUser — permission gate", () => {
  it("throws ForbiddenError when the actor lacks user:update", async () => {
    const ctx = userCtx([]);
    await expect(disableUser(ctx, { userId: TARGET_USER_ID })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockDisableAuth).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("disableUser — self-disable block", () => {
  it("throws ConflictError when the actor targets their own userId", async () => {
    const ctx = userCtx(["user:update"]);
    await expect(
      disableUser(ctx, { userId: ACTOR_USER_ID }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockDisableAuth).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("disableUser — cross-tenant escalation gate", () => {
  it("rejects cross-tenant disable when actor lacks merchant:read_all", async () => {
    const ctx = userCtx(["user:update"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: null,
    });
    await expect(
      disableUser(ctx, { userId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockDisableAuth).not.toHaveBeenCalled();
  });

  it("allows cross-tenant disable when actor carries merchant:read_all", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: null,
    });
    mockDisableAuth.mockResolvedValueOnce();

    const result = await disableUser(ctx, {
      userId: TARGET_USER_ID,
      reason: "Left the company",
    });

    expect(result).toEqual({ userId: TARGET_USER_ID, transitioned: true });
    expect(mockDisableAuth).toHaveBeenCalledWith(TARGET_USER_ID);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user.disabled",
        tenantId: TENANT_B,
        resourceId: TARGET_USER_ID,
        metadata: expect.objectContaining({
          email: "target@example.com",
          reason: "Left the company",
        }),
      }),
    );
  });

  it("uses withTenant (not withServiceRole) for same-tenant mutation", async () => {
    const ctx = userCtx(["user:update"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_A,
      email: "target@example.com",
      disabledAt: null,
    });
    mockWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({ execute: vi.fn().mockResolvedValue([]) } as never),
    );
    mockDisableAuth.mockResolvedValueOnce();

    await disableUser(ctx, { userId: TARGET_USER_ID });

    // First withServiceRole call = the lookup; the mutation runs
    // under withTenant for the same-tenant branch.
    expect(mockWithServiceRole).toHaveBeenCalledTimes(1);
    expect(mockWithTenant).toHaveBeenCalledTimes(1);
  });
});

describe("disableUser — idempotency / transitioned flag", () => {
  it("reports transitioned=true when disabling an enabled user", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: null,
    });
    mockDisableAuth.mockResolvedValueOnce();
    const result = await disableUser(ctx, { userId: TARGET_USER_ID });
    expect(result.transitioned).toBe(true);
  });

  it("reports transitioned=false when re-disabling an already-disabled user", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: "2026-05-12T10:00:00Z",
    });
    mockDisableAuth.mockResolvedValueOnce();
    const result = await disableUser(ctx, { userId: TARGET_USER_ID });
    expect(result.transitioned).toBe(false);
  });
});

describe("disableUser — not found + auth SDK error mapping", () => {
  it("throws NotFoundError when the user lookup returns no rows", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"]);
    setupLookupMissing();
    await expect(
      disableUser(ctx, { userId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockDisableAuth).not.toHaveBeenCalled();
  });

  it("maps AuthAdminError to ConflictError", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"]);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: null,
    });
    const { AuthAdminError } = await import("../auth-admin");
    mockDisableAuth.mockRejectedValueOnce(new AuthAdminError("auth down"));
    await expect(
      disableUser(ctx, { userId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enableUser
// ---------------------------------------------------------------------------

describe("enableUser — permission gate + symmetric guarantees", () => {
  it("throws ForbiddenError when the actor lacks user:update", async () => {
    const ctx = userCtx([]);
    await expect(enableUser(ctx, { userId: TARGET_USER_ID })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mockEnableAuth).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant enable when actor lacks merchant:read_all", async () => {
    const ctx = userCtx(["user:update"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: "2026-05-12T10:00:00Z",
    });
    await expect(
      enableUser(ctx, { userId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockEnableAuth).not.toHaveBeenCalled();
  });

  it("emits user.enabled audit on success", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: "2026-05-12T10:00:00Z",
    });
    mockEnableAuth.mockResolvedValueOnce();

    const result = await enableUser(ctx, { userId: TARGET_USER_ID });

    expect(result).toEqual({ userId: TARGET_USER_ID, transitioned: true });
    expect(mockEnableAuth).toHaveBeenCalledWith(TARGET_USER_ID);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user.enabled",
        tenantId: TENANT_B,
        resourceId: TARGET_USER_ID,
        metadata: expect.objectContaining({ email: "target@example.com" }),
      }),
    );
  });

  it("reports transitioned=false when re-enabling an already-enabled user", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookupAndMutation({
      targetTenantId: TENANT_B,
      email: "target@example.com",
      disabledAt: null,
    });
    mockEnableAuth.mockResolvedValueOnce();
    const result = await enableUser(ctx, { userId: TARGET_USER_ID });
    expect(result.transitioned).toBe(false);
  });
});
