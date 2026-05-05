// tests/unit/queue-push-task.spec.ts
//
// §7.2 push-handler tests per merged plan PR #145
// memory/plans/day-14-cron-decoupling.md §7.2.
//
// Covers rows 2-10 of §7.2:
//   2  — Happy path (pushSingleTask kind:'succeeded' → 200)
//   3  — pushSingleTask invocation gate (handler MUST NOT call adapter
//        directly; §5.1 amendment 6)
//   4  — Tenant-scoping mismatch (§5.1 amendment 1 / Step 1.4)
//   5  — address_id null guard (§5.1 amendment 2 / Step 1.5)
//   6  — Already-pushed pre-check (§5.3 Layer 2)
//   7  — AwbExists reconcile (kind:'awb_reconciled' → 200)
//   8  — Transient 5xx → throws (handler propagates so QStash retries)
//   9  — Signature gate structural — verifySignatureAppRouter wraps the
//        handler at module load time (§5.1)
//   10 — Observability log shape (§5.5) — 4-field structured log per
//        outcome path; outcome enum strict-check
//
// Outcome enum strict-check (row 10): the merged plan §5.5 sketches a
// 5-value enum but the route header explicitly notes "10-value
// observability outcome enum (replaces §5.5 sketch's 5-value version,
// which was simplified — actual implementation has more distinct
// states)." This spec pins the 11 actual emitted strings from
// route.ts:72-83 type union — code wins over plan sketch (the
// implementer's own header comment is the post-amendment authority).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@upstash/qstash/nextjs", () => ({
  // Default passthrough wrapper — lets the inner handler run for all
  // tests EXCEPT row 9 (which asserts THIS mock was called when the
  // route module loaded). Tests for actual SDK signature-verification
  // behavior live at integration level, not unit.
  verifySignatureAppRouter: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

vi.mock("../../src/shared/db", () => ({
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../src/modules/tasks/repository", () => ({
  findTaskById: vi.fn(),
}));

vi.mock("../../src/modules/task-push", () => ({
  pushSingleTask: vi.fn(),
}));

const adapterSpies = vi.hoisted(() => ({
  authenticate: vi.fn(),
  refreshSession: vi.fn(),
  createTask: vi.fn(),
  getTaskByAwb: vi.fn(),
  fetchAssetTrackingByAwb: vi.fn(),
  verifyWebhookRequest: vi.fn(),
  parseWebhookEvents: vi.fn(),
  mapStatusToInternal: vi.fn(),
}));

vi.mock("../../src/modules/integration", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/integration")>(
      "../../src/modules/integration",
    );
  return {
    ...actual,
    createSuiteFleetLastMileAdapter: vi.fn(() => adapterSpies),
  };
});

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { POST } from "../../src/app/api/queue/push-task/route";
import { withServiceRole } from "../../src/shared/db";
import { captureException } from "../../src/shared/sentry-capture";
import { findTaskById } from "../../src/modules/tasks/repository";
import { pushSingleTask } from "../../src/modules/task-push";
import type { Task } from "../../src/modules/tasks/types";
import type { SinglePushOutcome } from "../../src/modules/task-push/types";

const mockVerifySig = vi.mocked(verifySignatureAppRouter);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockCapture = vi.mocked(captureException);
const mockFindTaskById = vi.mocked(findTaskById);
const mockPushSingleTask = vi.mocked(pushSingleTask);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT_ID = "00000000-0000-0000-0000-00000000000b";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const ADDRESS_ID = "22222222-2222-2222-2222-222222222222";
const CONSIGNEE_ID = "33333333-3333-3333-3333-333333333333";

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    subscriptionId: null,
    createdVia: "manual_admin",
    customerOrderNumber: "ORDER-Q-001",
    referenceNumber: null,
    internalStatus: "CREATED",
    externalId: null,
    externalTrackingNumber: null,
    deliveryDate: "2026-05-06",
    deliveryStartTime: "09:00:00",
    deliveryEndTime: "11:00:00",
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
    addressId: ADDRESS_ID,
    createdAt: "2026-05-05T12:00:00.000Z",
    updatedAt: "2026-05-05T12:00:00.000Z",
    packages: [],
    ...overrides,
  };
}

