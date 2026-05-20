// Task-outbound-queue publisher unit tests — Day 22 / Phase 1.
//
// Mocks `@upstash/qstash` Client at the module boundary. Verifies wire
// payload shapes (deduplicationId format, flowControl, retries,
// failureCallback URLs), batchJSON chunking at 100, empty-array no-op,
// and missing-env-var error surfacing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPublishJSON = vi.fn();
const mockBatchJSON = vi.fn();

vi.mock("@upstash/qstash", () => {
  return {
    Client: class {
      publishJSON = mockPublishJSON;
      batchJSON = mockBatchJSON;
    },
  };
});

vi.mock("../../../shared/logger", () => {
  const child = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: { ...child, with: () => child } };
});

vi.mock("../../../shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import {
  __resetQStashClientForTest,
  enqueueBulkCancelTasks,
  enqueueBulkUpdateTasks,
  enqueueCancelTask,
  enqueueUpdateTask,
} from "../publish";
import type { CancelTaskPayload, UpdateTaskPayload } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-0000000000aa";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const CORRELATION_ID = "22222222-2222-2222-2222-222222222222";
const AWB = "MPL-72915243";

const SAMPLE_CANCEL_PAYLOAD: CancelTaskPayload = {
  tenant_id: TENANT_ID,
  task_id: TASK_ID,
  awb: AWB,
  correlation_id: CORRELATION_ID,
};

const SAMPLE_UPDATE_PAYLOAD: UpdateTaskPayload = {
  tenant_id: TENANT_ID,
  task_id: TASK_ID,
  awb: AWB,
  patch: {
    window: { date: "2026-05-12", startTime: "09:00:00", endTime: "11:00:00" },
    notes: "updated note",
  },
  correlation_id: CORRELATION_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetQStashClientForTest();
  process.env.QSTASH_TOKEN = "test-qstash-token";
  process.env.PUBLIC_BASE_URL = "https://planner.test";
  process.env.QSTASH_FLOW_CONTROL_KEY = "sf-push-global-test";
  mockPublishJSON.mockResolvedValue(undefined);
  mockBatchJSON.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.QSTASH_TOKEN;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.QSTASH_FLOW_CONTROL_KEY;
  delete process.env.VERCEL_URL;
});

describe("enqueueCancelTask — single message wire shape", () => {
  it("publishes one message to /api/queue/cancel-task with the expected body", async () => {
    await enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD);
    expect(mockPublishJSON).toHaveBeenCalledTimes(1);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.url).toBe("https://planner.test/api/queue/cancel-task");
    expect(args.body).toEqual(SAMPLE_CANCEL_PAYLOAD);
  });

  it("uses deduplicationId format `${task_id}_cancel_${correlation_id}`", async () => {
    await enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.deduplicationId).toBe(`${TASK_ID}_cancel_${CORRELATION_ID}`);
  });

  it("threads flowControl rate=5 period=1s with the resolved env-var key", async () => {
    await enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.flowControl).toEqual({
      key: "sf-push-global-test",
      rate: 5,
      period: "1s",
    });
  });

  it("sets retries=3 and failureCallback to /api/queue/cancel-task-failed", async () => {
    await enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.retries).toBe(3);
    expect(args.failureCallback).toBe(
      "https://planner.test/api/queue/cancel-task-failed",
    );
  });

  it("propagates QStash publish errors to caller", async () => {
    mockPublishJSON.mockRejectedValueOnce(new Error("QStash 502"));
    await expect(enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD)).rejects.toThrow("QStash 502");
  });
});

