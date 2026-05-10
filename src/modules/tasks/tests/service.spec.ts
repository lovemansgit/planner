// Task service-layer unit tests.
//
// Mocks ../../shared/db (withTenant, withServiceRole) and ../audit
// (emit) so we exercise permission, tenant-context, validation, and
// audit-emit flow without real Postgres or audit infra. Repository
// functions are mocked at the source-module boundary.
//
// Coverage targets the bimodal surface:
//
//   - System-only paths (createTask, bulkCreateTasks, deleteTask) —
//     reject user actors with ForbiddenError, run under withServiceRole,
//     emit with actorKind: "system".
//   - User-flow paths (getTask, listTasks, updateTask) — gate on
//     requirePermission, run under withTenant, audit only on changes.
//   - BulkValidationError aggregation across multiple rows.

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
  listAllTaskIdsByTenant: vi.fn(),
  updateTask: vi.fn(),
  listVisibleTaskIds: vi.fn(),
  listVisibleTaskExternalIds: vi.fn(),
}));

vi.mock("../../task-outbound-queue", () => ({
  enqueueCancelTask: vi.fn().mockResolvedValue(undefined),
  enqueueUpdateTask: vi.fn().mockResolvedValue(undefined),
  enqueueBulkCancelTasks: vi.fn().mockResolvedValue({ enqueuedCount: 0, failedChunks: 0, totalCount: 0 }),
  enqueueBulkUpdateTasks: vi.fn().mockResolvedValue({ enqueuedCount: 0, failedChunks: 0, totalCount: 0 }),
}));

vi.mock("../../../shared/logger", () => {
  const child = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: {
      ...child,
      with: () => child,
    },
  };
});

// sentry-capture is imported transitively by tasks/service.ts; mock it
// here so a test environment without SENTRY_DSN doesn't try to dispatch
// to the real SDK.
vi.mock("../../../shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { withServiceRole, withTenant } from "../../../shared/db";
import {
  ForbiddenError,
  NoLabelablePushedTasksError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors";
import type { Actor, RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { logger } from "../../../shared/logger";

import { emit } from "../../audit";

import {
  findTaskById,
  insertTaskWithPackages,
  listAllTaskIdsByTenant,
  listTasksByTenant,
  listVisibleTaskExternalIds,
  updateTask as updateTaskRow,
} from "../repository";
import {
  BulkValidationError,
  bulkCancelTasks,
  bulkCreateTasks,
  bulkUpdateTasks,
  cancelTask,
  createTask,
  getTask,
  listAllTaskIds,
  listTasks,
  printLabelsForTasks,
  updateTask,
  updateTaskAndPushOutbound,
} from "../service";

import {
  enqueueBulkCancelTasks,
  enqueueBulkUpdateTasks,
  enqueueCancelTask,
  enqueueUpdateTask,
} from "../../task-outbound-queue";
import type { CreateTaskInput, Task } from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockInsert = vi.mocked(insertTaskWithPackages);
const mockFindById = vi.mocked(findTaskById);
const mockListByTenant = vi.mocked(listTasksByTenant);
const mockListAllTaskIdsByTenant = vi.mocked(listAllTaskIdsByTenant);
const mockUpdate = vi.mocked(updateTaskRow);
const mockListVisibleTaskExternalIds = vi.mocked(listVisibleTaskExternalIds);
const mockLoggerError = vi.mocked(logger.error);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const FIXED_NOW = "2026-04-30T10:00:00.000Z";

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
    path: "/api/tasks",
  };
}

type SystemActorName = (Actor & { kind: "system" })["system"];

function systemCtx(
  system: SystemActorName = "cron:generate_tasks",
  tenantId: string | null = TENANT_ID
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
    path: "/cron/tasks",
  };
}

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    subscriptionId: null,
    createdVia: "manual_admin",
    customerOrderNumber: "ORDER-001",
    referenceNumber: null,
    internalStatus: "CREATED",
    externalId: null,
    externalTrackingNumber: null,
    deliveryDate: "2099-05-01",
    deliveryStartTime: "14:00:00",
    deliveryEndTime: "16:00:00",
    deliveryType: "STANDARD",
    taskKind: "DELIVERY",
    paymentMethod: null,
    codAmount: null,
    declaredValue: null,
    weightKg: null,
    notes: null,
    signatureRequired: false,
    smsNotifications: false,
    deliverToCustomerOnly: false,
    pushedToExternalAt: null,
    addressId: null,
    podPhotos: null,
    addressLabel: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    packages: [],
    ...overrides,
  };
}

const baseInput: CreateTaskInput = {
  consigneeId: CONSIGNEE_ID,
  customerOrderNumber: "ORDER-001",
  deliveryDate: "2099-05-01",
  deliveryStartTime: "14:00",
  deliveryEndTime: "16:00",
  packages: [{ position: 0 }],
};

