// gateGet / gateCheck / gateSet unit tests — Day 3 / C-6.
//
// Mocks ../../shared/db (withTenant) and ../audit (emit). Tests every
// method's permission, tenant-context, validation, transition, and
// audit-emit branches, plus the sysadmin-vs-tenant masking rule on
// migration_gate_set_by (the PR #24 review requirement).

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

import { gateCheck, gateGet, gateSet } from "../migration-gate";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TENANT_ADMIN_USER = "00000000-0000-0000-0000-00000000aaaa";
const SYSADMIN_USER = "00000000-0000-0000-0000-0000000000ad";
const FIXED_NOW = new Date("2026-04-28T10:00:00.000Z");

function tenantAdminCtx(extra: readonly Permission[] = []): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: TENANT_ADMIN_USER,
      tenantId: TENANT_ID,
      // Tenant Admin's actual perms are bigger; minimal set for these tests.
      permissions: new Set<Permission>([
        "tenant:read",
        "tenant:migration_gate_get",
        "tenant:migration_gate_check",
        ...extra,
      ]),
    },
    tenantId: TENANT_ID,
    requestId: "test-request",
    path: "/test",
  };
}

function sysadminCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_USER,
      tenantId: TENANT_ID,
      // Carrying the systemOnly migration_gate_set perm marks this
      // actor as sysadmin per migration-gate.ts's isSysadminActor proxy.
      permissions: new Set<Permission>([
        "tenant:read",
        "tenant:migration_gate_set",
        "tenant:migration_gate_get",
        "tenant:migration_gate_check",
      ]),
    },
    tenantId: TENANT_ID,
    requestId: "test-request",
    path: "/test",
  };
}

function ctxWithoutTenant(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: TENANT_ADMIN_USER,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: "test-request",
    path: "/test",
  };
}

function makeStubTx(executeReturns: unknown[]) {
  let call = 0;
  const execute = vi.fn(async () => {
    const value = executeReturns[call] ?? [];
    call += 1;
    return value;
  });
  return execute;
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// gateGet
// =============================================================================

describe("gateGet", () => {
  it("throws ForbiddenError when actor lacks tenant:migration_gate_get", async () => {
    const ctx = tenantAdminCtx();
    // Override perms to remove gate_get.
    (ctx.actor.permissions as Set<Permission>).delete("tenant:migration_gate_get");
    await expect(gateGet(ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      gateGet(ctxWithoutTenant(["tenant:migration_gate_get"]))
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when no row matches (RLS-hidden or unknown tenant)", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = { execute: makeStubTx([[]]) };
      return fn(tx as never);
    });
    await expect(gateGet(tenantAdminCtx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns status + setAt for a tenant-admin actor (set_by MASKED)", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = {
        execute: makeStubTx([
          [
            {
              migration_gate_status: "open",
              migration_gate_set_at: FIXED_NOW,
              migration_gate_set_by: SYSADMIN_USER,
            },
          ],
        ]),
      };
      return fn(tx as never);
    });

    const result = await gateGet(tenantAdminCtx());
    expect(result.status).toBe("open");
    expect(result.setAt).toBe(FIXED_NOW.toISOString());
    // PR #24 review requirement: setBy MUST NOT appear for tenant actors.
    expect(result.setBy).toBeUndefined();
    expect("setBy" in result).toBe(false);
  });

  it("returns setBy for sysadmin actors (the only ones allowed to see it)", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = {
        execute: makeStubTx([
          [
            {
              migration_gate_status: "open",
              migration_gate_set_at: FIXED_NOW,
              migration_gate_set_by: SYSADMIN_USER,
            },
          ],
        ]),
      };
      return fn(tx as never);
    });

    const result = await gateGet(sysadminCtx());
    expect(result.setBy).toBe(SYSADMIN_USER);
  });

  it("handles set_at returned as ISO string (postgres.js pooler shape)", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = {
        execute: makeStubTx([
          [
            {
              migration_gate_status: "closed",
              migration_gate_set_at: "2026-04-28T10:00:00.000Z",
              migration_gate_set_by: null,
            },
          ],
        ]),
      };
      return fn(tx as never);
    });
    const result = await gateGet(tenantAdminCtx());
    expect(result.setAt).toBe("2026-04-28T10:00:00.000Z");
  });

  it("returns setAt=null when the gate has never been set", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = {
        execute: makeStubTx([
          [
            {
              migration_gate_status: "closed",
              migration_gate_set_at: null,
              migration_gate_set_by: null,
            },
          ],
        ]),
      };
      return fn(tx as never);
    });
    const result = await gateGet(tenantAdminCtx());
    expect(result.setAt).toBeNull();
  });
});

// =============================================================================
// gateCheck
// =============================================================================

describe("gateCheck", () => {
  it("throws ForbiddenError when actor lacks tenant:migration_gate_check", async () => {
    const ctx = tenantAdminCtx();
    (ctx.actor.permissions as Set<Permission>).delete("tenant:migration_gate_check");
    await expect(gateCheck(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      gateCheck(ctxWithoutTenant(["tenant:migration_gate_check"]))
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when tenant row missing", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = { execute: makeStubTx([[]]) };
      return fn(tx as never);
    });
    await expect(gateCheck(tenantAdminCtx())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns { open: true, status: 'open' } when state is open", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = { execute: makeStubTx([[{ migration_gate_status: "open" }]]) };
      return fn(tx as never);
    });
    expect(await gateCheck(tenantAdminCtx())).toEqual({ open: true, status: "open" });
  });

  it("returns { open: false, status: 'closed' } when state is closed", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = { execute: makeStubTx([[{ migration_gate_status: "closed" }]]) };
      return fn(tx as never);
    });
    expect(await gateCheck(tenantAdminCtx())).toEqual({ open: false, status: "closed" });
  });

  it("returns { open: false, status: 'completed' } when state is completed", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = { execute: makeStubTx([[{ migration_gate_status: "completed" }]]) };
      return fn(tx as never);
    });
    expect(await gateCheck(tenantAdminCtx())).toEqual({ open: false, status: "completed" });
  });
});

