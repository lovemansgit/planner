// Day-22n PR-C-A — Calendar repository (data-access layer) for the
// consolidated `/calendar` cross-consignee view per brief §3.3.4.
//
// Three queries:
//   - countTasksGroupedByDay: per-day total + has_high_risk flag for a
//     week range. Drives the WeekView aggregate counts.
//   - selectTopTasksPerDay: up to 3 tasks per day (ordered by
//     delivery_start_time ASC), joined to consignees for the
//     consigneeName + crm_state isHighRisk derivation. Drives the
//     WeekView preview-pane rows per reviewer Q1 Option (b).
//   - computeMetrics: single round-trip returning the five
//     metric-card values. Brand-canon "today" anchored to Asia/Dubai
//     calendar date (computed at the service-layer caller and passed
//     as `today`).
//
// Filter contract (CalendarFilters):
//   - q          ILIKE on consignees.name
//   - crm        consignees.crm_state = $crm
//   - district   consignees.district  = $district
//   - window     delivery_start_time range mapped from canonical key
//   - status     tasks.internal_status = $status
//
// Tenant scope: every query carries an explicit
// `AND t.tenant_id = ${tenantId}` predicate alongside RLS — same
// value, same result, but self-describing in pg_stat (matches the
// task-repository defence-in-depth convention).

import { sql as sqlTag, type SQL } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type {
  CalendarDayCount,
  CalendarFilters,
  CalendarMetrics,
  CalendarTopTaskForDay,
} from "./types";
import type { TaskInternalStatus } from "../tasks/types";
import type { ConsigneeCrmState } from "../consignees/types";

// -----------------------------------------------------------------------------
// Filter helpers
// -----------------------------------------------------------------------------

/**
 * Canonical time-window key → SQL fragment that constrains
 * `t.delivery_start_time` to the matching half-open range. Empty /
 * undefined / unknown keys yield `TRUE` so the WHERE clause is a no-op.
 */
function timeWindowFilter(windowKey: string | undefined): SQL {
  switch (windowKey) {
    case "morning":
      return sqlTag`t.delivery_start_time >= '06:00:00' AND t.delivery_start_time < '12:00:00'`;
    case "afternoon":
      return sqlTag`t.delivery_start_time >= '12:00:00' AND t.delivery_start_time < '17:00:00'`;
    case "evening":
      return sqlTag`t.delivery_start_time >= '17:00:00' AND t.delivery_start_time < '22:00:00'`;
    default:
      return sqlTag`TRUE`;
  }
}

/**
 * Build the composite WHERE-fragment shared by the per-day and
 * top-tasks queries. Each filter contributes one AND-joined clause;
 * empty values short-circuit to `TRUE`. Always anchored on
 * `t.tenant_id = ${tenantId}` so the predicate is self-describing.
 */
function buildFilterClause(tenantId: Uuid, filters: CalendarFilters): SQL {
  const trimmedQ = filters.q?.trim();
  const qClause = trimmedQ
    ? sqlTag`c.name ILIKE ${"%" + trimmedQ + "%"}`
    : sqlTag`TRUE`;
  const crmClause = filters.crm
    ? sqlTag`c.crm_state = ${filters.crm}`
    : sqlTag`TRUE`;
  const districtClause = filters.district
    ? sqlTag`c.district = ${filters.district}`
    : sqlTag`TRUE`;
  const windowClause = timeWindowFilter(filters.window);
  const statusClause = filters.status
    ? sqlTag`t.internal_status = ${filters.status}`
    : sqlTag`TRUE`;
  return sqlTag`
    t.tenant_id = ${tenantId}
    AND ${qClause}
    AND ${crmClause}
    AND ${districtClause}
    AND ${windowClause}
    AND ${statusClause}
  `;
}

// -----------------------------------------------------------------------------
// Per-day counts (week range)
// -----------------------------------------------------------------------------

type DayCountRow = {
  delivery_date: Date | string;
  total: string | number; // bigint serialisation
  has_high_risk: boolean;
} & Record<string, unknown>;

