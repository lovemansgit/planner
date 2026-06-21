// Service A unit tests — Day-16 Block 4-B.
//
// Mocks DB layer (`withTenant`) + audit emit + identity permission
// catalogue. Verifies:
//   - Permission matrix (5 type variants × 4 role contexts)
//   - Subscription state checks (active / paused / ended)
//   - Cut-off enforcement (>= 18:00 Dubai day-before reject)
//   - Days-of-week eligibility (skip + one_off; forward exempt)
//   - Idempotency (replay returns existing exception with 409, no audit)
//   - Audit-event emission per type variant (correlation_id shared)
//   - pause_window + append_without_skip rejected at addSubscriptionException
//   - appendWithoutSkip permission + happy path
//
// computeCompensatingDate worked examples + edge cases A-I are tested
// at the pure-helper layer in `skip-algorithm.spec.ts` — the service
// wrapper is exercised here via the wired-through default-skip path
// to confirm I/O wiring + error mapping.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const mockExecute = vi.fn();
const mockEmit = vi.fn();

vi.mock("@/shared/db", () => ({
  withTenant: vi.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
    return await fn({ execute: mockExecute });
  }),
}));

vi.mock("@/modules/audit", () => ({
  emit: vi.fn((input: unknown) => {
    mockEmit(input);
    return Promise.resolve();
  }),
}));

// Day-29 §D(2) Phase-1 — mock the outbound publisher to prevent the
// real QStash client constructor from running in unit tests. The unit
// fixtures keep external_tracking_number=null on the markTaskSkipped
// mock return, so the service's gating clause never invokes the
// publisher; this mock just satisfies the import surface.
vi.mock("@/modules/task-outbound-queue", () => ({
  enqueueCancelTask: vi.fn(async () => undefined),
}));

// D56 / Phase-5 move-to-date rework — the move-to-date create-side calls the
// post-commit batch push for the newly-materialized moved task. Mock the
// publisher so the real QStash client never constructs in unit tests.
vi.mock("@/modules/task-materialization/queue", () => ({
  enqueueTaskPushBatch: vi.fn(async () => ({ enqueuedCount: 1, failedChunks: 0 })),
}));

// R1 (calendar-management Phase 1) — on-demand materializer invocation
// is wired into addSubscriptionException's skip-tail-extension post-commit
// block. The real primitive opens a withServiceRole connection, which the
// @/shared/db mock above doesn't expose. Mock to no-op so the existing
// unit fixtures (which exercise the local-write + audit-emit surface, not
// the on-demand consumer) continue to pass. The R1 surface is exercised
// end-to-end by tests/integration/task-materialization-on-demand.spec.ts.
vi.mock("@/modules/task-materialization/service", () => ({
  invokeOnDemandMaterialization: vi.fn(async () => ({
    newInsertedTaskIds: [],
    addressResolutionFailedCount: 0,
    advancedSubscriptionIds: [],
    runRowOutcome: { kind: "inserted" },
    cappedByGate: false,
  })),
  // D56 / Phase-5 — the move-to-date create-side materializes one task at the
  // target date inside the same tx. Default to the idempotent-conflict shape
  // (no insert, no failure); tests that assert the create+push override it.
  materializeSubscriptionOneOffDate: vi.fn(async () => ({
    insertedTaskId: null,
    addressResolutionFailed: false,
  })),
}));

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import {
  addSubscriptionException,
  appendWithoutSkip,
  getRecentExceptionsForSubscription,
} from "../service";
import type { AddSubscriptionExceptionInput } from "../types";
import { enqueueCancelTask } from "@/modules/task-outbound-queue";
import { enqueueTaskPushBatch } from "@/modules/task-materialization/queue";
import { materializeSubscriptionOneOffDate } from "@/modules/task-materialization/service";

const mockEnqueueCancel = vi.mocked(enqueueCancelTask);
const mockEnqueuePush = vi.mocked(enqueueTaskPushBatch);
const mockMaterializeOneOff = vi.mocked(materializeSubscriptionOneOffDate);

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const TENANT_ID = "00000000-0000-0000-0000-000000000aaa" as Uuid;
const SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000bbb" as Uuid;
const USER_ID = "00000000-0000-0000-0000-000000000ccc" as Uuid;
const ADDRESS_ID = "00000000-0000-0000-0000-000000000ddd" as Uuid;
const IDEMPOTENCY_KEY = "00000000-0000-0000-0000-000000000eee" as Uuid;
// Day 16 / Block 4-E §B B1 — consignee_id added to the
// getSubscriptionForUpdate SELECT projection; the
// findAddressForConsignee helper takes consigneeId as input. New
// fixture constants to support cross-consignee ownership tests.
const CONSIGNEE_ID = "00000000-0000-0000-0000-000000000c0c" as Uuid;
const OTHER_CONSIGNEE_ID = "00000000-0000-0000-0000-000000000c1c" as Uuid;

/**
 * "Now" used across tests — Tuesday 2026-05-05 09:00 UTC = Tuesday
 * 2026-05-05 13:00 Dubai. Cut-off for 2026-05-06 is 2026-05-05 14:00 UTC
 * = 18:00 Dubai. So at 09:00 UTC on 2026-05-05, the cut-off for skipping
 * 2026-05-06 has NOT elapsed; cut-off for 2026-05-05 itself HAS elapsed
 * (since cut-off is the day before, we'd compare against 2026-05-04 18:00
 * Dubai which is firmly in the past).
 */
const NOW = new Date("2026-05-05T09:00:00.000Z");
const DUBAI_TODAY = "2026-05-05";

/** A future eligible date for skip — Wednesday 2026-05-13 (cut-off NOT elapsed at NOW). */
const FUTURE_SKIP_DATE = "2026-05-13";

