// Day-25 / brief v1.12 §3.1.4 — createAdHocTask service unit tests.
//
// Mocks the QStash publisher, withTenant + withServiceRole, and the
// repository's insertTaskWithPackages so we exercise permission, tenant
// scoping, validation, delegation, and post-commit enqueue without
// touching real Postgres or Upstash.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  insertTaskWithPackages: vi.fn(),
  findTaskById: vi.fn(),
  listTasksByTenant: vi.fn(),
  listTasksBySubscription: vi.fn(),
  listAllTaskIdsByTenant: vi.fn(),
  updateTask: vi.fn(),
  listVisibleTaskIds: vi.fn(),
  listVisibleTaskExternalIds: vi.fn(),
}));

vi.mock("../../task-materialization/queue", () => ({
  enqueueTaskPushBatch: vi.fn().mockResolvedValue({ enqueuedCount: 1, failedChunks: 0 }),
}));

vi.mock("../../task-outbound-queue", () => ({
  enqueueCancelTask: vi.fn(),
  enqueueUpdateTask: vi.fn(),
  enqueueBulkCancelTasks: vi.fn().mockResolvedValue({ enqueuedCount: 0, failedChunks: 0 }),
  enqueueBulkUpdateTasks: vi.fn().mockResolvedValue({ enqueuedCount: 0, failedChunks: 0 }),
}));

vi.mock("../../../shared/logger", () => {
  const child = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: { ...child, with: () => child },
  };
});

vi.mock("../../../shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { withServiceRole, withTenant } from "../../../shared/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { insertTaskWithPackages } from "../repository";
import { enqueueTaskPushBatch } from "../../task-materialization/queue";

import { createAdHocTask } from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockInsertTask = vi.mocked(insertTaskWithPackages);
const mockEnqueue = vi.mocked(enqueueTaskPushBatch);
const mockEmit = vi.mocked(emit);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_ID = "00000000-0000-0000-0000-00000000aaaa";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const PRIMARY_ADDR_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_ADDR_ID = "44444444-4444-4444-4444-444444444444";
const TASK_ID = "55555555-5555-5555-5555-555555555555";

function ctx(perms: readonly Permission[], tenantId: string | null = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request-ad-hoc",
    path: `/consignees/${CONSIGNEE_ID}`,
  };
}

/** Stub tx that returns the next pre-queued result on .execute(). */
function makeTx(returns: readonly (readonly Record<string, unknown>[])[]) {
  let call = 0;
  return {
    execute: vi.fn(async () => {
      const r = returns[call] ?? [];
      call += 1;
      return r;
    }),
  };
}

const VALID = {
  date: "2026-06-01",
  windowStart: "10:00",
  windowEnd: "12:00",
} as const;

beforeEach(() => {
  mockWithTenant.mockReset();
  mockWithServiceRole.mockReset();
  mockInsertTask.mockReset();
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue({ enqueuedCount: 1, failedChunks: 0 });
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);

  // Default: withTenant + withServiceRole both run their callbacks with
  // a stub tx. Individual tests override execute returns.
  mockWithTenant.mockImplementation(async (_t, fn) => {
    return fn(makeTx([[{ id: CONSIGNEE_ID }], [{ id: PRIMARY_ADDR_ID }]]) as never);
  });
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    return fn({} as never);
  });
  mockInsertTask.mockResolvedValue({
    id: TASK_ID,
    customerOrderNumber: "ADHOC-1A2B3C4D",
    deliveryDate: VALID.date,
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createAdHocTask", () => {
  it("throws ForbiddenError when actor lacks task:create", async () => {
    await expect(
      createAdHocTask(ctx([]), CONSIGNEE_ID, VALID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockInsertTask).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      createAdHocTask(ctx(["task:create"], null), CONSIGNEE_ID, VALID),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("rejects malformed date", async () => {
    await expect(
      createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, { ...VALID, date: "2026/06/01" }),
    ).rejects.toThrow(/date must be YYYY-MM-DD/);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("rejects window <30 minutes apart", async () => {
    await expect(
      createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, {
        ...VALID,
        windowStart: "10:00",
        windowEnd: "10:15",
      }),
    ).rejects.toThrow(/at least 30 minutes/);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when consignee does not exist in tenant", async () => {
    mockWithTenant.mockImplementationOnce(async (_t, fn) => {
      return fn(makeTx([[]]) as never); // empty consignee lookup
    });
    await expect(
      createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, VALID),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockInsertTask).not.toHaveBeenCalled();
  });

  it("defaults to primary address when addressId omitted", async () => {
    await createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, VALID);

    expect(mockInsertTask).toHaveBeenCalledOnce();
    const insertArg = mockInsertTask.mock.calls[0][2];
    expect(insertArg.addressId).toBe(PRIMARY_ADDR_ID);
    expect(insertArg.createdVia).toBe("manual_admin");
    expect(insertArg.subscriptionId).toBeUndefined();
    expect(insertArg.customerOrderNumber).toMatch(/^ADHOC-/);
  });

  it("validates that supplied addressId belongs to the same consignee", async () => {
    mockWithTenant.mockImplementationOnce(async (_t, fn) => {
      // 1st execute = consignee lookup ok; 2nd execute = address ownership empty
      return fn(makeTx([[{ id: CONSIGNEE_ID }], []]) as never);
    });
    await expect(
      createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, {
        ...VALID,
        addressId: OTHER_ADDR_ID as never,
      }),
    ).rejects.toThrow(/does not belong to consignee/);
    expect(mockInsertTask).not.toHaveBeenCalled();
  });

  it("uses the supplied addressId when validation passes", async () => {
    mockWithTenant.mockImplementationOnce(async (_t, fn) => {
      return fn(makeTx([[{ id: CONSIGNEE_ID }], [{ id: OTHER_ADDR_ID }]]) as never);
    });
    await createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, {
      ...VALID,
      addressId: OTHER_ADDR_ID as never,
    });
    const insertArg = mockInsertTask.mock.calls[0][2];
    expect(insertArg.addressId).toBe(OTHER_ADDR_ID);
  });

  it("enqueues to QStash post-commit and swallows enqueue failures", async () => {
    mockEnqueue.mockRejectedValueOnce(new Error("upstash 503"));

    const result = await createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, VALID);

    expect(mockInsertTask).toHaveBeenCalledOnce();
    expect(mockEnqueue).toHaveBeenCalledOnce();
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        taskIds: [TASK_ID],
      }),
    );
    // Failure is swallowed — caller still gets a successful return.
    expect(result.task_id).toBe(TASK_ID);
  });

  it("delegates emit to createTask (no separate emit by ad-hoc wrapper)", async () => {
    await createAdHocTask(ctx(["task:create"]), CONSIGNEE_ID, VALID);
    // The delegated createTask emits `task.created`; this wrapper does not
    // add a second emit. Audit body verification belongs in createTask
    // tests (and the integration spec).
    expect(mockEmit).toHaveBeenCalledOnce();
    expect(mockEmit.mock.calls[0][0].eventType).toBe("task.created");
  });
});
