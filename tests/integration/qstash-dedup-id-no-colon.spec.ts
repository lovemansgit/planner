// tests/integration/qstash-dedup-id-no-colon.spec.ts
//
// Regression pin for the QStash deduplicationId construction in
// `src/modules/task-outbound-queue/publish.ts`. QStash rejects any
// deduplicationId containing ':' — the previous shape
// `${task_id}:cancel:${correlation_id}` (Day-22 ed5963b9) crashed
// every skip/cancel/update enqueue with
//   QstashError: DeduplicationId cannot contain ':'
//
// Fix: replace each ':' with '_' across all four publisher sites
// (single-cancel, single-update, bulk-cancel fan-out, bulk-update
// fan-out). This spec captures the exact deduplicationId argument
// passed to the QStash client at each site and asserts the
// post-fix shape across the full surface.
//
// Spec posture:
//   - Mocks `@upstash/qstash`'s Client so publishJSON + batchJSON
//     become capturable vi.fn()s (no real network).
//   - Drives all four publisher entry points with realistic
//     UUID-shaped task_id + correlation_id values.
//   - Asserts the captured deduplicationId per site:
//       1) matches /^[a-f0-9-]+_(cancel|update)_[a-f0-9-]+$/
//       2) does NOT contain ':'
//       3) is unique across the four call types for the same
//          (task_id, correlation_id) pair (single-cancel ≠
//          single-update ≠ bulk-cancel ≠ bulk-update only by op
//          tag — same task_id + same correlation_id collapses
//          across single vs bulk for the same op, which is the
//          intended dedup behaviour; cross-op uniqueness is what
//          this spec asserts).
//
// Lives in the integration project (no DB roundtrips here; the
// fixture is fully mocked) because the regression surface is the
// end-to-end publisher behaviour rather than a pure-function unit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const publishJSONSpy = vi.hoisted(() => vi.fn());
const batchJSONSpy = vi.hoisted(() => vi.fn());

vi.mock("@upstash/qstash", () => ({
  Client: function MockClient(this: {
    publishJSON: typeof publishJSONSpy;
    batchJSON: typeof batchJSONSpy;
  }) {
    this.publishJSON = publishJSONSpy;
    this.batchJSON = batchJSONSpy;
  },
}));

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import {
  __resetQStashClientForTest,
  enqueueBulkCancelTasks,
  enqueueBulkUpdateTasks,
  enqueueCancelTask,
  enqueueUpdateTask,
} from "../../src/modules/task-outbound-queue/publish";
import type {
  CancelTaskPayload,
  UpdateTaskPayload,
} from "../../src/modules/task-outbound-queue/types";

// RFC-4122 v4-shaped fixture UUIDs — keep distinct hex prefixes per
// field so a regex failure points at the right slot.
const TENANT_ID = "11111111-0000-4000-8000-000000000000";
const TASK_ID = "22222222-0000-4000-8000-000000000000";
const CORRELATION_ID = "33333333-0000-4000-8000-000000000000";
const AWB = "TEST-AWB-0001";

const DEDUP_ID_SHAPE = /^[a-f0-9-]+_(cancel|update)_[a-f0-9-]+$/;

const cancelPayload: CancelTaskPayload = {
  tenant_id: TENANT_ID,
  task_id: TASK_ID,
  awb: AWB,
  correlation_id: CORRELATION_ID,
};

const updatePayload: UpdateTaskPayload = {
  tenant_id: TENANT_ID,
  task_id: TASK_ID,
  awb: AWB,
  correlation_id: CORRELATION_ID,
  patch: { notes: "regression-pin: dedup id has no colon" },
};

beforeEach(() => {
  process.env.QSTASH_TOKEN = "test-token";
  process.env.PUBLIC_BASE_URL = "https://test.example.com";
  process.env.QSTASH_FLOW_CONTROL_KEY = "sf-push-global-test";
  publishJSONSpy.mockReset();
  publishJSONSpy.mockResolvedValue(undefined);
  batchJSONSpy.mockReset();
  batchJSONSpy.mockResolvedValue(undefined);
  __resetQStashClientForTest();
});

afterEach(() => {
  delete process.env.QSTASH_TOKEN;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.QSTASH_FLOW_CONTROL_KEY;
});

function dedupIdFromPublishJSONCall(callIndex: number): string {
  const arg = publishJSONSpy.mock.calls[callIndex]?.[0] as
    | { deduplicationId: string }
    | undefined;
  if (!arg) throw new Error(`no publishJSON call at index ${callIndex}`);
  return arg.deduplicationId;
}