/** Far enough out that the wrapper's compensating-date walk lands cleanly. */
const FAR_FUTURE_END_DATE = "2026-06-30"; // Tuesday — past FUTURE_SKIP_DATE

function ctxWith(permissions: readonly string[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(permissions) as unknown as Set<never>,
      email: "operator@test",
      displayName: null,
    },
    tenantId: TENANT_ID,
    requestId: "req-test",
    path: "/api/test",
  };
}

function subscriptionRow(
  overrides: Partial<{
    status: string;
    startDate: string;
    endDate: string | null;
    daysOfWeek: number[];
    consigneeId: string;
  }> = {},
) {
  // Use `in` discrimination so a deliberate null doesn't collapse to
  // the default via `??`.
  const endDate =
    "endDate" in overrides ? (overrides.endDate as string | null) : FAR_FUTURE_END_DATE;
  return {
    id: SUBSCRIPTION_ID,
    tenant_id: TENANT_ID,
    consignee_id: overrides.consigneeId ?? CONSIGNEE_ID,
    status: overrides.status ?? "active",
    start_date: overrides.startDate ?? "2026-05-01",
    end_date: endDate,
    days_of_week: overrides.daysOfWeek ?? [1, 2, 3, 4, 5], // Mon-Fri
  };
}

/**
 * Day 16 / Block 4-E — fixture for the findAddressForConsignee SELECT
 * issued inside the address_override_one_off / _forward branches of
 * addSubscriptionException. Returns one row when the address belongs
 * to the consignee. Tests that exercise the cross-consignee
 * rejection mock empty `[]` instead.
 */
function ownedAddressRow(addressId: string = ADDRESS_ID, consigneeId: string = CONSIGNEE_ID) {
  return {
    id: addressId,
    consignee_id: consigneeId,
    tenant_id: TENANT_ID,
    label: "home",
    is_primary: true,
  };
}

function insertedExceptionRow(
  overrides: Partial<{
    type: string;
    startDate: string;
    compensatingDate: string | null;
    targetDateOverride: string | null;
    skipWithoutAppend: boolean;
    addressOverrideId: string | null;
    reason: string | null;
  }> = {},
) {
  return {
    id: "00000000-0000-0000-0000-000000000fff",
    subscription_id: SUBSCRIPTION_ID,
    tenant_id: TENANT_ID,
    type: overrides.type ?? "skip",
    start_date: overrides.startDate ?? FUTURE_SKIP_DATE,
    end_date: null,
    target_date_override: overrides.targetDateOverride ?? null,
    skip_without_append: overrides.skipWithoutAppend ?? false,
    reason: overrides.reason ?? null,
    address_override_id: overrides.addressOverrideId ?? null,
    compensating_date: overrides.compensatingDate ?? null,
    correlation_id: "00000000-0000-0000-0000-000000000111",
    idempotency_key: IDEMPOTENCY_KEY,
    created_by: USER_ID,
    created_at: "2026-05-05T09:00:00.000Z",
  };
}

/**
 * Wire mock-execute to return the right data per query. The service
 * issues these queries in order:
 *   1. SELECT subscription FOR UPDATE
 *   2. (skip flow only) SELECT idempotency-replay
 *   3. (skip default flow) SELECT pause-windows
 *   4. (target_date_override) SELECT task-by-(sub,date) for collision
 *   5. INSERT subscription_exceptions RETURNING *
 *   6. (skip extending end_date) UPDATE subscriptions
 *   7. (skip flow) UPDATE tasks → SKIPPED
 *
 * Each helper here sets up the canonical happy-path response sequence.
 */
function setupHappyPath(opts?: {
  type?: string;
  insertedException?: ReturnType<typeof insertedExceptionRow>;
  pauseWindows?: Array<{ start_date: string; end_date: string }>;
  collidingTask?: unknown;
  skippedTaskRows?: number;
}) {
  mockExecute.mockReset();

  // 1. subscription FOR UPDATE
  mockExecute.mockResolvedValueOnce([subscriptionRow()]);

  // 2. idempotency-replay → none
  mockExecute.mockResolvedValueOnce([]);

  if (opts?.type === "skip" || opts?.type === undefined) {
    // 3. pause-windows → empty
    mockExecute.mockResolvedValueOnce(opts?.pauseWindows ?? []);
  }

  // 4. (target-date collision check, if applicable — only when targetDateOverride set)
  // Caller sets up via mockResolvedValueOnce as needed BEFORE calling the function.

  // 5. INSERT exception
  mockExecute.mockResolvedValueOnce([opts?.insertedException ?? insertedExceptionRow()]);

  // 6. (skip extending) UPDATE subscriptions — single result, count form
  // 7. (skip flow) UPDATE tasks — Day-29 §D(2) Phase-1: markTaskSkipped
  //    now uses RETURNING and yields a row array. external_tracking_number
  //    stays NULL for unit fixtures so the post-commit publisher gate
  //    short-circuits (no outbound enqueue in unit tests). Pass
  //    skippedTaskRows=0 to simulate sub-case 13a (date not materialized).
  // For the happy path mocks, we add two more no-op responses; not all
  // type variants reach both, but extras are harmless.
  mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);
  mockExecute.mockResolvedValueOnce(
    (opts?.skippedTaskRows ?? 1) === 0
      ? []
      : [{ id: "00000000-0000-0000-0000-00000000ffff", external_tracking_number: null }],
  );
}

