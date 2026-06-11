// Day-22n PR-C-A + Day-23n polish — Calendar service-layer unit tests.
//
// Mocks ../../shared/db (withTenant + withServiceRole) + ../repository
// so the service entry points exercise permission, tenant-context,
// and assembly flow without real Postgres. Repository functions are
// mocked at the source-module boundary, matching the pattern in
// src/modules/tasks/tests/service.spec.ts.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../shared/db", () => ({
  withTenant: vi.fn(),
  withServiceRole: vi.fn(),
}));

vi.mock("../repository", () => ({
  buildWeekDays: vi.fn(),
  computeMetrics: vi.fn(),
  computeTranscorpAdminMetrics: vi.fn(),
  countTasksGroupedByDay: vi.fn(),
  listDistinctCrmStates: vi.fn(),
  listDistinctDistricts: vi.fn(),
  listDistinctTaskStatuses: vi.fn(),
  listPerMerchantBreakdown: vi.fn(),
  listTasksForDayAcrossConsignees: vi.fn(),
  listTopMerchantsTodayWithTaskCount: vi.fn(),
}));

import { withServiceRole, withTenant } from "../../../shared/db";
import { ForbiddenError, ValidationError } from "../../../shared/errors";
import type { RequestContext } from "../../../shared/tenant-context";
import type { Permission } from "../../../shared/types";

import {
  buildWeekDays,
  computeMetrics,
  computeTranscorpAdminMetrics,
  countTasksGroupedByDay,
  listDistinctCrmStates,
  listDistinctDistricts,
  listDistinctTaskStatuses,
  listPerMerchantBreakdown,
  listTasksForDayAcrossConsignees,
  listTopMerchantsTodayWithTaskCount,
} from "../repository";
import {
  computeMonthGridWindow,
  computeWeekWindow,
  countTasksByDayAcrossConsignees,
  countTasksByDayForMonth,
  getCalendarFilterOptions,
  getCalendarMetrics,
  getCalendarMetricsTranscorpAdmin,
  getPerMerchantBreakdown,
  getTopMerchantsToday,
  listTasksForDay,
} from "../service";

