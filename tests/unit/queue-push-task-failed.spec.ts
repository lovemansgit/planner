// tests/unit/queue-push-task-failed.spec.ts
//
// §7.2 rows 11-12 — failureCallback handler tests per merged plan
// PR #145 memory/plans/day-14-cron-decoupling.md §5.2 amendment 5.
//
// Row 11 — happy path: QStash POSTs failure metadata with base64-encoded
//   sourceBody (the original PushTaskPayload). Handler decodes, calls the
//   service-layer recordFailedPushAttempt, returns 200 with the new
//   failed_push_id. Surfaces in /admin/failed-pushes UI without any
//   operator-side change (per §5.2 amendment 5: failureCallback IS the
//   canonical retry-exhaustion signal source).
//
// Row 12 — signature gate structural: the failureCallback endpoint
//   wraps its handler with verifySignatureAppRouter so unsigned POSTs
//   are rejected by the SDK before the inner handler runs. Asserted
//   structurally (verifySignatureAppRouter was called at module load).
//
// Plan #317 / F-4 update: pre-PR-B the route called repository
// insertFailedPush directly, so this test mocked the repo. PR-B routes
// the write through the service-layer recordFailedPushAttempt (which
// handles SQLSTATE 23505 → updateFailedPushAttempt for the retry path
// and emits task.push_failed audit). This test now mocks the service
// function — route-handler shape (decode → service → 200) is what we
// pin here; service internals are covered by failed-pushes/service tests
// + the integration spec at
// tests/integration/failed-push-callback-attempt-count-increments.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../src/modules/failed-pushes", () => ({
  recordFailedPushAttempt: vi.fn(),
}));

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { POST } from "../../src/app/api/queue/push-task-failed/route";
import { recordFailedPushAttempt } from "../../src/modules/failed-pushes";
import type { FailedPush } from "../../src/modules/failed-pushes/types";

const mockVerifySig = vi.mocked(verifySignatureAppRouter);
const mockRecordFailedPushAttempt = vi.mocked(recordFailedPushAttempt);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const FAILED_PUSH_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

