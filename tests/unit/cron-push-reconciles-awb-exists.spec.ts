// tests/unit/cron-push-reconciles-awb-exists.spec.ts
//
// Day 8 / D8-4b — AWB-exists reconcile path.
//
// RULE (happy path): When SF returns 23505/AWB-exists on createTask
// (`SuiteFleetAwbExistsError` from the adapter), the cron's per-tenant
// push pass MUST:
//   1. Call `adapter.getTaskByAwb(session, awb)` exactly once with
//      the parsed AWB from the typed error.
//   2. Call `markTaskPushed(taskId, externalId, awb)` to set
//      external_id / external_tracking_number / pushed_to_external_at.
//      tracking_number = the AWB itself.
//   3. Call `markFailedPushResolved(ctx, taskId, "reconciled-via-awb-D8-4b")`
//      — idempotent, returns null when no DLQ row existed.
//   4. Emit `task.pushed_via_reconcile` with task_id / external_id /
//      awb / customer_order_number / prior_failed_push_resolved.
//   5. Increment `awbExistsReconciled` (NOT `awbExists`) on outcome.
//   6. NOT call `recordFailedPushAttempt` — the loop closed cleanly.
//
// RULE (reconcile-failure path): When `getTaskByAwb` throws (network,
// auth, parse error, 4xx other than the AWB-exists itself), the
// cron MUST:
//   1. Call `recordFailedPushAttempt` with failureDetail prefixed
//      `awb_exists_reconcile_failed: '<awb>'; getTaskByAwb error: ...`
//      so operators can distinguish parse-only-era DLQ rows from
//      reconcile-attempted-and-failed rows.
//   2. Increment `awbExists` (NOT `awbExistsReconciled`).
//   3. NOT emit `task.pushed_via_reconcile`.
//
// RULE (reconcile-recovered local-write-failure path — Day 9 / D8-4b
// operator-visibility fix): When `getTaskByAwb` SUCCEEDED (we have
// the recovered SF id) BUT the subsequent `markTaskPushed` local
// UPDATE threw (DB connection drop, etc.), the cron MUST:
//   1. Sentry-capture the markErr (was the only signal pre-D8-4b).
//   2. Call `recordFailedPushAttempt` with failureDetail prefixed
//      `reconcile_recovered_but_mark_pushed_failed: '<awb>' (sf_id: <id>); error: <msg>`
//      so /admin/failed-pushes surfaces the row and the operator gets
//      cut-and-paste recovery (recovered SF id is in the detail).
//      Distinct from the two prefixes above so all three forensic
//      categories grep apart on the DLQ.
//   3. Increment `awbExists` (NOT `awbExistsReconciled`) — the loop
//      didn't close cleanly.
//   4. NOT emit `task.pushed_via_reconcile` — we don't claim the
//      reconcile succeeded if the local write didn't land.
//
// Counter posture (reviewer-locked, D8-4b): two AWB counters, NOT
// three. Reconcile failures (both shapes) count as `awbExists`. See
// PushTenantOutcome jsdoc for the rationale.
//
// Why a named test file: same precedent as the D8-4a guard tests —
// brief's PR #74 watch-item registration asks for named regression
// markers so CI grep finds the rule by name.

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
  markFailedPushResolved: vi.fn(),
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
import {
  markFailedPushResolved,
  recordFailedPushAttempt,
} from "../../src/modules/failed-pushes";
import { SuiteFleetAwbExistsError } from "../../src/modules/integration";
import { pushTasksForTenant } from "../../src/modules/task-push";
import { captureException } from "../../src/shared/sentry-capture";
import {
  listUnpushedTasksByTenant,
  markTaskPushed,
} from "../../src/modules/tasks/repository";
import { CredentialError } from "../../src/shared/errors";
import type { LastMileAdapter } from "../../src/modules/integration";
import type { Task } from "../../src/modules/tasks/types";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockRecord = vi.mocked(recordFailedPushAttempt);
const mockResolved = vi.mocked(markFailedPushResolved);
const mockListUnpushed = vi.mocked(listUnpushedTasksByTenant);
const mockMarkPushed = vi.mocked(markTaskPushed);
const mockCapture = vi.mocked(captureException);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "test-request-reconcile";
const RECOVERED_SF_ID = "59254";
const AWB = "MPL-08187661";
const CUSTOMER_ORDER_NUMBER = "ORDER-RC-001";

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
    id: TASK_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    subscriptionId: null,
    createdVia: "manual_admin",
    customerOrderNumber: CUSTOMER_ORDER_NUMBER,
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

