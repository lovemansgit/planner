// Service B unit tests — Day-16 Block 4-C.
//
// Mocks DB layer (`withTenant`) + audit emit + identity permission
// catalogue. Exercises the bounded-pause + auto-resume rewrites of
// `pauseSubscription` + `resumeSubscription` per merged plan §4 +
// brief §3.1.7.
//
// Coverage breakdown:
//   - pauseSubscription: permission, tenant context, date validation,
//     cut-off, state checks, idempotency, audit emission, end_date
//     extension correctness
//   - resumeSubscription: manual permission gate, auto-resume system
//     actor branch, not-paused idempotent path, no-active-window
//     idempotent path, early-manual recompute, audit emission
//
// Pure-helper algorithm correctness lives at
// `src/modules/subscription-exceptions/tests/skip-algorithm.spec.ts`
// (Day-13 + Day-16 worked examples). This file pins the I/O wiring +
// the service-layer flow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockExecute = vi.fn();
const mockEmit = vi.fn();
const mockEnqueueBulkCancelTasks = vi.fn();
const mockEnqueueTaskPushBatch = vi.fn();

vi.mock("@/shared/db", () => ({
  withTenant: vi.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    return await fn({ execute: mockExecute });
  }),
  withServiceRole: vi.fn(async (_reason: string, fn: (tx: unknown) => Promise<unknown>) => {
    return await fn({ execute: mockExecute });
  }),
}));

vi.mock("@/modules/audit", () => ({
  emit: vi.fn((input: unknown) => {
    mockEmit(input);
    return Promise.resolve();
  }),
}));

vi.mock("@/modules/task-outbound-queue", () => ({
  enqueueBulkCancelTasks: (payloads: unknown) => mockEnqueueBulkCancelTasks(payloads),
}));

// R16 — resumeSubscription's re-push fan-out publisher.
vi.mock("@/modules/task-materialization/queue", () => ({
  enqueueTaskPushBatch: (input: unknown) => mockEnqueueTaskPushBatch(input),
}));

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { pauseSubscription, resumeSubscription } from "../service";

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const TENANT_ID = "00000000-0000-0000-0000-000000000aaa" as Uuid;
const SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000bbb" as Uuid;
const USER_ID = "00000000-0000-0000-0000-000000000ccc" as Uuid;
const IDEMPOTENCY_KEY = "00000000-0000-0000-0000-000000000eee" as Uuid;
const PAUSE_EXCEPTION_ID = "00000000-0000-0000-0000-000000000fff" as Uuid;
const PAUSE_CORRELATION_ID = "00000000-0000-0000-0000-000000000111" as Uuid;

/** Mon 2026-05-04 09:00 UTC = 13:00 Dubai. */
const NOW = new Date("2026-05-04T09:00:00.000Z");

/** Mon 2026-05-11 — well past the cut-off for NOW. */
const PAUSE_START = "2026-05-11";
/** Fri 2026-05-15. */
const PAUSE_END = "2026-05-15";
/** Subscription ends Fri 2026-05-29 (originally), Mon-Fri eligibility. */
const ORIGINAL_END = "2026-05-29";

function userCtx(permissions: readonly string[]): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: USER_ID,
    tenantId: TENANT_ID,
    permissions: new Set(permissions) as unknown as Set<never>,
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: "/api/test",
  };
}

function systemCtx(): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:auto_resume",
    tenantId: TENANT_ID,
    permissions: new Set(["subscription:resume"]) as unknown as Set<never>,
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: "req-cron-test",
    path: "/api/cron/auto-resume",
  };
}

function subscriptionRow(
  overrides: Partial<{ status: string; endDate: string | null }> = {},
) {
  const endDate =
    "endDate" in overrides ? (overrides.endDate as string | null) : ORIGINAL_END;
  return {
    id: SUBSCRIPTION_ID,
    tenant_id: TENANT_ID,
    status: overrides.status ?? "active",
    start_date: "2026-04-01",
    end_date: endDate,
    days_of_week: [1, 2, 3, 4, 5],
    paused_at: null,
  };
}

function insertedPauseExceptionRow(
  overrides: Partial<{ startDate: string; endDate: string }> = {},
) {
  return {
    id: PAUSE_EXCEPTION_ID,
    subscription_id: SUBSCRIPTION_ID,
    tenant_id: TENANT_ID,
    type: "pause_window",
    start_date: overrides.startDate ?? PAUSE_START,
    end_date: overrides.endDate ?? PAUSE_END,
    target_date_override: null,
    skip_without_append: false,
    reason: null,
    address_override_id: null,
    compensating_date: null,
    correlation_id: PAUSE_CORRELATION_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    created_by: USER_ID,
    created_at: "2026-05-04T09:00:00.000Z",
  };
}

