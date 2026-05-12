// Day-22n /vercel-url-fallback — task-materialization queue.ts tests.
//
// Focused on the baseUrl resolution chain introduced by the
// PUBLIC_BASE_URL → VERCEL_URL → throw pattern. The original module
// had no test file; this spec adds env-var coverage matching the
// publish.spec.ts pattern in src/modules/task-outbound-queue/tests/.
//
// Wider coverage (chunk size, dedup, flowControl, etc.) is deferred
// per the brief's T2 scope — env-var resolution only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBatchJSON = vi.fn();

vi.mock("@upstash/qstash", () => {
  return {
    Client: class {
      batchJSON = mockBatchJSON;
    },
  };
});

vi.mock("../../../shared/logger", () => {
  // queue.ts calls `logger.with({...})` at module-load to obtain `log`,
  // then `log.with({...})` per-invocation for tenant-scoped context.
  // The mock returns a recursive .with() so both depths resolve to a
  // logger-shaped stub.
  const makeLogger = (): unknown => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    with: () => makeLogger(),
  });
  return { logger: makeLogger() };
});

vi.mock("../../../shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { enqueueTaskPushBatch } from "../queue";

const TENANT_ID = "00000000-0000-0000-0000-0000000000aa";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "test-request";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.QSTASH_TOKEN = "test-qstash-token";
  process.env.QSTASH_FLOW_CONTROL_KEY = "sf-push-global-test";
  mockBatchJSON.mockResolvedValue([{ messageId: "qmsg-1" }]);
});

afterEach(() => {
  delete process.env.QSTASH_TOKEN;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.QSTASH_FLOW_CONTROL_KEY;
  delete process.env.VERCEL_URL;
});

describe("enqueueTaskPushBatch — baseUrl resolution", () => {
  it("uses PUBLIC_BASE_URL for the push-task and failureCallback URLs when set", async () => {
    process.env.PUBLIC_BASE_URL = "https://operator-override.example.com";
    await enqueueTaskPushBatch({
      tenantId: TENANT_ID,
      taskIds: [TASK_ID],
      requestId: REQUEST_ID,
    });
    expect(mockBatchJSON).toHaveBeenCalledTimes(1);
    const messages = mockBatchJSON.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0].url).toBe(
      "https://operator-override.example.com/api/queue/push-task",
    );
    expect(messages[0].failureCallback).toBe(
      "https://operator-override.example.com/api/queue/push-task-failed",
    );
  });

  it("falls back to https://VERCEL_URL when PUBLIC_BASE_URL is missing (Day-22n preview-deploy fallback)", async () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.VERCEL_URL = "planner-git-feature-branch.vercel.app";
    await enqueueTaskPushBatch({
      tenantId: TENANT_ID,
      taskIds: [TASK_ID],
      requestId: REQUEST_ID,
    });
    expect(mockBatchJSON).toHaveBeenCalledTimes(1);
    const messages = mockBatchJSON.mock.calls[0][0];
    expect(messages[0].url).toBe(
      "https://planner-git-feature-branch.vercel.app/api/queue/push-task",
    );
    expect(messages[0].failureCallback).toBe(
      "https://planner-git-feature-branch.vercel.app/api/queue/push-task-failed",
    );
  });

  it("PUBLIC_BASE_URL wins over VERCEL_URL when both set", async () => {
    process.env.PUBLIC_BASE_URL = "https://operator-override.example.com";
    process.env.VERCEL_URL = "planner-git-some-branch.vercel.app";
    await enqueueTaskPushBatch({
      tenantId: TENANT_ID,
      taskIds: [TASK_ID],
      requestId: REQUEST_ID,
    });
    const messages = mockBatchJSON.mock.calls[0][0];
    expect(messages[0].url).toBe(
      "https://operator-override.example.com/api/queue/push-task",
    );
  });

  it("throws when PUBLIC_BASE_URL AND VERCEL_URL are both missing", async () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.VERCEL_URL;
    await expect(
      enqueueTaskPushBatch({
        tenantId: TENANT_ID,
        taskIds: [TASK_ID],
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow(/PUBLIC_BASE_URL or VERCEL_URL env var required/);
  });

  it("empty taskIds short-circuits before baseUrl resolution (no enqueue, no env-var probe)", async () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.VERCEL_URL;
    const result = await enqueueTaskPushBatch({
      tenantId: TENANT_ID,
      taskIds: [],
      requestId: REQUEST_ID,
    });
    expect(result).toEqual({ enqueuedCount: 0, failedChunks: 0 });
    expect(mockBatchJSON).not.toHaveBeenCalled();
  });
});