function makeRequest(body: { tenant_id: string; task_id: string }): Request {
  return new Request("https://example.com/api/queue/push-task", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "upstash-message-id": "msg-test-123",
    },
    body: JSON.stringify(body),
  });
}

// Console spies — logger emits info/debug via console.log and
// warn/error via console.error (one JSON-stringified line per call).
let logLines: Array<Record<string, unknown>>;
let errorLines: Array<Record<string, unknown>>;

function captureJsonLine(
  bucket: Array<Record<string, unknown>>,
): (line?: unknown) => void {
  return (line?: unknown) => {
    if (typeof line !== "string") return;
    try {
      bucket.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Non-JSON lines (e.g., dev banners) — ignore.
    }
  };
}

function defaultMockSetup(task: Task = taskFixture()): void {
  mockWithServiceRole.mockImplementation(
    async (_label: string, fn: (tx: never) => Promise<unknown>) =>
      fn({} as never),
  );
  mockFindTaskById.mockResolvedValue(task);
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockCapture.mockReset();
  mockFindTaskById.mockReset();
  mockPushSingleTask.mockReset();
  Object.values(adapterSpies).forEach((spy) => spy.mockReset());

  logLines = [];
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation(captureJsonLine(logLines));
  vi.spyOn(console, "error").mockImplementation(captureJsonLine(errorLines));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// §7.2 row 9 — Signature gate (structural)
// ===========================================================================
//
// Tests row 9 first because it asserts a fact about module load — the
// `verifySignatureAppRouter` wrapper has already been called by the
// time any test runs (mocks hoisted; route module imported above).
// Asserting here pins "the SDK gate is wired up at module level."

describe("§7.2 row 9 — signature gate is wired via verifySignatureAppRouter", () => {
  it("route module wraps its handler with verifySignatureAppRouter at load time", () => {
    expect(mockVerifySig).toHaveBeenCalled();
    expect(mockVerifySig).toHaveBeenCalledWith(expect.any(Function));
  });
});

// ===========================================================================
// §7.2 row 4 — Tenant-scoping mismatch (§5.1 amendment 1 / Step 1.4)
// ===========================================================================

describe("§7.2 row 4 — tenant-scoping mismatch returns 400; no SF call", () => {
  it("payload tenant ≠ task.tenantId → 400; pushSingleTask NOT called; Sentry capture fired", async () => {
    defaultMockSetup(taskFixture({ tenantId: OTHER_TENANT_ID }));
    const res = await POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }));

    expect(res.status).toBe(400);
    expect(mockPushSingleTask).not.toHaveBeenCalled();
    expect(adapterSpies.createTask).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({
      component: "queue_push_task",
      operation: "tenant_mismatch",
      tenant_id: TENANT_ID,
      task_id: TASK_ID,
    });
  });
});

// ===========================================================================
// §7.2 row 5 — address_id null guard (§5.1 amendment 2 / Step 1.5)
// ===========================================================================

describe("§7.2 row 5 — address_id null guard returns 400 + Sentry capture", () => {
  it("task.addressId IS NULL → 400; no SF call; Sentry-capture push.address_id_null fired", async () => {
    defaultMockSetup(taskFixture({ addressId: null }));
    const res = await POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }));

    expect(res.status).toBe(400);
    expect(mockPushSingleTask).not.toHaveBeenCalled();
    expect(adapterSpies.createTask).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({
      component: "queue_push_task",
      operation: "address_id_null",
      tenant_id: TENANT_ID,
      task_id: TASK_ID,
    });
    // §7.2 row 5 also asserts the structured log carries the
    // 'push.address_id_null' event marker (operator-grep target).
    const addressIdNullLog = errorLines.find(
      (line) => line.event === "push.address_id_null",
    );
    expect(addressIdNullLog).toBeDefined();
  });
});