beforeEach(() => {
  mockWithTenant.mockReset();
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockInsert.mockReset();
  mockFindById.mockReset();
  mockListByTenant.mockReset();
  mockListAllTaskIdsByTenant.mockReset();
  mockUpdate.mockReset();
  mockLoggerError.mockReset();

  mockWithTenant.mockImplementation(async (_tenantId, fn) => fn({} as never));
  mockWithServiceRole.mockImplementation(async (_reason, fn) => fn({} as never));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// createTask — system-only
// -----------------------------------------------------------------------------

describe("createTask", () => {
  it("rejects a user actor with ForbiddenError (no user-facing task:create permission)", async () => {
    await expect(createTask(userCtx(["task:read"]), baseInput)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when tenantId is null", async () => {
    const ctx = systemCtx("cron:generate_tasks", null);
    await expect(createTask(ctx, baseInput)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on missing required field", async () => {
    const ctx = systemCtx();
    await expect(
      createTask(ctx, { ...baseInput, customerOrderNumber: " " })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("happy path — runs under withServiceRole, emits task.created with actorKind: 'system'", async () => {
    const ctx = systemCtx();
    mockInsert.mockResolvedValue(taskFixture());

    const result = await createTask(ctx, baseInput);

    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("task.created");
    expect(emitArg.actorKind).toBe("system");
    expect(emitArg.actorId).toBe("cron:generate_tasks");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceId).toBe(TASK_ID);
    expect(result.id).toBe(TASK_ID);
  });
});

// -----------------------------------------------------------------------------
// bulkCreateTasks — system-only, all-or-nothing
// -----------------------------------------------------------------------------

describe("bulkCreateTasks", () => {
  it("rejects a user actor with ForbiddenError", async () => {
    await expect(bulkCreateTasks(userCtx(["task:read"]), [baseInput])).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws ValidationError when tenantId is null", async () => {
    const ctx = systemCtx("cron:generate_tasks", null);
    await expect(bulkCreateTasks(ctx, [baseInput])).rejects.toBeInstanceOf(ValidationError);
  });

  it("happy path — single transaction, per-task task.created + one task.bulk_created meta event", async () => {
    const ctx = systemCtx();
    const t1 = taskFixture({ id: "task-1", customerOrderNumber: "ORDER-1" });
    const t2 = taskFixture({ id: "task-2", customerOrderNumber: "ORDER-2" });
    mockInsert.mockResolvedValueOnce(t1).mockResolvedValueOnce(t2);

    const result = await bulkCreateTasks(ctx, [baseInput, baseInput]);

    expect(mockWithServiceRole).toHaveBeenCalledOnce(); // one transaction for both inserts
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(result.created).toHaveLength(2);
    expect(result.created[0].id).toBe("task-1");
    expect(result.created[1].id).toBe("task-2");

    // 2 per-task task.created emits + 1 task.bulk_created meta = 3 emits.
    expect(mockEmit).toHaveBeenCalledTimes(3);
    const eventTypes = mockEmit.mock.calls.map((c) => c[0].eventType);
    expect(eventTypes).toEqual(["task.created", "task.created", "task.bulk_created"]);

    const meta = mockEmit.mock.calls[2][0];
    expect(meta.metadata?.task_ids).toEqual(["task-1", "task-2"]);
    expect(meta.metadata?.count).toBe(2);
  });

  it("strict all-or-nothing — any per-row validation failure aborts the entire batch with no inserts", async () => {
    const ctx = systemCtx();
    const goodInput = baseInput;
    const badInput: CreateTaskInput = { ...baseInput, customerOrderNumber: "" };

    let raised: unknown = null;
    try {
      await bulkCreateTasks(ctx, [goodInput, badInput, goodInput]);
    } catch (err) {
      raised = err;
    }

    expect(raised).toBeInstanceOf(BulkValidationError);
    const error = raised as BulkValidationError;
    expect(error.failures).toHaveLength(1);
    expect(error.failures[0].rowIndex).toBe(1);
    expect(error.failures[0].field).toBe("customerOrderNumber");

    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("aggregates failures across multiple bad rows in a single BulkValidationError", async () => {
    const ctx = systemCtx();
    const inputs: CreateTaskInput[] = [
      { ...baseInput, consigneeId: "" }, // row 0: bad consigneeId
      baseInput, // row 1: ok
      { ...baseInput, deliveryDate: "" }, // row 2: bad deliveryDate
      { ...baseInput, deliveryEndTime: "" }, // row 3: bad deliveryEndTime
    ];

    let raised: unknown = null;
    try {
      await bulkCreateTasks(ctx, inputs);
    } catch (err) {
      raised = err;
    }

    const error = raised as BulkValidationError;
    expect(error).toBeInstanceOf(BulkValidationError);
    expect(error.failures).toHaveLength(3);
    const failureRows = error.failures.map((f) => f.rowIndex).sort();
    expect(failureRows).toEqual([0, 2, 3]);

    expect(mockWithServiceRole).not.toHaveBeenCalled();
  });

  it("returns { created: [] } for an empty input array (no audit, no transaction)", async () => {
    const ctx = systemCtx();
    const result = await bulkCreateTasks(ctx, []);
    expect(result.created).toEqual([]);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects a row with negative package position", async () => {
    const ctx = systemCtx();
    const badPackages: CreateTaskInput = {
      ...baseInput,
      packages: [{ position: -1 }],
    };
    let raised: unknown = null;
    try {
      await bulkCreateTasks(ctx, [badPackages]);
    } catch (err) {
      raised = err;
    }
    const error = raised as BulkValidationError;
    expect(error).toBeInstanceOf(BulkValidationError);
    expect(error.failures[0].field).toBe("packages[0].position");
  });

  it("per-task emit failures are logged but do not poison the result (committed batch is preserved)", async () => {
    const ctx = systemCtx();
    const t1 = taskFixture({ id: "task-1", customerOrderNumber: "ORDER-1" });
    const t2 = taskFixture({ id: "task-2", customerOrderNumber: "ORDER-2" });
    const t3 = taskFixture({ id: "task-3", customerOrderNumber: "ORDER-3" });
    mockInsert.mockResolvedValueOnce(t1).mockResolvedValueOnce(t2).mockResolvedValueOnce(t3);

    // Emit succeeds for task-1, throws for task-2, succeeds for
    // task-3, and succeeds for the meta event. The function MUST
    // still return the full result with all three tasks.
    mockEmit
      .mockResolvedValueOnce(undefined) // task.created task-1
      .mockRejectedValueOnce(new Error("audit DB unreachable")) // task.created task-2
      .mockResolvedValueOnce(undefined) // task.created task-3
      .mockResolvedValueOnce(undefined); // task.bulk_created meta

    let raised: unknown = null;
    let result: { created: readonly Task[] } | undefined;
    try {
      result = await bulkCreateTasks(ctx, [baseInput, baseInput, baseInput]);
    } catch (err) {
      raised = err;
    }

    expect(raised).toBeNull();
    expect(result).toBeDefined();
    expect(result!.created).toHaveLength(3);
    expect(result!.created.map((t) => t.id)).toEqual(["task-1", "task-2", "task-3"]);

    // All four emits attempted (3 per-task + 1 meta).
    expect(mockEmit).toHaveBeenCalledTimes(4);

    // The failed emit was logged at error level, NOT propagated.
    expect(mockLoggerError).toHaveBeenCalledOnce();
    const logArg = mockLoggerError.mock.calls[0][0] as unknown as {
      eventType: string;
      resourceId: string;
      error: string;
    };
    expect(logArg.eventType).toBe("task.created");
    expect(logArg.resourceId).toBe("task-2");
    expect(logArg.error).toContain("audit DB unreachable");

    // Transaction was already closed before the emits ran — nothing
    // about an emit failure can roll back the committed inserts.
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });
});

// -----------------------------------------------------------------------------
// getTask — user-flow read, requires task:read
// -----------------------------------------------------------------------------

describe("getTask", () => {
  it("rejects an actor without task:read with ForbiddenError", async () => {
    await expect(getTask(userCtx([]), TASK_ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("throws ValidationError when tenantId is null", async () => {
    await expect(getTask(userCtx(["task:read"], null), TASK_ID)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("returns the row inside withTenant", async () => {
    mockFindById.mockResolvedValue(taskFixture());
    const result = await getTask(userCtx(["task:read"]), TASK_ID);
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(result?.id).toBe(TASK_ID);
    expect(mockEmit).not.toHaveBeenCalled(); // reads not audited per R-4
  });

  it("returns null when the row is missing or RLS-hidden", async () => {
    mockFindById.mockResolvedValue(null);
    const result = await getTask(userCtx(["task:read"]), TASK_ID);
    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// listTasks — user-flow read, requires task:read
// -----------------------------------------------------------------------------

describe("listTasks", () => {
  it("rejects an actor without task:read with ForbiddenError", async () => {
    await expect(listTasks(userCtx([]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the rows inside withTenant; not audited", async () => {
    mockListByTenant.mockResolvedValue([taskFixture()]);
    const result = await listTasks(userCtx(["task:read"]));
    expect(result).toHaveLength(1);
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// listAllTaskIds — Day 17 / Session B select-all-across-pages
// -----------------------------------------------------------------------------

describe("listAllTaskIds", () => {
  it("rejects an actor without task:read with ForbiddenError", async () => {
    await expect(listAllTaskIds(userCtx([]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns the IDs inside withTenant; not audited", async () => {
    mockListAllTaskIdsByTenant.mockResolvedValue([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ] as never);
    const result = await listAllTaskIds(userCtx(["task:read"]));
    expect(result).toHaveLength(2);
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("forwards the optional status filter to the repository", async () => {
    mockListAllTaskIdsByTenant.mockResolvedValue([] as never);
    await listAllTaskIds(userCtx(["task:read"]), { status: "DELIVERED" });
    expect(mockListAllTaskIdsByTenant).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      { status: "DELIVERED" },
    );
  });
});

// -----------------------------------------------------------------------------
// updateTask — user-flow, requires task:update
// -----------------------------------------------------------------------------

describe("updateTask", () => {
  it("rejects an actor without task:update with ForbiddenError", async () => {
    await expect(
      updateTask(userCtx(["task:read"]), TASK_ID, { notes: "x" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError when the row does not exist", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(
      updateTask(userCtx(["task:update"]), TASK_ID, { notes: "x" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("happy path — runs under withTenant, emits task.updated with changed_fields", async () => {
    const before = taskFixture({ notes: null });
    const after = taskFixture({ notes: "delivered to neighbour" });
    mockFindById.mockResolvedValue(before);
    mockUpdate.mockResolvedValue(after);

    const result = await updateTask(userCtx(["task:update"]), TASK_ID, {
      notes: "delivered to neighbour",
    });

    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("task.updated");
    expect(emitArg.actorKind).toBe("user");
    expect(emitArg.metadata?.changed_fields).toEqual(["notes"]);
    expect(result.notes).toBe("delivered to neighbour");
  });

  it("no-op patch (every field unchanged) skips update + audit", async () => {
    const current = taskFixture({ notes: "existing" });
    mockFindById.mockResolvedValue(current);

    const result = await updateTask(userCtx(["task:update"]), TASK_ID, { notes: "existing" });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(result.notes).toBe("existing");
  });

  it("computes changed_fields[] across multiple changed scalars", async () => {
    const before = taskFixture({
      internalStatus: "CREATED",
      notes: null,
      signatureRequired: false,
    });
    const after = taskFixture({
      internalStatus: "ASSIGNED",
      notes: "x",
      signatureRequired: true,
    });
    mockFindById.mockResolvedValue(before);
    mockUpdate.mockResolvedValue(after);

    await updateTask(userCtx(["task:update"]), TASK_ID, {
      internalStatus: "ASSIGNED",
      notes: "x",
      signatureRequired: true,
    });

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata?.changed_fields).toEqual([
      "internalStatus",
      "notes",
      "signatureRequired",
    ]);
  });

  it("surfaces a vanished-row race as NotFoundError", async () => {
    mockFindById.mockResolvedValue(taskFixture({ notes: null }));
    mockUpdate.mockResolvedValue(null);
    await expect(
      updateTask(userCtx(["task:update"]), TASK_ID, { notes: "x" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects empty required-string fields in the patch", async () => {
    await expect(
      updateTask(userCtx(["task:update"]), TASK_ID, { customerOrderNumber: "  " })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// =============================================================================
// printLabelsForTasks — Day 17 Planner-UUID → SF-external-id translation
// =============================================================================
describe("printLabelsForTasks — Day-17 external_id translation", () => {
  const TASK_ID_1 = "11111111-1111-1111-1111-111111111111";
  const TASK_ID_2 = "22222222-2222-2222-2222-222222222222";
  const TASK_ID_3 = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    mockWithTenant.mockImplementation(async (_tenantId, fn) => fn({} as never));
  });

  function makeAdapter(printSpy: ReturnType<typeof vi.fn>): {
    authenticate: ReturnType<typeof vi.fn>;
    printLabels: ReturnType<typeof vi.fn>;
  } {
    return {
      authenticate: vi.fn().mockResolvedValue({ token: "tok", tenantId: TENANT_ID }),
      printLabels: printSpy,
    };
  }

  it("passes SF external_ids (NOT Planner UUIDs) to the adapter", async () => {
    mockListVisibleTaskExternalIds.mockResolvedValueOnce([
      { id: TASK_ID_1, externalId: "60547", pushedToExternalAt: "2026-05-05T07:55:19.321Z" },
      { id: TASK_ID_2, externalId: "60548", pushedToExternalAt: "2026-05-05T07:56:19.321Z" },
    ]);
    const printSpy = vi.fn().mockResolvedValue(Buffer.from("PDF"));
    const adapter = makeAdapter(printSpy);

    const result = await printLabelsForTasks(
      userCtx(["task:print_labels"]),
      [TASK_ID_1 as never, TASK_ID_2 as never],
      adapter as never,
    );

    expect(printSpy).toHaveBeenCalledTimes(1);
    const passedToAdapter = printSpy.mock.calls[0][1];
    expect(passedToAdapter).toEqual(["60547", "60548"]);
    // The Planner UUIDs MUST NOT have been passed — regression pin
    // for the Day-17 502 root-cause.
    expect(passedToAdapter).not.toContain(TASK_ID_1);
    expect(passedToAdapter).not.toContain(TASK_ID_2);

    expect(result.printedCount).toBe(2);
    expect(result.printedTaskIds).toEqual([TASK_ID_1, TASK_ID_2]);
    expect(result.skippedCount).toBe(0);
    expect(result.skippedTaskIds).toEqual([]);
  });

  it("filters out tasks with external_id IS NULL (pre-push) and surfaces them as skippedCount", async () => {
    mockListVisibleTaskExternalIds.mockResolvedValueOnce([
      { id: TASK_ID_1, externalId: "60547", pushedToExternalAt: "2026-05-05T07:55:19.321Z" },
      { id: TASK_ID_2, externalId: null, pushedToExternalAt: null }, // pre-push
      { id: TASK_ID_3, externalId: "60549", pushedToExternalAt: "2026-05-05T07:57:19.321Z" },
    ]);
    const printSpy = vi.fn().mockResolvedValue(Buffer.from("PDF"));

    const result = await printLabelsForTasks(
      userCtx(["task:print_labels"]),
      [TASK_ID_1 as never, TASK_ID_2 as never, TASK_ID_3 as never],
      makeAdapter(printSpy) as never,
    );

    expect(printSpy.mock.calls[0][1]).toEqual(["60547", "60549"]);
    expect(result.printedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.skippedTaskIds).toEqual([TASK_ID_2]);
  });

  it("filters out tasks with pushed_to_external_at IS NULL even if external_id is set (defence in depth)", async () => {
    mockListVisibleTaskExternalIds.mockResolvedValueOnce([
      { id: TASK_ID_1, externalId: "60547", pushedToExternalAt: null }, // partial-write edge
    ]);
    const printSpy = vi.fn();

    await expect(
      printLabelsForTasks(
        userCtx(["task:print_labels"]),
        [TASK_ID_1 as never],
        makeAdapter(printSpy) as never,
      ),
    ).rejects.toBeInstanceOf(NoLabelablePushedTasksError);

    expect(printSpy).not.toHaveBeenCalled();
  });

  it("throws NoLabelablePushedTasksError when ALL visible tasks are pre-push", async () => {
    mockListVisibleTaskExternalIds.mockResolvedValueOnce([
      { id: TASK_ID_1, externalId: null, pushedToExternalAt: null },
      { id: TASK_ID_2, externalId: null, pushedToExternalAt: null },
    ]);
    const printSpy = vi.fn();

    await expect(
      printLabelsForTasks(
        userCtx(["task:print_labels"]),
        [TASK_ID_1 as never, TASK_ID_2 as never],
        makeAdapter(printSpy) as never,
      ),
    ).rejects.toBeInstanceOf(NoLabelablePushedTasksError);

    expect(printSpy).not.toHaveBeenCalled();
  });

  it("throws ValidationError when no submitted IDs are visible in the tenant (existing behavior preserved)", async () => {
    mockListVisibleTaskExternalIds.mockResolvedValueOnce([]);
    const printSpy = vi.fn();

    await expect(
      printLabelsForTasks(
        userCtx(["task:print_labels"]),
        [TASK_ID_1 as never],
        makeAdapter(printSpy) as never,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(printSpy).not.toHaveBeenCalled();
  });

  it("rejects empty taskIds with ValidationError (existing behavior preserved)", async () => {
    const printSpy = vi.fn();

    await expect(
      printLabelsForTasks(
        userCtx(["task:print_labels"]),
        [],
        makeAdapter(printSpy) as never,
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(printSpy).not.toHaveBeenCalled();
  });

  it("rejects actor without task:print_labels permission with ForbiddenError", async () => {
    const printSpy = vi.fn();
    await expect(
      printLabelsForTasks(
        userCtx([]), // no permissions
        [TASK_ID_1 as never],
        makeAdapter(printSpy) as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("emits task.labels_printed audit with skipped_count + skipped_task_ids in metadata", async () => {
    mockListVisibleTaskExternalIds.mockResolvedValueOnce([
      { id: TASK_ID_1, externalId: "60547", pushedToExternalAt: "2026-05-05T07:55:19.321Z" },
      { id: TASK_ID_2, externalId: null, pushedToExternalAt: null },
    ]);
    const printSpy = vi.fn().mockResolvedValue(Buffer.from("PDF"));

    await printLabelsForTasks(
      userCtx(["task:print_labels"]),
      [TASK_ID_1 as never, TASK_ID_2 as never],
      makeAdapter(printSpy) as never,
    );

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("task.labels_printed");
    expect(emitArg.metadata?.requested_count).toBe(2);
    expect(emitArg.metadata?.printed_count).toBe(1);
    expect(emitArg.metadata?.skipped_count).toBe(1);
    expect(emitArg.metadata?.skipped_task_ids).toEqual([TASK_ID_2]);
  });
});

// =============================================================================
// Day 22 / Phase 1 — cancelTask / bulkCancelTasks / bulkUpdateTasks /
// updateTaskAndPushOutbound
// =============================================================================
//
// Covers the new SF-outbound-coupled service-layer fns. Mocks
// task-outbound-queue publishers + repository updateTaskRow + audit emit.
// All four fns share the post-commit-enqueue posture: local DB tx commits
// FIRST, audit + QStash enqueue happen AFTER. Tests verify that posture
// + the per-task cutoff guard + the idempotent fast-paths.

const mockEnqueueCancelTask = vi.mocked(enqueueCancelTask);
const mockEnqueueUpdateTask = vi.mocked(enqueueUpdateTask);
const mockEnqueueBulkCancelTasks = vi.mocked(enqueueBulkCancelTasks);
const mockEnqueueBulkUpdateTasks = vi.mocked(enqueueBulkUpdateTasks);

const FAR_FUTURE_DATE = "2099-05-01"; // never elapsed past Dubai cutoff in test runs
const STALE_PAST_DATE = "2020-01-01"; // always past cutoff

describe("cancelTask — single-task cancel + outbound enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({} as never),
    );
  });

  it("rejects user without task:cancel with ForbiddenError", async () => {
    await expect(cancelTask(userCtx([]), TASK_ID as never)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("happy path: UPDATE, audit task.updated, enqueue cancel-task message", async () => {
    const before = taskFixture({
      internalStatus: "CREATED",
      deliveryDate: FAR_FUTURE_DATE,
      externalTrackingNumber: "MPL-72915243",
    });
    const after = { ...before, internalStatus: "CANCELED" as const };
    mockFindById.mockResolvedValueOnce(before);
    mockUpdate.mockResolvedValueOnce(after);

    const result = await cancelTask(userCtx(["task:cancel"]), TASK_ID as never);

    expect(result.internalStatus).toBe("CANCELED");
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), TENANT_ID, TASK_ID, {
      internalStatus: "CANCELED",
    });
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("task.updated");
    expect(emitArg.metadata?.changed_fields).toEqual(["internalStatus"]);
    expect(emitArg.metadata?.to_internal_status).toBe("CANCELED");
    expect(mockEnqueueCancelTask).toHaveBeenCalledTimes(1);
    const enqueuePayload = mockEnqueueCancelTask.mock.calls[0][0];
    expect(enqueuePayload.tenant_id).toBe(TENANT_ID);
    expect(enqueuePayload.task_id).toBe(TASK_ID);
    expect(enqueuePayload.awb).toBe("MPL-72915243");
    expect(enqueuePayload.correlation_id).toBeTypeOf("string");
  });

  it("idempotent fast-path on already-CANCELED: no UPDATE, no audit, no enqueue", async () => {
    const already = taskFixture({
      internalStatus: "CANCELED",
      deliveryDate: FAR_FUTURE_DATE,
      externalTrackingNumber: "MPL-X",
    });
    mockFindById.mockResolvedValueOnce(already);

    const result = await cancelTask(userCtx(["task:cancel"]), TASK_ID as never);

    expect(result).toBe(already);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockEnqueueCancelTask).not.toHaveBeenCalled();
  });

  it("rejects DELIVERED tasks with ValidationError", async () => {
    mockFindById.mockResolvedValueOnce(
      taskFixture({ internalStatus: "DELIVERED", deliveryDate: FAR_FUTURE_DATE }),
    );
    await expect(
      cancelTask(userCtx(["task:cancel"]), TASK_ID as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects past-cutoff delivery_date with ValidationError", async () => {
    mockFindById.mockResolvedValueOnce(
      taskFixture({ internalStatus: "CREATED", deliveryDate: STALE_PAST_DATE }),
    );
    await expect(
      cancelTask(userCtx(["task:cancel"]), TASK_ID as never),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips QStash enqueue when task has no external_tracking_number (pre-push cancel)", async () => {
    const before = taskFixture({
      internalStatus: "CREATED",
      deliveryDate: FAR_FUTURE_DATE,
      externalTrackingNumber: null,
    });
    const after = { ...before, internalStatus: "CANCELED" as const };
    mockFindById.mockResolvedValueOnce(before);
    mockUpdate.mockResolvedValueOnce(after);

    await cancelTask(userCtx(["task:cancel"]), TASK_ID as never);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalled();
    expect(mockEnqueueCancelTask).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when task does not exist", async () => {
    mockFindById.mockResolvedValueOnce(null);
    await expect(
      cancelTask(userCtx(["task:cancel"]), TASK_ID as never),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("bulkCancelTasks — transactional cancel + fan-out enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({} as never),
    );
  });

  it("rejects user without task:bulk_cancel with ForbiddenError", async () => {
    await expect(
      bulkCancelTasks(userCtx([]), [TASK_ID as never]),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns empty result on empty input without DB / audit / enqueue", async () => {
    const result = await bulkCancelTasks(userCtx(["task:bulk_cancel"]), []);
    expect(result).toEqual({ canceled: [], alreadyCanceled: [], failures: [] });
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("happy path: cancels N tasks, emits N audits, enqueues bulk", async () => {
    const t1 = taskFixture({ id: "t1" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-1" });
    const t2 = taskFixture({ id: "t2" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-2" });
    mockFindById.mockResolvedValueOnce(t1).mockResolvedValueOnce(t2);
    mockUpdate
      .mockResolvedValueOnce({ ...t1, internalStatus: "CANCELED" })
      .mockResolvedValueOnce({ ...t2, internalStatus: "CANCELED" });

    const result = await bulkCancelTasks(
      userCtx(["task:bulk_cancel"]),
      ["t1" as never, "t2" as never],
    );

    expect(result.canceled).toHaveLength(2);
    expect(result.alreadyCanceled).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEnqueueBulkCancelTasks).toHaveBeenCalledTimes(1);
    const payloads = mockEnqueueBulkCancelTasks.mock.calls[0][0];
    expect(payloads).toHaveLength(2);
    expect(payloads[0].awb).toBe("MPL-1");
    expect(payloads[1].awb).toBe("MPL-2");
  });

  it("partial: per-task cutoff failure collected; valid tasks still cancel + enqueue", async () => {
    const ok = taskFixture({ id: "ok" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-OK" });
    const stale = taskFixture({ id: "stale" as never, deliveryDate: STALE_PAST_DATE });
    mockFindById.mockResolvedValueOnce(ok).mockResolvedValueOnce(stale);
    mockUpdate.mockResolvedValueOnce({ ...ok, internalStatus: "CANCELED" });

    const result = await bulkCancelTasks(
      userCtx(["task:bulk_cancel"]),
      ["ok" as never, "stale" as never],
    );

    expect(result.canceled).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].taskId).toBe("stale");
    expect(result.failures[0].reason).toMatch(/Dubai cut-off/);
    expect(mockEnqueueBulkCancelTasks).toHaveBeenCalledTimes(1);
    expect(mockEnqueueBulkCancelTasks.mock.calls[0][0]).toHaveLength(1);
  });

  it("classifies already-CANCELED into alreadyCanceled (no audit, no enqueue for it)", async () => {
    const already = taskFixture({ id: "x" as never, internalStatus: "CANCELED", deliveryDate: FAR_FUTURE_DATE });
    mockFindById.mockResolvedValueOnce(already);

    const result = await bulkCancelTasks(userCtx(["task:bulk_cancel"]), ["x" as never]);

    expect(result.alreadyCanceled).toHaveLength(1);
    expect(result.canceled).toHaveLength(0);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockEnqueueBulkCancelTasks).not.toHaveBeenCalled();
  });

  it("does not enqueue when canceled tasks lack external_tracking_number (pre-push)", async () => {
    const t = taskFixture({ id: "t" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: null });
    mockFindById.mockResolvedValueOnce(t);
    mockUpdate.mockResolvedValueOnce({ ...t, internalStatus: "CANCELED" });

    const result = await bulkCancelTasks(userCtx(["task:bulk_cancel"]), ["t" as never]);

    expect(result.canceled).toHaveLength(1);
    expect(mockEnqueueBulkCancelTasks).not.toHaveBeenCalled();
  });
});

describe("bulkUpdateTasks — transactional patch + fan-out enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({ execute: vi.fn().mockResolvedValue([{ exists: true }]) } as never),
    );
  });

  it("rejects user without task:bulk_update with ForbiddenError", async () => {
    await expect(
      bulkUpdateTasks(userCtx([]), [TASK_ID as never], { deliveryDate: FAR_FUTURE_DATE }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("happy path: updates N tasks, emits N audits, enqueues bulk", async () => {
    const t1 = taskFixture({ id: "t1" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-1" });
    const t2 = taskFixture({ id: "t2" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-2" });
    const newDate = "2099-06-01";
    mockFindById.mockResolvedValueOnce(t1).mockResolvedValueOnce(t2);
    mockUpdate
      .mockResolvedValueOnce({ ...t1, deliveryDate: newDate })
      .mockResolvedValueOnce({ ...t2, deliveryDate: newDate });

    const result = await bulkUpdateTasks(
      userCtx(["task:bulk_update"]),
      ["t1" as never, "t2" as never],
      { deliveryDate: newDate },
    );

    expect(result.updated).toHaveLength(2);
    expect(result.unchanged).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEnqueueBulkUpdateTasks).toHaveBeenCalledTimes(1);
    const payloads = mockEnqueueBulkUpdateTasks.mock.calls[0][0];
    expect(payloads[0].patch.window?.date).toBe(newDate);
  });

  it("rejects past-cutoff target deliveryDate per-row", async () => {
    const t = taskFixture({ id: "t" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-T" });
    mockFindById.mockResolvedValueOnce(t);

    const result = await bulkUpdateTasks(
      userCtx(["task:bulk_update"]),
      ["t" as never],
      { deliveryDate: STALE_PAST_DATE },
    );

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toMatch(/target delivery date/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("classifies no-op patches into unchanged (no audit, no enqueue)", async () => {
    const t = taskFixture({ id: "t" as never, deliveryDate: FAR_FUTURE_DATE, externalTrackingNumber: "MPL-T", notes: "same" });
    mockFindById.mockResolvedValueOnce(t);
    mockUpdate.mockResolvedValueOnce(t);

    const result = await bulkUpdateTasks(userCtx(["task:bulk_update"]), ["t" as never], {
      notes: "same", // identical → no change
    });

    expect(result.updated).toHaveLength(0);
    expect(result.unchanged).toHaveLength(1);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockEnqueueBulkUpdateTasks).not.toHaveBeenCalled();
  });
});

describe("updateTaskAndPushOutbound — wrapper around updateTask + enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTenant.mockImplementation(async (_tenantId, fn) =>
      fn({ execute: vi.fn().mockResolvedValue([{ exists: true }]) } as never),
    );
  });

  it("delegates to updateTask + enqueues update-task message when task has AWB + window patch", async () => {
    const before = taskFixture({
      deliveryDate: FAR_FUTURE_DATE,
      externalTrackingNumber: "MPL-WRAP",
    });
    const after = { ...before, deliveryDate: "2099-06-01" };
    mockFindById.mockResolvedValueOnce(before);
    mockUpdate.mockResolvedValueOnce(after);

    const result = await updateTaskAndPushOutbound(
      userCtx(["task:update"]),
      TASK_ID as never,
      { deliveryDate: "2099-06-01" },
    );

    expect(result).toBe(after);
    expect(mockEnqueueUpdateTask).toHaveBeenCalledTimes(1);
    const payload = mockEnqueueUpdateTask.mock.calls[0][0];
    expect(payload.awb).toBe("MPL-WRAP");
    expect(payload.patch.window?.date).toBe("2099-06-01");
  });

  it("skips enqueue when task has no external_tracking_number", async () => {
    const before = taskFixture({
      deliveryDate: FAR_FUTURE_DATE,
      externalTrackingNumber: null,
    });
    const after = { ...before, deliveryDate: "2099-06-01" };
    mockFindById.mockResolvedValueOnce(before);
    mockUpdate.mockResolvedValueOnce(after);

    await updateTaskAndPushOutbound(
      userCtx(["task:update"]),
      TASK_ID as never,
      { deliveryDate: "2099-06-01" },
    );

    expect(mockEnqueueUpdateTask).not.toHaveBeenCalled();
  });

  it("skips enqueue when integration patch is empty (e.g. only addressId without snapshot mapping)", async () => {
    const before = taskFixture({
      deliveryDate: FAR_FUTURE_DATE,
      externalTrackingNumber: "MPL-T",
      addressId: null,
    });
    const after = {
      ...before,
      addressId: "00000000-0000-0000-0000-000000000bbb" as never,
    };
    mockFindById.mockResolvedValueOnce(before);
    mockUpdate.mockResolvedValueOnce(after);

    await updateTaskAndPushOutbound(
      userCtx(["task:update"]),
      TASK_ID as never,
      { addressId: "00000000-0000-0000-0000-000000000bbb" as never },
    );

    expect(mockEnqueueUpdateTask).not.toHaveBeenCalled();
  });

  it("propagates underlying updateTask errors (e.g. cutoff guard)", async () => {
    const stale = taskFixture({ deliveryDate: STALE_PAST_DATE, externalTrackingNumber: "MPL-X" });
    mockFindById.mockResolvedValueOnce(stale);

    await expect(
      updateTaskAndPushOutbound(userCtx(["task:update"]), TASK_ID as never, {
        notes: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockEnqueueUpdateTask).not.toHaveBeenCalled();
  });
});
