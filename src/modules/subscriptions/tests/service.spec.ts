// Subscription service-layer unit tests — Day 6 / S-4.
//
// Mocks ../../shared/db (withTenant) and ../audit (emit) so we exercise
// permission, tenant-context, validation, lifecycle transitions, and
// audit-emit flow without real Postgres or audit infra. Repository
// functions are mocked at the source-module boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../../audit", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", () => ({
  insertSubscription: vi.fn(),
  findSubscriptionById: vi.fn(),
  listSubscriptionsByTenant: vi.fn(),
  listSweepCandidates: vi.fn(),
  updateSubscription: vi.fn(),
  endSubscription: vi.fn(),
}));

import { withServiceRole, withTenant } from "../../../shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";

import {
  endSubscription as endSubscriptionRow,
  findSubscriptionById,
  insertSubscription,
  listSubscriptionsByTenant,
  listSweepCandidates,
  updateSubscription as updateSubscriptionRow,
} from "../repository";
import {
  createSubscription,
  endSubscription,
  getSubscription,
  listSubscriptions,
  sweepEndedSubscriptions,
  updateSubscription,
} from "../service";
import type { Subscription, SubscriptionUpdate } from "../types";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockInsert = vi.mocked(insertSubscription);
const mockFindById = vi.mocked(findSubscriptionById);
const mockListByTenant = vi.mocked(listSubscriptionsByTenant);
const mockListSweepCandidates = vi.mocked(listSweepCandidates);
const mockUpdate = vi.mocked(updateSubscriptionRow);
const mockEnd = vi.mocked(endSubscriptionRow);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const SUB_ID = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const FIXED_NOW = "2026-05-01T10:00:00.000Z";

function ctx(perms: readonly Permission[], tenantId: string | null = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/api/subscriptions",
  };
}

