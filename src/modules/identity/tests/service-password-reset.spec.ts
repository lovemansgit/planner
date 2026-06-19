// F5 — Unit tests for resetUserPassword: permission gate (RED-first),
// password validation, cross-tenant escalation gate, not-found, auth
// admin SDK error mapping, and the user.password_reset audit emit.
//
// The auth-admin SDK is the third-party boundary and is mocked here;
// the password reset has no public.users mirror write (the credential
// lives in auth.users only), so there is no integration-spec SQL path
// to pair — unlike disable/enable which mutate disabled_at.

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
  resetAuthUserPassword: vi.fn(),
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
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { resetAuthUserPassword } from "../auth-admin";
import { resetUserPassword } from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockResetAuth = vi.mocked(resetAuthUserPassword);

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const TARGET_USER_ID = "11111111-1111-1111-1111-111111111111";
const VALID_PW = "temp-Passw0rd!";

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
 * `resetUserPassword` reads the target's tenant + email via the same
 * `withServiceRole` cross-tenant lookup disable/enable use. Stub it to
 * return one row.
 */
function setupLookup(args: {
  readonly targetTenantId: string;
  readonly email: string;
}) {
  mockWithServiceRole.mockImplementation(async (_label, fn) =>
    fn({
      execute: vi.fn().mockResolvedValueOnce([
        { tenant_id: args.targetTenantId, email: args.email, disabled_at: null },
      ]),
    } as never),
  );
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
  mockResetAuth.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resetUserPassword — permission gate", () => {
  it("throws ForbiddenError when the actor lacks user:update", async () => {
    const ctx = userCtx([]);
    await expect(
      resetUserPassword(ctx, { userId: TARGET_USER_ID, newPassword: VALID_PW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockResetAuth).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("resetUserPassword — password validation", () => {
  it("throws ValidationError when the new password is shorter than 8 chars", async () => {
    const ctx = userCtx(["user:update"]);
    await expect(
      resetUserPassword(ctx, { userId: TARGET_USER_ID, newPassword: "short" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockResetAuth).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("resetUserPassword — cross-tenant escalation gate", () => {
  it("rejects cross-tenant reset when actor lacks merchant:read_all", async () => {
    const ctx = userCtx(["user:update"], TENANT_A);
    setupLookup({ targetTenantId: TENANT_B, email: "target@example.com" });
    await expect(
      resetUserPassword(ctx, { userId: TARGET_USER_ID, newPassword: VALID_PW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockResetAuth).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("allows cross-tenant reset when actor carries merchant:read_all and audits it", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookup({ targetTenantId: TENANT_B, email: "target@example.com" });
    mockResetAuth.mockResolvedValueOnce();

    const result = await resetUserPassword(ctx, {
      userId: TARGET_USER_ID,
      newPassword: VALID_PW,
    });

    expect(result).toEqual({ userId: TARGET_USER_ID });
    expect(mockResetAuth).toHaveBeenCalledWith(TARGET_USER_ID, VALID_PW);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "user.password_reset",
        tenantId: TENANT_B,
        resourceId: TARGET_USER_ID,
        metadata: expect.objectContaining({ email: "target@example.com" }),
      }),
    );
  });

  it("NEVER puts the plaintext password in the audit metadata", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"], TENANT_A);
    setupLookup({ targetTenantId: TENANT_B, email: "target@example.com" });
    mockResetAuth.mockResolvedValueOnce();

    await resetUserPassword(ctx, {
      userId: TARGET_USER_ID,
      newPassword: VALID_PW,
    });

    const emitted = mockEmit.mock.calls[0]?.[0];
    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain(VALID_PW);
  });
});

describe("resetUserPassword — same-tenant happy path", () => {
  it("resets and audits without any withTenant/withServiceRole mutation write", async () => {
    const ctx = userCtx(["user:update"], TENANT_A);
    setupLookup({ targetTenantId: TENANT_A, email: "self-tenant@example.com" });
    mockResetAuth.mockResolvedValueOnce();

    const result = await resetUserPassword(ctx, {
      userId: TARGET_USER_ID,
      newPassword: VALID_PW,
    });

    expect(result).toEqual({ userId: TARGET_USER_ID });
    // Lookup is the only withServiceRole call; no mirror UPDATE for a
    // password reset, so withTenant is never invoked.
    expect(mockWithServiceRole).toHaveBeenCalledTimes(1);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("permits an actor to reset their own password (no self-block)", async () => {
    const ctx = userCtx(["user:update"], TENANT_A);
    setupLookup({ targetTenantId: TENANT_A, email: "me@example.com" });
    mockResetAuth.mockResolvedValueOnce();

    const result = await resetUserPassword(ctx, {
      userId: ACTOR_USER_ID,
      newPassword: VALID_PW,
    });

    expect(result).toEqual({ userId: ACTOR_USER_ID });
    expect(mockResetAuth).toHaveBeenCalledWith(ACTOR_USER_ID, VALID_PW);
  });
});

describe("resetUserPassword — not found + auth SDK error mapping", () => {
  it("throws NotFoundError when the user lookup returns no rows", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"]);
    setupLookupMissing();
    await expect(
      resetUserPassword(ctx, { userId: TARGET_USER_ID, newPassword: VALID_PW }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockResetAuth).not.toHaveBeenCalled();
  });

  it("maps AuthAdminError to ConflictError and does not audit", async () => {
    const ctx = userCtx(["user:update", "merchant:read_all"]);
    setupLookup({ targetTenantId: TENANT_B, email: "target@example.com" });
    const { AuthAdminError } = await import("../auth-admin");
    mockResetAuth.mockRejectedValueOnce(new AuthAdminError("auth down"));
    await expect(
      resetUserPassword(ctx, { userId: TARGET_USER_ID, newPassword: VALID_PW }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
