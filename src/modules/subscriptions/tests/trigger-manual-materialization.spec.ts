// F6 — Unit tests for triggerManualMaterialization: the guarded admin
// wrapper that exposes materializeSubscriptionForDateRange behind a
// permission gate so Ops can force a subscription's tasks to materialize
// off-cycle from the daily cron. RED-first on the permission gate.

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
  listSubscriptionsByConsignee: vi.fn(),
  listSubscriptionsByTenant: vi.fn(),
  listSweepCandidates: vi.fn(),
  updateSubscription: vi.fn(),
  endSubscription: vi.fn(),
}));

vi.mock("../../task-materialization/service", () => ({
  materializeSubscriptionForDateRange: vi.fn().mockResolvedValue({
    newInsertedTaskIds: [],
    addressResolutionFailedCount: 0,
  }),
}));

vi.mock("../../task-materialization/dubai-date", () => ({
  computeTargetDateInDubai: vi.fn().mockReturnValue("2026-05-15"),
  computeTodayInDubai: vi.fn().mockReturnValue("2026-05-01"),
}));

import { withServiceRole } from "../../../shared/db";
import { ForbiddenError, NotFoundError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import { emit } from "../../audit";
import { materializeSubscriptionForDateRange } from "../../task-materialization/service";

import { triggerManualMaterialization } from "../service";

const mockWithServiceRole = vi.mocked(withServiceRole);
const mockEmit = vi.mocked(emit);
const mockMaterialize = vi.mocked(materializeSubscriptionForDateRange);

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const SUB_ID = "11111111-1111-1111-1111-111111111111";

function ctx(
  perms: readonly Permission[],
  tenantId: string | null = TENANT_A,
): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_USER_ID,
      tenantId: tenantId ?? "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId,
    requestId: "test-request",
    path: "/admin/subscriptions",
  };
}

/**
 * First withServiceRole call = the cross-tenant tenant_id lookup; the
 * second = the materialize writer (which invokes the mocked
 * materializeSubscriptionForDateRange).
 */
function setupLookupAndMaterialize(targetTenantId: string) {
  let lookupDone = false;
  mockWithServiceRole.mockImplementation(async (_label, fn) => {
    if (!lookupDone) {
      lookupDone = true;
      return fn({
        execute: vi.fn().mockResolvedValueOnce([{ tenant_id: targetTenantId }]),
      } as never);
    }
    return fn({ execute: vi.fn().mockResolvedValue([]) } as never);
  });
}

function setupLookupMissing() {
  mockWithServiceRole.mockImplementation(async (_label, fn) =>
    fn({ execute: vi.fn().mockResolvedValueOnce([]) } as never),
  );
}

beforeEach(() => {
  mockWithServiceRole.mockReset();
  mockEmit.mockReset();
  mockEmit.mockResolvedValue(undefined);
  mockMaterialize.mockReset();
  mockMaterialize.mockResolvedValue({
    newInsertedTaskIds: [],
    addressResolutionFailedCount: 0,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("triggerManualMaterialization — permission gate", () => {
  it("throws ForbiddenError when the actor lacks subscription:update", async () => {
    await expect(
      triggerManualMaterialization(ctx([]), { subscriptionId: SUB_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockWithServiceRole).not.toHaveBeenCalled();
    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("triggerManualMaterialization — not found", () => {
  it("throws NotFoundError when the subscription lookup returns no rows", async () => {
    setupLookupMissing();
    await expect(
      triggerManualMaterialization(ctx(["subscription:update"]), {
        subscriptionId: SUB_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("triggerManualMaterialization — cross-tenant authority gate", () => {
  it("rejects a cross-tenant trigger when the actor lacks subscription:read_all", async () => {
    setupLookupAndMaterialize(TENANT_B);
    await expect(
      triggerManualMaterialization(ctx(["subscription:update"], TENANT_A), {
        subscriptionId: SUB_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockMaterialize).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("allows a cross-tenant trigger when the actor carries subscription:read_all", async () => {
    setupLookupAndMaterialize(TENANT_B);
    mockMaterialize.mockResolvedValueOnce({
      newInsertedTaskIds: ["t1", "t2", "t3"],
      addressResolutionFailedCount: 1,
    });

    const result = await triggerManualMaterialization(
      ctx(["subscription:update", "subscription:read_all"], TENANT_A),
      { subscriptionId: SUB_ID },
    );

    expect(result).toEqual({
      newInsertedTaskCount: 3,
      addressResolutionFailedCount: 1,
    });
    // Materialized over [today, horizon] in Dubai (mocked dubai-date).
    expect(mockMaterialize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        subscriptionId: SUB_ID,
        startDate: "2026-05-01",
        endDate: "2026-05-15",
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "cron.on_demand_invoked",
        tenantId: TENANT_B,
        resourceId: SUB_ID,
        metadata: expect.objectContaining({
          triggered_by: "admin_manual_trigger",
          subscription_id: SUB_ID,
          new_inserted_task_count: 3,
          address_resolution_failed_count: 1,
          target_date: "2026-05-15",
        }),
      }),
    );
  });
});

describe("triggerManualMaterialization — same-tenant happy path", () => {
  it("materializes and audits without requiring subscription:read_all", async () => {
    setupLookupAndMaterialize(TENANT_A);
    mockMaterialize.mockResolvedValueOnce({
      newInsertedTaskIds: ["t1"],
      addressResolutionFailedCount: 0,
    });

    const result = await triggerManualMaterialization(
      ctx(["subscription:update"], TENANT_A),
      { subscriptionId: SUB_ID },
    );

    expect(result).toEqual({
      newInsertedTaskCount: 1,
      addressResolutionFailedCount: 0,
    });
    expect(mockMaterialize).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});
