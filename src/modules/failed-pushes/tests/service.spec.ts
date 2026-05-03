// Service-layer unit tests — T-7.
//
// Mocks ../../shared/db (withServiceRole), ../audit (emit), and
// ../repository so we exercise system-actor gating, validation, and
// audit-emit flow without real Postgres or audit infra.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  insertFailedPush: vi.fn(),
}));

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { Actor, RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import { insertFailedPush } from "../repository";
import { recordFailedPush } from "../service";
import type { FailedPush, FailureReason, RecordFailedPushInput } from "../types";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockInsert = vi.mocked(insertFailedPush);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const FAILED_PUSH_ID = "22222222-2222-2222-2222-222222222222";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const FIXED_NOW = "2026-04-30T10:00:00.000Z";

type SystemActorName = (Actor & { kind: "system" })["system"];

function userCtx(perms: readonly Permission[], tenantId: string | null = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/api/failed-pushes",
  };
}

function systemCtx(
  system: SystemActorName = "cron:generate_tasks",
  tenantId: string | null = TENANT_ID,
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
    path: "/cron/failed-pushes",
  };
}

function failedPushFixture(overrides: Partial<FailedPush> = {}): FailedPush {
  return {
    id: FAILED_PUSH_ID,
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    attemptCount: 1,
    taskPayload: { customerOrderNumber: "ORDER-001" },
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

const baseInput: RecordFailedPushInput = {
  taskId: TASK_ID,
  taskPayload: { customerOrderNumber: "ORDER-001" },
  failureReason: "network",
};

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockInsert.mockReset();

  mockWithServiceRole.mockImplementation(async (_reason, fn) => fn({} as never));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordFailedPush", () => {
  it("rejects a user actor with ForbiddenError (no user-facing failed-pushes permission)", async () => {
    await expect(
      recordFailedPush(userCtx(["task:read", "task:update"]), baseInput),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when tenantId is null", async () => {
    const ctx = systemCtx("cron:generate_tasks", null);
    await expect(recordFailedPush(ctx, baseInput)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on empty taskId", async () => {
    const ctx = systemCtx();
    await expect(recordFailedPush(ctx, { ...baseInput, taskId: " " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws ValidationError on a failureReason outside the closed set", async () => {
    const ctx = systemCtx();
    // Cast through unknown to bypass the type-level union; the runtime
    // guard is the load-bearing protection here.
    const bogus = { ...baseInput, failureReason: "bogus" as unknown as FailureReason };
    await expect(recordFailedPush(ctx, bogus)).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("happy path — runs under withServiceRole, emits task.push_failed with system actor", async () => {
    const ctx = systemCtx();
    mockInsert.mockResolvedValue(failedPushFixture());

    const result = await recordFailedPush(ctx, baseInput);

    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledOnce();

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("task.push_failed");
    expect(emitArg.actorKind).toBe("system");
    expect(emitArg.actorId).toBe("cron:generate_tasks");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("task");
    expect(emitArg.resourceId).toBe(TASK_ID);
    expect(emitArg.metadata?.task_id).toBe(TASK_ID);
    expect(emitArg.metadata?.attempt_count).toBe(1);
    expect(emitArg.metadata?.failure_reason).toBe("network");

    expect(result.id).toBe(FAILED_PUSH_ID);
  });

  it("passes through populated failureDetail and httpStatus to the repository", async () => {
    const ctx = systemCtx();
    mockInsert.mockResolvedValue(
      failedPushFixture({ failureDetail: "connection reset", httpStatus: 502 }),
    );

    const result = await recordFailedPush(ctx, {
      ...baseInput,
      failureReason: "server_5xx",
      failureDetail: "connection reset",
      httpStatus: 502,
    });

    const insertArg = mockInsert.mock.calls[0][2];
    expect(insertArg.failureDetail).toBe("connection reset");
    expect(insertArg.httpStatus).toBe(502);

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata?.http_status).toBe(502);
    expect(result.httpStatus).toBe(502);
  });

  it("trims whitespace-only failureDetail to undefined", async () => {
    const ctx = systemCtx();
    mockInsert.mockResolvedValue(failedPushFixture());
    await recordFailedPush(ctx, { ...baseInput, failureDetail: "   " });
    const insertArg = mockInsert.mock.calls[0][2];
    expect(insertArg.failureDetail).toBeUndefined();
  });

  it("propagates a duplicate-unresolved DB error (SQLSTATE 23505) without emit", async () => {
    const ctx = systemCtx();
    const dupErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    mockInsert.mockRejectedValue(dupErr);

    await expect(recordFailedPush(ctx, baseInput)).rejects.toMatchObject({ code: "23505" });
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
