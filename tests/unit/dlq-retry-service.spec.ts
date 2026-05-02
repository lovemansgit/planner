// tests/unit/dlq-retry-service.spec.ts
//
// Day 8 / D8-5 — retryFailedPush service-layer regression markers.
//
// LOAD-BEARING ASSERTIONS:
//   1. Permission gate — `failed_pushes:retry` required; Forbidden
//      otherwise. CS Agent exclusion test in permissions.spec.ts §"
//      failed_pushes:retry permission" pins role membership; this
//      test pins runtime enforcement.
//   2. NotFoundError when the row is missing or cross-tenant.
//   3. ValidationError when the row is already resolved (idempotency
//      guard against double-click + concurrent retry).
//   4. The injected pushTask is called once with a system-actor
//      context (`system:dlq_retry`), preserving tenantId + requestId
//      from the user ctx.
//   5. The `failed_push.retried` audit event is emitted with the USER
//      actor (operator attribution) and the canonical metadata shape
//      including `prior_attempt_count` (BEFORE the retry) and
//      `retry_outcome`.
//   6. The post-retry FailedPush returned to the caller is the
//      RE-FETCHED row (so attempt_count increment from
//      recordFailedPushAttempt or resolved_at from
//      markFailedPushResolved lands in the response).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/modules/audit", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/audit")>("../../src/modules/audit");
  return { ...actual, emit: vi.fn().mockResolvedValue(undefined) };
});

import { emit } from "../../src/modules/audit";
import {
  retryFailedPush,
  type PushSingleTaskFn,
  type RetryFailedPushResult,
} from "../../src/modules/failed-pushes";
import type { FailedPush } from "../../src/modules/failed-pushes";
import type { LastMileAdapter } from "../../src/modules/integration";
import { pushSingleTask, type SinglePushOutcome } from "../../src/modules/task-push";
import { withTenant } from "../../src/shared/db";
import { ForbiddenError, NotFoundError, ValidationError } from "../../src/shared/errors";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

// =============================================================================
// Structural compatibility pin (reviewer-noted before D8-5 merge)
// =============================================================================
// PushSingleTaskFn is defined in failed-pushes/service.ts. The actual
// pushSingleTask runtime function lives in task-push/service.ts. The
// circular-import workaround (function injection at the route layer)
// only buys us anything if the two stay structurally compatible —
// otherwise a future signature drift in pushSingleTask would silently
// break the contract retryFailedPush expects, and the cycle-avoidance
// would be theatre.
//
// `satisfies` is a TS 4.9+ compile-time assertion. If pushSingleTask's
// signature ever diverges from PushSingleTaskFn (extra/missing
// params, return-type mismatch, parameter-type mismatch), this line
// fails to compile and CI breaks at the typecheck step. Runtime
// behaviour is unaffected.
//
// The line is intentionally module-level (not inside a describe block)
// so the assertion fires at file-import time during typecheck — no
// test runner needed to surface a regression.
pushSingleTask satisfies PushSingleTaskFn;

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const FAILED_PUSH_ID = "11111111-1111-1111-1111-111111111111";
const TASK_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "test-request-d85";

function tenantAdminCtx(extraPerms: ReadonlySet<string> = new Set(["failed_pushes:retry"])): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: USER_ID,
    tenantId: TENANT_ID,
    permissions: extraPerms as ReadonlySet<`${string}:${string}`>,
  };
  return { actor, tenantId: TENANT_ID, requestId: REQUEST_ID, path: "/api/failed-pushes/x/retry" };
}

function csAgentCtx(): RequestContext {
  // CS Agent's permission set in roles.ts excludes failed_pushes:retry
  // by design (explicit list, not auto-pickup). Simulate by passing a
  // permission set that lacks the retry perm.
  const actor: Actor = {
    kind: "user",
    userId: USER_ID,
    tenantId: TENANT_ID,
    permissions: new Set(["consignee:read", "subscription:read", "task:read"]) as ReadonlySet<`${string}:${string}`>,
  };
  return { actor, tenantId: TENANT_ID, requestId: REQUEST_ID, path: "/api/failed-pushes/x/retry" };
}

function unresolvedFailedPushFixture(overrides: Partial<FailedPush> = {}): FailedPush {
  return {
    id: FAILED_PUSH_ID,
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    attemptCount: 2,
    taskPayload: { stub: true },
    failureReason: "client_4xx",
    failureDetail: "stub failure",
    httpStatus: 400,
    firstFailedAt: "2026-05-01T12:00:00.000Z",
    lastAttemptedAt: "2026-05-02T12:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-02T12:00:00.000Z",
    ...overrides,
  };
}