/**
 * Stub adapter where createTask is hard-wired to throw the AWB-exists
 * typed error. getTaskByAwb default returns the recovered SF id.
 * Individual tests override getTaskByAwb to throw for failure-path
 * scenarios.
 */
function stubAdapterReconciles(): LastMileAdapter & {
  authenticate: ReturnType<typeof vi.fn>;
  createTask: ReturnType<typeof vi.fn>;
  getTaskByAwb: ReturnType<typeof vi.fn>;
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
      throw new SuiteFleetAwbExistsError(
        AWB,
        400,
        `Awb with value ${AWB} exists already`,
      );
    }),
    getTaskByAwb: vi.fn(async () => ({ externalId: RECOVERED_SF_ID })),
    fetchAssetTrackingByAwb: vi.fn(),
    verifyWebhookRequest: vi.fn(),
    parseWebhookEvents: vi.fn(),
    mapStatusToInternal: vi.fn(),
  } as never;
}

/**
 * Stand up the per-tenant withServiceRole call sequence for one task.
 * The cron's reconcile branch produces these calls in order:
 *   1. load_config              — returns customer_code present
 *   2. (count_unpushed skipped — only fires on the missing_customer_code guard)
 *   3. list_unpushed            — returns the one task fixture
 *   4. load_consignee           — returns consignee with valid district
 *   5. mark_pushed_via_reconcile — UPDATE task row (return value: 1 row)
 *   (markFailedPushResolved is mocked at the service-layer boundary
 *    so it doesn't add a withServiceRole call here.)
 */
function stubWithServiceRoleHappy() {
  let serviceRoleCall = 0;
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    serviceRoleCall += 1;
    const tx = {
      execute: vi.fn(async () => {
        if (serviceRoleCall === 1) {
          return [{ suitefleet_customer_code: "MPL" }];
        }
        if (serviceRoleCall === 3) {
          return [
            {
              id: CONSIGNEE_ID,
              name: "RC Test Consignee",
              phone: "+971500000077",
              email: null,
              address_line: "456 Reconcile Rd",
              emirate_or_region: "Dubai",
              district: "Al Quoz Industrial 1",
            },
          ];
        }
        if (serviceRoleCall === 4) {
          // markTaskPushed UPDATE — value is unused by service.ts
          // because markTaskPushed is mocked separately (returns
          // boolean from its own mock).
          return [];
        }
        throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
      }),
    };
    return fn(tx as never);
  });
}