beforeEach(() => {
  mockExecute.mockReset();
  mockEmit.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// Permission matrix — 5 type variants
// -----------------------------------------------------------------------------

describe("addSubscriptionException — permission matrix", () => {
  const baseInput: AddSubscriptionExceptionInput = {
    type: "skip",
    date: FUTURE_SKIP_DATE,
    idempotencyKey: IDEMPOTENCY_KEY,
  };

  it("'skip' default requires subscription:skip — succeeds with that perm only", async () => {
    setupHappyPath({ insertedException: insertedExceptionRow({ compensatingDate: "2026-07-01" }) });
    const ctx = ctxWith(["subscription:skip"]);
    const result = await addSubscriptionException(ctx, SUBSCRIPTION_ID, baseInput, { now: NOW });
    expect(result.status).toBe("inserted");
  });

  it("'skip' default rejects actor without subscription:skip", async () => {
    const ctx = ctxWith([]);
    await expect(
      addSubscriptionException(ctx, SUBSCRIPTION_ID, baseInput, { now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("'skip' with target_date_override requires subscription:override_skip_rules", async () => {
    const input: AddSubscriptionExceptionInput = {
      ...baseInput,
      targetDateOverride: "2026-07-06", // Mon — eligible
    };
    setupHappyPath({
      insertedException: insertedExceptionRow({
        compensatingDate: "2026-07-06",
        targetDateOverride: "2026-07-06",
      }),
    });
    // Service order for the move-to-date path (D56 rework):
    // [sub, replay, INSERT, UPDATE task]. No end_date UPDATE — move-to-date
    // never extends end_date (target 2026-07-06 is BEYOND the default
    // end_date 2026-06-30, so it is a valid beyond-schedule move). The
    // one-off materialization is module-mocked (no execute call).
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // 1. sub
    mockExecute.mockResolvedValueOnce([]); // 2. replay none
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ compensatingDate: "2026-07-06", targetDateOverride: "2026-07-06" }),
    ]); // 3. INSERT
    mockExecute.mockResolvedValueOnce([
      { id: "00000000-0000-0000-0000-00000000ffff", external_tracking_number: null },
    ]); // 4. UPDATE task SKIPPED (RETURNING per Day-29)

    const ctx = ctxWith(["subscription:override_skip_rules"]);
    const result = await addSubscriptionException(ctx, SUBSCRIPTION_ID, input, { now: NOW });
    expect(result.status).toBe("inserted");
  });

  it("'skip' with target_date_override rejects actor with only subscription:skip", async () => {
    const input: AddSubscriptionExceptionInput = {
      ...baseInput,
      targetDateOverride: "2026-07-06",
    };
    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      addSubscriptionException(ctx, SUBSCRIPTION_ID, input, { now: NOW }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("'skip' with skip_without_append=true requires subscription:override_skip_rules", async () => {
    const input: AddSubscriptionExceptionInput = {
      ...baseInput,
      skipWithoutAppend: true,
    };
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // 1. sub
    mockExecute.mockResolvedValueOnce([]); // 2. replay none
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ skipWithoutAppend: true, compensatingDate: null }),
    ]); // 3. INSERT
    mockExecute.mockResolvedValueOnce([
      { id: "00000000-0000-0000-0000-00000000ffff", external_tracking_number: null },
    ]); // 4. UPDATE task SKIPPED (RETURNING per Day-29)

    const ctx = ctxWith(["subscription:override_skip_rules"]);
    const result = await addSubscriptionException(ctx, SUBSCRIPTION_ID, input, { now: NOW });
    expect(result.status).toBe("inserted");
    expect(result.compensatingDate).toBeNull();
    expect(result.newEndDate).toBeNull();
  });

  it("'skip' with skip_without_append rejects actor with only subscription:skip", async () => {
    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        { ...baseInput, skipWithoutAppend: true },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("'address_override_one_off' requires subscription:change_address_one_off", async () => {
    const input: AddSubscriptionExceptionInput = {
      type: "address_override_one_off",
      date: FUTURE_SKIP_DATE,
      idempotencyKey: IDEMPOTENCY_KEY,
      addressOverrideId: ADDRESS_ID,
    };
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // 1. sub
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // 1b. cross-consignee ownership (Block 4-E §B)
    mockExecute.mockResolvedValueOnce([]); // 2. replay
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "address_override_one_off",
        addressOverrideId: ADDRESS_ID,
      }),
    ]); // 3. INSERT
    mockExecute.mockResolvedValueOnce([]); // 4. R4 markTaskAddressOverridden — unit fixture date unmaterialized

    const ctx = ctxWith(["subscription:change_address_one_off"]);
    const result = await addSubscriptionException(ctx, SUBSCRIPTION_ID, input, { now: NOW });
    expect(result.status).toBe("inserted");
  });

  it("'address_override_one_off' rejects actor without that perm", async () => {
    const ctx = ctxWith(["subscription:change_address_forward"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_one_off",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
          addressOverrideId: ADDRESS_ID,
        },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("'address_override_forward' requires subscription:change_address_forward", async () => {
    const input: AddSubscriptionExceptionInput = {
      type: "address_override_forward",
      date: FUTURE_SKIP_DATE,
      idempotencyKey: IDEMPOTENCY_KEY,
      addressOverrideId: ADDRESS_ID,
    };
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // Block 4-E §B ownership check
    mockExecute.mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "address_override_forward",
        addressOverrideId: ADDRESS_ID,
      }),
    ]);
    mockExecute.mockResolvedValueOnce([]); // R5 markTasksAddressOverriddenForward — no in-horizon rows in unit fixtures

    const ctx = ctxWith(["subscription:change_address_forward"]);
    const result = await addSubscriptionException(ctx, SUBSCRIPTION_ID, input, { now: NOW });
    expect(result.status).toBe("inserted");
  });

  it("'address_override_forward' rejects actor without that perm", async () => {
    const ctx = ctxWith(["subscription:change_address_one_off"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_forward",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
          addressOverrideId: ADDRESS_ID,
        },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// -----------------------------------------------------------------------------
// pause_window + append_without_skip REJECTED at this entry
// -----------------------------------------------------------------------------

describe("addSubscriptionException — type rejection", () => {
  it("rejects type='pause_window' with ValidationError naming pauseSubscription", async () => {
    const ctx = ctxWith(["subscription:pause"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "pause_window",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/pauseSubscription/);
  });

  it("rejects type='append_without_skip' with ValidationError naming appendWithoutSkip", async () => {
    const ctx = ctxWith(["subscription:override_skip_rules"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "append_without_skip",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/appendWithoutSkip/);
  });
});

// -----------------------------------------------------------------------------
// Subscription state checks
// -----------------------------------------------------------------------------

describe("addSubscriptionException — subscription state", () => {
  const skipInput: AddSubscriptionExceptionInput = {
    type: "skip",
    date: FUTURE_SKIP_DATE,
    idempotencyKey: IDEMPOTENCY_KEY,
  };

  it("rejects ConflictError when subscription is paused", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);

    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      addSubscriptionException(ctx, SUBSCRIPTION_ID, skipInput, { now: NOW }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects ConflictError when subscription is ended", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "ended" })]);

    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      addSubscriptionException(ctx, SUBSCRIPTION_ID, skipInput, { now: NOW }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects NotFoundError when subscription does not exist", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([]);

    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      addSubscriptionException(ctx, SUBSCRIPTION_ID, skipInput, { now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// -----------------------------------------------------------------------------
// Cut-off enforcement (brief §3.1.8)
// -----------------------------------------------------------------------------

describe("addSubscriptionException — cut-off enforcement", () => {
  it("rejects when cut-off elapsed (skip date is today and now is past 14:00 UTC)", async () => {
    const ctx = ctxWith(["subscription:skip"]);
    // skipDate = 2026-05-05 (Tuesday); cut-off was 2026-05-04 18:00 Dubai = 2026-05-04 14:00 UTC.
    // NOW = 2026-05-05 09:00 UTC, which is past 2026-05-04 14:00 UTC. Cut-off elapsed.
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "skip",
          date: DUBAI_TODAY,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/cut-off/);
  });

  it("R-A: address_override_one_off past cut-off is ALLOWED (address edits follow the assignment gate, not the clock)", async () => {
    const ctx = ctxWith(["subscription:change_address_one_off"]);
    // DUBAI_TODAY's cut-off has elapsed at NOW — a skip would reject;
    // the address override no longer consults the clock.
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // sub FOR UPDATE
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // 5b ownership
    mockExecute.mockResolvedValueOnce([]); // idempotency → none
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ type: "address_override_one_off", addressOverrideId: ADDRESS_ID, startDate: DUBAI_TODAY }),
    ]); // INSERT exception
    mockExecute.mockResolvedValueOnce([]); // markTaskAddressOverridden → unmaterialized (null path)
    mockExecute.mockResolvedValueOnce([]); // R-A probe → no driver-bound task
    const result = await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "address_override_one_off",
        date: DUBAI_TODAY,
        addressOverrideId: ADDRESS_ID as never,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { now: NOW },
    );
    expect(result.status).toBe("inserted");
  });

  it("R-A: address_override_one_off on a driver-bound task is REJECTED (assignment gate)", async () => {
    const ctx = ctxWith(["subscription:change_address_one_off"]);
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // sub FOR UPDATE
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // 5b ownership
    mockExecute.mockResolvedValueOnce([]); // idempotency → none
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ type: "address_override_one_off", addressOverrideId: ADDRESS_ID, startDate: FUTURE_SKIP_DATE }),
    ]); // INSERT exception
    mockExecute.mockResolvedValueOnce([]); // markTaskAddressOverridden → null (frozen row excluded by WHERE)
    mockExecute.mockResolvedValueOnce([{ internal_status: "ASSIGNED" }]); // R-A probe → driver-bound
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_one_off",
          date: FUTURE_SKIP_DATE,
          addressOverrideId: ADDRESS_ID as never,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/driver|locked/i);
  });

  it("accepts when cut-off has NOT elapsed (skip date is far enough out)", async () => {
    setupHappyPath({ insertedException: insertedExceptionRow({ compensatingDate: "2026-07-01" }) });
    const ctx = ctxWith(["subscription:skip"]);
    const result = await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "skip",
        date: FUTURE_SKIP_DATE, // 2026-05-13, well past today
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { now: NOW },
    );
    expect(result.status).toBe("inserted");
  });
});

