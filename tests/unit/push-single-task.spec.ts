// tests/unit/push-single-task.spec.ts
//
// Day 8 / D8-5 — pushSingleTask state-machine regression markers.
//
// pushSingleTask is the per-task push primitive extracted for the
// operator-driven DLQ retry path. It mirrors the cron loop's
// per-iteration body and returns a typed `SinglePushOutcome` union;
// each kind is a distinct branch with side-effect implications
// (DLQ write, markPushed, audit emit, etc.) that this test file
// pins.
//
// LOAD-BEARING ASSERTIONS:
//   1. `tenant_skipped` when customer_code is null/whitespace; NO
//      tenant.push_skipped event emitted (that event is for the
//      cron's bulk-pass scope; single-task = operator-layer
//      attribution via failed_push.retried).
//   2. `task_not_found` / `task_already_pushed` short-circuits with
//      no SF call.
//   3. `skipped_district` writes a DLQ row with the canonical
//      `unknown_district:` failure_detail prefix.
//   4. `succeeded` → markTaskPushed + idempotent
//      markFailedPushResolved (closes any stale DLQ row).
//   5. `awb_reconciled` → markTaskPushed (tracking_number = AWB),
//      markFailedPushResolved with `reconciled-via-awb-D8-5-retry`,
//      task.pushed_via_reconcile event with system actor.
//   6. `awb_exists` (reconcile failure) → DLQ row with
//      `awb_exists_reconcile_failed:` prefix; counter posture
//      (reconcile failure counts as awb_exists, not a third counter)
//      mirrored from D8-4b.
//   7. `failed_to_dlq` (non-AWB failure) → DLQ row via
//      recordFailedPushAttempt with classified failure reason.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/modules/audit", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/audit")>("../../src/modules/audit");
  return { ...actual, emit: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("../../src/modules/failed-pushes", () => ({
  recordFailedPushAttempt: vi.fn(),
  markFailedPushResolved: vi.fn(),
}));

vi.mock("../../src/modules/tasks/repository", () => ({
  findTaskById: vi.fn(),
  markTaskPushed: vi.fn(),
  listUnpushedTasksByTenant: vi.fn(),
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { emit } from "../../src/modules/audit";
import {
  markFailedPushResolved,
  recordFailedPushAttempt,
} from "../../src/modules/failed-pushes";
import {
  SuiteFleetAwbExistsError,
  type LastMileAdapter,
} from "../../src/modules/integration";
import { pushSingleTask } from "../../src/modules/task-push";
import { findTaskById, markTaskPushed } from "../../src/modules/tasks/repository";
import type { Task } from "../../src/modules/tasks/types";
import { withServiceRole } from "../../src/shared/db";
import { CredentialError } from "../../src/shared/errors";
import { captureException } from "../../src/shared/sentry-capture";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockRecord = vi.mocked(recordFailedPushAttempt);
const mockResolved = vi.mocked(markFailedPushResolved);
const mockFindTask = vi.mocked(findTaskById);
const mockMarkPushed = vi.mocked(markTaskPushed);
const mockCapture = vi.mocked(captureException);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "test-request-pst";
const RECOVERED_SF_ID = "59254";
const AWB = "MPL-08187661";

function systemCtx(): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "system:dlq_retry",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return { actor, tenantId: TENANT_ID, requestId: REQUEST_ID, path: "/api/failed-pushes/x/retry" };
}

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    subscriptionId: null,
    createdVia: "manual_admin",
    customerOrderNumber: "ORDER-PST-001",
    referenceNumber: null,
    internalStatus: "CREATED",
    externalId: null,
    externalTrackingNumber: null,
    deliveryDate: "2026-05-03",
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
    createdAt: "2026-05-02T12:00:00.000Z",
    updatedAt: "2026-05-02T12:00:00.000Z",
    packages: [],
    ...overrides,
  };
}

function stubAdapter(overrides: Partial<LastMileAdapter> = {}): LastMileAdapter {
  return {
    authenticate: vi.fn(async (tenantId) => ({
      tenantId,
      token: "stub-token",
      renewalToken: "stub-refresh",
      tokenExpiresAt: "2026-05-02T13:00:00.000Z",
      renewalTokenExpiresAt: "2026-11-02T12:00:00.000Z",
    })),
    refreshSession: vi.fn(),
    createTask: vi.fn(async () => ({
      externalId: "59999",
      trackingNumber: "MPL-99999999",
      status: "CREATED",
      createdAt: "2026-05-02T17:00:00.000Z",
    })),
    getTaskByAwb: vi.fn(async () => ({ externalId: RECOVERED_SF_ID })),
    fetchAssetTrackingByAwb: vi.fn(),
    verifyWebhookRequest: vi.fn(),
    parseWebhookEvents: vi.fn(),
    mapStatusToInternal: vi.fn(),
    ...overrides,
  } as never;
}

interface ServiceRoleStubConfig {
  customerCode?: string | null;
  consigneeDistrict?: string;
}

function stubWithServiceRoleHappy(cfg: ServiceRoleStubConfig = {}) {
  // Resolve the customer_code value. `??` coalesces null TO the
  // default — wrong when the test wants to pass null through, so
  // distinguish via the property's presence in the config object.
  const customerCode = "customerCode" in cfg ? cfg.customerCode : "MPL";
  let serviceRoleCall = 0;
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    serviceRoleCall += 1;
    const tx = {
      execute: vi.fn(async () => {
        if (serviceRoleCall === 1) {
          return [{ suitefleet_customer_code: customerCode }];
        }
        // 2nd call (load_task) is handled via mockFindTask, NOT
        // tx.execute — so this stub is for any subsequent
        // tx.execute calls. Per pushSingleTask sequence:
        //   call 3: load_consignee
        //   call 4: mark_pushed (succeeded path)
        // We return consignee on call 3 and empty on call 4.
        if (serviceRoleCall === 3) {
          return [
            {
              id: CONSIGNEE_ID,
              name: "PST Test Consignee",
              phone: "+971500000099",
              email: null,
              address_line: "1 Test Rd",
              emirate_or_region: "Dubai",
              district: cfg.consigneeDistrict ?? "Al Quoz Industrial 1",
            },
          ];
        }
        return [];
      }),
    };
    return fn(tx as never);
  });
}

