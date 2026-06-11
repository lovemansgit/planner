// Service-layer unit tests for Day-30 / Fix-A2 (Aqib UAT 2026-05-18)
// listFailedPushTaskIdsForTenant — read-only failed-push set for the
// merchant calendar badge. Gated on the NEW `failed_pushes:read`
// permission (read-only sibling to `failed_pushes:retry`).
//
// Mocks ../../shared/db (withTenant) and ../repository
// (listUnresolvedByTenant) so we exercise the permission gate +
// tenant-scope assertion + Set assembly without real Postgres.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../repository", () => ({
  listUnresolvedByTenant: vi.fn(),
}));

import { withTenant } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { Actor, RequestContext } from "../../../shared/tenant-context";
import type { Permission, Uuid } from "../../../shared/types";

import { listUnresolvedByTenant } from "../repository";
import { listFailedPushTaskIdsForTenant } from "../service";
import type { FailedPush } from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockList = vi.mocked(listUnresolvedByTenant);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a" as Uuid;
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const TASK_ID_1 = "11111111-1111-1111-1111-111111111111" as Uuid;
const TASK_ID_2 = "22222222-2222-2222-2222-222222222222" as Uuid;
const FIXED_NOW = "2026-05-18T10:00:00.000Z";

type SystemActorName = (Actor & { kind: "system" })["system"];

function userCtx(perms: readonly Permission[], tenantId: Uuid | null = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? ("00000000-0000-0000-0000-000000000000" as Uuid),
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/consignees/test",
  };
}

function systemCtx(
  system: SystemActorName = "cron:generate_tasks",
  tenantId: Uuid | null = TENANT_ID,
): RequestContext {
  return {
    actor: {
      kind: "system",
      system,
      tenantId,
      permissions: new Set(),
    },
    tenantId,
    requestId: "test-system-request",
    path: "/cron/test",
  };
}

function failedPushFixture(overrides: Partial<FailedPush> = {}): FailedPush {
  return {
    id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    tenantId: TENANT_ID,
    taskId: TASK_ID_1,
    attemptCount: 1,
    taskPayload: {},
    failureReason: "network",
    failureDetail: null,
    httpStatus: null,
    firstFailedAt: FIXED_NOW,
    lastAttemptedAt: FIXED_NOW,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockList.mockReset();
  mockWithTenant.mockImplementation(async (_tenantId, fn) => fn({} as never));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listFailedPushTaskIdsForTenant — Day-30 / Fix-A2", () => {
  it("rejects a user actor without failed_pushes:read with ForbiddenError", async () => {
    await expect(
      listFailedPushTaskIdsForTenant(userCtx(["task:read"])),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("rejects a user actor that has failed_pushes:retry but NOT failed_pushes:read", async () => {
    // Defensive — the permissions split is the whole point. A role
    // with retry but no read shouldn't bypass the gate. Auto-pickup
    // means in practice Tenant Admin gets both, but the spec proves
    // the gate is on the right perm.
    await expect(
      listFailedPushTaskIdsForTenant(userCtx(["failed_pushes:retry"])),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("accepts a user actor with failed_pushes:read; returns Set of unique task IDs", async () => {
    mockList.mockResolvedValueOnce([
      failedPushFixture({ taskId: TASK_ID_1 }),
      failedPushFixture({ taskId: TASK_ID_2 }),
    ]);

    const result = await listFailedPushTaskIdsForTenant(
      userCtx(["failed_pushes:read"]),
    );

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has(TASK_ID_1)).toBe(true);
    expect(result.has(TASK_ID_2)).toBe(true);
  });

  it("returns empty Set when the tenant has no unresolved failed_pushes", async () => {
    mockList.mockResolvedValueOnce([]);

    const result = await listFailedPushTaskIdsForTenant(
      userCtx(["failed_pushes:read"]),
    );

    expect(result.size).toBe(0);
  });

  it("requires tenant-scoped context — rejects a tenant-null user ctx with ValidationError", async () => {
    await expect(
      listFailedPushTaskIdsForTenant(userCtx(["failed_pushes:read"], null)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("deduplicates task_ids when multiple failed_pushes rows reference the same task (defence)", async () => {
    // A task can have multiple failed_pushes rows over time
    // (retry → succeed → fail again → retry → ...). The Set
    // collapses duplicates for the calendar membership signal.
    mockList.mockResolvedValueOnce([
      failedPushFixture({ taskId: TASK_ID_1, id: "row-1" }),
      failedPushFixture({ taskId: TASK_ID_1, id: "row-2" }),
      failedPushFixture({ taskId: TASK_ID_2, id: "row-3" }),
    ]);

    const result = await listFailedPushTaskIdsForTenant(
      userCtx(["failed_pushes:read"]),
    );

    expect(result.size).toBe(2);
    expect(result.has(TASK_ID_1)).toBe(true);
    expect(result.has(TASK_ID_2)).toBe(true);
  });

  it("accepts a system actor with failed_pushes:read in its permissions set", async () => {
    mockList.mockResolvedValueOnce([failedPushFixture()]);
    // System actors generally have empty perms; for this test we
    // wire failed_pushes:read into the system actor to prove the
    // gate isn't user-kind-specific.
    const ctx = systemCtx();
    (ctx.actor.permissions as Set<Permission>).add("failed_pushes:read");

    const result = await listFailedPushTaskIdsForTenant(ctx);
    expect(result.size).toBe(1);
  });
});