// -----------------------------------------------------------------------------
// Days-of-week eligibility
// -----------------------------------------------------------------------------

describe("addSubscriptionException — days-of-week eligibility", () => {
  it("rejects skip on a non-eligible weekday (Sat for Mon-Fri sub)", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ daysOfWeek: [1, 2, 3, 4, 5] })]);

    const ctx = ctxWith(["subscription:skip"]);
    // 2026-05-16 is a Saturday.
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "skip",
          date: "2026-05-16",
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/eligible delivery weekday/);
  });

  it("accepts skip on an eligible weekday", async () => {
    setupHappyPath({ insertedException: insertedExceptionRow({ compensatingDate: "2026-07-01" }) });
    const ctx = ctxWith(["subscription:skip"]);
    const result = await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "skip",
        date: FUTURE_SKIP_DATE, // Wednesday — eligible for Mon-Fri
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { now: NOW },
    );
    expect(result.status).toBe("inserted");
  });

  it("rejects address_override_one_off on a non-eligible weekday", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ daysOfWeek: [1, 2, 3, 4, 5] })]);
    // Block 4-E §B: cross-consignee ownership check fires BEFORE
    // days-of-week eligibility per the placement rule. The address
    // is owned (so the test still reaches the weekday rejection it
    // was designed to assert).
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]);

    const ctx = ctxWith(["subscription:change_address_one_off"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_one_off",
          date: "2026-05-16", // Saturday
          idempotencyKey: IDEMPOTENCY_KEY,
          addressOverrideId: ADDRESS_ID,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/eligible delivery weekday/);
  });

  it("accepts address_override_forward on a non-eligible weekday (forward exempts)", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ daysOfWeek: [1, 2, 3, 4, 5] })]);
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // Block 4-E §B ownership check
    mockExecute.mockResolvedValueOnce([]); // replay
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "address_override_forward",
        startDate: "2026-05-16",
        addressOverrideId: ADDRESS_ID,
      }),
    ]);
    mockExecute.mockResolvedValueOnce([]); // R5 markTasksAddressOverriddenForward — no in-horizon rows in unit fixtures

    const ctx = ctxWith(["subscription:change_address_forward"]);
    const result = await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "address_override_forward",
        date: "2026-05-16", // Saturday
        idempotencyKey: IDEMPOTENCY_KEY,
        addressOverrideId: ADDRESS_ID,
      },
      { now: NOW },
    );
    expect(result.status).toBe("inserted");
  });
});

