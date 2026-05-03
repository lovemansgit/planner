// tests/unit/cron-push-rejects-unknown-district.spec.ts
//
// Day 8 / D8-4a — fail-closed guard 1 (per-task).
//
// RULE: When `consignee.district === 'UNKNOWN'` (the sentinel value
// the D8-2 schema migration backfilled for missing district), the
// cron's per-tenant push pass MUST:
//   1. NOT call the SF adapter's createTask method for that task.
//   2. Write a `failed_pushes` row via `recordFailedPushAttempt`
//      with `failureReason='unknown'` and `failureDetail` starting
//      with 'unknown_district:'. The DB CHECK constraint restricts
//      failure_reason to a fixed set; 'unknown_district' lives in
//      failureDetail, not the enum.
//   3. Continue processing the rest of the batch (one task's
//      pre-flight skip does NOT abort the whole tenant).
//   4. Return outcome `{ kind: 'pushed', skippedDistrict: N, ... }`.
//
// `recordFailedPushAttempt` (D8-4a) emits the audit event with
// `metadata.attempt_count` reflecting the increment count. The audit
// metadata's `reason='unknown_district'` lives inside the
// `recordFailedPushAttempt` call's failureDetail (not asserted at
// this level — the failed-pushes service tests cover the audit
// metadata shape independently).
//
// Why a named test file: brief's PR #74 watch-item registration
// asked for a named regression marker so CI grep finds the rule by
// name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/modules/audit", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/audit")>("../../src/modules/audit");
  return {
    ...actual,
    emit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../src/modules/failed-pushes", () => ({
  recordFailedPushAttempt: vi.fn(),
}));

vi.mock("../../src/modules/tasks/repository", () => ({
  listUnpushedTasksByTenant: vi.fn(),
  markTaskPushed: vi.fn(),
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { withServiceRole } from "../../src/shared/db";
import { emit } from "../../src/modules/audit";
import { recordFailedPushAttempt } from "../../src/modules/failed-pushes";
import { pushTasksForTenant } from "../../src/modules/task-push";
import {
  listUnpushedTasksByTenant,
  markTaskPushed,
} from "../../src/modules/tasks/repository";
import type { LastMileAdapter } from "../../src/modules/integration";
import type { Task } from "../../src/modules/tasks/types";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockRecord = vi.mocked(recordFailedPushAttempt);
const mockListUnpushed = vi.mocked(listUnpushedTasksByTenant);
const mockMarkPushed = vi.mocked(markTaskPushed);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TASK_ID_UNKNOWN = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID_UNKNOWN = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "test-request-ud";

function systemCtx(): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:generate_tasks",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: REQUEST_ID,
    path: "/api/cron/generate-tasks",
  };
}

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID_UNKNOWN,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID_UNKNOWN,
    subscriptionId: null,
    createdVia: "manual_admin",
    customerOrderNumber: "ORDER-UD-001",
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
    createdAt: "2026-05-02T12:00:00.000Z",
    updatedAt: "2026-05-02T12:00:00.000Z",
    packages: [],
    ...overrides,
  };
}

function stubAdapter(): LastMileAdapter & {
  authenticate: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
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
    createTask: vi.fn(async () => {
      throw new Error("createTask must NOT be called when unknown_district guard fires");
    }),
    fetchAssetTrackingByAwb: vi.fn(),
    verifyWebhookRequest: vi.fn(),
    parseWebhookEvents: vi.fn(),
    mapStatusToInternal: vi.fn(),
  } as never;
}

describe("D8-4a guard 1 — unknown_district (per-task fail-closed)", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockRecord.mockResolvedValue({
      id: "fp-1",
      tenantId: TENANT_ID,
      taskId: TASK_ID_UNKNOWN,
      attemptCount: 1,
      taskPayload: {},
      failureReason: "unknown",
      failureDetail: "unknown_district: stub",
      httpStatus: null,
      firstFailedAt: "2026-05-02T12:00:00.000Z",
      lastAttemptedAt: "2026-05-02T12:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNotes: null,
      createdAt: "2026-05-02T12:00:00.000Z",
      updatedAt: "2026-05-02T12:00:00.000Z",
    });
    mockListUnpushed.mockReset();
    mockMarkPushed.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT call adapter.createTask when consignee.district is the UNKNOWN sentinel", async () => {
    // Three withServiceRole calls in this path:
    //   1. load_config — customer_code present (passes guard 2)
    //   2. list_unpushed — returns one task
    //   3. load_consignee — returns consignee with district='UNKNOWN'
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) {
            return [{ suitefleet_customer_code: "MPL" }];
          }
          if (serviceRoleCall === 3) {
            // load_consignee
            return [
              {
                id: CONSIGNEE_ID_UNKNOWN,
                name: "UD Test Consignee",
                phone: "+971500000099",
                email: null,
                address_line: "123 Stub St",
                emirate_or_region: "Dubai",
                district: "UNKNOWN",
              },
            ];
          }
          throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
        }),
      };
      // call #2 invokes the listUnpushedTasksByTenant mock directly
      // (not via tx.execute), so we just resolve fn with the stub tx
      return fn(tx as never);
    });

    mockListUnpushed.mockResolvedValue([taskFixture()]);

    const adapter = stubAdapter();
    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    // Outcome: pushed kind, exactly 1 skippedDistrict, 0 succeeded
    expect(outcome.kind).toBe("pushed");
    if (outcome.kind === "pushed") {
      expect(outcome.attemptedCount).toBe(1);
      expect(outcome.succeeded).toBe(0);
      expect(outcome.skippedDistrict).toBe(1);
      expect(outcome.failedToDLQ).toBe(0);
      expect(outcome.awbExists).toBe(0);
    }

    // Load-bearing: ZERO calls to adapter.createTask
    expect(adapter.createTask).not.toHaveBeenCalled();

    // The task must NOT be marked pushed
    expect(mockMarkPushed).not.toHaveBeenCalled();
  });

  it("calls recordFailedPushAttempt with failureReason='unknown' and failureDetail starting with 'unknown_district:'", async () => {
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: "MPL" }];
          if (serviceRoleCall === 3) {
            return [
              {
                id: CONSIGNEE_ID_UNKNOWN,
                name: "UD Test Consignee",
                phone: "+971500000099",
                email: null,
                address_line: "123 Stub St",
                emirate_or_region: "Dubai",
                district: "UNKNOWN",
              },
            ];
          }
          throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });

    mockListUnpushed.mockResolvedValue([taskFixture()]);

    const adapter = stubAdapter();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const recordArg = mockRecord.mock.calls[0][1];
    expect(recordArg.taskId).toBe(TASK_ID_UNKNOWN);
    expect(recordArg.failureReason).toBe("unknown");
    expect(recordArg.failureDetail).toMatch(/^unknown_district:/);
    // Payload carries the pre-flight-skip marker for forensic clarity
    expect(recordArg.taskPayload).toEqual({
      skipped_pre_flight: true,
      reason: "unknown_district",
    });
  });

});
