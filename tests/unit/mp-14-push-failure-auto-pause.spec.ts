// tests/unit/mp-14-push-failure-auto-pause.spec.ts
//
// Day 7 / C-7. MP-14 named test — rule coverage marker for CI.
//
// MP-14 RULE (per plan-resolutions.docx §3 Day 7 row + Day-7 brief §3 C-7):
//   "When a subscription's pushed task fails N times (N=3 in pilot),
//    the subscription auto-pauses with audit emit
//    `subscription.auto_paused` (new event, systemOnly: true,
//    metadata: subscription_id, failure_count, last_error)."
//
// Implementation status (2 May 2026):
// =============================================================================
// FULLY IMPLEMENTED today by `autoPauseSubscriptionForRepeatedFailure`
// in src/modules/subscriptions/service.ts. Unlike MP-13, MP-14 has no
// schema gap — the new event type is added to the catalogue
// (src/modules/audit/event-types.ts), the service method is wired,
// and idempotency is preserved.
//
// What MP-14 does NOT include in C-7:
//   • The CALLER of autoPauseSubscriptionForRepeatedFailure does not
//     yet exist. The cron's failed-push retry path (Day-8 / C-3) is
//     where the threshold-detection-and-trigger logic lives. Until
//     C-3 ships, the service method is "armed but unfired" — the
//     audit event vocabulary, service surface, and named test are all
//     in place; only the trigger that calls into it is pending.
//   • That separation is deliberate. C-7 ships the rule + its name;
//     C-3 wires the trigger. Either one can land first; both must
//     land for the rule to fire end-to-end in production.
//
// What this test pins:
//   • Path 1 — happy path: active subscription receives the auto-pause
//     trigger, transitions to paused, emits subscription.auto_paused
//     with full metadata.
//   • Path 2 — idempotent no-op on already-paused subscription: no
//     state transition, no audit emit.
//   • Path 3 — idempotent no-op on ended subscription: no state
//     transition, no audit emit.
//   • Path 4 — NotFoundError when subscription does not exist (and
//     does NOT audit).
//   • Path 5 — ForbiddenError when caller is a user actor (system-
//     only path; the audit catalogue marks the event systemOnly).
//   • Path 6 — emit metadata carries the right shape per the
//     catalogue's metadataNotes (subscription_id, task_id,
//     failure_count, last_error).
//
// Why a named test file:
//   Same reason as MP-13 — CI output shows rule coverage by name. A
//   reviewer can grep for "MP-14" and see immediately whether the
//   rule is covered. The named file pattern survives refactors that
//   would scatter assertions across multiple service specs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../src/modules/audit", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/modules/audit")>("../../src/modules/audit");
  return {
    ...actual,
    emit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../src/modules/subscriptions/repository", () => ({
  insertSubscription: vi.fn(),
  findSubscriptionById: vi.fn(),
  listSubscriptionsByTenant: vi.fn(),
  updateSubscription: vi.fn(),
  pauseSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  endSubscription: vi.fn(),
}));

vi.mock("../../src/shared/logger", () => {
  const child = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: { ...child, with: () => child } };
});

vi.mock("../../src/shared/sentry-capture", () => ({
  captureException: vi.fn(),
}));

import { withServiceRole } from "../../src/shared/db";
import { ConflictError, ForbiddenError, NotFoundError } from "../../src/shared/errors";
import { emit } from "../../src/modules/audit";
import {
  findSubscriptionById,
  pauseSubscription as pauseSubscriptionRow,
} from "../../src/modules/subscriptions/repository";
import { autoPauseSubscriptionForRepeatedFailure } from "../../src/modules/subscriptions";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";
import type {
  Subscription,
  SubscriptionStatus,
  SubscriptionUpdate,
} from "../../src/modules/subscriptions";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockFindById = vi.mocked(findSubscriptionById);
const mockPauseRow = vi.mocked(pauseSubscriptionRow);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const SUBSCRIPTION_ID = "11111111-1111-1111-1111-111111111111";
const TASK_ID = "22222222-2222-2222-2222-222222222222";
const FAILURE_COUNT = 3;
const LAST_ERROR = "HTTP 503 from SuiteFleet (truncated)";

function systemCtx(): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:generate_tasks",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: "mp-14-test-request",
    path: "/cron/auto-pause",
  };
}

function userCtx(): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: "00000000-0000-0000-0000-000000000001",
    tenantId: TENANT_ID,
    permissions: new Set(),
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: "mp-14-test-request",
    path: "/api/x",
  };
}

function subscriptionFixture(status: SubscriptionStatus = "active"): Subscription {
  return {
    id: SUBSCRIPTION_ID,
    tenantId: TENANT_ID,
    consigneeId: "33333333-3333-3333-3333-333333333333",
    status,
    startDate: "2026-05-01",
    endDate: null,
    daysOfWeek: [1, 3, 5],
    deliveryWindowStart: "14:00:00",
    deliveryWindowEnd: "16:00:00",
    deliveryAddressOverride: null,
    mealPlanName: null,
    externalRef: null,
    notesInternal: null,
    pausedAt: status === "paused" ? "2026-05-02T00:00:00.000Z" : null,
    endedAt: status === "ended" ? "2026-05-02T00:00:00.000Z" : null,
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
  };
}

function pauseTransition(): SubscriptionUpdate {
  const before = subscriptionFixture("active");
  const after = subscriptionFixture("paused");
  return { before, after };
}

const AUTO_PAUSE_INPUT = {
  subscriptionId: SUBSCRIPTION_ID,
  taskId: TASK_ID,
  failureCount: FAILURE_COUNT,
  lastError: LAST_ERROR,
};