// -----------------------------------------------------------------------------
// Idempotency
// -----------------------------------------------------------------------------

describe("addSubscriptionException — idempotency", () => {
  it("returns idempotent_replay (409) when key matches existing exception, no audit emit", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ compensatingDate: "2026-07-01" }),
    ]); // replay-hit

    const ctx = ctxWith(["subscription:skip"]);
    const result = await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "skip",
        date: FUTURE_SKIP_DATE,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { now: NOW },
    );

    expect(result.status).toBe("idempotent_replay");
    expect(result.httpStatus).toBe(409);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns inserted (201) on first call with a fresh idempotency_key", async () => {
    setupHappyPath({ insertedException: insertedExceptionRow({ compensatingDate: "2026-07-01" }) });
    const ctx = ctxWith(["subscription:skip"]);
    const result = await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "skip",
        date: FUTURE_SKIP_DATE,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { now: NOW },
    );
    expect(result.status).toBe("inserted");
    expect(result.httpStatus).toBe(201);
    expect(mockEmit).toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// Audit-event emission per type variant
// -----------------------------------------------------------------------------

describe("addSubscriptionException — audit emission per type", () => {
  it("'skip' default emits exception.created + end_date.extended with shared correlation_id", async () => {
    setupHappyPath({
      insertedException: insertedExceptionRow({ compensatingDate: "2026-07-01" }),
    });
    const ctx = ctxWith(["subscription:skip"]);
    await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "skip",
        date: FUTURE_SKIP_DATE,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      { now: NOW },
    );

    expect(mockEmit).toHaveBeenCalledTimes(2);
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain("subscription.exception.created");
    expect(eventTypes).toContain("subscription.end_date.extended");

    const correlationIds = mockEmit.mock.calls.map(
      (c) => (c[0] as { metadata: { correlation_id: string } }).metadata.correlation_id,
    );
    expect(correlationIds[0]).toBe(correlationIds[1]);
  });

  it("'skip' with skip_without_append emits ONLY exception.created (no end_date extension)", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ skipWithoutAppend: true, compensatingDate: null }),
    ]);
    mockExecute.mockResolvedValueOnce([
      { id: "00000000-0000-0000-0000-00000000ffff", external_tracking_number: null },
    ]); // UPDATE task SKIPPED — RETURNING per Day-29

    const ctx = ctxWith(["subscription:override_skip_rules"]);
    await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "skip",
        date: FUTURE_SKIP_DATE,
        idempotencyKey: IDEMPOTENCY_KEY,
        skipWithoutAppend: true,
      },
      { now: NOW },
    );

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect((mockEmit.mock.calls[0][0] as { eventType: string }).eventType).toBe(
      "subscription.exception.created",
    );
  });

  it("'address_override_one_off' emits exception.created + address_override.applied (no end_date)", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // Block 4-E §B ownership check
    mockExecute.mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "address_override_one_off",
        addressOverrideId: ADDRESS_ID,
      }),
    ]);
    mockExecute.mockResolvedValueOnce([]); // R4 markTaskAddressOverridden — unit fixture date unmaterialized

    const ctx = ctxWith(["subscription:change_address_one_off"]);
    await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "address_override_one_off",
        date: FUTURE_SKIP_DATE,
        idempotencyKey: IDEMPOTENCY_KEY,
        addressOverrideId: ADDRESS_ID,
      },
      { now: NOW },
    );

    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      "subscription.exception.created",
      "subscription.address_override.applied",
    ]);
  });

  it("'address_override_forward' emits exception.created + address_override.applied with scope='forward'", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([ownedAddressRow()]); // Block 4-E §B ownership check
    mockExecute.mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "address_override_forward",
        addressOverrideId: ADDRESS_ID,
      }),
    ]);
    mockExecute.mockResolvedValueOnce([]); // R5 markTasksAddressOverriddenForward — no in-horizon rows in unit fixtures

    const ctx = ctxWith(["subscription:change_address_forward"]);
    await addSubscriptionException(
      ctx,
      SUBSCRIPTION_ID,
      {
        type: "address_override_forward",
        date: FUTURE_SKIP_DATE,
        idempotencyKey: IDEMPOTENCY_KEY,
        addressOverrideId: ADDRESS_ID,
      },
      { now: NOW },
    );

    const overrideEmit = mockEmit.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "subscription.address_override.applied",
    )?.[0] as { metadata: { scope: string } } | undefined;
    expect(overrideEmit?.metadata.scope).toBe("forward");
  });

  it("address-override missing addressOverrideId throws ValidationError", async () => {
    const ctx = ctxWith(["subscription:change_address_one_off"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_one_off",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
          // addressOverrideId omitted
        },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // -------------------------------------------------------------------------
  // Block 4-E §B B1 — cross-consignee address ownership rejection
  // -------------------------------------------------------------------------
  // The shared findAddressForConsignee helper returns null when the
  // address row exists but belongs to another consignee in the same
  // tenant. Service A's address_override branches throw
  // ValidationError 'address_not_found_for_consignee' on null. RLS
  // does NOT catch cross-consignee within the same tenant; this is
  // the only defence.

  it("'address_override_one_off' rejects when addressOverrideId belongs to another consignee in the same tenant (§B B1)", async () => {
    mockExecute.mockReset();
    // Subscription belongs to CONSIGNEE_ID (default fixture).
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    // findAddressForConsignee returns [] — the address exists but
    // belongs to OTHER_CONSIGNEE_ID, so the SQL's
    // `consignee_id = $2` predicate filters it out.
    mockExecute.mockResolvedValueOnce([]);

    const ctx = ctxWith(["subscription:change_address_one_off"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_one_off",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
          addressOverrideId: ADDRESS_ID,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/address_not_found_for_consignee/);
    // No idempotency-replay query, no INSERT, no audit. Service
    // aborted at step 5b before reaching downstream steps.
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("'address_override_forward' rejects when addressOverrideId belongs to another consignee (§B B1)", async () => {
    mockExecute.mockReset();
    // Subscription owned by OTHER_CONSIGNEE_ID this time — ensures
    // the helper input uses the SUBSCRIPTION's consignee_id, not any
    // operator-supplied value (cross-spoof defence).
    mockExecute.mockResolvedValueOnce([
      subscriptionRow({ consigneeId: OTHER_CONSIGNEE_ID }),
    ]);
    // findAddressForConsignee returns [] — address belongs to a
    // third party (CONSIGNEE_ID, not OTHER_CONSIGNEE_ID).
    mockExecute.mockResolvedValueOnce([]);

    const ctx = ctxWith(["subscription:change_address_forward"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "address_override_forward",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
          addressOverrideId: ADDRESS_ID,
        },
        { now: NOW },
      ),
    ).rejects.toThrow(/address_not_found_for_consignee/);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// appendWithoutSkip
// -----------------------------------------------------------------------------

describe("appendWithoutSkip", () => {
  it("requires subscription:override_skip_rules — denies without it", async () => {
    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      appendWithoutSkip(
        ctx,
        SUBSCRIPTION_ID,
        { reason: "goodwill", idempotencyKey: IDEMPOTENCY_KEY },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires non-empty reason", async () => {
    const ctx = ctxWith(["subscription:override_skip_rules"]);
    await expect(
      appendWithoutSkip(
        ctx,
        SUBSCRIPTION_ID,
        { reason: "", idempotencyKey: IDEMPOTENCY_KEY },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("happy path — INSERT exception + UPDATE end_date + emits BOTH events with shared correlation_id", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // sub
    mockExecute.mockResolvedValueOnce([]); // replay
    mockExecute.mockResolvedValueOnce([]); // pause-windows
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "append_without_skip",
        startDate: "2026-07-01",
        compensatingDate: null,
      }),
    ]); // INSERT
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown); // UPDATE end_date

    const ctx = ctxWith(["subscription:override_skip_rules"]);
    const result = await appendWithoutSkip(
      ctx,
      SUBSCRIPTION_ID,
      { reason: "complaint resolution", idempotencyKey: IDEMPOTENCY_KEY },
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    expect(result.newEndDate).toBe("2026-07-01");

    expect(mockEmit).toHaveBeenCalledTimes(2);
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([
      "subscription.exception.created",
      "subscription.end_date.extended",
    ]);
    const correlationIds = mockEmit.mock.calls.map(
      (c) => (c[0] as { metadata: { correlation_id: string } }).metadata.correlation_id,
    );
    expect(correlationIds[0]).toBe(correlationIds[1]);

    // The end_date.extended event metadata should mark triggered_by='append_without_skip'.
    const endDateEmit = mockEmit.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === "subscription.end_date.extended",
    )?.[0] as { metadata: { triggered_by: string } } | undefined;
    expect(endDateEmit?.metadata.triggered_by).toBe("append_without_skip");
  });

  it("idempotent replay returns 409 with existing exception_id, no audit emit", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        type: "append_without_skip",
        startDate: "2026-07-01",
      }),
    ]); // replay-hit

    const ctx = ctxWith(["subscription:override_skip_rules"]);
    const result = await appendWithoutSkip(
      ctx,
      SUBSCRIPTION_ID,
      { reason: "complaint", idempotencyKey: IDEMPOTENCY_KEY },
      { now: NOW },
    );

    expect(result.status).toBe("idempotent_replay");
    expect(result.httpStatus).toBe(409);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects when subscription is paused", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ status: "paused" })]);

    const ctx = ctxWith(["subscription:override_skip_rules"]);
    await expect(
      appendWithoutSkip(
        ctx,
        SUBSCRIPTION_ID,
        { reason: "complaint", idempotencyKey: IDEMPOTENCY_KEY },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// -----------------------------------------------------------------------------
// Subscription with no end_date — skip flow rejects (cannot extend null end_date)
// -----------------------------------------------------------------------------

describe("addSubscriptionException — open-ended subscription (end_date IS NULL)", () => {
  it("default skip on a subscription with no end_date throws ConflictError", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ endDate: null })]);
    mockExecute.mockResolvedValueOnce([]); // replay
    mockExecute.mockResolvedValueOnce([]); // pause-windows

    const ctx = ctxWith(["subscription:skip"]);
    await expect(
      addSubscriptionException(
        ctx,
        SUBSCRIPTION_ID,
        {
          type: "skip",
          date: FUTURE_SKIP_DATE,
          idempotencyKey: IDEMPOTENCY_KEY,
        },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ===========================================================================
// D56 / Phase-5 — move-to-date: cancel the original on SF AND materialize a
// real one-off task at the target date (Love: "build them properly, do not
// paper over it"). Plus the cancel sweep for the other skip variants.
// ===========================================================================
//
// Move-to-date moves a delivery to a date BEYOND the schedule end. Within-
// schedule targets already deliver, so they are REJECTED at the service layer
// (Love's ruling) rather than silently no-op'd. The valid (beyond-end_date)
// case: skip-cancel the original (cancel on SF if pushed) AND materialize +
// push one fresh task at the target — so SF holds exactly ONE delivery.

describe("addSubscriptionException — move-to-date create-side (D56)", () => {
  const PUSHED_AWB = "MLU-21789001";
  const ORIGINAL_TASK_ID = "00000000-0000-0000-0000-00000000ffff";
  const MOVED_TASK_ID = "00000000-0000-0000-0000-00000000a1a1" as Uuid;
  const BEYOND_END_TARGET = "2026-07-06"; // Monday, > default end_date 2026-06-30
  const WITHIN_END_TARGET = "2026-06-15"; // Monday, <= default end_date 2026-06-30

  // markTaskSkipped's UPDATE ... RETURNING row. external_tracking_number is the
  // original's AWB when pushed; null when materialized-but-not-pushed.
  function skippedTaskRow(awb: string | null) {
    return [{ id: ORIGINAL_TASK_ID, external_tracking_number: awb }];
  }

  // Wire the 4 execute calls of a valid move-to-date: sub, replay, INSERT,
  // markTaskSkipped. (No end_date UPDATE; the one-off materializer is mocked.)
  function setupMoveToDate(opts: { endDate?: string | null; skippedAwb: string | null }) {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([
      subscriptionRow("endDate" in opts ? { endDate: opts.endDate } : {}),
    ]);
    mockExecute.mockResolvedValueOnce([]); // replay none
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({
        compensatingDate: BEYOND_END_TARGET,
        targetDateOverride: BEYOND_END_TARGET,
      }),
    ]);
    mockExecute.mockResolvedValueOnce(skippedTaskRow(opts.skippedAwb));
  }

  it("beyond-end_date on a pushed original: creates exactly ONE task at target, cancels the original AWB, pushes the moved task", async () => {
    setupMoveToDate({ skippedAwb: PUSHED_AWB });
    mockMaterializeOneOff.mockResolvedValueOnce({
      insertedTaskId: MOVED_TASK_ID,
      addressResolutionFailed: false,
    });

    const result = await addSubscriptionException(
      ctxWith(["subscription:override_skip_rules"]),
      SUBSCRIPTION_ID,
      { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, targetDateOverride: BEYOND_END_TARGET },
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    // exactly one task materialized at the target date
    expect(mockMaterializeOneOff).toHaveBeenCalledTimes(1);
    expect(mockMaterializeOneOff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ subscriptionId: SUBSCRIPTION_ID, date: BEYOND_END_TARGET }),
    );
    // original cancelled on SF
    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
    expect(mockEnqueueCancel).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: ORIGINAL_TASK_ID, awb: PUSHED_AWB }),
    );
    // moved task pushed (standard pipeline)
    expect(mockEnqueuePush).toHaveBeenCalledTimes(1);
    expect(mockEnqueuePush).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, taskIds: [MOVED_TASK_ID] }),
    );
  });

  it("beyond-end_date does NOT extend end_date and does NOT fan out (no end_date.extended event)", async () => {
    setupMoveToDate({ skippedAwb: PUSHED_AWB });
    mockMaterializeOneOff.mockResolvedValueOnce({
      insertedTaskId: MOVED_TASK_ID,
      addressResolutionFailed: false,
    });

    const result = await addSubscriptionException(
      ctxWith(["subscription:override_skip_rules"]),
      SUBSCRIPTION_ID,
      { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, targetDateOverride: BEYOND_END_TARGET },
      { now: NOW },
    );

    expect(result.newEndDate).toBeNull();
    const eventTypes = mockEmit.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).not.toContain("subscription.end_date.extended");
    // single one-off materialization (not a range/fan-out)
    expect(mockMaterializeOneOff).toHaveBeenCalledTimes(1);
  });

  it("unpushed original (no AWB): no SF cancel, but the moved task is still created and pushed", async () => {
    setupMoveToDate({ skippedAwb: null });
    mockMaterializeOneOff.mockResolvedValueOnce({
      insertedTaskId: MOVED_TASK_ID,
      addressResolutionFailed: false,
    });

    const result = await addSubscriptionException(
      ctxWith(["subscription:override_skip_rules"]),
      SUBSCRIPTION_ID,
      { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, targetDateOverride: BEYOND_END_TARGET },
      { now: NOW },
    );

    expect(result.status).toBe("inserted");
    expect(mockEnqueueCancel).not.toHaveBeenCalled();
    expect(mockMaterializeOneOff).toHaveBeenCalledTimes(1);
    expect(mockEnqueuePush).toHaveBeenCalledWith(
      expect.objectContaining({ taskIds: [MOVED_TASK_ID] }),
    );
  });

  it("within-schedule target on a bounded subscription (<= end_date) is rejected — no exception, no cancel, no materialize", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // sub (end_date 2026-06-30)
    mockExecute.mockResolvedValueOnce([]); // replay none

    await expect(
      addSubscriptionException(
        ctxWith(["subscription:override_skip_rules"]),
        SUBSCRIPTION_ID,
        { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, targetDateOverride: WITHIN_END_TARGET },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(mockMaterializeOneOff).not.toHaveBeenCalled();
    expect(mockEnqueueCancel).not.toHaveBeenCalled();
    expect(mockEnqueuePush).not.toHaveBeenCalled();
  });

  it("any eligible target on an open-ended subscription (end_date IS NULL) is rejected — every day already delivers", async () => {
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow({ endDate: null })]); // open-ended
    mockExecute.mockResolvedValueOnce([]); // replay none

    await expect(
      addSubscriptionException(
        ctxWith(["subscription:override_skip_rules"]),
        SUBSCRIPTION_ID,
        { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, targetDateOverride: BEYOND_END_TARGET },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(mockMaterializeOneOff).not.toHaveBeenCalled();
    expect(mockEnqueueCancel).not.toHaveBeenCalled();
    expect(mockEnqueuePush).not.toHaveBeenCalled();
  });

  it("address-gap at target (resolution failed) rolls back atomically — no SF cancel, no push", async () => {
    setupMoveToDate({ skippedAwb: PUSHED_AWB });
    mockMaterializeOneOff.mockResolvedValueOnce({
      insertedTaskId: null,
      addressResolutionFailed: true,
    });

    await expect(
      addSubscriptionException(
        ctxWith(["subscription:override_skip_rules"]),
        SUBSCRIPTION_ID,
        { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, targetDateOverride: BEYOND_END_TARGET },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // tx rolled back: post-commit cancel + push never run
    expect(mockEnqueueCancel).not.toHaveBeenCalled();
    expect(mockEnqueuePush).not.toHaveBeenCalled();
  });
});

describe("addSubscriptionException — outbound cancel sweep (default skip / skip-without-append)", () => {
  const PUSHED_AWB = "MLU-21789002";
  const ORIGINAL_TASK_ID = "00000000-0000-0000-0000-00000000ffff";

  function skippedTaskRow(awb: string | null) {
    return [{ id: ORIGINAL_TASK_ID, external_tracking_number: awb }];
  }

  it("default skip cancels a pushed original on SF", async () => {
    // sequence: sub, replay, pause-windows, INSERT, UPDATE end_date, markTaskSkipped
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce([]); // pause-windows
    mockExecute.mockResolvedValueOnce([insertedExceptionRow({ compensatingDate: "2026-07-01" })]);
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);
    mockExecute.mockResolvedValueOnce(skippedTaskRow(PUSHED_AWB));

    await addSubscriptionException(
      ctxWith(["subscription:skip"]),
      SUBSCRIPTION_ID,
      { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY },
      { now: NOW },
    );

    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
    expect(mockEnqueueCancel).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: ORIGINAL_TASK_ID, awb: PUSHED_AWB }),
    );
  });

  it("skip-without-append cancels a pushed original on SF", async () => {
    // sequence: sub, replay, INSERT, markTaskSkipped (no pause-windows, no end_date)
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]);
    mockExecute.mockResolvedValueOnce([]);
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ skipWithoutAppend: true, compensatingDate: null }),
    ]);
    mockExecute.mockResolvedValueOnce(skippedTaskRow(PUSHED_AWB));

    await addSubscriptionException(
      ctxWith(["subscription:override_skip_rules"]),
      SUBSCRIPTION_ID,
      { type: "skip", date: FUTURE_SKIP_DATE, idempotencyKey: IDEMPOTENCY_KEY, skipWithoutAppend: true },
      { now: NOW },
    );

    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
    expect(mockEnqueueCancel).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: ORIGINAL_TASK_ID, awb: PUSHED_AWB }),
    );
  });
});