function activePauseWindowRow(
  overrides: Partial<{ startDate: string; endDate: string }> = {},
) {
  return {
    id: PAUSE_EXCEPTION_ID,
    start_date: overrides.startDate ?? PAUSE_START,
    end_date: overrides.endDate ?? PAUSE_END,
    correlation_id: PAUSE_CORRELATION_ID,
  };
}

// R2 fixtures — markTasksCanceledInWindow now RETURNs (id,
// external_tracking_number). Unpushed rows (null AWB) get no SF fan-out;
// pushed rows (non-null AWB) do.
function unpushedCanceledRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-0000-0000-00000000c0${String(i).padStart(2, "0")}` as Uuid,
    external_tracking_number: null,
  }));
}

function pushedCanceledRow(n: number) {
  return {
    id: `00000000-0000-0000-0000-00000000a0${String(n).padStart(2, "0")}` as Uuid,
    external_tracking_number: `AWB-PAUSE-${n}`,
  };
}

/**
 * Best-effort introspection of a drizzle `sql` template for unit
 * assertions (the DB layer is mocked, so SQL never executes). Joins the
 * StringChunk literals so a test can assert a fragment is present —
 * used by the R2 resume-reconcile regression to prove the
 * pending_cancel→synced CASE is in the restore UPDATE.
 */
function sqlIncludes(arg: unknown, needle: string): boolean {
  const chunks = (arg as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  const text = chunks
    .map((c) => {
      const v = (c as { value?: unknown }).value;
      return Array.isArray(v) ? v.join("") : "";
    })
    .join(" ");
  return text.includes(needle);
}

beforeEach(() => {
  mockExecute.mockReset();
  mockEmit.mockReset();
  mockEnqueueBulkCancelTasks.mockReset();
  mockEnqueueBulkCancelTasks.mockResolvedValue({
    enqueuedCount: 0,
    failedChunks: 0,
    totalCount: 0,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// pauseSubscription — input + state validation
// -----------------------------------------------------------------------------

describe("pauseSubscription — input + state validation", () => {
  const validInput = {
    pause_start: PAUSE_START,
    pause_end: PAUSE_END,
    reason: "merchant on vacation",
    idempotency_key: IDEMPOTENCY_KEY,
  };

  it("rejects ForbiddenError without subscription:pause", async () => {
    await expect(
      pauseSubscription(userCtx([]), SUBSCRIPTION_ID, validInput, { now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects ValidationError on malformed pause_start", async () => {
    await expect(
      pauseSubscription(
        userCtx(["subscription:pause"]),
        SUBSCRIPTION_ID,
        { ...validInput, pause_start: "2026/05/11" },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects ValidationError on pause_end <= pause_start", async () => {
    await expect(
      pauseSubscription(
        userCtx(["subscription:pause"]),
        SUBSCRIPTION_ID,
        { ...validInput, pause_end: PAUSE_START },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects ValidationError when cut-off elapsed for pause_start", async () => {
    // pause_start = today (2026-05-04) — cut-off for that was
    // 2026-05-03 18:00 Dubai. NOW = 2026-05-04 09:00 UTC = 13:00 Dubai;
    // cut-off has elapsed.
    await expect(
      pauseSubscription(
        userCtx(["subscription:pause"]),
        SUBSCRIPTION_ID,
        { ...validInput, pause_start: "2026-05-04" },
        { now: NOW },
      ),
    ).rejects.toThrow(/cut-off/);
  });

  it("rejects NotFoundError when subscription not found", async () => {
    mockExecute.mockResolvedValueOnce([]); // SELECT FOR UPDATE → none
    await expect(
      pauseSubscription(userCtx(["subscription:pause"]), SUBSCRIPTION_ID, validInput, {
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects ConflictError when subscription is paused", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);
    await expect(
      pauseSubscription(userCtx(["subscription:pause"]), SUBSCRIPTION_ID, validInput, {
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects ConflictError when subscription is ended", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "ended" })]);
    await expect(
      pauseSubscription(userCtx(["subscription:pause"]), SUBSCRIPTION_ID, validInput, {
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// -----------------------------------------------------------------------------
// pauseSubscription — happy path + idempotency + audit
// -----------------------------------------------------------------------------

describe("pauseSubscription — happy path + audit", () => {
  const validInput = {
    pause_start: PAUSE_START,
    pause_end: PAUSE_END,
    reason: "merchant on vacation",
    idempotency_key: IDEMPOTENCY_KEY,
  };

  it("happy path: inserts exception, cancels tasks, extends end_date, emits paused + end_date.extended with shared correlation_id", async () => {
    // Service flow on the happy path (5 mockExecute calls):
    // 1. SELECT subscription FOR UPDATE
    // 2. SELECT idempotency replay (none)
    // 3. INSERT subscription_exceptions RETURNING *
    // 4. UPDATE tasks → CANCELED RETURNING (id, external_tracking_number)
    //    — 5 unpushed rows (null AWB) so no SF fan-out fires here.
    // 5. UPDATE subscriptions (paused + end_date)
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce(unpushedCanceledRows(5));
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    expect(result.http_status).toBe(201);
    expect(result.exception_id).toBe(PAUSE_EXCEPTION_ID);
    expect(result.correlation_id).toBe(PAUSE_CORRELATION_ID);
    expect(result.canceled_task_count).toBe(5);
    // 5 eligible Mon-Fri days walked forward from 2026-05-30 (Sat) →
    // Mon-Fri 2026-06-01..2026-06-05 → 5th eligible = 2026-06-05.
    expect(result.new_end_date).toBe("2026-06-05");

    expect(mockEmit).toHaveBeenCalledTimes(2);
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      "subscription.paused",
      "subscription.end_date.extended",
    ]);

    const correlationIds = mockEmit.mock.calls.map(
      (c) => (c[0] as { metadata: { correlation_id: string } }).metadata.correlation_id,
    );
    expect(correlationIds[0]).toBe(correlationIds[1]);
    expect(correlationIds[0]).toBe(PAUSE_CORRELATION_ID);

    const pausedEmit = mockEmit.mock.calls[0][0] as {
      metadata: {
        pause_start: string;
        pause_end: string;
        canceled_task_count: number;
        exception_id: string;
      };
    };
    expect(pausedEmit.metadata.pause_start).toBe(PAUSE_START);
    expect(pausedEmit.metadata.pause_end).toBe(PAUSE_END);
    expect(pausedEmit.metadata.canceled_task_count).toBe(5);
    expect(pausedEmit.metadata.exception_id).toBe(PAUSE_EXCEPTION_ID);

    const endDateEmit = mockEmit.mock.calls[1][0] as {
      metadata: { previous_end_date: string; new_end_date: string; triggered_by: string };
    };
    expect(endDateEmit.metadata.previous_end_date).toBe(ORIGINAL_END);
    expect(endDateEmit.metadata.new_end_date).toBe("2026-06-05");
    expect(endDateEmit.metadata.triggered_by).toBe("pause_resume");
  });

  it("idempotent replay: returns existing exception with 409, no audit", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]); // replay hit

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("idempotent_replay");
    expect(result.http_status).toBe(409);
    expect(result.exception_id).toBe(PAUSE_EXCEPTION_ID);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("open-ended subscription: pauses + cancels tasks + skips end_date extension", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow({ endDate: null })]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce(unpushedCanceledRows(5));
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    expect(result.new_end_date).toBe("");
    expect(result.canceled_task_count).toBe(5);

    // Only subscription.paused emitted; no end_date.extended (no
    // change to end_date for open-ended subs).
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect((mockEmit.mock.calls[0][0] as { eventType: string }).eventType).toBe(
      "subscription.paused",
    );
  });
});

// -----------------------------------------------------------------------------
// resumeSubscription — permission + idempotency
// -----------------------------------------------------------------------------

describe("resumeSubscription — permission + idempotency", () => {
  const validInput = { idempotency_key: IDEMPOTENCY_KEY };

  it("rejects ForbiddenError without subscription:resume (manual path)", async () => {
    await expect(
      resumeSubscription(userCtx([]), SUBSCRIPTION_ID, validInput, { now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects ForbiddenError when auto-resume is invoked with a user actor", async () => {
    await expect(
      resumeSubscription(userCtx(["subscription:resume"]), SUBSCRIPTION_ID, validInput, {
        now: NOW,
        is_auto_resume: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns already_active when subscription is already active (idempotent, no audit)", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "active" })]);

    const result = await resumeSubscription(
      userCtx(["subscription:resume"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("already_active");
    expect(result.http_status).toBe(200);
    expect(result.correlation_id).toBeNull();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns already_active when no active pause window exists (idempotent, no audit)", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);
    mockExecute.mockResolvedValueOnce([]); // active pause window query → none

    const result = await resumeSubscription(
      userCtx(["subscription:resume"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("already_active");
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// resumeSubscription — auto + manual happy paths
// -----------------------------------------------------------------------------

describe("resumeSubscription — auto + manual happy paths", () => {
  const validInput = { idempotency_key: IDEMPOTENCY_KEY };

  it("auto-resume with system actor: actual_resume_date = pause_end, no end_date change, single audit event", async () => {
    // pause_end has elapsed; auto-resume restores subscription to active.
    // Service flow (3 mockExecute calls for auto path):
    // 1. SELECT subscription FOR UPDATE
    // 2. SELECT active pause window
    // 3. UPDATE subscriptions → active
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);
    mockExecute.mockResolvedValueOnce([activePauseWindowRow()]);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);

    const result = await resumeSubscription(
      systemCtx(),
      SUBSCRIPTION_ID,
      validInput,
      { now: new Date("2026-05-16T09:00:00.000Z"), is_auto_resume: true },
    );

    expect(result.status).toBe("resumed");
    expect(result.actual_resume_date).toBe(PAUSE_END);
    expect(result.new_end_date).toBe(ORIGINAL_END);
    expect(result.restored_task_count).toBe(0);
    expect(result.correlation_id).toBe(PAUSE_CORRELATION_ID);

    // Single audit (no end_date change for auto-resume).
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emit = mockEmit.mock.calls[0][0] as {
      eventType: string;
      metadata: {
        actual_resume_date: string;
        is_auto_resume: boolean;
        correlation_id: string;
      };
    };
    expect(emit.eventType).toBe("subscription.resumed");
    expect(emit.metadata.actual_resume_date).toBe(PAUSE_END);
    expect(emit.metadata.is_auto_resume).toBe(true);
    expect(emit.metadata.correlation_id).toBe(PAUSE_CORRELATION_ID);
  });

  it("manual resume on/after pause_end: same as auto — no shrink, no restore", async () => {
    // NOW = 2026-05-16 (after pause_end Fri 2026-05-15) UTC 09:00.
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);
    mockExecute.mockResolvedValueOnce([activePauseWindowRow()]);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);

    const result = await resumeSubscription(
      userCtx(["subscription:resume"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: new Date("2026-05-16T09:00:00.000Z") },
    );

    expect(result.status).toBe("resumed");
    expect(result.new_end_date).toBe(ORIGINAL_END); // no change
    expect(result.restored_task_count).toBe(0);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it("manual resume early (before pause_end): end_date shrinks + tasks restored + 2 audit events", async () => {
    // pause window 2026-05-11..2026-05-15.
    // current end_date 2026-05-29 (already extended by previous pause flow).
    // Mock the original end_date AS-IF it had been extended by 5 eligible days from a pre-pause 2026-05-22.
    // Actually for the test we just verify the recompute happens — the exact numbers depend on the implementation.
    // Manual resume on 2026-05-13 (Wed) — early, before pause_end Fri 2026-05-15.
    //
    // Expected:
    //   originalExtension = countEligibleDeliveryDays(sub, 2026-05-11, 2026-05-15) = 5
    //   effectiveExtension = countEligibleDeliveryDays(sub, 2026-05-11, 2026-05-12) = 2 (Mon, Tue)
    //   shrinkBy = 5 - 2 = 3
    //   new_end_date = walkBackwardEligibleDays from 2026-05-29 by 3 days = Mon 2026-05-26
    //   (Backward walk: Thu 2026-05-28, Wed 2026-05-27, Tue 2026-05-26 — 3 eligible Mon-Fri)

    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);
    mockExecute.mockResolvedValueOnce([activePauseWindowRow()]);
    // markTasksRestoredInWindow — R16 row shape; never-pushed rows here
    // (null previous AWB) so this test stays about the end-date recompute.
    mockExecute.mockResolvedValueOnce([
      { id: "t1", previous_external_tracking_number: null },
      { id: "t2", previous_external_tracking_number: null },
      { id: "t3", previous_external_tracking_number: null },
    ] as unknown);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown); // UPDATE subscriptions

    const result = await resumeSubscription(
      userCtx(["subscription:resume"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: new Date("2026-05-13T09:00:00.000Z") }, // Wed = early manual
    );

    expect(result.status).toBe("resumed");
    expect(result.actual_resume_date).toBe("2026-05-13");
    expect(result.new_end_date).toBe("2026-05-26");
    expect(result.restored_task_count).toBe(3);

    // Two audit events (resumed + end_date.extended).
    expect(mockEmit).toHaveBeenCalledTimes(2);
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      "subscription.resumed",
      "subscription.end_date.extended",
    ]);
    const endDateEmit = mockEmit.mock.calls[1][0] as {
      metadata: { previous_end_date: string; new_end_date: string };
    };
    expect(endDateEmit.metadata.previous_end_date).toBe(ORIGINAL_END);
    expect(endDateEmit.metadata.new_end_date).toBe("2026-05-26");
  });
});

// -----------------------------------------------------------------------------
// pauseSubscription — R2 SF cancel fan-out (plan-PR #337 §2.R2)
// -----------------------------------------------------------------------------

describe("pauseSubscription — R2 SF cancel fan-out", () => {
  const validInput = {
    pause_start: PAUSE_START,
    pause_end: PAUSE_END,
    reason: "merchant on vacation",
    idempotency_key: IDEMPOTENCY_KEY,
  };

  it("⑤.1 happy multi-task fan-out: pushes SF cancels for all pushed rows + emits pause_cancels_pushed", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce([
      pushedCanceledRow(1),
      pushedCanceledRow(2),
      pushedCanceledRow(3),
    ]);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);
    mockEnqueueBulkCancelTasks.mockResolvedValue({
      enqueuedCount: 3,
      failedChunks: 0,
      totalCount: 3,
    });

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    expect(result.canceled_task_count).toBe(3);

    // Publisher invoked once with one CancelTaskPayload per pushed row.
    expect(mockEnqueueBulkCancelTasks).toHaveBeenCalledTimes(1);
    const payloads = mockEnqueueBulkCancelTasks.mock.calls[0][0] as Array<{
      tenant_id: string;
      task_id: string;
      awb: string;
      correlation_id: string;
    }>;
    expect(payloads).toHaveLength(3);
    expect(payloads.map((p) => p.awb)).toEqual(["AWB-PAUSE-1", "AWB-PAUSE-2", "AWB-PAUSE-3"]);
    expect(payloads.every((p) => p.correlation_id === PAUSE_CORRELATION_ID)).toBe(true);
    expect(payloads.every((p) => p.tenant_id === TENANT_ID)).toBe(true);

    // 3 emits: paused, end_date.extended, pause_cancels_pushed.
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      "subscription.paused",
      "subscription.end_date.extended",
      "subscription.pause_cancels_pushed",
    ]);
    const pushedEmit = mockEmit.mock.calls[2][0] as {
      metadata: {
        pushed_task_count: number;
        enqueued_count: number;
        failed_chunks: number;
        correlation_id: string;
        pause_start: string;
        pause_end: string;
      };
    };
    expect(pushedEmit.metadata.pushed_task_count).toBe(3);
    expect(pushedEmit.metadata.enqueued_count).toBe(3);
    expect(pushedEmit.metadata.failed_chunks).toBe(0);
    expect(pushedEmit.metadata.correlation_id).toBe(PAUSE_CORRELATION_ID);
    expect(pushedEmit.metadata.pause_start).toBe(PAUSE_START);
    expect(pushedEmit.metadata.pause_end).toBe(PAUSE_END);
  });

  it("⑤.2 partial-failure: emits pause_cancels_pushed with failed_chunks THEN re-throws (Q5)", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce([pushedCanceledRow(1), pushedCanceledRow(2)]);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);
    mockEnqueueBulkCancelTasks.mockResolvedValue({
      enqueuedCount: 1,
      failedChunks: 1,
      totalCount: 2,
    });

    await expect(
      pauseSubscription(userCtx(["subscription:pause"]), SUBSCRIPTION_ID, validInput, {
        now: NOW,
      }),
    ).rejects.toThrow(/partially failed/);

    // emit-then-throw: the audit row records the partial failure BEFORE
    // the re-throw. Local DB writes already committed (tx returned).
    const pushedEmit = mockEmit.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "subscription.pause_cancels_pushed",
    );
    expect(pushedEmit).toBeDefined();
    expect((pushedEmit![0] as { metadata: { failed_chunks: number } }).metadata.failed_chunks).toBe(
      1,
    );
  });

  it("⑤.3 idempotency replay: no fan-out, no pause_cancels_pushed", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]); // replay hit

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("idempotent_replay");
    expect(mockEnqueueBulkCancelTasks).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("⑤.4 zero pushed tasks: cancels locally, no SF fan-out, no pause_cancels_pushed", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce(unpushedCanceledRows(3));
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    expect(result.canceled_task_count).toBe(3);
    expect(mockEnqueueBulkCancelTasks).not.toHaveBeenCalled();
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual(["subscription.paused", "subscription.end_date.extended"]);
  });

  it("⑤.5 resume regression (R16): early manual resume restores tasks, clears ids on SF-cancelled rows, fans out the re-push", async () => {
    // 4 execute calls: SELECT sub, SELECT pause window, UPDATE tasks
    // (restore), UPDATE subscriptions. R16 supersedes the R2 safe-state
    // half: pushed rows clear external ids + flip to 'pending' and
    // re-enter the push pipeline via enqueueTaskPushBatch.
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);
    mockExecute.mockResolvedValueOnce([activePauseWindowRow()]);
    mockExecute.mockResolvedValueOnce([
      { id: "t1", previous_external_tracking_number: "AWB-1" },
      { id: "t2", previous_external_tracking_number: "AWB-2" },
      { id: "t3", previous_external_tracking_number: null },
    ] as unknown); // markTasksRestoredInWindow
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown); // UPDATE subscriptions
    mockEnqueueTaskPushBatch.mockResolvedValueOnce({ enqueuedCount: 2, failedChunks: 0 });

    const result = await resumeSubscription(
      userCtx(["subscription:resume"]),
      SUBSCRIPTION_ID,
      { idempotency_key: IDEMPOTENCY_KEY },
      { now: new Date("2026-05-13T09:00:00.000Z") }, // Wed = early manual
    );

    expect(result.status).toBe("resumed");
    expect(result.restored_task_count).toBe(3);
    expect(result.reactivated_task_count).toBe(2);
    expect(mockEnqueueBulkCancelTasks).not.toHaveBeenCalled();

    // The restore UPDATE (3rd execute call) carries the R16 id-clear +
    // honest 'pending' flip (no more pending_cancel→synced reconcile).
    const restoreSql = mockExecute.mock.calls[2][0];
    expect(sqlIncludes(restoreSql, "pending")).toBe(true);
    expect(sqlIncludes(restoreSql, "external_tracking_number")).toBe(true);

    // Fan-out saw exactly the AWB-carrying rows.
    expect(mockEnqueueTaskPushBatch).toHaveBeenCalledTimes(1);
    const input = mockEnqueueTaskPushBatch.mock.calls[0][0] as { taskIds: readonly string[] };
    expect([...input.taskIds].sort()).toEqual(["t1", "t2"]);

    // Third emit = the R16 outbound-leg event with previous_awbs.
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain("subscription.resume_reactivations_pushed");
  });

  it("⑤.6 mixed pushed + unpushed: only pushed rows fan out; count covers all", async () => {
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce([
      pushedCanceledRow(1),
      ...unpushedCanceledRows(3),
      pushedCanceledRow(2),
    ]);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);
    mockEnqueueBulkCancelTasks.mockResolvedValue({
      enqueuedCount: 2,
      failedChunks: 0,
      totalCount: 2,
    });

    const result = await pauseSubscription(
      userCtx(["subscription:pause"]),
      SUBSCRIPTION_ID,
      validInput,
      { now: NOW },
    );

    expect(result.canceled_task_count).toBe(5);
    expect(mockEnqueueBulkCancelTasks).toHaveBeenCalledTimes(1);
    const payloads = mockEnqueueBulkCancelTasks.mock.calls[0][0] as Array<{ awb: string }>;
    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.awb).sort()).toEqual(["AWB-PAUSE-1", "AWB-PAUSE-2"]);
    const pushedEmit = mockEmit.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "subscription.pause_cancels_pushed",
    )![0] as { metadata: { pushed_task_count: number; enqueued_count: number } };
    expect(pushedEmit.metadata.pushed_task_count).toBe(2);
    expect(pushedEmit.metadata.enqueued_count).toBe(2);
  });
});
