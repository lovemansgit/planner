// Day-22n PR-C-A + Day-23n polish — Calendar service-layer for the
// consolidated `/calendar` cross-consignee view per brief §3.3.4.
//
// Read-only surface. Tenant-scoped entry points gate on `task:read`
// and run under withTenant so RLS scopes naturally. The Transcorp
// admin variant gates on `task:read_all` and runs under
// withServiceRole — RLS bypassed by design. NO audit emit per R-4 —
// reads are not audited.
//
// Day-23n changes:
//   - countTasksByDayAcrossConsignees no longer parallel-fetches the
//     top-task slice; the WeekView now renders click-through cells
//     without inline preview rows.
//   - Added getCalendarMetricsTranscorpAdmin — cross-tenant metric
//     variant gated on `task:read_all`.

import { withServiceRole, withTenant } from "@/shared/db";
import { ValidationError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { requirePermission } from "../identity";
import type { ConsigneeCrmState } from "../consignees/types";
import type { TaskInternalStatus } from "../tasks/types";

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
} from "./repository";
import type {
  CalendarDayCount,
  CalendarDayTaskRow,
  CalendarFilters,
  CalendarMetrics,
  CalendarMetricsTranscorpAdmin,
  CalendarPerMerchantBreakdownRow,
  CalendarTopMerchantToday,
} from "./types";

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

/**
 * Compute the inclusive [weekStart, weekEnd] window from a Monday
 * anchor — weekStart is the anchor itself, weekEnd is anchor + 6
 * days. Pure helper, no I/O — exported for spec coverage.
 */
export function computeWeekWindow(weekStart: string): { start: string; end: string } {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    start: weekStart,
    end: end.toISOString().slice(0, 10),
  };
}

/**
 * Day-23 PM — Compute the inclusive [gridStart, gridEnd] window for a
 * month-grid view. Returns Monday of the week containing the 1st of
 * the month through Sunday of the week containing the last day of
 * the month. Always 28, 35, or 42 days. Pure helper — exported for
 * spec coverage.
 *
 * `monthAnchor` must be the first day of a month (YYYY-MM-01);
 * passing any other day is treated as the first of that month
 * (i.e., the month is resolved from year + month components).
 */
export function computeMonthGridWindow(monthAnchor: string): { start: string; end: string } {
  const anchor = new Date(`${monthAnchor}T00:00:00Z`);
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  // Walk back to Monday (ISO weekday 1) of monthStart's week.
  const monthStartIsoDay = monthStart.getUTCDay() === 0 ? 7 : monthStart.getUTCDay();
  const gridStart = new Date(monthStart);
  gridStart.setUTCDate(monthStart.getUTCDate() - (monthStartIsoDay - 1));
  // Last day of month: day 0 of the following month.
  const monthEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  // Walk forward to Sunday (ISO weekday 7) of monthEnd's week.
  const monthEndIsoDay = monthEnd.getUTCDay() === 0 ? 7 : monthEnd.getUTCDay();
  const gridEnd = new Date(monthEnd);
  gridEnd.setUTCDate(monthEnd.getUTCDate() + (7 - monthEndIsoDay));
  return {
    start: gridStart.toISOString().slice(0, 10),
    end: gridEnd.toISOString().slice(0, 10),
  };
}

/**
 * Per-day aggregate over the week starting at the given Monday
 * anchor. Returns exactly 7 CalendarDayCount entries — one per day,
 * Monday → Sunday — even on days with zero matching tasks.
 *
 * Day-23n polish: drops the top-3 preview-task slice; day cells
 * click through to `/calendar?view=day&date=<iso>` instead of
 * rendering inline preview rows.
 */
export async function countTasksByDayAcrossConsignees(
  ctx: RequestContext,
  weekStart: string,
  filters: CalendarFilters = {},
): Promise<readonly CalendarDayCount[]> {
  requirePermission(ctx, "task:read");
  assertTenantScoped(ctx, "calendar:week-view");
  const { start, end } = computeWeekWindow(weekStart);
  return withTenant(ctx.tenantId, async (tx) => {
    const perDayCounts = await countTasksGroupedByDay(
      tx,
      ctx.tenantId,
      start,
      end,
      filters,
    );
    return buildWeekDays(start, end, perDayCounts);
  });
}

/**
 * Five-metric snapshot for the /calendar header — tenant variant.
 * `today` is the Asia/Dubai calendar date (caller supplies it so the
 * value is deterministic and unit-testable; the page-side `page.tsx`
 * computes it via `computeTodayInDubai(new Date())`).
 */
export async function getCalendarMetrics(
  ctx: RequestContext,
  today: string,
  filters: CalendarFilters = {},
): Promise<CalendarMetrics> {
  requirePermission(ctx, "task:read");
  assertTenantScoped(ctx, "calendar:metrics");
  return withTenant(ctx.tenantId, async (tx) => {
    return computeMetrics(tx, ctx.tenantId, today, filters);
  });
}

