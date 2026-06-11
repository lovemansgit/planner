// tests/unit/task-materialization-queue.spec.ts
//
// §7.1 row 14 (D7-2 rewrite) — Phase 5 batchJSON enqueue shape tests
// per merged plan PR #145 memory/plans/day-14-cron-decoupling.md §7.1.
//
// Pins:
//   - Chunking boundary: N tasks → ceil(N/100) batchJSON calls
//   - Each message shape: { url, body, deduplicationId, flowControl,
//     retries, failureCallback } with the load-bearing values
//   - flowControl.key resolves from env-var per §6.3 amendment 3
//     (Production = 'sf-push-global-mvp', Preview =
//     'sf-push-global-preview') — value pinned at invocation time, not
//     module-load time
//   - retries: 3 per §5.2 amendment
//   - Missing env-var failure modes (throws)
//   - Per-chunk error isolation: failure of one batchJSON call counts
//     as failedChunks++ and continues to next chunk per Q5 (b)
//
// Conventions inherited from §7.2:
//   - server-only mocked to no-op so route-importing modules load
//     cleanly in unit tests
//   - vi.hoisted for env-var setup before module imports (the QStash
//     client constructor reads QSTASH_TOKEN at construction time)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const batchJSONSpy = vi.hoisted(() => vi.fn());

vi.mock("@upstash/qstash", () => ({
  // Plain function (not arrow) so `new Client(...)` works — vi.fn() with
  // mockImplementation returning an arrow fn isn't constructable.
  Client: function MockClient(this: { batchJSON: typeof batchJSONSpy }) {
    this.batchJSON = batchJSONSpy;
  },
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { enqueueTaskPushBatch } from "../../src/modules/task-materialization/queue";
import { captureException } from "../../src/shared/sentry-capture";

const mockCapture = vi.mocked(captureException);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const REQUEST_ID = "req-test-deadbeef";

beforeEach(() => {
  process.env.QSTASH_TOKEN = "test-token";
  process.env.PUBLIC_BASE_URL = "https://test.example.com";
  process.env.QSTASH_FLOW_CONTROL_KEY = "sf-push-global-mvp";
  batchJSONSpy.mockReset();
  batchJSONSpy.mockResolvedValue(undefined);
  mockCapture.mockReset();
});

afterEach(() => {
  delete process.env.QSTASH_TOKEN;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.QSTASH_FLOW_CONTROL_KEY;
});

function makeTaskIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    // RFC-4122 v4-shaped UUID with deterministic hex per index for
    // assertion stability. Matches the Uuid type's runtime format.
    const hex = i.toString(16).padStart(8, "0");
    return `${hex}-0000-4000-8000-000000000000`;
  });
}

