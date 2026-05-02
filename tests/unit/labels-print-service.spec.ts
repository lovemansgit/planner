// tests/unit/labels-print-service.spec.ts
//
// Day 8 / D8-6 — printLabelsForTasks service-layer regression markers.
//
// LOAD-BEARING ASSERTIONS:
//   1. Permission gate — task:print_labels required; ForbiddenError
//      when missing.
//   2. Visibility filter (silent drop) — submitted IDs that don't
//      belong to the requesting tenant drop. ValidationError ONLY when
//      every submitted ID dropped (operator submitted a list of
//      cross-tenant or bogus UUIDs); partial drops succeed silently
//      with the audit metadata's requested_count/printed_count split.
//   3. Adapter call — adapter.authenticate + adapter.printLabels
//      called with the FILTERED ID list (not the raw submitted list).
//   4. Audit event — task.labels_printed with USER actor + canonical
//      metadata { task_ids (submitted, pre-filter), format,
//      requested_count, printed_count }.
//   5. Result shape — pdfBuffer + format + requestedCount +
//      printedCount + printedTaskIds returned to the caller.

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
import type { LastMileAdapter } from "../../src/modules/integration";
import { printLabelsForTasks } from "../../src/modules/tasks";
import { withTenant } from "../../src/shared/db";
import { ForbiddenError, ValidationError } from "../../src/shared/errors";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithTenant = vi.mocked(withTenant);
const mockEmit = vi.mocked(emit);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const REQUEST_ID = "test-request-d86";

const TASK_ID_A = "11111111-1111-1111-1111-111111111111";
const TASK_ID_B = "22222222-2222-2222-2222-222222222222";
const TASK_ID_C = "33333333-3333-3333-3333-333333333333";
const TASK_ID_OTHER_TENANT = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function tenantAdminCtx(): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: USER_ID,
    tenantId: TENANT_ID,
    permissions: new Set(["task:print_labels", "task:read"]) as ReadonlySet<`${string}:${string}`>,
  };
  return { actor, tenantId: TENANT_ID, requestId: REQUEST_ID, path: "/api/tasks/labels" };
}

function ctxWithoutPerm(): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: USER_ID,
    tenantId: TENANT_ID,
    // task:read but NOT task:print_labels
    permissions: new Set(["task:read"]) as ReadonlySet<`${string}:${string}`>,
  };
  return { actor, tenantId: TENANT_ID, requestId: REQUEST_ID, path: "/api/tasks/labels" };
}

function stubAdapter(overrides: Partial<LastMileAdapter> = {}): LastMileAdapter & {
  authenticate: ReturnType<typeof vi.fn>;
  printLabels: ReturnType<typeof vi.fn>;
} {
  return {
    authenticate: vi.fn(async (tenantId) => ({
      tenantId,
      token: "stub-token",
      renewalToken: "stub-refresh",
      tokenExpiresAt: "2026-05-02T13:00:00.000Z",
      renewalTokenExpiresAt: "2026-11-02T12:00:00.000Z",
    })),
    refreshSession: vi.fn(),
    createTask: vi.fn(),
    getTaskByAwb: vi.fn(),
    printLabels: vi.fn(async () => Buffer.from("stub-pdf-bytes")),
    fetchAssetTrackingByAwb: vi.fn(),
    verifyWebhookRequest: vi.fn(),
    parseWebhookEvents: vi.fn(),
    mapStatusToInternal: vi.fn(),
    ...overrides,
  } as never;
}

/**
 * Stub withTenant so that listVisibleTaskIds (the only call inside
 * printLabelsForTasks's withTenant block) returns the given IDs as
 * `[{ id }]` rows.
 */
function stubVisibleIds(visibleIds: readonly string[]) {
  mockWithTenant.mockImplementation(async (_tenantId, fn) => {
    const tx = {
      execute: vi.fn(async () => visibleIds.map((id) => ({ id }))),
    };
    return fn(tx as never);
  });
}

