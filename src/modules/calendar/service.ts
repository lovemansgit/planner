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
} from "./repository";
import type {
  CalendarDayCount,
  CalendarFilters,
  CalendarMetrics,
  CalendarMetricsTranscorpAdmin,
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