describe("§7.1 row 14 — Phase 5 batchJSON enqueue shape", () => {
  describe("chunking boundary (D7-2)", () => {
    it.each([
      [0, 0],
      [1, 1],
      [50, 1],
      [99, 1],
      [100, 1],
      [101, 2],
      [250, 3],
      [1000, 10],
      [1001, 11],
    ])("N=%i tasks → ceil(N/100)=%i batchJSON calls", async (n, expectedCalls) => {
      const taskIds = makeTaskIds(n);
      const result = await enqueueTaskPushBatch({
        tenantId: TENANT_ID,
        taskIds,
        requestId: REQUEST_ID,
      });

      expect(batchJSONSpy).toHaveBeenCalledTimes(expectedCalls);
      expect(result.enqueuedCount).toBe(n);
      expect(result.failedChunks).toBe(0);

      // Every chunk respects the 100-message cap.
      for (const call of batchJSONSpy.mock.calls) {
        expect(call[0].length).toBeLessThanOrEqual(100);
      }
      // Sum across all chunks equals N.
      const totalSent = batchJSONSpy.mock.calls.reduce(
        (acc, call) => acc + (call[0] as unknown[]).length,
        0,
      );
      expect(totalSent).toBe(n);
    });
  });

  describe("message shape", () => {
    it("each message carries url + body + deduplicationId + flowControl + retries + failureCallback", async () => {
      const [taskA, taskB] = makeTaskIds(2);

      await enqueueTaskPushBatch({
        tenantId: TENANT_ID,
        taskIds: [taskA, taskB],
        requestId: REQUEST_ID,
      });

      expect(batchJSONSpy).toHaveBeenCalledTimes(1);
      const messages = batchJSONSpy.mock.calls[0][0];
      expect(messages).toHaveLength(2);

      for (const [idx, taskId] of [taskA, taskB].entries()) {
        const message = messages[idx];
        expect(message).toEqual({
          url: "https://test.example.com/api/queue/push-task",
          body: { tenant_id: TENANT_ID, task_id: taskId },
          deduplicationId: taskId, // load-bearing per §1.1 self-healing
          flowControl: {
            key: "sf-push-global-mvp", // resolved from env at invocation time
            rate: 5,
            period: "1s",
          },
          retries: 3, // §5.2 amendment
          failureCallback: "https://test.example.com/api/queue/push-task-failed",
        });
      }
    });
  });

  describe("env-var resolution (§6.3 amendment 3)", () => {
    it("uses Preview value when QSTASH_FLOW_CONTROL_KEY=sf-push-global-preview", async () => {
      // Per-invocation read (not module-load); value swap takes effect immediately.
      process.env.QSTASH_FLOW_CONTROL_KEY = "sf-push-global-preview";

      await enqueueTaskPushBatch({
        tenantId: TENANT_ID,
        taskIds: makeTaskIds(1),
        requestId: REQUEST_ID,
      });

      const message = batchJSONSpy.mock.calls[0][0][0];
      expect(message.flowControl.key).toBe("sf-push-global-preview");
    });

    it("throws when QSTASH_FLOW_CONTROL_KEY is unset", async () => {
      delete process.env.QSTASH_FLOW_CONTROL_KEY;

      await expect(
        enqueueTaskPushBatch({
          tenantId: TENANT_ID,
          taskIds: makeTaskIds(1),
          requestId: REQUEST_ID,
        }),
      ).rejects.toThrow(/QSTASH_FLOW_CONTROL_KEY/);
      expect(batchJSONSpy).not.toHaveBeenCalled();
    });

    it("throws when PUBLIC_BASE_URL is unset", async () => {
      delete process.env.PUBLIC_BASE_URL;

      await expect(
        enqueueTaskPushBatch({
          tenantId: TENANT_ID,
          taskIds: makeTaskIds(1),
          requestId: REQUEST_ID,
        }),
      ).rejects.toThrow(/PUBLIC_BASE_URL/);
      expect(batchJSONSpy).not.toHaveBeenCalled();
    });
  });

  describe("empty batch", () => {
    it("skips enqueue entirely when taskIds is empty", async () => {
      const result = await enqueueTaskPushBatch({
        tenantId: TENANT_ID,
        taskIds: [],
        requestId: REQUEST_ID,
      });

      expect(result.enqueuedCount).toBe(0);
      expect(result.failedChunks).toBe(0);
      expect(batchJSONSpy).not.toHaveBeenCalled();
    });
  });

  describe("per-chunk error isolation (Q5 (b))", () => {
    it("counts failed chunk + continues to next chunk; Sentry-captures the failure", async () => {
      // 250 tasks → 3 chunks. Make chunk 2 fail; chunks 1 + 3 succeed.
      // Expected: enqueuedCount = 200 (chunks 1 + 3), failedChunks = 1.
      batchJSONSpy
        .mockResolvedValueOnce(undefined) // chunk 1 ok
        .mockRejectedValueOnce(new Error("simulated qstash 500")) // chunk 2 fail
        .mockResolvedValueOnce(undefined); // chunk 3 ok

      const result = await enqueueTaskPushBatch({
        tenantId: TENANT_ID,
        taskIds: makeTaskIds(250),
        requestId: REQUEST_ID,
      });

      expect(batchJSONSpy).toHaveBeenCalledTimes(3);
      expect(result.enqueuedCount).toBe(150); // 100 (ok) + 0 (failed chunk of 100) + 50 (ok)
      expect(result.failedChunks).toBe(1);
      expect(mockCapture).toHaveBeenCalledTimes(1);
      const captureContext = mockCapture.mock.calls[0][1] as Record<string, unknown>;
      expect(captureContext.component).toBe("task_materialization_queue");
      expect(captureContext.operation).toBe("batchJSON_chunk");
      expect(captureContext.tenant_id).toBe(TENANT_ID);
    });
  });
});