function dedupIdFromBatchJSONCall(
  callIndex: number,
  messageIndex: number,
): string {
  const messages = batchJSONSpy.mock.calls[callIndex]?.[0] as
    | ReadonlyArray<{ deduplicationId: string }>
    | undefined;
  if (!messages) throw new Error(`no batchJSON call at index ${callIndex}`);
  const msg = messages[messageIndex];
  if (!msg) {
    throw new Error(
      `no message at index ${messageIndex} in batchJSON call ${callIndex}`,
    );
  }
  return msg.deduplicationId;
}

describe("QStash deduplicationId regression — no ':' across all four publisher sites", () => {
  it("enqueueCancelTask emits dedup id with '_' separators (no ':')", async () => {
    await enqueueCancelTask(cancelPayload);

    expect(publishJSONSpy).toHaveBeenCalledTimes(1);
    const dedupId = dedupIdFromPublishJSONCall(0);

    expect(dedupId).not.toContain(":");
    expect(dedupId).toMatch(DEDUP_ID_SHAPE);
    expect(dedupId).toBe(`${TASK_ID}_cancel_${CORRELATION_ID}`);
  });

  it("enqueueUpdateTask emits dedup id with '_' separators (no ':')", async () => {
    await enqueueUpdateTask(updatePayload);

    expect(publishJSONSpy).toHaveBeenCalledTimes(1);
    const dedupId = dedupIdFromPublishJSONCall(0);

    expect(dedupId).not.toContain(":");
    expect(dedupId).toMatch(DEDUP_ID_SHAPE);
    expect(dedupId).toBe(`${TASK_ID}_update_${CORRELATION_ID}`);
  });

  it("enqueueBulkCancelTasks fan-out emits dedup ids with '_' separators (no ':')", async () => {
    await enqueueBulkCancelTasks([cancelPayload]);

    expect(batchJSONSpy).toHaveBeenCalledTimes(1);
    const dedupId = dedupIdFromBatchJSONCall(0, 0);

    expect(dedupId).not.toContain(":");
    expect(dedupId).toMatch(DEDUP_ID_SHAPE);
    expect(dedupId).toBe(`${TASK_ID}_cancel_${CORRELATION_ID}`);
  });

  it("enqueueBulkUpdateTasks fan-out emits dedup ids with '_' separators (no ':')", async () => {
    await enqueueBulkUpdateTasks([updatePayload]);

    expect(batchJSONSpy).toHaveBeenCalledTimes(1);
    const dedupId = dedupIdFromBatchJSONCall(0, 0);

    expect(dedupId).not.toContain(":");
    expect(dedupId).toMatch(DEDUP_ID_SHAPE);
    expect(dedupId).toBe(`${TASK_ID}_update_${CORRELATION_ID}`);
  });

  it("dedup ids are unique across op kinds (cancel vs update) for the same (task_id, correlation_id)", async () => {
    await enqueueCancelTask(cancelPayload);
    await enqueueUpdateTask(updatePayload);
    await enqueueBulkCancelTasks([cancelPayload]);
    await enqueueBulkUpdateTasks([updatePayload]);

    const singleCancelId = dedupIdFromPublishJSONCall(0);
    const singleUpdateId = dedupIdFromPublishJSONCall(1);
    const bulkCancelId = dedupIdFromBatchJSONCall(0, 0);
    const bulkUpdateId = dedupIdFromBatchJSONCall(1, 0);

    // Cross-op-kind: cancel must differ from update (the op tag is
    // the discriminator).
    expect(singleCancelId).not.toBe(singleUpdateId);
    expect(bulkCancelId).not.toBe(bulkUpdateId);
    expect(singleCancelId).not.toBe(bulkUpdateId);
    expect(singleUpdateId).not.toBe(bulkCancelId);

    // Same op via single vs bulk path with same identity collapses
    // (intended dedup behaviour — re-clicking after a switch from
    // single to bulk should NOT double-send).
    expect(singleCancelId).toBe(bulkCancelId);
    expect(singleUpdateId).toBe(bulkUpdateId);

    // None of them contain ':' — the regression we're guarding.
    for (const id of [singleCancelId, singleUpdateId, bulkCancelId, bulkUpdateId]) {
      expect(id).not.toContain(":");
      expect(id).toMatch(DEDUP_ID_SHAPE);
    }
  });
});