describe("enqueueUpdateTask — single message wire shape", () => {
  it("publishes one message to /api/queue/update-task with the patch in the body", async () => {
    await enqueueUpdateTask(SAMPLE_UPDATE_PAYLOAD);
    expect(mockPublishJSON).toHaveBeenCalledTimes(1);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.url).toBe("https://planner.test/api/queue/update-task");
    expect(args.body).toEqual(SAMPLE_UPDATE_PAYLOAD);
    expect((args.body as UpdateTaskPayload).patch).toEqual(SAMPLE_UPDATE_PAYLOAD.patch);
  });

  it("uses deduplicationId format `${task_id}_update_${correlation_id}`", async () => {
    await enqueueUpdateTask(SAMPLE_UPDATE_PAYLOAD);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.deduplicationId).toBe(`${TASK_ID}_update_${CORRELATION_ID}`);
  });

  it("uses /api/queue/update-task-failed as failureCallback", async () => {
    await enqueueUpdateTask(SAMPLE_UPDATE_PAYLOAD);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.failureCallback).toBe(
      "https://planner.test/api/queue/update-task-failed",
    );
  });
});

describe("enqueueBulkCancelTasks — fan-out + chunking", () => {
  it("returns zero counts on empty input without invoking batchJSON", async () => {
    const result = await enqueueBulkCancelTasks([]);
    expect(result).toEqual({ enqueuedCount: 0, failedChunks: 0, totalCount: 0 });
    expect(mockBatchJSON).not.toHaveBeenCalled();
  });

  it("publishes one batchJSON call for ≤100 payloads", async () => {
    const payloads = Array.from({ length: 50 }, (_, i) => ({
      ...SAMPLE_CANCEL_PAYLOAD,
      task_id: `t${i}` as `${string}-${string}-${string}-${string}-${string}`,
      correlation_id: `c${i}` as `${string}-${string}-${string}-${string}-${string}`,
    }));
    const result = await enqueueBulkCancelTasks(payloads);
    expect(mockBatchJSON).toHaveBeenCalledTimes(1);
    expect(result.enqueuedCount).toBe(50);
    expect(result.failedChunks).toBe(0);
    expect(result.totalCount).toBe(50);
  });

  it("chunks at 100 messages per batchJSON call (250 → 3 chunks)", async () => {
    const payloads = Array.from({ length: 250 }, (_, i) => ({
      ...SAMPLE_CANCEL_PAYLOAD,
      task_id: `t${i}` as `${string}-${string}-${string}-${string}-${string}`,
      correlation_id: `c${i}` as `${string}-${string}-${string}-${string}-${string}`,
    }));
    const result = await enqueueBulkCancelTasks(payloads);
    expect(mockBatchJSON).toHaveBeenCalledTimes(3);
    expect(mockBatchJSON.mock.calls[0][0]).toHaveLength(100);
    expect(mockBatchJSON.mock.calls[1][0]).toHaveLength(100);
    expect(mockBatchJSON.mock.calls[2][0]).toHaveLength(50);
    expect(result.enqueuedCount).toBe(250);
  });

  it("logs chunk failure + continues to next chunk (per Phase 5 self-healing)", async () => {
    mockBatchJSON
      .mockRejectedValueOnce(new Error("QStash chunk 0 failed"))
      .mockResolvedValueOnce(undefined);
    const payloads = Array.from({ length: 150 }, (_, i) => ({
      ...SAMPLE_CANCEL_PAYLOAD,
      task_id: `t${i}` as `${string}-${string}-${string}-${string}-${string}`,
      correlation_id: `c${i}` as `${string}-${string}-${string}-${string}-${string}`,
    }));
    const result = await enqueueBulkCancelTasks(payloads);
    expect(mockBatchJSON).toHaveBeenCalledTimes(2);
    expect(result.enqueuedCount).toBe(50);
    expect(result.failedChunks).toBe(1);
    expect(result.totalCount).toBe(150);
  });

  it("each message carries its own deduplicationId based on task_id + correlation_id", async () => {
    const payloads = [
      { ...SAMPLE_CANCEL_PAYLOAD, task_id: TASK_ID, correlation_id: "c1" },
      { ...SAMPLE_CANCEL_PAYLOAD, task_id: "t2", correlation_id: "c2" },
    ] as CancelTaskPayload[];
    await enqueueBulkCancelTasks(payloads);
    const messages = mockBatchJSON.mock.calls[0][0];
    expect(messages[0].deduplicationId).toBe(`${TASK_ID}_cancel_c1`);
    expect(messages[1].deduplicationId).toBe(`t2_cancel_c2`);
  });
});

