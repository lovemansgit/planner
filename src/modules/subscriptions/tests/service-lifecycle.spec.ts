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

beforeEach(() => {
  mockExecute.mockReset();
  mockEmit.mockReset();
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
    // 4. UPDATE tasks → CANCELED (returns count)
    // 5. UPDATE subscriptions (paused + end_date)
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([insertedPauseExceptionRow()]);
    mockExecute.mockResolvedValueOnce({ count: 5 } as unknown);
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
    mockExecute.mockResolvedValueOnce({ count: 5 } as unknown);
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
    mockExecute.mockResolvedValueOnce({ count: 3 } as unknown); // markTasksRestoredInWindow
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