describe("D8-5 pushSingleTask — guards", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockRecord.mockResolvedValue({
      id: "fp-stub",
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      attemptCount: 1,
      taskPayload: {},
      failureReason: "unknown",
      failureDetail: "stub",
      httpStatus: null,
      firstFailedAt: "2026-05-02T12:00:00.000Z",
      lastAttemptedAt: "2026-05-02T12:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      createdAt: "2026-05-02T12:00:00.000Z",
      updatedAt: "2026-05-02T12:00:00.000Z",
    });
    mockResolved.mockReset();
    mockResolved.mockResolvedValue(null);
    mockFindTask.mockReset();
    mockMarkPushed.mockReset();
    mockMarkPushed.mockResolvedValue(true);
    mockCapture.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("returns tenant_skipped when customer_code is null; emits NO tenant.push_skipped event", async () => {
    stubWithServiceRoleHappy({ customerCode: null });
    const adapter = stubAdapter();
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);

    expect(outcome).toEqual({ kind: "tenant_skipped", reason: "missing_customer_code" });
    expect(adapter.authenticate).not.toHaveBeenCalled();
    expect(adapter.createTask).not.toHaveBeenCalled();
    // No tenant.push_skipped — that event is bulk-cron-scope only.
    const skippedEmits = mockEmit.mock.calls.filter(
      (c) => c[0].eventType === "tenant.push_skipped",
    );
    expect(skippedEmits).toHaveLength(0);
  });

  it("returns tenant_skipped on whitespace-only customer_code (defensive trim guard)", async () => {
    stubWithServiceRoleHappy({ customerCode: "   " });
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, stubAdapter());
    expect(outcome.kind).toBe("tenant_skipped");
  });

  it("returns task_not_found when findTaskById returns null", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(null);
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, stubAdapter());
    expect(outcome).toEqual({ kind: "task_not_found" });
  });

  it("returns task_not_found when the task belongs to another tenant (RLS-equivalent)", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(taskFixture({ tenantId: "other-tenant-uuid" }));
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, stubAdapter());
    expect(outcome.kind).toBe("task_not_found");
  });

  it("returns task_already_pushed when pushedToExternalAt + externalId are set", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(
      taskFixture({
        externalId: "existing-sf-id",
        externalTrackingNumber: "MPL-EXISTING",
        pushedToExternalAt: "2026-05-02T15:57:57.526Z",
      }),
    );
    const adapter = stubAdapter();
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);
    expect(outcome).toEqual({ kind: "task_already_pushed", externalId: "existing-sf-id" });
    expect(adapter.authenticate).not.toHaveBeenCalled();
  });

  it("returns skipped_district + writes DLQ row with `unknown_district:` prefix when consignee.district is the UNKNOWN sentinel", async () => {
    stubWithServiceRoleHappy({ consigneeDistrict: "UNKNOWN" });
    mockFindTask.mockResolvedValue(taskFixture());
    const adapter = stubAdapter();
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);

    expect(outcome).toEqual({ kind: "skipped_district", district: "UNKNOWN" });
    expect(adapter.createTask).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const recordArg = mockRecord.mock.calls[0][1];
    expect(recordArg.failureReason).toBe("unknown");
    expect(recordArg.failureDetail).toMatch(/^unknown_district:/);
  });
});