// ===========================================================================
// getRecentExceptionsForSubscription — Day 22 / §3.3.5 reader
// ===========================================================================

describe("getRecentExceptionsForSubscription", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  function exceptionRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "00000000-0000-0000-0000-000000000ce1",
      subscription_id: SUBSCRIPTION_ID,
      tenant_id: TENANT_ID,
      type: "skip",
      start_date: "2026-05-18",
      end_date: null,
      target_date_override: null,
      skip_without_append: false,
      reason: null,
      address_override_id: null,
      compensating_date: "2026-06-01",
      correlation_id: "00000000-0000-0000-0000-000000000c01",
      idempotency_key: "00000000-0000-0000-0000-000000000c02",
      created_by: USER_ID,
      created_at: "2026-05-11T12:00:00.000Z",
      ...overrides,
    };
  }

  it("throws ForbiddenError when actor lacks subscription:read", async () => {
    await expect(
      getRecentExceptionsForSubscription(ctxWith([]), SUBSCRIPTION_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns mapped exceptions newest-first (descending by created_at)", async () => {
    mockExecute.mockResolvedValueOnce([
      exceptionRow({ id: "row-2", created_at: "2026-05-11T12:00:00.000Z" }),
      exceptionRow({ id: "row-1", created_at: "2026-05-10T08:00:00.000Z" }),
    ]);

    const result = await getRecentExceptionsForSubscription(
      ctxWith(["subscription:read"]),
      SUBSCRIPTION_ID,
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("row-2");
    expect(result[1].id).toBe("row-1");
  });

  it("scopes the SQL to (tenant_id, subscription_id) with ORDER BY created_at DESC + LIMIT 10 by default", async () => {
    mockExecute.mockResolvedValueOnce([]);

    await getRecentExceptionsForSubscription(
      ctxWith(["subscription:read"]),
      SUBSCRIPTION_ID,
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    // mockExecute is invoked with the drizzle SQL object — we cannot
    // string-equal it, but the count + return-empty path proves the
    // service plumbed through. SQL-shape (tenant + sub predicates,
    // ORDER, LIMIT clamp) is anchored in the repository unit test.
  });

  it("returns an empty array when the subscription has no exception rows yet", async () => {
    mockExecute.mockResolvedValueOnce([]);
    const result = await getRecentExceptionsForSubscription(
      ctxWith(["subscription:read"]),
      SUBSCRIPTION_ID,
    );
    expect(result).toEqual([]);
  });

  it("does not emit an audit event (read path is not audited per R-4)", async () => {
    mockExecute.mockResolvedValueOnce([exceptionRow()]);
    mockEmit.mockClear();
    await getRecentExceptionsForSubscription(
      ctxWith(["subscription:read"]),
      SUBSCRIPTION_ID,
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