function stubAdapter(): LastMileAdapter {
  // Adapter is forwarded into pushTask; the test injects a stubbed
  // pushTask, so the adapter is not exercised. Just satisfies the type.
  return {} as LastMileAdapter;
}

describe("D8-5 retryFailedPush — permission gate", () => {
  beforeEach(() => {
    mockWithTenant.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
  });

  afterEach(() => vi.clearAllMocks());

  it("throws ForbiddenError when caller lacks failed_pushes:retry (CS Agent precedent)", async () => {
    const pushTask = vi.fn(async () => ({ kind: "succeeded" }) as SinglePushOutcome);
    await expect(
      retryFailedPush(csAgentCtx(), FAILED_PUSH_ID, stubAdapter(), pushTask),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(pushTask).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("does NOT throw when caller has failed_pushes:retry (Tenant Admin)", async () => {
    let serviceRoleCall = 0;
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) {
            return [
              {
                id: FAILED_PUSH_ID,
                tenant_id: TENANT_ID,
                task_id: TASK_ID,
                attempt_count: 2,
                task_payload: {},
                failure_reason: "client_4xx",
                failure_detail: null,
                http_status: 400,
                first_failed_at: "2026-05-01T12:00:00.000Z",
                last_attempted_at: "2026-05-02T12:00:00.000Z",
                resolved_at: null,
                resolved_by: null,
                resolution_notes: null,
                created_at: "2026-05-01T12:00:00.000Z",
                updated_at: "2026-05-02T12:00:00.000Z",
              },
            ];
          }
          // 2nd call is the post-retry refetch
          return [
            {
              id: FAILED_PUSH_ID,
              tenant_id: TENANT_ID,
              task_id: TASK_ID,
              attempt_count: 2,
              task_payload: {},
              failure_reason: "client_4xx",
              failure_detail: null,
              http_status: 400,
              first_failed_at: "2026-05-01T12:00:00.000Z",
              last_attempted_at: "2026-05-02T12:00:00.000Z",
              resolved_at: "2026-05-02T17:09:54.223Z",
              resolved_by: null,
              resolution_notes: "resolved-via-D8-5-retry-success",
              created_at: "2026-05-01T12:00:00.000Z",
              updated_at: "2026-05-02T17:09:54.223Z",
            },
          ];
        }),
      };
      return fn(tx as never);
    });
    const pushTask = vi.fn(
      async () => ({ kind: "succeeded", externalId: "59999", trackingNumber: "MPL-99999999" }) as SinglePushOutcome,
    );
    await expect(
      retryFailedPush(tenantAdminCtx(), FAILED_PUSH_ID, stubAdapter(), pushTask),
    ).resolves.toBeDefined();
  });
});

describe("D8-5 retryFailedPush — state guards", () => {
  beforeEach(() => {
    mockWithTenant.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
  });

  afterEach(() => vi.clearAllMocks());

  it("throws NotFoundError when the row doesn't exist in the tenant", async () => {
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = { execute: vi.fn(async () => []) };
      return fn(tx as never);
    });
    const pushTask = vi.fn();
    await expect(
      retryFailedPush(tenantAdminCtx(), FAILED_PUSH_ID, stubAdapter(), pushTask),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(pushTask).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when the row is already resolved (idempotency guard)", async () => {
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      const tx = {
        execute: vi.fn(async () => [
          {
            id: FAILED_PUSH_ID,
            tenant_id: TENANT_ID,
            task_id: TASK_ID,
            attempt_count: 2,
            task_payload: {},
            failure_reason: "client_4xx",
            failure_detail: null,
            http_status: 400,
            first_failed_at: "2026-05-01T12:00:00.000Z",
            last_attempted_at: "2026-05-02T12:00:00.000Z",
            resolved_at: "2026-05-02T16:00:00.000Z",
            resolved_by: null,
            resolution_notes: "resolved-via-D8-5-retry-success",
            created_at: "2026-05-01T12:00:00.000Z",
            updated_at: "2026-05-02T16:00:00.000Z",
          },
        ]),
      };
      return fn(tx as never);
    });
    const pushTask = vi.fn();
    await expect(
      retryFailedPush(tenantAdminCtx(), FAILED_PUSH_ID, stubAdapter(), pushTask),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(pushTask).not.toHaveBeenCalled();
  });
});