describe("enqueueBulkUpdateTasks — fan-out + chunking", () => {
  it("publishes one batchJSON call for ≤100 update payloads", async () => {
    const payloads = Array.from({ length: 25 }, (_, i) => ({
      ...SAMPLE_UPDATE_PAYLOAD,
      task_id: `t${i}` as `${string}-${string}-${string}-${string}-${string}`,
      correlation_id: `c${i}` as `${string}-${string}-${string}-${string}-${string}`,
    }));
    const result = await enqueueBulkUpdateTasks(payloads);
    expect(mockBatchJSON).toHaveBeenCalledTimes(1);
    expect(result.enqueuedCount).toBe(25);
  });

  it("each message uses _update_ dedup format + update-task URL/failureCallback", async () => {
    await enqueueBulkUpdateTasks([SAMPLE_UPDATE_PAYLOAD]);
    const messages = mockBatchJSON.mock.calls[0][0];
    expect(messages[0].url).toBe("https://planner.test/api/queue/update-task");
    expect(messages[0].failureCallback).toBe(
      "https://planner.test/api/queue/update-task-failed",
    );
    expect(messages[0].deduplicationId).toBe(`${TASK_ID}_update_${CORRELATION_ID}`);
  });

  it("returns zero counts on empty input without invoking batchJSON", async () => {
    const result = await enqueueBulkUpdateTasks([]);
    expect(result).toEqual({ enqueuedCount: 0, failedChunks: 0, totalCount: 0 });
    expect(mockBatchJSON).not.toHaveBeenCalled();
  });
});

describe("missing env vars surface fatal errors", () => {
  it("throws if QSTASH_TOKEN is missing", async () => {
    delete process.env.QSTASH_TOKEN;
    __resetQStashClientForTest();
    await expect(enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD)).rejects.toThrow(
      /QSTASH_TOKEN env var required/,
    );
  });

  it("throws if PUBLIC_BASE_URL AND VERCEL_URL are both missing", async () => {
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.VERCEL_URL;
    await expect(enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD)).rejects.toThrow(
      /PUBLIC_BASE_URL or VERCEL_URL env var required/,
    );
  });

  // Day-22n /vercel-url-fallback — preview-deploy fallback coverage.
  it("falls back to https://VERCEL_URL when PUBLIC_BASE_URL is missing", async () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.VERCEL_URL = "planner-git-feature-branch.vercel.app";
    await enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD);
    expect(mockPublishJSON).toHaveBeenCalledTimes(1);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.url).toBe(
      "https://planner-git-feature-branch.vercel.app/api/queue/cancel-task",
    );
    expect(args.failureCallback).toBe(
      "https://planner-git-feature-branch.vercel.app/api/queue/cancel-task-failed",
    );
  });

  it("PUBLIC_BASE_URL wins over VERCEL_URL when both set", async () => {
    process.env.PUBLIC_BASE_URL = "https://operator-override.example.com";
    process.env.VERCEL_URL = "planner-git-some-branch.vercel.app";
    await enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD);
    const args = mockPublishJSON.mock.calls[0][0];
    expect(args.url).toBe(
      "https://operator-override.example.com/api/queue/cancel-task",
    );
  });

  it("throws if QSTASH_FLOW_CONTROL_KEY is missing", async () => {
    delete process.env.QSTASH_FLOW_CONTROL_KEY;
    await expect(enqueueCancelTask(SAMPLE_CANCEL_PAYLOAD)).rejects.toThrow(
      /QSTASH_FLOW_CONTROL_KEY env var required/,
    );
  });
});