function makeQStashFailurePayload(overrides: Record<string, unknown> = {}) {
  // QStash failureCallback body shape per route.ts QStashFailureCallbackBody
  // — sourceBody is base64-encoded JSON of the original push-task payload.
  const originalPayload = JSON.stringify({
    tenant_id: TENANT_ID,
    task_id: TASK_ID,
  });
  const sourceBodyB64 = Buffer.from(originalPayload, "utf-8").toString("base64");
  return {
    sourceMessageId: "msg-abc-123",
    sourceUrl: "https://planner.example.com/api/queue/push-task",
    sourceBody: sourceBodyB64,
    status: 503,
    body: '{"error":"SF unavailable"}',
    retried: 3,
    dlqId: "qstash-dlq-456",
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("https://example.com/api/queue/push-task-failed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function failedPushFixture(overrides: Partial<FailedPush> = {}): FailedPush {
  return {
    id: FAILED_PUSH_ID,
    tenantId: TENANT_ID,
    taskId: TASK_ID,
    attemptCount: 1,
    taskPayload: {},
    failureReason: "server_5xx",
    failureDetail: '{"error":"SF unavailable"}',
    httpStatus: 503,
    firstFailedAt: "2026-05-05T12:00:00.000Z",
    lastAttemptedAt: "2026-05-05T12:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdAt: "2026-05-05T12:00:00.000Z",
    updatedAt: "2026-05-05T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockRecordFailedPushAttempt.mockReset();
  mockRecordFailedPushAttempt.mockResolvedValue(failedPushFixture());
  // Silence logger noise during tests; structural log assertions are
  // covered in queue-push-task.spec.ts row 10. This file pins
  // failureCallback DB-write behavior, not log shape.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// §7.2 row 11 — failureCallback happy path (§5.2 amendment 5)
// ===========================================================================

describe("§7.2 row 11 — failureCallback handler happy path", () => {
  it("decodes base64 sourceBody → routes through recordFailedPushAttempt → 200 with failed_push_id", async () => {
    const res = await POST(makeRequest(makeQStashFailurePayload()));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outcome: string;
      failed_push_id: string;
      attempt_count: number;
    };
    expect(body.outcome).toBe("recorded");
    expect(body.failed_push_id).toBe(FAILED_PUSH_ID);
    expect(body.attempt_count).toBe(1);

    expect(mockRecordFailedPushAttempt).toHaveBeenCalledTimes(1);
    const [ctxArg, inputArg] = mockRecordFailedPushAttempt.mock.calls[0];
    // Plan #317 / F-4: ctx is a system-actor RequestContext mirroring the
    // /api/queue/push-task wiring (system: "queue:push_task"; same QStash
    // queue). recordFailedPushAttempt asserts system actor + tenant context.
    expect(ctxArg.actor.kind).toBe("system");
    if (ctxArg.actor.kind === "system") {
      expect(ctxArg.actor.system).toBe("queue:push_task");
      expect(ctxArg.actor.tenantId).toBe(TENANT_ID);
    }
    expect(ctxArg.tenantId).toBe(TENANT_ID);
    expect(ctxArg.path).toBe("/api/queue/push-task-failed");
    expect(inputArg.taskId).toBe(TASK_ID);
    // Status 503 → server_5xx per deriveFailureReason in route.
    expect(inputArg.failureReason).toBe("server_5xx");
    expect(inputArg.httpStatus).toBe(503);
    // failureDetail is the QStash response body excerpt (≤1000 chars).
    expect(inputArg.failureDetail).toBe('{"error":"SF unavailable"}');
    // taskPayload snapshot carries QStash retry metadata for ops triage.
    expect(inputArg.taskPayload).toMatchObject({
      source: "qstash_failure_callback",
      source_message_id: "msg-abc-123",
      qstash_retried_count: 3,
      qstash_dlq_id: "qstash-dlq-456",
      original_push_payload: { tenant_id: TENANT_ID, task_id: TASK_ID },
    });
  });

  it("maps QStash failure status codes to FailureReason enum correctly", async () => {
    // Status code → failure_reason mapping per deriveFailureReason in
    // route. Pinned here so a future refactor can't silently rebucket.
    const cases: Array<{ status: number | undefined; reason: string }> = [
      { status: 408, reason: "timeout" },
      { status: 504, reason: "timeout" },
      { status: 500, reason: "server_5xx" },
      { status: 502, reason: "server_5xx" },
      { status: 599, reason: "server_5xx" },
      { status: 400, reason: "client_4xx" },
      { status: 404, reason: "client_4xx" },
      { status: 499, reason: "client_4xx" },
      { status: undefined, reason: "unknown" },
    ];

    for (const { status, reason } of cases) {
      mockRecordFailedPushAttempt.mockClear();
      mockRecordFailedPushAttempt.mockResolvedValue(
        failedPushFixture({ failureReason: reason as FailedPush["failureReason"] }),
      );
      const res = await POST(makeRequest(makeQStashFailurePayload({ status })));
      expect(res.status, `status=${status} should yield 200`).toBe(200);
      expect(
        mockRecordFailedPushAttempt.mock.calls[0][1].failureReason,
        `status=${status} → reason=${reason}`,
      ).toBe(reason);
    }
  });
});

// ===========================================================================
// §7.2 row 12 — failureCallback signature gate (structural)
// ===========================================================================

describe("§7.2 row 12 — failureCallback signature gate is wired", () => {
  it("route module wraps handler with verifySignatureAppRouter at load time", () => {
    // Module-load assertion: the signature gate IS in place. Per
    // §5.2 'Verification' row of the amendment-5 table:
    // 'Signature-verified via the same verifySignatureAppRouter
    // wrapper as §5.1' — this test pins the wrapper is present.
    expect(mockVerifySig).toHaveBeenCalled();
    expect(mockVerifySig).toHaveBeenCalledWith(expect.any(Function));
  });
});