describe("D8-5 pushSingleTask — happy paths", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockResolved.mockReset();
    mockFindTask.mockReset();
    mockMarkPushed.mockReset();
    mockMarkPushed.mockResolvedValue(true);
    mockCapture.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("returns succeeded on clean SF push; calls markTaskPushed + idempotent markFailedPushResolved", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(taskFixture());
    mockResolved.mockResolvedValue(null); // no prior DLQ row
    const adapter = stubAdapter();
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);

    expect(outcome).toEqual({
      kind: "succeeded",
      externalId: "59999",
      trackingNumber: "MPL-99999999",
    });
    expect(adapter.createTask).toHaveBeenCalledTimes(1);
    expect(mockMarkPushed).toHaveBeenCalledTimes(1);
    expect(mockResolved).toHaveBeenCalledTimes(1);
    // Resolution notes pinned for forensic clarity on
    // /admin/failed-pushes
    expect(mockResolved.mock.calls[0][2]).toBe("resolved-via-D8-5-retry-success");
  });

  it("returns awb_reconciled on AwbExistsError → getTaskByAwb success; marks pushed with AWB as tracking", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(taskFixture());
    mockResolved.mockResolvedValue({
      id: "fp-1",
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      attemptCount: 2,
      taskPayload: {},
      failureReason: "client_4xx",
      failureDetail: `awb_exists: '${AWB}'`,
      httpStatus: 400,
      firstFailedAt: "2026-05-01T12:00:00.000Z",
      lastAttemptedAt: "2026-05-02T12:00:00.000Z",
      resolvedAt: "2026-05-02T17:09:54.223Z",
      resolvedBy: null,
      resolutionNotes: "reconciled-via-awb-D8-5-retry",
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-02T17:09:54.223Z",
    });

    const adapter = stubAdapter({
      createTask: vi.fn(async () => {
        throw new SuiteFleetAwbExistsError(AWB, 400, `Awb with value ${AWB} exists already`);
      }),
    }) as LastMileAdapter & {
      createTask: ReturnType<typeof vi.fn>;
      getTaskByAwb: ReturnType<typeof vi.fn>;
    };
    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);

    expect(outcome.kind).toBe("awb_reconciled");
    if (outcome.kind === "awb_reconciled") {
      expect(outcome.externalId).toBe(RECOVERED_SF_ID);
      expect(outcome.awb).toBe(AWB);
      expect(outcome.priorFailedPushResolved).toBe(true);
    }

    // markTaskPushed called with recovered SF id + AWB as tracking_number
    expect(mockMarkPushed).toHaveBeenCalledTimes(1);
    const markArgs = mockMarkPushed.mock.calls[0];
    expect(markArgs[3]).toBe(RECOVERED_SF_ID);
    expect(markArgs[4]).toBe(AWB);

    // task.pushed_via_reconcile emit (system actor — system:dlq_retry)
    const reconcileEmits = mockEmit.mock.calls.filter(
      (c) => c[0].eventType === "task.pushed_via_reconcile",
    );
    expect(reconcileEmits).toHaveLength(1);
    expect(reconcileEmits[0][0].actorKind).toBe("system");
    expect(reconcileEmits[0][0].metadata).toMatchObject({
      task_id: TASK_ID,
      external_id: RECOVERED_SF_ID,
      awb: AWB,
      prior_failed_push_resolved: true,
    });

    // markFailedPushResolved called with the canonical D8-5-retry note
    expect(mockResolved).toHaveBeenCalledTimes(1);
    expect(mockResolved.mock.calls[0][2]).toBe("reconciled-via-awb-D8-5-retry");
  });
});