/**
 * Day-23n — Transcorp admin (cross-tenant) metric variant. Permission
 * gate `task:read_all` (transcorp-sysadmin only). Runs under
 * withServiceRole — RLS bypassed; aggregates span every merchant.
 * No tenant context required.
 */
export async function getCalendarMetricsTranscorpAdmin(
  ctx: RequestContext,
  today: string,
): Promise<CalendarMetricsTranscorpAdmin> {
  requirePermission(ctx, "task:read_all");
  return withServiceRole("transcorp_staff:calendar_metrics", async (tx) => {
    return computeTranscorpAdminMetrics(tx, today);
  });
}

/**
 * Day-23 PM — Per-day aggregate over the calendar grid containing
 * `monthAnchor` (Monday of week-of-1st → Sunday of week-of-last-day).
 * Returns 28, 35, or 42 entries depending on month length and weekday
 * alignment. Underneath, calls `countTasksGroupedByDay` (range-agnostic)
 * + `buildWeekDays` (also range-agnostic — fills missing days with
 * zero counts).
 */
export async function countTasksByDayForMonth(
  ctx: RequestContext,
  monthAnchor: string,
  filters: CalendarFilters = {},
): Promise<readonly CalendarDayCount[]> {
  requirePermission(ctx, "task:read");
  assertTenantScoped(ctx, "calendar:month-view");
  const { start, end } = computeMonthGridWindow(monthAnchor);
  return withTenant(ctx.tenantId, async (tx) => {
    const perDayCounts = await countTasksGroupedByDay(
      tx,
      ctx.tenantId,
      start,
      end,
      filters,
    );
    // buildWeekDays is range-agnostic — iterates start→end with
    // `cursor <= end` so a 28-42 day month grid works the same as the
    // 7-day week range.
    return buildWeekDays(start, end, perDayCounts);
  });
}

/**
 * Day-23 PM — All tasks for the given `date` across every consignee in
 * the tenant, JOINed with consignee.name/district/crm_state so the
 * day-view list can render those columns without per-row fetches.
 * Ordered by delivery window then consignee name.
 */
export async function listTasksForDay(
  ctx: RequestContext,
  date: string,
  filters: CalendarFilters = {},
): Promise<readonly CalendarDayTaskRow[]> {
  requirePermission(ctx, "task:read");
  assertTenantScoped(ctx, "calendar:day-view");
  return withTenant(ctx.tenantId, async (tx) => {
    return listTasksForDayAcrossConsignees(tx, ctx.tenantId, date, filters);
  });
}

/**
 * Day-23n fleet panels — top-N merchants by today's task volume.
 * Permission gate `task:read_all`; runs under withServiceRole.
 * Caller supplies `today` (Asia/Dubai calendar date).
 */
export async function getTopMerchantsToday(
  ctx: RequestContext,
  today: string,
  limit = 10,
): Promise<readonly CalendarTopMerchantToday[]> {
  requirePermission(ctx, "task:read_all");
  return withServiceRole("transcorp_staff:fleet_panels", async (tx) => {
    return listTopMerchantsTodayWithTaskCount(tx, today, limit);
  });
}

/**
 * Day-23n fleet panels — per-merchant breakdown. One row per active
 * tenant with 4 column counts (today's total, delivered today, in
 * transit, failed last 7 days). Permission gate `task:read_all`;
 * runs under withServiceRole.
 */
export async function getPerMerchantBreakdown(
  ctx: RequestContext,
  today: string,
): Promise<readonly CalendarPerMerchantBreakdownRow[]> {
  requirePermission(ctx, "task:read_all");
  return withServiceRole("transcorp_staff:fleet_panels", async (tx) => {
    return listPerMerchantBreakdown(tx, today);
  });
}

export interface CalendarFilterOptions {
  readonly districts: readonly string[];
  readonly crmStates: readonly ConsigneeCrmState[];
  readonly statuses: readonly TaskInternalStatus[];
}

/**
 * Distinct-value lookups feeding the CalendarFilterBar dropdowns.
 * Single round-trip per dimension — parallel-fetched.
 */
export async function getCalendarFilterOptions(
  ctx: RequestContext,
): Promise<CalendarFilterOptions> {
  requirePermission(ctx, "task:read");
  assertTenantScoped(ctx, "calendar:filter-options");
  return withTenant(ctx.tenantId, async (tx) => {
    const [districts, crmStates, statuses] = await Promise.all([
      listDistinctDistricts(tx, ctx.tenantId),
      listDistinctCrmStates(tx, ctx.tenantId),
      listDistinctTaskStatuses(tx, ctx.tenantId),
    ]);
    return { districts, crmStates, statuses };
  });
}