function isoDateOf(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * COUNT tasks grouped by `delivery_date` across the inclusive
 * [weekStart, weekEnd] window. Returns one row per day that has at
 * least one matching task; days with zero matches are absent (the
 * service-layer caller fills them with 0-count placeholders so the
 * WeekView grid always shows all 7 days).
 *
 * `has_high_risk` is true iff at least one of the day's tasks is for
 * a consignee currently in HIGH_RISK CRM state. Computed via
 * `bool_or(c.crm_state = 'HIGH_RISK')` in the same aggregate.
 */
export async function countTasksGroupedByDay(
  tx: DbTx,
  tenantId: Uuid,
  weekStart: string,
  weekEnd: string,
  filters: CalendarFilters,
): Promise<readonly { date: string; total: number; hasHighRisk: boolean }[]> {
  const whereClause = buildFilterClause(tenantId, filters);
  const rows = await tx.execute<DayCountRow>(sqlTag`
    SELECT
      t.delivery_date,
      COUNT(*) AS total,
      bool_or(c.crm_state = 'HIGH_RISK') AS has_high_risk
    FROM tasks t
    JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
    WHERE ${whereClause}
      AND t.delivery_date >= ${weekStart}
      AND t.delivery_date <= ${weekEnd}
    GROUP BY t.delivery_date
    ORDER BY t.delivery_date ASC
  `);
  return rows.map((row) => ({
    date: isoDateOf(row.delivery_date),
    total: Number(row.total),
    hasHighRisk: Boolean(row.has_high_risk),
  }));
}

// -----------------------------------------------------------------------------
// Top-3 tasks per day
// -----------------------------------------------------------------------------

type TopTaskRow = {
  delivery_date: Date | string;
  task_id: string;
  consignee_id: string;
  consignee_name: string;
  delivery_start_time: string;
  internal_status: TaskInternalStatus;
  crm_state: ConsigneeCrmState;
} & Record<string, unknown>;

/**
 * Select up to 3 tasks per delivery_date across the inclusive
 * [weekStart, weekEnd] window, ordered by delivery_start_time ASC,
 * for the WeekView preview pane. Implemented via a window function
 * (`ROW_NUMBER() OVER (PARTITION BY delivery_date ORDER BY
 * delivery_start_time)`) inside a subquery so the outer query stays
 * a single SELECT and the planner can use the existing
 * (tenant_id, delivery_date) index.
 *
 * Returns rows grouped/keyed by delivery_date at the service layer;
 * this fn returns the flat row set with `delivery_date` per row.
 */
export async function selectTopTasksPerDay(
  tx: DbTx,
  tenantId: Uuid,
  weekStart: string,
  weekEnd: string,
  filters: CalendarFilters,
): Promise<readonly (CalendarTopTaskForDay & { deliveryDate: string })[]> {
  const whereClause = buildFilterClause(tenantId, filters);
  const rows = await tx.execute<TopTaskRow>(sqlTag`
    SELECT delivery_date,
           task_id,
           consignee_id,
           consignee_name,
           delivery_start_time,
           internal_status,
           crm_state
    FROM (
      SELECT
        t.delivery_date,
        t.id AS task_id,
        t.consignee_id,
        c.name AS consignee_name,
        t.delivery_start_time,
        t.internal_status,
        c.crm_state,
        ROW_NUMBER() OVER (
          PARTITION BY t.delivery_date
          ORDER BY t.delivery_start_time ASC, t.id ASC
        ) AS rn
      FROM tasks t
      JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
      WHERE ${whereClause}
        AND t.delivery_date >= ${weekStart}
        AND t.delivery_date <= ${weekEnd}
    ) ranked
    WHERE rn <= 3
    ORDER BY delivery_date ASC, delivery_start_time ASC
  `);
  return rows.map((row) => ({
    deliveryDate: isoDateOf(row.delivery_date),
    taskId: row.task_id,
    consigneeId: row.consignee_id,
    consigneeName: row.consignee_name,
    // Trim seconds — UI shows "HH:MM" only.
    deliveryWindowStart: row.delivery_start_time.slice(0, 5),
    status: row.internal_status,
    isHighRisk: row.crm_state === "HIGH_RISK",
  }));
}

// -----------------------------------------------------------------------------
// Metric snapshot
// -----------------------------------------------------------------------------

type MetricsRow = {
  active_consignees: string | number;
  today_deliveries_scheduled: string | number;
  delivered_today: string | number;
  out_for_delivery: string | number;
  failed_at_risk: string | number;
} & Record<string, unknown>;

/**
 * Compute the five header metric-card values in a single round-trip.
 *
 * Status mapping (TaskInternalStatus is the source of truth, not the
 * brief's hypothetical names):
 *   - todayDeliveriesScheduled: delivery_date = today AND
 *       internal_status IN ('CREATED','ASSIGNED','IN_TRANSIT','ON_HOLD')
 *     — anything not yet in a terminal state.
 *   - deliveredToday:           delivery_date = today AND
 *       internal_status = 'DELIVERED'
 *   - outForDelivery:           internal_status = 'IN_TRANSIT'
 *     (closest analogue to "out for delivery"; not date-scoped because
 *      a task may be in transit on a date earlier or later than today)
 *   - failedAtRisk:             COUNT(DISTINCT consignee_id) across
 *     (tasks FAILED in last 7 days) UNION (consignees HIGH_RISK)
 *   - activeConsignees:         consignees.crm_state IN ('ACTIVE','HIGH_RISK')
 *
 * Filters apply to the four task-scoped metrics; activeConsignees is
 * always the merchant-wide CRM-state COUNT (per reviewer brief — the
 * metric reflects the merchant's book of business, not the filtered
 * view of today).
 */
export async function computeMetrics(
  tx: DbTx,
  tenantId: Uuid,
  today: string,
  filters: CalendarFilters,
): Promise<CalendarMetrics> {
  const whereClause = buildFilterClause(tenantId, filters);
  const rows = await tx.execute<MetricsRow>(sqlTag`
    SELECT
      (
        SELECT COUNT(*) FROM consignees c
        WHERE c.tenant_id = ${tenantId}
          AND c.crm_state IN ('ACTIVE', 'HIGH_RISK')
      ) AS active_consignees,
      (
        SELECT COUNT(*)
        FROM tasks t
        JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
        WHERE ${whereClause}
          AND t.delivery_date = ${today}
          AND t.internal_status IN ('CREATED', 'ASSIGNED', 'IN_TRANSIT', 'ON_HOLD')
      ) AS today_deliveries_scheduled,
      (
        SELECT COUNT(*)
        FROM tasks t
        JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
        WHERE ${whereClause}
          AND t.delivery_date = ${today}
          AND t.internal_status = 'DELIVERED'
      ) AS delivered_today,
      (
        SELECT COUNT(*)
        FROM tasks t
        JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
        WHERE ${whereClause}
          AND t.internal_status = 'IN_TRANSIT'
      ) AS out_for_delivery,
      (
        SELECT COUNT(DISTINCT consignee_id) FROM (
          SELECT t.consignee_id
          FROM tasks t
          WHERE t.tenant_id = ${tenantId}
            AND t.internal_status = 'FAILED'
            AND t.delivery_date >= (${today}::date - INTERVAL '7 days')
          UNION
          SELECT c.id AS consignee_id
          FROM consignees c
          WHERE c.tenant_id = ${tenantId}
            AND c.crm_state = 'HIGH_RISK'
        ) at_risk
      ) AS failed_at_risk
  `);
  const row = rows[0];
  return {
    activeConsignees: row ? Number(row.active_consignees) : 0,
    todayDeliveriesScheduled: row ? Number(row.today_deliveries_scheduled) : 0,
    deliveredToday: row ? Number(row.delivered_today) : 0,
    outForDelivery: row ? Number(row.out_for_delivery) : 0,
    failedAtRisk: row ? Number(row.failed_at_risk) : 0,
  };
}

// -----------------------------------------------------------------------------
// Filter-option discovery (distinct lookups)
// -----------------------------------------------------------------------------

type DistinctStringRow = { value: string | null } & Record<string, unknown>;

/**
 * SELECT DISTINCT consignees.district values for the tenant, used to
 * populate the area / district filter dropdown on the page. Empty
 * strings + nulls are filtered out at the SQL layer.
 */
export async function listDistinctDistricts(
  tx: DbTx,
  tenantId: Uuid,
): Promise<readonly string[]> {
  const rows = await tx.execute<DistinctStringRow>(sqlTag`
    SELECT DISTINCT district AS value
    FROM consignees
    WHERE tenant_id = ${tenantId}
      AND district IS NOT NULL
      AND district <> ''
    ORDER BY value ASC
  `);
  return rows
    .map((row) => row.value)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * SELECT DISTINCT consignees.crm_state for the tenant, used to
 * populate the CRM filter dropdown. Always returns a subset of the
 * ConsigneeCrmState enum.
 */
export async function listDistinctCrmStates(
  tx: DbTx,
  tenantId: Uuid,
): Promise<readonly ConsigneeCrmState[]> {
  const rows = await tx.execute<DistinctStringRow>(sqlTag`
    SELECT DISTINCT crm_state AS value
    FROM consignees
    WHERE tenant_id = ${tenantId}
      AND crm_state IS NOT NULL
    ORDER BY value ASC
  `);
  return rows
    .map((row) => row.value)
    .filter((value): value is ConsigneeCrmState => typeof value === "string" && value.length > 0);
}

/**
 * SELECT DISTINCT tasks.internal_status for the tenant, used to
 * populate the status filter dropdown.
 */
export async function listDistinctTaskStatuses(
  tx: DbTx,
  tenantId: Uuid,
): Promise<readonly TaskInternalStatus[]> {
  const rows = await tx.execute<DistinctStringRow>(sqlTag`
    SELECT DISTINCT internal_status AS value
    FROM tasks
    WHERE tenant_id = ${tenantId}
      AND internal_status IS NOT NULL
    ORDER BY value ASC
  `);
  return rows
    .map((row) => row.value)
    .filter((value): value is TaskInternalStatus => typeof value === "string" && value.length > 0);
}

// -----------------------------------------------------------------------------
// Day-cell assembly helper
// -----------------------------------------------------------------------------

/**
 * Compose a 7-day CalendarDayCount[] from the per-day count rows + the
 * top-task rows. Missing days fill with `{ total: 0, hasHighRisk:
 * false, topTasks: [] }`. Top-task rows are grouped by deliveryDate
 * (no re-sort; the SQL already orders by delivery_start_time ASC).
 *
 * Exported for direct service-layer use AND for unit-test coverage —
 * the join logic is independent of the SQL round-trip.
 */
export function buildWeekDays(
  weekStart: string,
  weekEnd: string,
  perDayCounts: readonly { date: string; total: number; hasHighRisk: boolean }[],
  topTaskRows: readonly (CalendarTopTaskForDay & { deliveryDate: string })[],
): readonly CalendarDayCount[] {
  const countsByDate = new Map<string, { total: number; hasHighRisk: boolean }>();
  for (const row of perDayCounts) {
    countsByDate.set(row.date, { total: row.total, hasHighRisk: row.hasHighRisk });
  }
  const topsByDate = new Map<string, CalendarTopTaskForDay[]>();
  for (const row of topTaskRows) {
    const list = topsByDate.get(row.deliveryDate) ?? [];
    list.push({
      taskId: row.taskId,
      consigneeId: row.consigneeId,
      consigneeName: row.consigneeName,
      deliveryWindowStart: row.deliveryWindowStart,
      status: row.status,
      isHighRisk: row.isHighRisk,
    });
    topsByDate.set(row.deliveryDate, list);
  }
  const days: CalendarDayCount[] = [];
  let cursor = weekStart;
  while (cursor <= weekEnd) {
    const count = countsByDate.get(cursor);
    days.push({
      date: cursor,
      total: count?.total ?? 0,
      hasHighRisk: count?.hasHighRisk ?? false,
      topTasks: topsByDate.get(cursor) ?? [],
    });
    // Increment cursor by one day using UTC date math.
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return days;
}