describe("D8-5 pushSingleTask — failure paths", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockRecord.mockResolvedValue({
      id: "fp-1",
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      attemptCount: 3,
      taskPayload: {},
      failureReason: "unknown",
      failureDetail: "stub",
      httpStatus: null,
      firstFailedAt: "2026-05-01T12:00:00.000Z",
      lastAttemptedAt: "2026-05-02T12:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-02T12:00:00.000Z",
    });
    mockResolved.mockReset();
    mockResolved.mockResolvedValue(null);
    mockFindTask.mockReset();
    mockMarkPushed.mockReset();
    mockMarkPushed.mockResolvedValue(true);
    mockCapture.mockReset();
  });

  afterEach(() => vi.clearAllMocks());

  it("returns awb_exists with `awb_exists_reconcile_failed:` prefix when getTaskByAwb fails", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(taskFixture());
    const adapter = stubAdapter({
      createTask: vi.fn(async () => {
        throw new SuiteFleetAwbExistsError(AWB, 400, `Awb with value ${AWB} exists already`);
      }),
      getTaskByAwb: vi.fn(async () => {
        throw new CredentialError(
          "SuiteFleet getTaskByAwb network error — single-attempt policy, no retry",
        );
      }),
    });

    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);

    expect(outcome.kind).toBe("awb_exists");
    if (outcome.kind === "awb_exists") {
      expect(outcome.awb).toBe(AWB);
      // The reconcileErrorMessage carries the full classified detail
      // including the load-bearing prefix.
      expect(outcome.reconcileErrorMessage).toMatch(
        /^awb_exists_reconcile_failed: 'MPL-08187661'; getTaskByAwb error:/,
      );
    }

    // DLQ row recorded with the prefix
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][1].failureDetail).toMatch(
      /^awb_exists_reconcile_failed: 'MPL-08187661'; getTaskByAwb error:/,
    );

    // No task.pushed_via_reconcile event — failure path doesn't emit
    const reconcileEmits = mockEmit.mock.calls.filter(
      (c) => c[0].eventType === "task.pushed_via_reconcile",
    );
    expect(reconcileEmits).toHaveLength(0);
  });

  it("returns failed_to_dlq for non-AWB push errors with classified failureReason", async () => {
    stubWithServiceRoleHappy();
    mockFindTask.mockResolvedValue(taskFixture());
    const adapter = stubAdapter({
      createTask: vi.fn(async () => {
        throw new CredentialError(
          "SuiteFleet createTask returned 503 — single-attempt policy, no retry",
        );
      }),
    });

    const outcome = await pushSingleTask(systemCtx(), TASK_ID, adapter);

    expect(outcome.kind).toBe("failed_to_dlq");
    if (outcome.kind === "failed_to_dlq") {
      // CredentialError with "5" + "0" in message → server_5xx per
      // classifyAdapterError's heuristic (mirrors D8-4a).
      expect(outcome.failureReason).toBe("server_5xx");
    }
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
});
