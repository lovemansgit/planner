// Day-22n PR-C-A — Calendar service-layer unit tests.
//
// Mocks ../../shared/db (withTenant) + ../repository so the service
// entry points exercise permission, tenant-context, and assembly
// flow without real Postgres. Repository functions are mocked at
// the source-module boundary, matching the pattern in
// src/modules/tasks/tests/service.spec.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
}));

vi.mock("../repository", () => ({
  buildWeekDays: vi.fn(),
  computeMetrics: vi.fn(),
  countTasksGroupedByDay: vi.fn(),
  listDistinctCrmStates: vi.fn(),
  listDistinctDistricts: vi.fn(),
  listDistinctTaskStatuses: vi.fn(),
  selectTopTasksPerDay: vi.fn(),
}));

import { withTenant } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import {
  buildWeekDays,
  computeMetrics,
  countTasksGroupedByDay,
  listDistinctCrmStates,
  listDistinctDistricts,
  listDistinctTaskStatuses,
  selectTopTasksPerDay,
} from "../repository";
import {
  computeWeekWindow,
  countTasksByDayAcrossConsignees,
  getCalendarFilterOptions,
  getCalendarMetrics,
} from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockCountTasksGroupedByDay = vi.mocked(countTasksGroupedByDay);
const mockSelectTopTasksPerDay = vi.mocked(selectTopTasksPerDay);
const mockBuildWeekDays = vi.mocked(buildWeekDays);
const mockComputeMetrics = vi.mocked(computeMetrics);
const mockListDistinctDistricts = vi.mocked(listDistinctDistricts);
const mockListDistinctCrmStates = vi.mocked(listDistinctCrmStates);
const mockListDistinctTaskStatuses = vi.mocked(listDistinctTaskStatuses);

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";