describe("D8-6 printLabelsForTasks — permission gate", () => {
  beforeEach(() => {
    mockWithTenant.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("throws ForbiddenError when caller lacks task:print_labels", async () => {
    const adapter = stubAdapter();
    await expect(
      printLabelsForTasks(ctxWithoutPerm(), [TASK_ID_A], adapter),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(adapter.authenticate).not.toHaveBeenCalled();
    expect(adapter.printLabels).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError on empty taskIds (defensive — Zod also gates at route)", async () => {
    const adapter = stubAdapter();
    await expect(
      printLabelsForTasks(tenantAdminCtx(), [], adapter),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(adapter.authenticate).not.toHaveBeenCalled();
  });
});

describe("D8-6 printLabelsForTasks — visibility filter (silent drop)", () => {
  beforeEach(() => {
    mockWithTenant.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("calls adapter.printLabels with the FILTERED ID list (cross-tenant ID dropped silently)", async () => {
    // Operator submitted 3 IDs; visibility filter returns 2 (one is
    // cross-tenant). The dropped ID surfaces ONLY in the audit
    // metadata's requested-vs-printed count, never as a per-ID
    // 404 / 403.
    stubVisibleIds([TASK_ID_A, TASK_ID_B]);
    const adapter = stubAdapter();
    const result = await printLabelsForTasks(
      tenantAdminCtx(),
      [TASK_ID_A, TASK_ID_OTHER_TENANT, TASK_ID_B],
      adapter,
    );

    expect(adapter.printLabels).toHaveBeenCalledTimes(1);
    const printArgs = adapter.printLabels.mock.calls[0];
    expect(printArgs[1]).toEqual([TASK_ID_A, TASK_ID_B]);
    expect(result.requestedCount).toBe(3);
    expect(result.printedCount).toBe(2);
  });

  it("throws ValidationError when EVERY submitted ID drops (operator submitted only cross-tenant IDs)", async () => {
    // Edge case: operator probes for cross-tenant existence by
    // submitting a list of UUIDs and watching for a 200 vs 4xx.
    // We surface 400 (not 404) and surface a generic message that
    // doesn't reveal which IDs (if any) exist in some other tenant.
    stubVisibleIds([]);
    const adapter = stubAdapter();
    await expect(
      printLabelsForTasks(
        tenantAdminCtx(),
        [TASK_ID_OTHER_TENANT],
        adapter,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(adapter.printLabels).not.toHaveBeenCalled();
  });
});

describe("D8-6 printLabelsForTasks — audit + result shape", () => {
  beforeEach(() => {
    mockWithTenant.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  it("emits task.labels_printed with USER actor + canonical metadata shape (task_ids = pre-filter list)", async () => {
    stubVisibleIds([TASK_ID_A, TASK_ID_B]);
    const adapter = stubAdapter();
    await printLabelsForTasks(
      tenantAdminCtx(),
      [TASK_ID_A, TASK_ID_B, TASK_ID_C],
      adapter,
    );

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0]?.[0];
    expect(emitArg).toBeDefined();
    if (!emitArg) throw new Error("emit not called");
    expect(emitArg.eventType).toBe("task.labels_printed");
    expect(emitArg.actorKind).toBe("user");
    expect(emitArg.actorId).toBe(USER_ID);
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("task");
    expect(emitArg.resourceId).toBe(TASK_ID_A); // first submitted id
    expect(emitArg.metadata).toEqual({
      // task_ids: pre-filter list (what the operator submitted) —
      // forensic record of the click. printed_count is the
      // post-filter count.
      task_ids: [TASK_ID_A, TASK_ID_B, TASK_ID_C],
      format: "indv-small",
      requested_count: 3,
      printed_count: 2,
    });
  });

  it("returns PrintLabelsForTasksResult with PDF buffer + counts + filtered ID list", async () => {
    stubVisibleIds([TASK_ID_A, TASK_ID_B]);
    const adapter = stubAdapter({
      printLabels: vi.fn(async () => Buffer.from("MULTI-PAGE-PDF-BYTES")),
    });
    const result = await printLabelsForTasks(
      tenantAdminCtx(),
      [TASK_ID_A, TASK_ID_B, TASK_ID_OTHER_TENANT],
      adapter,
    );

    expect(result.format).toBe("indv-small");
    expect(result.requestedCount).toBe(3);
    expect(result.printedCount).toBe(2);
    expect(result.printedTaskIds).toEqual([TASK_ID_A, TASK_ID_B]);
    expect(result.pdfBuffer).toBeInstanceOf(Buffer);
    expect(result.pdfBuffer.toString("utf8")).toBe("MULTI-PAGE-PDF-BYTES");
  });

  it("authenticates once with the tenant id", async () => {
    stubVisibleIds([TASK_ID_A]);
    const adapter = stubAdapter();
    await printLabelsForTasks(tenantAdminCtx(), [TASK_ID_A], adapter);
    expect(adapter.authenticate).toHaveBeenCalledTimes(1);
    expect(adapter.authenticate).toHaveBeenCalledWith(TENANT_ID);
  });
});