describe("D8-4b reconcile — happy path", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockResolved.mockReset();
    mockListUnpushed.mockReset();
    mockMarkPushed.mockReset();
    mockMarkPushed.mockResolvedValue(true);
    mockCapture.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls getTaskByAwb once with the parsed AWB after createTask throws AwbExistsError", async () => {
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    // No prior DLQ row — markFailedPushResolved returns null
    // (idempotent no-op). prior_failed_push_resolved should land
    // false in the audit metadata.
    mockResolved.mockResolvedValue(null);

    const adapter = stubAdapterReconciles();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(adapter.createTask).toHaveBeenCalledTimes(1);
    expect(adapter.getTaskByAwb).toHaveBeenCalledTimes(1);
    const [sessionArg, awbArg] = adapter.getTaskByAwb.mock.calls[0];
    expect(awbArg).toBe(AWB);
    expect(sessionArg.tenantId).toBe(TENANT_ID);
  });

  it("marks the local task pushed with the recovered SF id and the AWB as tracking_number", async () => {
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    mockResolved.mockResolvedValue(null);

    const adapter = stubAdapterReconciles();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockMarkPushed).toHaveBeenCalledTimes(1);
    const markArgs = mockMarkPushed.mock.calls[0];
    // (tx, tenantId, taskId, externalId, externalTrackingNumber)
    expect(markArgs[1]).toBe(TENANT_ID);
    expect(markArgs[2]).toBe(TASK_ID);
    expect(markArgs[3]).toBe(RECOVERED_SF_ID);
    // tracking_number = the AWB itself per D8-4b reconcile semantics
    expect(markArgs[4]).toBe(AWB);
  });

  it("calls markFailedPushResolved with the canonical resolution_notes string", async () => {
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    mockResolved.mockResolvedValue(null);

    const adapter = stubAdapterReconciles();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockResolved).toHaveBeenCalledTimes(1);
    const callArgs = mockResolved.mock.calls[0];
    const taskIdArg = callArgs[1];
    const notesArg = callArgs[2];
    expect(taskIdArg).toBe(TASK_ID);
    // Reviewer-locked string: 'reconciled-via-awb-D8-4b'. Operators
    // looking at /admin/failed-pushes can grep this resolution_notes
    // value to find system-resolved (cron) entries vs operator-resolved.
    expect(notesArg).toBe("reconciled-via-awb-D8-4b");
  });

  it("emits task.pushed_via_reconcile with the canonical metadata shape (prior_failed_push_resolved=false on first-time AWB-exists)", async () => {
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    mockResolved.mockResolvedValue(null);

    const adapter = stubAdapterReconciles();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("task.pushed_via_reconcile");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("task");
    expect(emitArg.resourceId).toBe(TASK_ID);
    expect(emitArg.metadata).toEqual({
      task_id: TASK_ID,
      external_id: RECOVERED_SF_ID,
      awb: AWB,
      customer_order_number: CUSTOMER_ORDER_NUMBER,
      prior_failed_push_resolved: false,
    });
  });

  it("emits task.pushed_via_reconcile with prior_failed_push_resolved=true when a parse-only-era DLQ row was resolved", async () => {
    // Pre-D8-4b cron passes left parse-only DLQ rows (failure_detail
    // starting with `awb_exists:`). The first D8-4b cron pass that
    // processes such a task hits the AWB-exists branch, reconciles
    // successfully, AND closes out the unresolved DLQ row. The
    // boolean lands in audit metadata so operators can trace which
    // reconciles closed prior failures vs first-time AWB-exists.
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    mockResolved.mockResolvedValue({
      id: "fp-1",
      tenantId: TENANT_ID,
      taskId: TASK_ID,
      attemptCount: 2,
      taskPayload: { stub: true },
      failureReason: "client_4xx",
      failureDetail: `awb_exists: '${AWB}'`,
      httpStatus: 400,
      firstFailedAt: "2026-05-01T12:00:00.000Z",
      lastAttemptedAt: "2026-05-02T12:00:00.000Z",
      resolvedAt: "2026-05-02T16:00:00.000Z",
      resolvedBy: null,
      resolutionNotes: "reconciled-via-awb-D8-4b",
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-02T16:00:00.000Z",
    });

    const adapter = stubAdapterReconciles();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toMatchObject({
      prior_failed_push_resolved: true,
    });
  });

  it("returns outcome with awbExistsReconciled=1 and awbExists=0 (counter posture: success counts as reconciled, NOT awbExists)", async () => {
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    mockResolved.mockResolvedValue(null);

    const adapter = stubAdapterReconciles();
    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(outcome.kind).toBe("pushed");
    if (outcome.kind === "pushed") {
      expect(outcome.attemptedCount).toBe(1);
      expect(outcome.succeeded).toBe(0); // not a clean first-attempt push
      expect(outcome.awbExistsReconciled).toBe(1);
      expect(outcome.awbExists).toBe(0);
      expect(outcome.failedToDLQ).toBe(0);
      expect(outcome.skippedDistrict).toBe(0);
    }
  });

  it("does NOT call recordFailedPushAttempt on the happy path (loop closed cleanly via reconcile)", async () => {
    stubWithServiceRoleHappy();
    mockListUnpushed.mockResolvedValue([taskFixture()]);
    mockResolved.mockResolvedValue(null);

    const adapter = stubAdapterReconciles();
    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("D8-4b reconcile — failure path (getTaskByAwb throws)", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockRecord.mockResolvedValue({
      id: "fp-r-1",
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
    mockListUnpushed.mockReset();
    mockMarkPushed.mockReset();
    mockMarkPushed.mockResolvedValue(true);
    mockCapture.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records failed_pushes with the awb_exists_reconcile_failed prefix when getTaskByAwb throws", async () => {
    // Reviewer-load-bearing: failure_detail prefix
    // `awb_exists_reconcile_failed: '<awb>'; getTaskByAwb error: ...`
    // distinguishes parse-only-era DLQ rows from
    // reconcile-attempted-and-failed rows. Operators on
    // /admin/failed-pushes use this prefix to triage.
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: "MPL" }];
          if (serviceRoleCall === 3) {
            return [
              {
                id: CONSIGNEE_ID,
                name: "RC Test Consignee",
                phone: "+971500000077",
                email: null,
                address_line: "456 Reconcile Rd",
                emirate_or_region: "Dubai",
                district: "Al Quoz Industrial 1",
              },
            ];
          }
          throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });
    mockListUnpushed.mockResolvedValue([taskFixture()]);

    const adapter = stubAdapterReconciles();
    adapter.getTaskByAwb.mockRejectedValueOnce(
      new CredentialError(
        "SuiteFleet getTaskByAwb network error — single-attempt policy, no retry",
      ),
    );

    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const recordArg = mockRecord.mock.calls[0][1];
    expect(recordArg.taskId).toBe(TASK_ID);
    expect(recordArg.failureDetail).toMatch(
      /^awb_exists_reconcile_failed: 'MPL-08187661'; getTaskByAwb error:/,
    );
    expect(recordArg.failureReason).toBe("network");
  });

  it("does NOT emit task.pushed_via_reconcile and does NOT call markTaskPushed when reconcile fails", async () => {
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: "MPL" }];
          if (serviceRoleCall === 3) {
            return [
              {
                id: CONSIGNEE_ID,
                name: "RC Test Consignee",
                phone: "+971500000077",
                email: null,
                address_line: "456 Reconcile Rd",
                emirate_or_region: "Dubai",
                district: "Al Quoz Industrial 1",
              },
            ];
          }
          throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });
    mockListUnpushed.mockResolvedValue([taskFixture()]);

    const adapter = stubAdapterReconciles();
    adapter.getTaskByAwb.mockRejectedValueOnce(new Error("synthetic reconcile failure"));

    await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    // No task.pushed_via_reconcile event — failure path doesn't emit it.
    const reconcileEmits = mockEmit.mock.calls.filter(
      (call) => call[0].eventType === "task.pushed_via_reconcile",
    );
    expect(reconcileEmits).toHaveLength(0);

    // Local task stays unpushed
    expect(mockMarkPushed).not.toHaveBeenCalled();
    // Resolution path not invoked — DLQ row stays unresolved for the
    // next cron pass to retry against.
    expect(mockResolved).not.toHaveBeenCalled();
  });

  it("counts the reconcile failure as awbExists, NOT a third counter (reviewer-locked posture: two AWB counters only)", async () => {
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: "MPL" }];
          if (serviceRoleCall === 3) {
            return [
              {
                id: CONSIGNEE_ID,
                name: "RC Test Consignee",
                phone: "+971500000077",
                email: null,
                address_line: "456 Reconcile Rd",
                emirate_or_region: "Dubai",
                district: "Al Quoz Industrial 1",
              },
            ];
          }
          throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });
    mockListUnpushed.mockResolvedValue([taskFixture()]);

    const adapter = stubAdapterReconciles();
    adapter.getTaskByAwb.mockRejectedValueOnce(new Error("synthetic reconcile failure"));

    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(outcome.kind).toBe("pushed");
    if (outcome.kind === "pushed") {
      expect(outcome.awbExists).toBe(1);
      expect(outcome.awbExistsReconciled).toBe(0);
      expect(outcome.failedToDLQ).toBe(0);
      expect(outcome.succeeded).toBe(0);
    }
  });
});

