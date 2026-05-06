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

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import {
  addSubscriptionException,
  appendWithoutSkip,
} from "../service";
import type { AddSubscriptionExceptionInput } from "../types";

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
  // 7. (skip flow) UPDATE tasks
  // For the happy path mocks, we add two more no-op responses; not all
  // type variants reach both, but extras are harmless.
  mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);
  mockExecute.mockResolvedValueOnce({ count: opts?.skippedTaskRows ?? 1 } as unknown);
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
    // Service order for target_date_override path post-fix:
    // [sub, replay, INSERT, UPDATE end_date, UPDATE task].
    // Collision-check call was removed from service.ts per Block 4-B
    // fix-2 routing — cron handles override-date tagging on next tick.
    mockExecute.mockReset();
    mockExecute.mockResolvedValueOnce([subscriptionRow()]); // 1. sub
    mockExecute.mockResolvedValueOnce([]); // 2. replay none
    mockExecute.mockResolvedValueOnce([
      insertedExceptionRow({ compensatingDate: "2026-07-06", targetDateOverride: "2026-07-06" }),
    ]); // 3. INSERT
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown); // 4. UPDATE end_date
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown); // 5. UPDATE task SKIPPED

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
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown); // 4. UPDATE task SKIPPED

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
    mockExecute.mockResolvedValueOnce({ count: 1 } as unknown);

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