describe("D8-5 retryFailedPush — system bridge + audit", () => {
  beforeEach(() => {
    mockWithTenant.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
  });

  afterEach(() => vi.clearAllMocks());

  function stubFindByIdReturning(row: FailedPush) {
    let callCount = 0;
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      callCount++;
      const dbRow = {
        id: row.id,
        tenant_id: row.tenantId,
        task_id: row.taskId,
        attempt_count: row.attemptCount,
        task_payload: row.taskPayload,
        failure_reason: row.failureReason,
        failure_detail: row.failureDetail,
        http_status: row.httpStatus,
        first_failed_at: row.firstFailedAt,
        last_attempted_at: row.lastAttemptedAt,
        resolved_at: row.resolvedAt,
        resolved_by: row.resolvedBy,
        resolution_notes: row.resolutionNotes,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      };
      const tx = { execute: vi.fn(async () => [dbRow]) };
      return fn(tx as never);
    });
    return () => callCount;
  }

  it("calls pushTask once with a system actor (`system:dlq_retry`), preserving tenantId + requestId", async () => {
    stubFindByIdReturning(unresolvedFailedPushFixture());
    // Type the mock with the full PushSingleTaskFn signature so
    // mock.calls[0] is a typed tuple, not `never[]` — gives the
    // narrowing on `actor.kind` etc. below something to chew on.
    const pushTask = vi.fn(
      async (
        ctx: RequestContext,
        taskId: string,
        adapter: LastMileAdapter,
      ): Promise<SinglePushOutcome> => {
        void ctx;
        void taskId;
        void adapter;
        return { kind: "succeeded", externalId: "5", trackingNumber: "T" };
      },
    );
    await retryFailedPush(tenantAdminCtx(), FAILED_PUSH_ID, stubAdapter(), pushTask);

    expect(pushTask).toHaveBeenCalledTimes(1);
    const systemCtx = pushTask.mock.calls[0]?.[0];
    const taskIdArg = pushTask.mock.calls[0]?.[1];
    if (!systemCtx) throw new Error("pushTask was not called");
    expect(systemCtx.actor.kind).toBe("system");
    if (systemCtx.actor.kind === "system") {
      expect(systemCtx.actor.system).toBe("system:dlq_retry");
    }
    expect(systemCtx.tenantId).toBe(TENANT_ID);
    expect(systemCtx.requestId).toBe(REQUEST_ID);
    expect(taskIdArg).toBe(TASK_ID);
  });

  it("emits failed_push.retried with USER actor + canonical metadata shape", async () => {
    stubFindByIdReturning(unresolvedFailedPushFixture({ attemptCount: 3 }));
    const pushTask = vi.fn(
      async () => ({ kind: "awb_reconciled", externalId: "59254", awb: "MPL-X", priorFailedPushResolved: true }) as SinglePushOutcome,
    );
    await retryFailedPush(tenantAdminCtx(), FAILED_PUSH_ID, stubAdapter(), pushTask);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("failed_push.retried");
    expect(emitArg.actorKind).toBe("user");
    expect(emitArg.actorId).toBe(USER_ID);
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("failed_push");
    expect(emitArg.resourceId).toBe(FAILED_PUSH_ID);
    expect(emitArg.metadata).toEqual({
      task_id: TASK_ID,
      failed_push_id: FAILED_PUSH_ID,
      prior_attempt_count: 3,
      retry_outcome: "awb_reconciled",
    });
  });

  it("returns RetryFailedPushResult with the re-fetched row so post-retry state lands in the response", async () => {
    // The 1st withTenant call returns the unresolved row; the 2nd
    // returns a resolved row (resolved-via-success). The result MUST
    // carry the resolved row so the UI can drop the entry from the
    // unresolved list.
    let call = 0;
    mockWithTenant.mockImplementation(async (_tenantId, fn) => {
      call++;
      const resolvedAt = call === 2 ? "2026-05-02T17:09:54.223Z" : null;
      const tx = {
        execute: vi.fn(async () => [
          {
            id: FAILED_PUSH_ID,
            tenant_id: TENANT_ID,
            task_id: TASK_ID,
            attempt_count: 2,
            task_payload: {},
            failure_reason: "client_4xx",
            failure_detail: null,
            http_status: 400,
            first_failed_at: "2026-05-01T12:00:00.000Z",
            last_attempted_at: "2026-05-02T12:00:00.000Z",
            resolved_at: resolvedAt,
            resolved_by: null,
            resolution_notes: resolvedAt !== null ? "resolved-via-D8-5-retry-success" : null,
            created_at: "2026-05-01T12:00:00.000Z",
            updated_at: "2026-05-02T12:00:00.000Z",
          },
        ]),
      };
      return fn(tx as never);
    });
    const pushTask = vi.fn(
      async () => ({ kind: "succeeded", externalId: "5", trackingNumber: "T" }) as SinglePushOutcome,
    );
    const result: RetryFailedPushResult = await retryFailedPush(
      tenantAdminCtx(),
      FAILED_PUSH_ID,
      stubAdapter(),
      pushTask,
    );

    // Re-fetched row's resolved_at is set
    expect(result.failedPush.resolvedAt).toBe("2026-05-02T17:09:54.223Z");
    expect(result.outcome.kind).toBe("succeeded");
  });
});