describe("D8-4b reconcile — markTaskPushed write failure (post-recovery)", () => {
  beforeEach(() => {
    mockWithServiceRole.mockReset();
    mockEmit.mockReset();
    mockEmit.mockResolvedValue(undefined);
    mockRecord.mockReset();
    mockResolved.mockReset();
    mockListUnpushed.mockReset();
    mockMarkPushed.mockReset();
    mockCapture.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Sentry-captures markTaskPushed failures, writes a DLQ row with reconcile_recovered_but_mark_pushed_failed prefix, and counts as awbExists", async () => {
    // SF reconciled successfully (we have the recovered id) but the
    // local UPDATE failed — DB connection drop, etc. Pre-D8-4b
    // (Day 9) the only signal was Sentry; the operator had no
    // /admin/failed-pushes surface. Day 9 D8-4b adds the DLQ row
    // write so operators get cut-and-paste recovery (the recovered
    // SF id lands in failure_detail).
    let serviceRoleCall = 0;
    mockWithServiceRole.mockImplementation(async (_label, fn) => {
      serviceRoleCall += 1;
      // Throw on the markTaskPushed call (#4) to simulate the
      // local DB failure post-reconcile.
      if (serviceRoleCall === 4) {
        throw new Error("synthetic DB failure on markTaskPushed");
      }
      const tx = {
        execute: vi.fn(async () => {
          if (serviceRoleCall === 1) return [{ suitefleet_customer_code: "MPL" }];
          if (serviceRoleCall === 3) {
            return [
              {
                id: CONSIGNEE_ID,
                name: "RC Test Consignee",
                phone: "+971500000077",
                email: null,
                address_line: "456 Reconcile Rd",
                emirate_or_region: "Dubai",
                district: "Al Quoz Industrial 1",
              },
            ];
          }
          throw new Error(`unexpected withServiceRole.execute on call #${serviceRoleCall}`);
        }),
      };
      return fn(tx as never);
    });
    mockListUnpushed.mockResolvedValue([taskFixture()]);

    const adapter = stubAdapterReconciles();
    const outcome = await pushTasksForTenant(systemCtx(), TENANT_ID, adapter);

    expect(mockCapture).toHaveBeenCalledTimes(1);
    const captureContext = mockCapture.mock.calls[0][1] as Record<string, unknown>;
    expect(captureContext.operation).toBe("mark_pushed_via_reconcile");
    expect(captureContext.task_id).toBe(TASK_ID);
    expect(captureContext.awb).toBe(AWB);

    // Day 9 / D8-4b: DLQ row lands with the reconcile-recovered prefix.
    // Three forensic prefixes now grep apart on /admin/failed-pushes:
    //   - awb_exists:  D8-4a parse-only DLQ (pre-reconcile cron pass)
    //   - awb_exists_reconcile_failed:  D8-4b getTaskByAwb-threw path
    //   - reconcile_recovered_but_mark_pushed_failed:  D8-4b post-recovery local-write-failure (this case)
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const recordArg = mockRecord.mock.calls[0][1];
    expect(recordArg.taskId).toBe(TASK_ID);
    expect(recordArg.failureReason).toBe("unknown");
    expect(recordArg.httpStatus).toBeUndefined();
    expect(recordArg.failureDetail).toMatch(
      /^reconcile_recovered_but_mark_pushed_failed: 'MPL-08187661' \(sf_id: 59254\); error:/,
    );
    // Carries the original mark-error message so the operator sees
    // what failed (Sentry has the stack; DLQ has the human-readable line).
    expect(recordArg.failureDetail).toContain("synthetic DB failure on markTaskPushed");

    // No task.pushed_via_reconcile audit event — we don't claim the
    // reconcile succeeded if the local write didn't land.
    const reconcileEmits = mockEmit.mock.calls.filter(
      (call) => call[0].eventType === "task.pushed_via_reconcile",
    );
    expect(reconcileEmits).toHaveLength(0);

    // Counter posture: counts as awbExists (loop didn't close) per
    // the two-counter posture.
    expect(outcome.kind).toBe("pushed");
    if (outcome.kind === "pushed") {
      expect(outcome.awbExists).toBe(1);
      expect(outcome.awbExistsReconciled).toBe(0);
    }
  });
});