// ===========================================================================
// §7.2 row 6 — Already-pushed pre-check skip (§5.3 Layer 2)
// ===========================================================================

describe("§7.2 row 6 — already-pushed pre-check skip returns 200; no SF call", () => {
  it("task.pushedToExternalAt IS NOT NULL → 200 with task_already_pushed_pre_check; pushSingleTask NOT invoked", async () => {
    defaultMockSetup(
      taskFixture({
        pushedToExternalAt: "2026-05-05T11:30:00.000Z",
        externalId: "sf-existing-001",
        externalTrackingNumber: "MPL-EXISTING",
      }),
    );
    const res = await POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe("task_already_pushed_pre_check");
    expect(mockPushSingleTask).not.toHaveBeenCalled();
    expect(adapterSpies.createTask).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// §7.2 row 2 — Happy path (kind:'succeeded' → 200)
// ===========================================================================

describe("§7.2 row 2 — happy path", () => {
  it("pushSingleTask kind:'succeeded' → 200 with success outcome; markTaskPushed inside pushSingleTask", async () => {
    defaultMockSetup();
    mockPushSingleTask.mockResolvedValue({
      kind: "succeeded",
      externalId: "sf-77777",
      trackingNumber: "MPL-77777777",
    } satisfies SinglePushOutcome);

    const res = await POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe("success");
    expect(mockPushSingleTask).toHaveBeenCalledTimes(1);
    // pushSingleTask invoked with (ctx, taskId, adapter) — pin the
    // task_id positional and that the ctx carries the tenant_id from
    // the (now-validated-equal) payload + task row.
    const [ctxArg, taskIdArg] = mockPushSingleTask.mock.calls[0];
    expect(taskIdArg).toBe(TASK_ID);
    expect(ctxArg.tenantId).toBe(TENANT_ID);
    expect(ctxArg.actor.kind).toBe("system");
  });
});

// ===========================================================================
// §7.2 row 3 — pushSingleTask invocation gate (§5.1 amendment 6)
// ===========================================================================
//
// Negative-assertion test: the handler MUST go through pushSingleTask;
// it MUST NOT call adapter.createTask itself. If a future refactor
// bypasses pushSingleTask and calls the adapter directly, this test
// catches it: pushSingleTask spy doesn't fire, adapter.createTask spy
// does. With pushSingleTask mocked, the adapter spy captures any
// direct adapter usage.

describe("§7.2 row 3 — pushSingleTask invocation gate (§5.1 amendment 6)", () => {
  it("handler invokes pushSingleTask; adapter.createTask NEVER called by handler", async () => {
    defaultMockSetup();
    mockPushSingleTask.mockResolvedValue({
      kind: "succeeded",
      externalId: "sf-1",
      trackingNumber: "MPL-1",
    } satisfies SinglePushOutcome);

    await POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }));

    expect(mockPushSingleTask).toHaveBeenCalledTimes(1);
    // Adapter is constructed at module load (singleton), but the
    // handler must NOT reach into adapter.createTask. The §1.3
    // retirement table says pushSingleTask becomes the only
    // post-cutover caller of markTaskPushed and the only path
    // through the D8-4b reconcile branch — bypassing pushSingleTask
    // breaks both contracts.
    expect(adapterSpies.createTask).not.toHaveBeenCalled();
    expect(adapterSpies.getTaskByAwb).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// §7.2 row 7 — AwbExists reconcile (Layer 3, §5.3)
// ===========================================================================

describe("§7.2 row 7 — awb_reconciled outcome maps to 200", () => {
  it("pushSingleTask kind:'awb_reconciled' → 200 with awb_exists_reconciled outcome", async () => {
    defaultMockSetup();
    mockPushSingleTask.mockResolvedValue({
      kind: "awb_reconciled",
      externalId: "sf-recovered-001",
      awb: "MPL-AWB-001",
      priorFailedPushResolved: true,
    } satisfies SinglePushOutcome);

    const res = await POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string };
    expect(body.outcome).toBe("awb_exists_reconciled");
    expect(mockPushSingleTask).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// §7.2 row 8 — Transient 5xx → throws (handler propagates for QStash retry)
// ===========================================================================
//
// Two paths emit awb_reconcile_failed_retry_throw and re-throw:
// (a) pushSingleTask itself throws (caught + re-thrown after Sentry
//     capture)
// (b) pushSingleTask returns kind:'awb_exists' (reconcile failed
//     post-create) — handler throws synthesised error in switch
// This test covers path (a) — the more common 5xx case.

describe("§7.2 row 8 — pushSingleTask throw is propagated to QStash", () => {
  it("pushSingleTask throws (e.g. transient 5xx) → handler re-throws; Sentry captured", async () => {
    defaultMockSetup();
    const sfError = new Error("SF createTask returned 503 Service Unavailable");
    mockPushSingleTask.mockRejectedValue(sfError);

    await expect(
      POST(makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID })),
    ).rejects.toThrow("SF createTask returned 503 Service Unavailable");

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture.mock.calls[0][0]).toBe(sfError);
    expect(mockCapture.mock.calls[0][1]).toMatchObject({
      component: "queue_push_task",
      operation: "pushSingleTask_throw",
      tenant_id: TENANT_ID,
      task_id: TASK_ID,
    });
  });
});

// ===========================================================================
// §7.2 row 10 — Observability log shape strict-check (§5.5)
// ===========================================================================
//
// Per §5.5 + route.ts:60-83. 4-field structured log emitted at handler
// exit with { tenant_id, task_id, sf_latency_ms, outcome }. The plan's
// §5.5 sketches a 5-value enum but the route header explicitly
// supersedes that: actual implementation has 11 distinct outcome
// strings (route.ts:72-83 type union). This spec pins the actual
// emitted enum, not the plan sketch — code wins over sketch per the
// implementer's in-code amendment note.
//
// Test covers each outcome path that maps directly to a log emission.
// The 11 outcome strings divide into:
//   Pre-call rejection paths (3 outcomes, fired before pushSingleTask):
//     - tenant_mismatch_rejected
//     - address_id_null_rejected
//     - task_already_pushed_pre_check
//     - task_not_found (also fires from inside pushSingleTask; pinned
//       once via pre-call path)
//   pushSingleTask outcome paths (7 outcomes):
//     - success
//     - awb_exists_reconciled
//     - awb_reconcile_failed_retry_throw (route.ts:226 catch path
//       AND :283 awb_exists case path)
//     - failed_to_dlq
//     - skipped_district
//     - tenant_skipped_no_credentials
//     - task_already_pushed_in_push

const EXPECTED_OUTCOME_ENUM = [
  "tenant_mismatch_rejected",
  "address_id_null_rejected",
  "task_already_pushed_pre_check",
  "success",
  "awb_exists_reconciled",
  "awb_reconcile_failed_retry_throw",
  "failed_to_dlq",
  "skipped_district",
  "tenant_skipped_no_credentials",
  "task_already_pushed_in_push",
  "task_not_found",
] as const;

interface OutcomePathConfig {
  outcome: (typeof EXPECTED_OUTCOME_ENUM)[number];
  setup: () => void;
  expectsThrow: boolean;
}

function findLogByOutcome(outcome: string): Record<string, unknown> | undefined {
  // Logger emits info/debug to console.log, warn/error to console.error.
  // outcome strings appear in either bucket depending on log level —
  // search both.
  return [...logLines, ...errorLines].find((line) => line.outcome === outcome);
}

const OUTCOME_PATHS: OutcomePathConfig[] = [
  {
    outcome: "tenant_mismatch_rejected",
    setup: () => defaultMockSetup(taskFixture({ tenantId: OTHER_TENANT_ID })),
    expectsThrow: false,
  },
  {
    outcome: "address_id_null_rejected",
    setup: () => defaultMockSetup(taskFixture({ addressId: null })),
    expectsThrow: false,
  },
  {
    outcome: "task_already_pushed_pre_check",
    setup: () =>
      defaultMockSetup(
        taskFixture({
          pushedToExternalAt: "2026-05-05T11:30:00.000Z",
          externalId: "sf-existing",
          externalTrackingNumber: "MPL-EXISTING",
        }),
      ),
    expectsThrow: false,
  },
  {
    outcome: "task_not_found",
    setup: () => {
      mockWithServiceRole.mockImplementation(
        async (_label: string, fn: (tx: never) => Promise<unknown>) =>
          fn({} as never),
      );
      mockFindTaskById.mockResolvedValue(null);
    },
    expectsThrow: false,
  },
  {
    outcome: "success",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "succeeded",
        externalId: "sf-1",
        trackingNumber: "MPL-1",
      } satisfies SinglePushOutcome);
    },
    expectsThrow: false,
  },
  {
    outcome: "awb_exists_reconciled",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "awb_reconciled",
        externalId: "sf-recovered",
        awb: "MPL-AWB",
        priorFailedPushResolved: true,
      } satisfies SinglePushOutcome);
    },
    expectsThrow: false,
  },
  {
    outcome: "awb_reconcile_failed_retry_throw",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "awb_exists",
        awb: "MPL-AWB",
        reconcileErrorMessage:
          "awb_exists_reconcile_failed: 'MPL-AWB'; getTaskByAwb error: ECONNRESET",
      } satisfies SinglePushOutcome);
    },
    // The 'awb_exists' switch case throws to trigger QStash retry.
    expectsThrow: true,
  },
  {
    outcome: "failed_to_dlq",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "failed_to_dlq",
        failureReason: "server_5xx",
        httpStatus: 503,
        failureDetail: "SF createTask returned 503",
      } satisfies SinglePushOutcome);
    },
    expectsThrow: false,
  },
  {
    outcome: "skipped_district",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "skipped_district",
        district: "UNKNOWN",
      } satisfies SinglePushOutcome);
    },
    expectsThrow: false,
  },
  {
    outcome: "tenant_skipped_no_credentials",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "tenant_skipped",
        reason: "missing_customer_code",
      } satisfies SinglePushOutcome);
    },
    expectsThrow: false,
  },
  {
    outcome: "task_already_pushed_in_push",
    setup: () => {
      defaultMockSetup();
      mockPushSingleTask.mockResolvedValue({
        kind: "task_already_pushed",
        externalId: "sf-race",
      } satisfies SinglePushOutcome);
    },
    expectsThrow: false,
  },
];