const mockWithTenant = vi.mocked(withTenant);
const mockWithServiceRole = vi.mocked(withServiceRole);
const mockCountTasksGroupedByDay = vi.mocked(countTasksGroupedByDay);
const mockBuildWeekDays = vi.mocked(buildWeekDays);
const mockComputeMetrics = vi.mocked(computeMetrics);
const mockComputeTranscorpAdminMetrics = vi.mocked(computeTranscorpAdminMetrics);
const mockListDistinctDistricts = vi.mocked(listDistinctDistricts);
const mockListDistinctCrmStates = vi.mocked(listDistinctCrmStates);
const mockListDistinctTaskStatuses = vi.mocked(listDistinctTaskStatuses);
const mockListTasksForDayAcrossConsignees = vi.mocked(listTasksForDayAcrossConsignees);
const mockListTopMerchantsToday = vi.mocked(listTopMerchantsTodayWithTaskCount);
const mockListPerMerchantBreakdown = vi.mocked(listPerMerchantBreakdown);

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
  mockWithServiceRole.mockImplementation(async (_label, fn) => fn({} as never));
  mockCountTasksGroupedByDay.mockResolvedValue([]);
  mockBuildWeekDays.mockReturnValue([]);
  mockComputeMetrics.mockResolvedValue({
    activeConsignees: 0,
    todayDeliveriesScheduled: 0,
    deliveredToday: 0,
    outForDelivery: 0,
    failedAtRisk: 0,
  });
  mockComputeTranscorpAdminMetrics.mockResolvedValue({
    activeMerchants: 0,
    totalDeliveriesToday: 0,
    deliveredToday: 0,
    inTransit: 0,
    failedLast7Days: 0,
  });
  mockListDistinctDistricts.mockResolvedValue([]);
  mockListDistinctCrmStates.mockResolvedValue([]);
  mockListDistinctTaskStatuses.mockResolvedValue([]);
  mockListTopMerchantsToday.mockResolvedValue([]);
  mockListPerMerchantBreakdown.mockResolvedValue([]);
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

  it("runs under withTenant and only fetches per-day counts (no top-task slice Day-23n)", async () => {
    const ctx = userCtx(["task:read"]);
    await countTasksByDayAcrossConsignees(ctx, "2026-05-11");
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockWithTenant.mock.calls[0][0]).toBe(TENANT_ID);
    expect(mockCountTasksGroupedByDay).toHaveBeenCalledOnce();
  });

  it("passes the inclusive [weekStart, weekStart+6] window to the repo fn", async () => {
    const ctx = userCtx(["task:read"]);
    await countTasksByDayAcrossConsignees(ctx, "2026-05-11");
    expect(mockCountTasksGroupedByDay.mock.calls[0][2]).toBe("2026-05-11");
    expect(mockCountTasksGroupedByDay.mock.calls[0][3]).toBe("2026-05-17");
  });

  it("threads filters through to the count repo fn", async () => {
    const ctx = userCtx(["task:read"]);
    const filters = { q: "Sarah", crm: "HIGH_RISK" };
    await countTasksByDayAcrossConsignees(ctx, "2026-05-11", filters);
    expect(mockCountTasksGroupedByDay.mock.calls[0][4]).toEqual(filters);
  });

  it("returns the buildWeekDays output verbatim", async () => {
    const ctx = userCtx(["task:read"]);
    mockBuildWeekDays.mockReturnValue([
      { date: "2026-05-11", total: 5, hasHighRisk: true },
    ] as never);
    const days = await countTasksByDayAcrossConsignees(ctx, "2026-05-11");
    expect(days).toEqual([
      { date: "2026-05-11", total: 5, hasHighRisk: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getCalendarMetrics (tenant)
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
// getCalendarMetricsTranscorpAdmin (cross-tenant)
// ---------------------------------------------------------------------------

describe("getCalendarMetricsTranscorpAdmin", () => {
  it("throws ForbiddenError when actor lacks task:read_all", async () => {
    const ctx = userCtx(["task:read"]); // tenant-scoped only, no cross-tenant
    await expect(
      getCalendarMetricsTranscorpAdmin(ctx, "2026-05-11"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not require a tenant context (cross-tenant aggregate)", async () => {
    const ctx = userCtx(["task:read_all"], null);
    await expect(
      getCalendarMetricsTranscorpAdmin(ctx, "2026-05-11"),
    ).resolves.toBeDefined();
  });

  it("runs under withServiceRole (RLS bypassed) — never withTenant", async () => {
    const ctx = userCtx(["task:read_all"]);
    await getCalendarMetricsTranscorpAdmin(ctx, "2026-05-11");
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockWithServiceRole.mock.calls[0][0]).toBe(
      "transcorp_staff:calendar_metrics",
    );
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("calls the repo with today and returns the cross-tenant metrics", async () => {
    const ctx = userCtx(["task:read_all"]);
    mockComputeTranscorpAdminMetrics.mockResolvedValue({
      activeMerchants: 4,
      totalDeliveriesToday: 120,
      deliveredToday: 45,
      inTransit: 18,
      failedLast7Days: 6,
    });
    const result = await getCalendarMetricsTranscorpAdmin(ctx, "2026-05-11");
    expect(mockComputeTranscorpAdminMetrics).toHaveBeenCalledOnce();
    expect(mockComputeTranscorpAdminMetrics.mock.calls[0][1]).toBe("2026-05-11");
    expect(result.activeMerchants).toBe(4);
    expect(result.totalDeliveriesToday).toBe(120);
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

// ---------------------------------------------------------------------------
// Day-23 PM — computeMonthGridWindow
// ---------------------------------------------------------------------------

describe("computeMonthGridWindow", () => {
  it("returns Mon-of-week-of-1st through Sun-of-week-of-last for May 2026 (35 days)", () => {
    // May 2026: Fri 2026-05-01 → Sun 2026-05-31.
    // Grid Mon: 2026-04-27. Grid Sun: 2026-05-31 (already Sunday).
    const { start, end } = computeMonthGridWindow("2026-05-01");
    expect(start).toBe("2026-04-27");
    expect(end).toBe("2026-05-31");
  });

  it("returns 28 days when month starts on Monday and ends on Sunday (Feb 2026)", () => {
    // 2026-02-01 is a Sunday actually — let me use a known case.
    // 2027-02-01 is Monday; 2027-02-28 is Sunday → exactly 28 days.
    const { start, end } = computeMonthGridWindow("2027-02-01");
    expect(start).toBe("2027-02-01");
    expect(end).toBe("2027-02-28");
  });

  it("returns 42 days when month requires 6 week-rows (May 2027)", () => {
    // 2027-05-01 is Saturday; month ends 2027-05-31 (Monday).
    // Grid Mon: 2027-04-26. Grid Sun: 2027-06-06.
    const { start, end } = computeMonthGridWindow("2027-05-01");
    expect(start).toBe("2027-04-26");
    expect(end).toBe("2027-06-06");
  });

  it("normalises an arbitrary day-of-month input to the same month grid", () => {
    // Passing 2026-05-15 should resolve to the May 2026 grid.
    const fromMid = computeMonthGridWindow("2026-05-15");
    const fromFirst = computeMonthGridWindow("2026-05-01");
    expect(fromMid).toEqual(fromFirst);
  });
});

// ---------------------------------------------------------------------------
// getTopMerchantsToday (Day-23n fleet panels)
// ---------------------------------------------------------------------------

describe("getTopMerchantsToday", () => {
  it("throws ForbiddenError when actor lacks task:read_all", async () => {
    const ctx = userCtx(["task:read"]);
    await expect(
      getTopMerchantsToday(ctx, "2026-05-12"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("runs under withServiceRole — never withTenant", async () => {
    const ctx = userCtx(["task:read_all"]);
    await getTopMerchantsToday(ctx, "2026-05-12");
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockWithServiceRole.mock.calls[0][0]).toBe(
      "transcorp_staff:fleet_panels",
    );
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("calls the repo with today + limit and returns the rows verbatim", async () => {
    const ctx = userCtx(["task:read_all"]);
    mockListTopMerchantsToday.mockResolvedValue([
      { tenantId: "t1", tenantName: "MPL", tenantSlug: "mpl", taskCount: 42 },
    ]);
    const rows = await getTopMerchantsToday(ctx, "2026-05-12", 5);
    expect(mockListTopMerchantsToday).toHaveBeenCalledOnce();
    expect(mockListTopMerchantsToday.mock.calls[0][1]).toBe("2026-05-12");
    expect(mockListTopMerchantsToday.mock.calls[0][2]).toBe(5);
    expect(rows).toEqual([
      { tenantId: "t1", tenantName: "MPL", tenantSlug: "mpl", taskCount: 42 },
    ]);
  });

  it("defaults limit to 10 when caller omits", async () => {
    const ctx = userCtx(["task:read_all"]);
    await getTopMerchantsToday(ctx, "2026-05-12");
    expect(mockListTopMerchantsToday.mock.calls[0][2]).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Day-23 PM — countTasksByDayForMonth
// ---------------------------------------------------------------------------

describe("countTasksByDayForMonth", () => {
  const MONTH_ANCHOR = "2026-05-01";

  it("throws ForbiddenError when actor lacks task:read", async () => {
    const ctx = userCtx([]);
    await expect(countTasksByDayForMonth(ctx, MONTH_ANCHOR, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ValidationError when tenant context is missing", async () => {
    const ctx = userCtx(["task:read"], null);
    await expect(countTasksByDayForMonth(ctx, MONTH_ANCHOR, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("invokes withTenant + repo countTasksGroupedByDay + buildWeekDays over the month grid", async () => {
    const ctx = userCtx(["task:read"]);
    mockCountTasksGroupedByDay.mockResolvedValue([]);
    mockBuildWeekDays.mockReturnValue([]);
    await countTasksByDayForMonth(ctx, MONTH_ANCHOR, {});
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockCountTasksGroupedByDay).toHaveBeenCalledOnce();
    expect(mockBuildWeekDays).toHaveBeenCalledOnce();
    // Verify the grid window passed to buildWeekDays matches May 2026.
    const buildArgs = mockBuildWeekDays.mock.calls[0];
    expect(buildArgs[0]).toBe("2026-04-27");
    expect(buildArgs[1]).toBe("2026-05-31");
  });

  it("passes the filter set through to the repository", async () => {
    const ctx = userCtx(["task:read"]);
    mockCountTasksGroupedByDay.mockResolvedValue([]);
    mockBuildWeekDays.mockReturnValue([]);
    const filters = { q: "khouri", crm: "HIGH_RISK" };
    await countTasksByDayForMonth(ctx, MONTH_ANCHOR, filters);
    expect(mockCountTasksGroupedByDay).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      "2026-04-27",
      "2026-05-31",
      filters,
    );
  });
});

// ---------------------------------------------------------------------------
// Day-23 PM — listTasksForDay
// ---------------------------------------------------------------------------

describe("listTasksForDay", () => {
  const DATE = "2026-05-15";

  it("throws ForbiddenError when actor lacks task:read", async () => {
    const ctx = userCtx([]);
    await expect(listTasksForDay(ctx, DATE, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError when tenant context is missing", async () => {
    const ctx = userCtx(["task:read"], null);
    await expect(listTasksForDay(ctx, DATE, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("invokes withTenant + repo listTasksForDayAcrossConsignees with date + tenant", async () => {
    const ctx = userCtx(["task:read"]);
    mockListTasksForDayAcrossConsignees.mockResolvedValue([]);
    await listTasksForDay(ctx, DATE, {});
    expect(mockWithTenant).toHaveBeenCalledOnce();
    expect(mockListTasksForDayAcrossConsignees).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      DATE,
      {},
    );
  });

  it("passes filters through to the repository", async () => {
    const ctx = userCtx(["task:read"]);
    mockListTasksForDayAcrossConsignees.mockResolvedValue([]);
    const filters = { status: "FAILED" };
    await listTasksForDay(ctx, DATE, filters);
    expect(mockListTasksForDayAcrossConsignees).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      DATE,
      filters,
    );
  });
});

// ---------------------------------------------------------------------------
// getPerMerchantBreakdown (Day-23n fleet panels)
// ---------------------------------------------------------------------------

describe("getPerMerchantBreakdown", () => {
  it("throws ForbiddenError when actor lacks task:read_all", async () => {
    const ctx = userCtx(["task:read"]);
    await expect(
      getPerMerchantBreakdown(ctx, "2026-05-12"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("runs under withServiceRole — never withTenant", async () => {
    const ctx = userCtx(["task:read_all"]);
    await getPerMerchantBreakdown(ctx, "2026-05-12");
    expect(mockWithServiceRole).toHaveBeenCalledOnce();
    expect(mockWithServiceRole.mock.calls[0][0]).toBe(
      "transcorp_staff:fleet_panels",
    );
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("calls the repo with today and returns the rows verbatim", async () => {
    const ctx = userCtx(["task:read_all"]);
    mockListPerMerchantBreakdown.mockResolvedValue([
      {
        tenantId: "t1",
        tenantName: "MPL",
        tenantSlug: "mpl",
        totalToday: 42,
        deliveredToday: 10,
        inTransit: 5,
        failedLast7Days: 2,
      },
    ]);
    const rows = await getPerMerchantBreakdown(ctx, "2026-05-12");
    expect(mockListPerMerchantBreakdown).toHaveBeenCalledOnce();
    expect(mockListPerMerchantBreakdown.mock.calls[0][1]).toBe("2026-05-12");
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantSlug).toBe("mpl");
    expect(rows[0].failedLast7Days).toBe(2);
  });
});
