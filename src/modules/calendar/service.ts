// Day-22n PR-C-A — Calendar service-layer for the consolidated
// `/calendar` cross-consignee view per brief §3.3.4.
//
// Read-only surface. Permission gate `task:read` (the calendar
// renders tasks across the merchant's book of business — same auth
// envelope as the /tasks list). Tenant-scoped via withTenant so RLS
// scopes naturally. NO audit emit per R-4 — reads are not audited.
//
// Pattern matches the read paths on /tasks (src/modules/tasks/service.ts:
// listTasks at L561). Each entry point does the same three steps:
//   1. requirePermission(ctx, 'task:read') — throws ForbiddenError.
//   2. assertTenantScoped — throws ValidationError if ctx.tenantId is null.
//   3. withTenant(...) → call into the repo + assemble the response.

import { withTenant } from "@/shared/db";
import { ValidationError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { requirePermission } from "../identity";
import type { ConsigneeCrmState } from "../consignees/types";
import type { TaskInternalStatus } from "../tasks/types";

import {
  buildWeekDays,
  computeMetrics,
  countTasksGroupedByDay,
  listDistinctCrmStates,
  listDistinctDistricts,
  listDistinctTaskStatuses,
  selectTopTasksPerDay,
} from "./repository";
import type { CalendarDayCount, CalendarFilters, CalendarMetrics } from "./types";

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
 * Per reviewer Q1 Option (b): each entry includes up to 3 preview
 * tasks (ordered by delivery_start_time ASC). The page-side
 * ConsolidatedWeekView component renders the topTasks via Session
 * B's TaskPreviewRow primitive plus an overflow line for
 * `total - topTasks.length` when positive.
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
    const [perDayCounts, topTaskRows] = await Promise.all([
      countTasksGroupedByDay(tx, ctx.tenantId, start, end, filters),
      selectTopTasksPerDay(tx, ctx.tenantId, start, end, filters),
    ]);
    return buildWeekDays(start, end, perDayCounts, topTaskRows);
  });
}

/**
 * Five-metric snapshot for the /calendar header. `today` is the
 * Asia/Dubai calendar date (caller supplies it so the value is
 * deterministic and unit-testable; the page-side `page.tsx` computes
 * it via `computeTodayInDubai(new Date())`).
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

export interface CalendarFilterOptions {
  readonly districts: readonly string[];
  readonly crmStates: readonly ConsigneeCrmState[];
  readonly statuses: readonly TaskInternalStatus[];
}

/**
 * Distinct-value lookups feeding the CalendarFilterBar dropdowns.
 * Single round-trip per dimension — parallel-fetched. Time-window
 * options are a static canonical set ({morning, afternoon, evening})
 * and live in the page-side helper, not here.
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
