// Day-22n PR-C-B + Day-23n polish — Type contract for the consolidated
// `/calendar` cross-consignee aggregate view (brief §3.3.4).
//
// Day-23n polish (PR #N): the WeekView no longer renders top-3 task
// previews per scope-narrowing ruling. CalendarTopTaskForDay +
// CalendarDayCount.topTasks dropped; day cells are now click-through
// to /calendar?view=day&date=<iso>. Time-window URL filter also
// dropped (no consumer in the post-narrowing UX).
//
// Brief §3.3.4 five metric cards (one snapshot from `getCalendarMetrics`)
// + per-day aggregate counts (one row from `countTasksByDayAcrossConsignees`).

/**
 * Five metric-card snapshot returned by `getCalendarMetrics`. Tenant
 * variant — composed of consignee + task counts for the active tenant.
 *
 * `failedAtRisk` per reviewer OQ-5 ruling: union of (FAILED tasks in
 * last 7 days) + (active consignees with crm_state = 'HIGH_RISK').
 */
export interface CalendarMetrics {
  readonly activeConsignees: number;
  readonly todayDeliveriesScheduled: number;
  readonly deliveredToday: number;
  readonly outForDelivery: number;
  readonly failedAtRisk: number;
}

/**
 * Day-23n — Transcorp admin (cross-tenant) metric variant. Surfaced
 * on `/calendar` when the actor carries `task:read_all` (i.e.
 * transcorp-sysadmin). Composed cross-tenant via withServiceRole;
 * RLS is bypassed by design — only this role reaches the path.
 */
export interface CalendarMetricsTranscorpAdmin {
  readonly activeMerchants: number;
  readonly totalDeliveriesToday: number;
  readonly deliveredToday: number;
  readonly inTransit: number;
  readonly failedLast7Days: number;
}

/**
 * Day-23n fleet panels — single row in the "Top merchants today"
 * panel. Sorted by `taskCount` DESC at the SQL layer.
 */
export interface CalendarTopMerchantToday {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly taskCount: number;
}

/**
 * Day-23n fleet panels — single row in the "Per-merchant breakdown"
 * panel. One row per active tenant; column counts come from FILTER
 * aggregates in a single round-trip.
 */
export interface CalendarPerMerchantBreakdownRow {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly totalToday: number;
  readonly deliveredToday: number;
  readonly inTransit: number;
  readonly failedLast7Days: number;
}

/**
 * Per-day aggregate row used by week / month / day grids. Day-23n —
 * stripped to total + hasHighRisk only (the top-task preview slice
 * has been removed in favour of click-through day cells).
 */
export interface CalendarDayCount {
  readonly date: string; // ISO YYYY-MM-DD
  readonly total: number;
  readonly hasHighRisk: boolean;
}

/**
 * Three-segment view selector. /calendar consolidated view excludes
 * the year segment per reviewer OQ-7 ruling — year is consignee-detail
 * only (heat-map per brief §3.3.3).
 */
export type CalendarConsolidatedView = "week" | "month" | "day";

/**
 * URL-state shape for the filter bar. Day-23n — `window`
 * (time-of-day) filter dropped; no consumer in the post-narrowing UX.
 */
export interface CalendarFiltersValue {
  readonly q: string;
  readonly crm: string;
  readonly district: string;
  readonly status: string;
}

/**
 * Day-23 PM — Single-task row returned by the day-view fetch.
 * Joined with the consignee surface so the day-view list can render
 * consignee name + district + crm_state without per-row lookups.
 * Used by ConsolidatedDayView.
 */
export interface CalendarDayTaskRow {
  readonly taskId: string;
  readonly consigneeId: string;
  readonly consigneeName: string;
  readonly district: string | null;
  readonly crmState: string;
  readonly status: string;
  readonly deliveryWindowStart: string;
  readonly deliveryWindowEnd: string;
  readonly externalTrackingNumber: string | null;
  readonly subscriptionId: string | null;
}