function userCtx(
  perms: readonly Permission[],
  tenantId: string | null = TENANT_ID,
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
    path: "/calendar",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWithTenant.mockImplementation(async (_tenantId, fn) => fn({} as never));
  mockCountTasksGroupedByDay.mockResolvedValue([]);
  mockSelectTopTasksPerDay.mockResolvedValue([]);
  mockBuildWeekDays.mockReturnValue([]);
  mockComputeMetrics.mockResolvedValue({
    activeConsignees: 0,
    todayDeliveriesScheduled: 0,
    deliveredToday: 0,
    outForDelivery: 0,
    failedAtRisk: 0,
  });
  mockListDistinctDistricts.mockResolvedValue([]);
  mockListDistinctCrmStates.mockResolvedValue([]);
  mockListDistinctTaskStatuses.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// computeWeekWindow (pure)
// ---------------------------------------------------------------------------

describe("computeWeekWindow", () => {
  it("returns start = weekStart and end = weekStart + 6 days", () => {
    expect(computeWeekWindow("2026-05-11")).toEqual({
      start: "2026-05-11",
      end: "2026-05-17",
    });
  });

  it("handles month boundary", () => {
    expect(computeWeekWindow("2026-04-27")).toEqual({
      start: "2026-04-27",
      end: "2026-05-03",
    });
  });

  it("handles year boundary", () => {
    expect(computeWeekWindow("2026-12-28")).toEqual({
      start: "2026-12-28",
      end: "2027-01-03",
    });
  });
});

// ---------------------------------------------------------------------------
// countTasksByDayAcrossConsignees
// ---------------------------------------------------------------------------

describe("countTasksByDayAcrossConsignees", () => {
  it("throws ForbiddenError when actor lacks task:read", async () => {
    const ctx = userCtx([]);
    await expect(
      countTasksByDayAcrossConsignees(ctx, "2026-05-11"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when tenant context is missing", async () => {
    const ctx = userCtx(["task:read"], null);
    await expect(
      countTasksByDayAcrossConsignees(ctx, "2026-05-11"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("runs under withTenant and parallel-fetches counts + top tasks", async () => {
    const ctx = userCtx(["task:read"]);
    await countTasksByDayAcrossConsignees(ctx, "2026-05-11");
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockWithTenant.mock.calls[0][0]).toBe(TENANT_ID);
    expect(mockCountTasksGroupedByDay).toHaveBeenCalledOnce();
    expect(mockSelectTopTasksPerDay).toHaveBeenCalledOnce();
  });

  it("passes the inclusive [weekStart, weekStart+6] window to the repo fns", async () => {
    const ctx = userCtx(["task:read"]);
    await countTasksByDayAcrossConsignees(ctx, "2026-05-11");
    // Args: (tx, tenantId, start, end, filters)
    expect(mockCountTasksGroupedByDay.mock.calls[0][2]).toBe("2026-05-11");
    expect(mockCountTasksGroupedByDay.mock.calls[0][3]).toBe("2026-05-17");
    expect(mockSelectTopTasksPerDay.mock.calls[0][2]).toBe("2026-05-11");
    expect(mockSelectTopTasksPerDay.mock.calls[0][3]).toBe("2026-05-17");
  });

  it("threads filters through to both repo fns", async () => {
    const ctx = userCtx(["task:read"]);
    const filters = { q: "Sarah", crm: "HIGH_RISK" };
    await countTasksByDayAcrossConsignees(ctx, "2026-05-11", filters);
    expect(mockCountTasksGroupedByDay.mock.calls[0][4]).toEqual(filters);
    expect(mockSelectTopTasksPerDay.mock.calls[0][4]).toEqual(filters);
  });

  it("returns the buildWeekDays output verbatim", async () => {
    const ctx = userCtx(["task:read"]);
    mockBuildWeekDays.mockReturnValue([
      { date: "2026-05-11", total: 5, hasHighRisk: true, topTasks: [] },
    ] as never);
    const days = await countTasksByDayAcrossConsignees(ctx, "2026-05-11");
    expect(days).toEqual([
      { date: "2026-05-11", total: 5, hasHighRisk: true, topTasks: [] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getCalendarMetrics
// ---------------------------------------------------------------------------

describe("getCalendarMetrics", () => {
  it("throws ForbiddenError when actor lacks task:read", async () => {
    const ctx = userCtx([]);
    await expect(getCalendarMetrics(ctx, "2026-05-11")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ValidationError when tenant context is missing", async () => {
    const ctx = userCtx(["task:read"], null);
    await expect(getCalendarMetrics(ctx, "2026-05-11")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("calls the repo with the tenantId + today + filters", async () => {
    const ctx = userCtx(["task:read"]);
    await getCalendarMetrics(ctx, "2026-05-11", { status: "FAILED" });
    expect(mockComputeMetrics).toHaveBeenCalledOnce();
    expect(mockComputeMetrics.mock.calls[0][1]).toBe(TENANT_ID);
    expect(mockComputeMetrics.mock.calls[0][2]).toBe("2026-05-11");
    expect(mockComputeMetrics.mock.calls[0][3]).toEqual({ status: "FAILED" });
  });

  it("returns the repo output verbatim", async () => {
    const ctx = userCtx(["task:read"]);
    mockComputeMetrics.mockResolvedValue({
      activeConsignees: 42,
      todayDeliveriesScheduled: 12,
      deliveredToday: 5,
      outForDelivery: 3,
      failedAtRisk: 2,
    });
    const result = await getCalendarMetrics(ctx, "2026-05-11");
    expect(result.activeConsignees).toBe(42);
    expect(result.failedAtRisk).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getCalendarFilterOptions
// ---------------------------------------------------------------------------

describe("getCalendarFilterOptions", () => {
  it("throws ForbiddenError when actor lacks task:read", async () => {
    const ctx = userCtx([]);
    await expect(getCalendarFilterOptions(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when tenant context is missing", async () => {
    const ctx = userCtx(["task:read"], null);
    await expect(getCalendarFilterOptions(ctx)).rejects.toBeInstanceOf(ValidationError);
  });

  it("parallel-fetches districts, crm states, and statuses", async () => {
    const ctx = userCtx(["task:read"]);
    mockListDistinctDistricts.mockResolvedValue(["Al Quoz", "Jumeirah"]);
    mockListDistinctCrmStates.mockResolvedValue(["ACTIVE", "HIGH_RISK"]);
    mockListDistinctTaskStatuses.mockResolvedValue(["CREATED", "FAILED"]);
    const result = await getCalendarFilterOptions(ctx);
    expect(result).toEqual({
      districts: ["Al Quoz", "Jumeirah"],
      crmStates: ["ACTIVE", "HIGH_RISK"],
      statuses: ["CREATED", "FAILED"],
    });
    expect(mockListDistinctDistricts).toHaveBeenCalledOnce();
    expect(mockListDistinctCrmStates).toHaveBeenCalledOnce();
    expect(mockListDistinctTaskStatuses).toHaveBeenCalledOnce();
  });
});