describe("MP-14 — push-failure auto-pause (FULLY IMPLEMENTED; cron caller is Day-8/C-3)", () => {
  beforeEach(() => {
    // withServiceRole stub runs the callback with a no-op tx — repo
    // functions are themselves mocked.
    mockWithServiceRole.mockImplementation(async (_reason, fn) => fn({} as never));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Path 1 — active subscription transitions to paused and emits subscription.auto_paused", async () => {
    mockFindById.mockResolvedValue(subscriptionFixture("active"));
    mockPauseRow.mockResolvedValue(pauseTransition());

    const result = await autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT);

    expect(result.status).toBe("paused");
    expect(mockPauseRow).toHaveBeenCalledOnce();
    expect(mockEmit).toHaveBeenCalledOnce();

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("subscription.auto_paused");
    expect(emitArg.actorKind).toBe("system");
    expect(emitArg.actorId).toBe("cron:generate_tasks");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("subscription");
    expect(emitArg.resourceId).toBe(SUBSCRIPTION_ID);
    expect(emitArg.metadata).toEqual({
      subscription_id: SUBSCRIPTION_ID,
      task_id: TASK_ID,
      failure_count: FAILURE_COUNT,
      last_error: LAST_ERROR,
    });
  });

  it("Path 2 — idempotent: already-paused subscription is a no-op (no transition, no emit)", async () => {
    mockFindById.mockResolvedValue(subscriptionFixture("paused"));

    const result = await autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT);

    expect(result.status).toBe("paused");
    expect(mockPauseRow).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("Path 3 — idempotent: ended subscription is a no-op (no transition, no emit)", async () => {
    mockFindById.mockResolvedValue(subscriptionFixture("ended"));

    const result = await autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT);

    expect(result.status).toBe("ended");
    expect(mockPauseRow).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("Path 4 — throws NotFoundError when subscription does not exist (and does NOT audit)", async () => {
    mockFindById.mockResolvedValue(null);

    await expect(
      autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockPauseRow).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("Path 5 — throws ForbiddenError when caller is a user actor (system-only)", async () => {
    await expect(
      autoPauseSubscriptionForRepeatedFailure(userCtx(), AUTO_PAUSE_INPUT),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockPauseRow).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("Path 6 — race-safe: row vanishes between pre-check and pause → NotFoundError", async () => {
    // Pre-check returns active; pauseRow returns null (row was paused
    // or deleted by another writer between the SELECT and the UPDATE
    // FOR UPDATE inside the same withServiceRole tx). Service must
    // surface this as NotFoundError, not silently succeed.
    mockFindById.mockResolvedValue(subscriptionFixture("active"));
    mockPauseRow.mockResolvedValue(null);

    await expect(
      autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("Path 7 — race-loser: concurrent invocation hits ConflictError → no-op, no audit emit", async () => {
    // Concurrent T1/T2 scenario: both pre-checks see active. T1 wins
    // the SELECT FOR UPDATE inside pauseRow, transitions to paused,
    // emits the event. T2 acquires the lock after T1 commits, the
    // repository's status re-check sees paused, throws ConflictError.
    // Service must catch it, refetch the now-paused row, return it as
    // a no-op WITHOUT a second audit emit.
    //
    // Test simulation:
    //   - First withServiceRole call (the project+pause tx): runs the
    //     callback which calls findSubscriptionById (active) then
    //     pauseRow (throws ConflictError).
    //   - Second withServiceRole call (the refetch): runs the callback
    //     which calls findSubscriptionById and returns the paused row.
    mockFindById
      .mockResolvedValueOnce(subscriptionFixture("active"))   // pre-check inside the tx
      .mockResolvedValueOnce(subscriptionFixture("paused"));  // refetch after ConflictError
    mockPauseRow.mockImplementation(async () => {
      throw new ConflictError(
        `Cannot pause subscription ${SUBSCRIPTION_ID}: status is 'paused', expected 'active'`,
      );
    });

    const result = await autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT);

    // Returns the now-paused row as a no-op — caller can't tell whether
    // it won or lost the race; both outcomes look identical from the
    // cron's perspective (subscription is paused, no error).
    expect(result.status).toBe("paused");
    // Audit event MUST NOT fire on the race-loser path. T1's emit is
    // the canonical record of this auto-pause; T2 emitting again would
    // duplicate the event with a stale failure_count + last_error from
    // T2's input that doesn't reflect the actual triggering failure.
    expect(mockEmit).not.toHaveBeenCalled();
    // Second withServiceRole call (the refetch) must have happened.
    expect(mockWithServiceRole).toHaveBeenCalledTimes(2);
  });

  it("Path 8 — ConflictError + refetch returns null (vanished) → original ConflictError surfaces", async () => {
    // Edge case for the race-loser path: T1 paused successfully, then
    // an admin / future delete-subscription path removed the row, and
    // T2's refetch finds nothing. We can't fabricate state, so the
    // original ConflictError surfaces instead of a fake NotFoundError
    // or a synthesised paused row.
    mockFindById
      .mockResolvedValueOnce(subscriptionFixture("active"))
      .mockResolvedValueOnce(null);
    mockPauseRow.mockImplementation(async () => {
      throw new ConflictError("race-loser path");
    });

    await expect(
      autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("ignores cross-tenant access via system actor (returns NotFoundError, not the wrong tenant's row)", async () => {
    // System actor's ctx.tenantId differs from the looked-up
    // subscription's tenantId. This shouldn't normally happen — the
    // cron's per-tenant loop binds tenantId per iteration — but if
    // it does, the service must surface it as not-found rather than
    // pause a subscription owned by another tenant.
    const fixture = subscriptionFixture("active");
    mockFindById.mockResolvedValue({
      ...fixture,
      tenantId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    });

    await expect(
      autoPauseSubscriptionForRepeatedFailure(systemCtx(), AUTO_PAUSE_INPUT),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockPauseRow).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