function subFixture(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: SUB_ID,
    tenantId: TENANT_ID,
    consigneeId: CONSIGNEE_ID,
    status: "active",
    startDate: "2026-05-01",
    endDate: null,
    daysOfWeek: [1, 3, 5],
    deliveryWindowStart: "14:00:00",
    deliveryWindowEnd: "16:00:00",
    deliveryAddressOverride: null,
    mealPlanName: null,
    externalRef: null,
    notesInternal: null,
    pausedAt: null,
    endedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeUpdate(before: Subscription, after: Subscription): SubscriptionUpdate {
  return { before, after };
}

beforeEach(() => {
  mockWithTenant.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockInsert.mockReset();
  mockFindById.mockReset();
  mockListByTenant.mockReset();
  mockUpdate.mockReset();
  mockEnd.mockReset();
  // Default: withTenant runs its callback against an opaque tx stub.
  // Tests that need specific repo behaviour set it via the repo mocks.
  mockWithTenant.mockImplementation(async (_tenantId, fn) => {
    return fn({} as never);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const validCreateInput = {
  consigneeId: CONSIGNEE_ID,
  startDate: "2026-05-01",
  daysOfWeek: [1, 3, 5] as const,
  deliveryWindowStart: "14:00:00",
  deliveryWindowEnd: "16:00:00",
};

// -----------------------------------------------------------------------------
// createSubscription
// -----------------------------------------------------------------------------

describe("createSubscription", () => {
  it("throws ForbiddenError when actor lacks subscription:create", async () => {
    await expect(createSubscription(ctx([]), validCreateInput)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      createSubscription(ctx(["subscription:create"], null), validCreateInput)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("throws ValidationError when daysOfWeek is empty", async () => {
    await expect(
      createSubscription(ctx(["subscription:create"]), { ...validCreateInput, daysOfWeek: [] })
    ).rejects.toThrow(/at least one weekday/);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("throws ValidationError when daysOfWeek contains an out-of-range value", async () => {
    await expect(
      createSubscription(ctx(["subscription:create"]), { ...validCreateInput, daysOfWeek: [0, 1] })
    ).rejects.toThrow(/integers 1–7/);
    await expect(
      createSubscription(ctx(["subscription:create"]), { ...validCreateInput, daysOfWeek: [1, 8] })
    ).rejects.toThrow(/integers 1–7/);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws ValidationError when a required string is whitespace-only", async () => {
    await expect(
      createSubscription(ctx(["subscription:create"]), {
        ...validCreateInput,
        startDate: "   ",
      })
    ).rejects.toThrow(/startDate is required/);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("collapses empty/whitespace nullable strings to null on insert", async () => {
    const fixture = subFixture();
    mockInsert.mockResolvedValue(fixture);

    await createSubscription(ctx(["subscription:create"]), {
      ...validCreateInput,
      mealPlanName: "  ",
      externalRef: "",
      notesInternal: "trimmed value  ",
    });

    expect(mockInsert).toHaveBeenCalledOnce();
    const insertArg = mockInsert.mock.calls[0][2];
    expect(insertArg.mealPlanName).toBeNull();
    expect(insertArg.externalRef).toBeNull();
    expect(insertArg.notesInternal).toBe("trimmed value");
  });

  it("inserts and emits subscription.created with full metadata payload", async () => {
    const fixture = subFixture();
    mockInsert.mockResolvedValue(fixture);

    const result = await createSubscription(ctx(["subscription:create"]), validCreateInput);

    expect(result).toEqual(fixture);
    expect(mockInsert).toHaveBeenCalledOnce();

    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("subscription.created");
    expect(emitArg.tenantId).toBe(TENANT_ID);
    expect(emitArg.resourceType).toBe("subscription");
    expect(emitArg.resourceId).toBe(SUB_ID);
    expect(emitArg.metadata).toEqual({
      subscription_id: SUB_ID,
      consignee_id: CONSIGNEE_ID,
      start_date: "2026-05-01",
      days_of_week: [1, 3, 5],
    });
  });
});

// -----------------------------------------------------------------------------
// reads — getSubscription / listSubscriptions
// -----------------------------------------------------------------------------

describe("getSubscription", () => {
  it("throws ForbiddenError when actor lacks subscription:read", async () => {
    await expect(getSubscription(ctx([]), SUB_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      getSubscription(ctx(["subscription:read"], null), SUB_ID)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns the row from the repository, no audit", async () => {
    const fixture = subFixture();
    mockFindById.mockResolvedValue(fixture);
    const result = await getSubscription(ctx(["subscription:read"]), SUB_ID);
    expect(result).toEqual(fixture);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("returns null when the repository returns null", async () => {
    mockFindById.mockResolvedValue(null);
    const result = await getSubscription(ctx(["subscription:read"]), SUB_ID);
    expect(result).toBeNull();
  });
});

describe("listSubscriptions", () => {
  it("throws ForbiddenError when actor lacks subscription:read", async () => {
    await expect(listSubscriptions(ctx([]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(listSubscriptions(ctx(["subscription:read"], null))).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("returns rows from the repository, no audit", async () => {
    const rows = [subFixture({ id: "row-1" }), subFixture({ id: "row-2" })];
    mockListByTenant.mockResolvedValue(rows);
    const result = await listSubscriptions(ctx(["subscription:read"]));
    expect(result).toEqual(rows);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// updateSubscription
// -----------------------------------------------------------------------------

describe("updateSubscription", () => {
  it("throws ForbiddenError when actor lacks subscription:update", async () => {
    await expect(
      updateSubscription(ctx([]), SUB_ID, { mealPlanName: "x" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      updateSubscription(ctx(["subscription:update"], null), SUB_ID, { mealPlanName: "x" })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when daysOfWeek in patch is empty", async () => {
    await expect(
      updateSubscription(ctx(["subscription:update"]), SUB_ID, { daysOfWeek: [] })
    ).rejects.toThrow(/at least one weekday/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws ValidationError when daysOfWeek in patch is out of range", async () => {
    await expect(
      updateSubscription(ctx(["subscription:update"]), SUB_ID, { daysOfWeek: [9] })
    ).rejects.toThrow(/integers 1–7/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the repository returns null", async () => {
    mockUpdate.mockResolvedValue(null);
    await expect(
      updateSubscription(ctx(["subscription:update"]), SUB_ID, { mealPlanName: "x" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("skips the audit emit when before === after referentially (empty-patch short-circuit)", async () => {
    // The repo's empty-patch branch returns the SAME object reference
    // for before and after. Service must detect this and skip the emit.
    const before = subFixture();
    mockUpdate.mockResolvedValue({ before, after: before });

    const result = await updateSubscription(ctx(["subscription:update"]), SUB_ID, {});

    expect(result).toBe(before);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("skips the audit emit when patch values match current row (no-op edit)", async () => {
    // Non-empty patch where every field happens to equal the current
    // value. Repo issues UPDATE … RETURNING * so before/after are
    // distinct objects. Service must diff and detect no actual change.
    const before = subFixture({ mealPlanName: "Diet" });
    const after = subFixture({ mealPlanName: "Diet" });
    mockUpdate.mockResolvedValue({ before, after });

    const result = await updateSubscription(ctx(["subscription:update"]), SUB_ID, {
      mealPlanName: "Diet",
    });

    expect(result).toEqual(after);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("emits subscription.updated with the diff'd changed_fields when scalar fields change", async () => {
    const before = subFixture({ mealPlanName: "Old", deliveryWindowEnd: "16:00:00" });
    const after = subFixture({ mealPlanName: "New", deliveryWindowEnd: "17:00:00" });
    mockUpdate.mockResolvedValue({ before, after });

    await updateSubscription(ctx(["subscription:update"]), SUB_ID, {
      mealPlanName: "New",
      deliveryWindowEnd: "17:00:00",
    });

    expect(mockEmit).toHaveBeenCalledOnce();
    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("subscription.updated");
    expect(emitArg.resourceId).toBe(SUB_ID);
    expect(emitArg.metadata).toEqual({
      changed_fields: ["deliveryWindowEnd", "mealPlanName"],
    });
  });

  it("detects daysOfWeek diff (array element-wise comparison)", async () => {
    const before = subFixture({ daysOfWeek: [1, 3, 5] });
    const after = subFixture({ daysOfWeek: [1, 3, 5, 7] });
    mockUpdate.mockResolvedValue({ before, after });

    await updateSubscription(ctx(["subscription:update"]), SUB_ID, {
      daysOfWeek: [1, 3, 5, 7],
    });

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toEqual({ changed_fields: ["daysOfWeek"] });
  });

  it("collapses empty/whitespace nullable patch values to null", async () => {
    const before = subFixture({ notesInternal: "old note" });
    const after = subFixture({ notesInternal: null });
    mockUpdate.mockResolvedValue({ before, after });

    await updateSubscription(ctx(["subscription:update"]), SUB_ID, {
      notesInternal: "   ",
    });

    expect(mockUpdate).toHaveBeenCalledOnce();
    const patchArg = mockUpdate.mock.calls[0][3];
    expect(patchArg.notesInternal).toBeNull();
  });
});

// pauseSubscription + resumeSubscription tests live at
// `src/modules/subscriptions/tests/service-lifecycle.spec.ts` (Day-16
// Block 4-C). The pre-Day-16 placeholder describe blocks here were
// deleted when Service B's bounded-pause + auto-resume rewrite landed.

// -----------------------------------------------------------------------------
// endSubscription
// -----------------------------------------------------------------------------

describe("endSubscription", () => {
  it("throws ForbiddenError when actor lacks subscription:end", async () => {
    await expect(endSubscription(ctx([]), SUB_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when ctx.tenantId is null", async () => {
    await expect(
      endSubscription(ctx(["subscription:end"], null), SUB_ID)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when the row is missing (and does NOT audit)", async () => {
    mockEnd.mockResolvedValue(null);
    await expect(endSubscription(ctx(["subscription:end"]), SUB_ID)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("propagates ConflictError from the repo when row is already 'ended'", async () => {
    mockEnd.mockRejectedValue(new ConflictError("already ended"));
    await expect(endSubscription(ctx(["subscription:end"]), SUB_ID)).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("emits subscription.ended from active with previous/new status + ended_at", async () => {
    const before = subFixture({ status: "active" });
    const after = subFixture({ status: "ended", endedAt: FIXED_NOW });
    mockEnd.mockResolvedValue(makeUpdate(before, after));

    await endSubscription(ctx(["subscription:end"]), SUB_ID);

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.eventType).toBe("subscription.ended");
    expect(emitArg.metadata).toEqual({
      subscription_id: SUB_ID,
      previous_status: "active",
      new_status: "ended",
      ended_at: FIXED_NOW,
      trigger_source: "user",
    });
  });

  it("captures previous_status: 'paused' when ending from a paused subscription", async () => {
    const before = subFixture({ status: "paused", pausedAt: "2026-04-30T08:00:00.000Z" });
    const after = subFixture({ status: "ended", pausedAt: null, endedAt: FIXED_NOW });
    mockEnd.mockResolvedValue(makeUpdate(before, after));

    await endSubscription(ctx(["subscription:end"]), SUB_ID);

    const emitArg = mockEmit.mock.calls[0][0];
    expect(emitArg.metadata).toMatchObject({
      previous_status: "paused",
      new_status: "ended",
    });
  });
});

// =============================================================================
// sweepEndedSubscriptions — Day 7 / C-8 (closing commit)
// =============================================================================
//
// Service-layer end-date sweeper. Walks subscriptions whose end_date has
// passed and transitions each to ENDED, emitting subscription.ended with
// trigger_source: 'sweeper' to disambiguate from the operator-driven
// endSubscription path (which now emits trigger_source: 'user').

describe("sweepEndedSubscriptions (system actor; cron caller pending Day 12)", () => {
  beforeEach(() => {
    mockWithServiceRole.mockImplementation(async (_reason, fn) => fn({} as never));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function systemSweepCtx(tenantId: string | null = TENANT_ID): RequestContext {
    return {
      actor: {
        kind: "system",
        system: "cron:end_expired",
        tenantId,
        permissions: new Set(),
      },
      tenantId,
      requestId: "sweep-test-request",
      path: "/cron/end-expired",
    };
  }

  it("rejects user actors with ForbiddenError (system-only)", async () => {
    await expect(
      sweepEndedSubscriptions(ctx(["subscription:end"]), "2026-05-02"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockListSweepCandidates).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects malformed asOfDate with ValidationError", async () => {
    await expect(
      sweepEndedSubscriptions(systemSweepCtx(), "May 2 2026"),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockListSweepCandidates).not.toHaveBeenCalled();
  });

  it("rejects null tenantId with ValidationError", async () => {
    await expect(
      sweepEndedSubscriptions(systemSweepCtx(null), "2026-05-02"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns zero swept when no candidates match (no audit emit)", async () => {
    mockListSweepCandidates.mockResolvedValue([]);

    const result = await sweepEndedSubscriptions(systemSweepCtx(), "2026-05-02");

    expect(result).toEqual({ swept: 0, subscriptionIds: [], skippedDueToRace: 0 });
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("transitions matching candidates to ended and emits trigger_source: 'sweeper'", async () => {
    const idA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    mockListSweepCandidates.mockResolvedValue([idA, idB]);
    const beforeA = subFixture({ id: idA, status: "active" });
    const afterA = subFixture({ id: idA, status: "ended", endedAt: FIXED_NOW });
    const beforeB = subFixture({ id: idB, status: "paused", pausedAt: "2026-04-30T00:00:00.000Z" });
    const afterB = subFixture({ id: idB, status: "ended", pausedAt: null, endedAt: FIXED_NOW });
    mockEnd
      .mockResolvedValueOnce(makeUpdate(beforeA, afterA))
      .mockResolvedValueOnce(makeUpdate(beforeB, afterB));

    const result = await sweepEndedSubscriptions(systemSweepCtx(), "2026-05-02");

    expect(result.swept).toBe(2);
    expect(result.subscriptionIds).toEqual([idA, idB]);
    expect(result.skippedDueToRace).toBe(0);

    expect(mockEmit).toHaveBeenCalledTimes(2);
    const firstEmit = mockEmit.mock.calls[0][0];
    expect(firstEmit.eventType).toBe("subscription.ended");
    expect(firstEmit.actorKind).toBe("system");
    expect(firstEmit.actorId).toBe("cron:end_expired");
    expect(firstEmit.resourceId).toBe(idA);
    expect(firstEmit.metadata).toEqual({
      subscription_id: idA,
      previous_status: "active",
      new_status: "ended",
      ended_at: FIXED_NOW,
      trigger_source: "sweeper",
    });

    const secondEmit = mockEmit.mock.calls[1][0];
    expect(secondEmit.metadata).toMatchObject({
      subscription_id: idB,
      previous_status: "paused",
      trigger_source: "sweeper",
    });
  });

  it("counts ConflictError race-loser rows in skippedDueToRace (no emit for those)", async () => {
    const idActive = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const idRace = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    mockListSweepCandidates.mockResolvedValue([idActive, idRace]);
    const before = subFixture({ id: idActive, status: "active" });
    const after = subFixture({ id: idActive, status: "ended", endedAt: FIXED_NOW });
    mockEnd
      .mockResolvedValueOnce(makeUpdate(before, after))
      .mockImplementationOnce(async () => {
        throw new ConflictError(
          `Cannot end subscription ${idRace}: status is already 'ended' (terminal)`,
        );
      });

    const result = await sweepEndedSubscriptions(systemSweepCtx(), "2026-05-02");

    expect(result.swept).toBe(1);
    expect(result.subscriptionIds).toEqual([idActive]);
    expect(result.skippedDueToRace).toBe(1);

    // Only the active row's emit fires; the race-loser is silent.
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit.mock.calls[0][0].resourceId).toBe(idActive);
  });

  it("counts vanished rows (endSubscriptionRow returns null) in skippedDueToRace", async () => {
    const idVanished = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    mockListSweepCandidates.mockResolvedValue([idVanished]);
    mockEnd.mockResolvedValueOnce(null);

    const result = await sweepEndedSubscriptions(systemSweepCtx(), "2026-05-02");

    expect(result.swept).toBe(0);
    expect(result.skippedDueToRace).toBe(1);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("propagates non-ConflictError exceptions (e.g. DB connectivity errors)", async () => {
    const idA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    mockListSweepCandidates.mockResolvedValue([idA]);
    mockEnd.mockImplementationOnce(async () => {
      throw new Error("connection terminated unexpectedly");
    });

    await expect(
      sweepEndedSubscriptions(systemSweepCtx(), "2026-05-02"),
    ).rejects.toThrow(/connection terminated/);
  });
});