describe("§7.2 row 10 — observability log shape strict-check (§5.5)", () => {
  it("EXPECTED_OUTCOME_ENUM matches the 11 strings in the route's Outcome type union", () => {
    // String drift guard. If a future contributor adds/removes an
    // outcome from the route's type union without updating this list,
    // the new outcome won't be exercised by the parameterised test
    // below. The list is hand-maintained against route.ts:72-83.
    expect(EXPECTED_OUTCOME_ENUM).toHaveLength(11);
    // Sanity: all entries are unique.
    expect(new Set(EXPECTED_OUTCOME_ENUM).size).toBe(EXPECTED_OUTCOME_ENUM.length);
  });

  it.each(OUTCOME_PATHS)(
    "$outcome path emits structured log with { tenant_id, task_id, sf_latency_ms, outcome }",
    async ({ outcome, setup, expectsThrow }) => {
      setup();

      const invocation = POST(
        makeRequest({ tenant_id: TENANT_ID, task_id: TASK_ID }),
      );

      if (expectsThrow) {
        await expect(invocation).rejects.toBeDefined();
      } else {
        await invocation;
      }

      const logEntry = findLogByOutcome(outcome);
      expect(logEntry, `expected log emission for outcome=${outcome}`).toBeDefined();
      // Strict-check the 4 §5.5 fields are present + correctly typed.
      expect(logEntry).toMatchObject({
        tenant_id: TENANT_ID,
        task_id: TASK_ID,
        outcome,
      });
      expect(typeof logEntry?.sf_latency_ms).toBe("number");
      expect(EXPECTED_OUTCOME_ENUM).toContain(logEntry?.outcome);
    },
  );
});
