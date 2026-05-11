// Day-22n PR-C-B — Type contract for the consolidated `/calendar`
// cross-consignee aggregate view (brief §3.3.4).
//
// Session B lands these shapes first; Session A's service-layer
// (PR-C-A) consumes them. If both sessions file _types.ts in
// parallel, the merge picks Session B's file (filed earlier in the
// night per reviewer instruction).
//
// Brief §3.3.4 five metric cards (one snapshot from `getCalendarMetrics`),
// per-day aggregate counts (one row from `countTasksByDayAcrossConsignees`),
// and the LIMIT-3 "top tasks today" preview pane wired into the week
// view per reviewer Q1 ruling.

import type { TaskInternalStatus } from "@/modules/tasks/types";

/**
 * Five metric-card snapshot, returned by the service-layer
 * `getCalendarMetrics(ctx, asOf)` in a single round-trip.
 *
 * `failedAtRisk` composition per reviewer OQ-5 ruling: union of
 * (FAILED tasks in last 7 days) + (active consignees with crm_state
 * = 'HIGH_RISK'). Displayed as a single numeral with optional
 * hover-tooltip breakdown.
 */
export interface CalendarMetrics {
  readonly activeConsignees: number;
  readonly todayDeliveriesScheduled: number;
  readonly deliveredToday: number;
  readonly outForDelivery: number;
  readonly failedAtRisk: number;
}

/**
 * Per-day aggregate row used by week / month / day grids. Includes
 * the top-3 task preview slice for the week-view preview pane
 * (reviewer Q1 Option (b)). `topTasks` ordered by
 * `deliveryWindowStart` ASC so the earliest deliveries surface
 * first; `total - topTasks.length` overflow rendered as a "+ N more"
 * line beneath the rows.
 */
export interface CalendarDayCount {
  readonly date: string; // ISO YYYY-MM-DD
  readonly total: number;
  readonly hasHighRisk: boolean;
  readonly topTasks: readonly CalendarTopTaskForDay[];
}

/**
 * Single task row inside the WeekView preview pane. Consignee name
 * sourced from `consignees.name` via service-layer JOIN;
 * `isHighRisk` reflects `consignees.crm_state = 'HIGH_RISK'` (not
 * task-state-derived). Used for both the row tint and the
 * drill-down link target.
 */
export interface CalendarTopTaskForDay {
  readonly taskId: string;
  readonly consigneeId: string;
  readonly consigneeName: string;
  readonly deliveryWindowStart: string; // "HH:MM"
  readonly status: TaskInternalStatus;
  readonly isHighRisk: boolean;
}

/**
 * Three-segment view selector. /calendar consolidated view excludes
 * the year segment per reviewer OQ-7 ruling — year is consignee-detail
 * only (heat-map per brief §3.3.3).
 */
export type CalendarConsolidatedView = "week" | "month" | "day";

/**
 * URL-state shape for the filter bar. Empty string = "all" for
 * each select; empty `q` = no search filter applied. Mirrors the
 * `/tasks?status=…&page=…` URL-state precedent (reviewer OQ-3:
 * no shared-primitive extraction tonight).
 */
export interface CalendarFiltersValue {
  readonly q: string;
  readonly crm: string;
  readonly district: string;
  readonly window: string;
  readonly status: string;
}