// =============================================================================
// gateSet — permission, validation, NotFound
// =============================================================================

describe("gateSet — permission and validation", () => {
  it("throws ForbiddenError when actor lacks tenant:migration_gate_set (e.g. tenant admin)", async () => {
    await expect(gateSet(tenantAdminCtx(), "open", "test")).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      gateSet(ctxWithoutTenant(["tenant:migration_gate_set"]), "open", "test")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when reason is empty / whitespace-only", async () => {
    await expect(gateSet(sysadminCtx(), "open", "")).rejects.toBeInstanceOf(ValidationError);
    await expect(gateSet(sysadminCtx(), "open", "   ")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when newStatus is unknown", async () => {
    // @ts-expect-error — intentional invalid runtime value
    await expect(gateSet(sysadminCtx(), "imaginary", "ok")).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when the tenant row is missing", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = { execute: makeStubTx([[]]) }; // SELECT FOR UPDATE returns no rows
      return fn(tx as never);
    });
    await expect(gateSet(sysadminCtx(), "open", "test")).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// =============================================================================
// gateSet — state-machine transitions
// =============================================================================

describe("gateSet — state-machine transitions", () => {
  function setupTransition(currentStatus: string, updatedRow?: Record<string, unknown>) {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = {
        execute: makeStubTx([
          // SELECT FOR UPDATE returns current row
          [{ migration_gate_status: currentStatus, migration_gate_set_at: null, migration_gate_set_by: null }],
          // UPDATE … RETURNING returns the updated row
          updatedRow
            ? [updatedRow]
            : [
                {
                  migration_gate_status: currentStatus,
                  migration_gate_set_at: FIXED_NOW,
                  migration_gate_set_by: SYSADMIN_USER,
                },
              ],
        ]),
      };
      return fn(tx as never);
    });
  }

  it("allows closed → open and emits with previous_status / new_status / reason", async () => {
    setupTransition("closed", {
      migration_gate_status: "open",
      migration_gate_set_at: FIXED_NOW,
      migration_gate_set_by: SYSADMIN_USER,
    });

    const result = await gateSet(sysadminCtx(), "open", "Cleared SuiteFleet for tenant Acme");

    expect(result.status).toBe("open");
    expect(result.setBy).toBe(SYSADMIN_USER);
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit.mock.calls[0][0].metadata).toEqual({
      previous_status: "closed",
      new_status: "open",
      reason: "Cleared SuiteFleet for tenant Acme",
    });
  });

  it("allows open → completed", async () => {
    setupTransition("open", {
      migration_gate_status: "completed",
      migration_gate_set_at: FIXED_NOW,
      migration_gate_set_by: SYSADMIN_USER,
    });
    const result = await gateSet(sysadminCtx(), "completed", "import succeeded");
    expect(result.status).toBe("completed");
    expect(mockEmit).toHaveBeenCalledOnce();
  });

  it("allows open → closed (override path)", async () => {
    setupTransition("open", {
      migration_gate_status: "closed",
      migration_gate_set_at: FIXED_NOW,
      migration_gate_set_by: SYSADMIN_USER,
    });
    const result = await gateSet(sysadminCtx(), "closed", "clearing was incomplete; rewinding");
    expect(result.status).toBe("closed");
  });

  it("allows completed → open (sysadmin override)", async () => {
    setupTransition("completed", {
      migration_gate_status: "open",
      migration_gate_set_at: FIXED_NOW,
      migration_gate_set_by: SYSADMIN_USER,
    });
    const result = await gateSet(sysadminCtx(), "open", "incident recovery — re-importing");
    expect(result.status).toBe("open");
  });

  it("rejects closed → completed (must go via open)", async () => {
    setupTransition("closed");
    await expect(
      gateSet(sysadminCtx(), "completed", "test")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects completed → closed (only completed→open allowed; closed reset requires two hops)", async () => {
    setupTransition("completed");
    await expect(
      gateSet(sysadminCtx(), "closed", "test")
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("no-ops the same-state transition (returns current state, NO audit emit)", async () => {
    mockWithTenant.mockImplementation(async (_t, fn) => {
      const tx = {
        execute: makeStubTx([
          // Only the SELECT FOR UPDATE fires; UPDATE is skipped on same-state.
          [{ migration_gate_status: "open", migration_gate_set_at: FIXED_NOW, migration_gate_set_by: SYSADMIN_USER }],
        ]),
      };
      return fn(tx as never);
    });
    const result = await gateSet(sysadminCtx(), "open", "redundant call");
    expect(result.status).toBe("open");
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("captures setBy = the user's uuid for human actors", async () => {
    setupTransition("closed", {
      migration_gate_status: "open",
      migration_gate_set_at: FIXED_NOW,
      migration_gate_set_by: SYSADMIN_USER,
    });
    const result = await gateSet(sysadminCtx(), "open", "human transition");
    expect(result.setBy).toBe(SYSADMIN_USER);
  });
});
