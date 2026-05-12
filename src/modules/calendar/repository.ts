// Day-22n PR-C-A + Day-23n polish — Calendar repository (data-access
// layer) for the consolidated `/calendar` cross-consignee view per
// brief §3.3.4.
//
// Day-23n changes:
//   - selectTopTasksPerDay + its types removed; day-cell click-through
//     replaces the in-cell preview.
//   - timeWindowFilter removed; `window` URL filter dropped.
//   - Added computeTranscorpAdminMetrics — cross-tenant aggregate
//     metric variant for transcorp-sysadmin actor on /calendar.
//
// Tenant-scoped queries:
//   - countTasksGroupedByDay: per-day total + has_high_risk flag for
//     a week range.
//   - computeMetrics: tenant-scoped 5-metric snapshot.
//   - listDistinct{Districts,CrmStates,TaskStatuses}: filter dropdown
//     source data.
//
// Cross-tenant queries (caller wraps in withServiceRole):
//   - computeTranscorpAdminMetrics: 5 cross-tenant counters in one
//     round-trip. RLS bypassed; transcorp-sysadmin only.

import { sql as sqlTag, type SQL } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type {
  CalendarDayCount,
  CalendarDayTaskRow,
  CalendarFilters,
  CalendarMetrics,
  CalendarMetricsTranscorpAdmin,
} from "./types";
import type { TaskInternalStatus } from "../tasks/types";
import type { ConsigneeCrmState } from "../consignees/types";

// -----------------------------------------------------------------------------
// Filter helpers
// -----------------------------------------------------------------------------

/**
 * Build the composite WHERE-fragment shared by tenant-scoped queries.
 * Each filter contributes one AND-joined clause; empty values
 * short-circuit to `TRUE`. Always anchored on
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
  const statusClause = filters.status
    ? sqlTag`t.internal_status = ${filters.status}`
    : sqlTag`TRUE`;
  return sqlTag`
    t.tenant_id = ${tenantId}
    AND ${qClause}
    AND ${crmClause}
    AND ${districtClause}
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
// Day-23 PM — Day-view task list (cross-consignee)
// -----------------------------------------------------------------------------

type DayTaskRow = {
  task_id: string;
  consignee_id: string;
  consignee_name: string;
  district: string | null;
  crm_state: string;
  internal_status: string;
  delivery_window_start: string;
  delivery_window_end: string;
  external_tracking_number: string | null;
  subscription_id: string | null;
} & Record<string, unknown>;

/**
 * List every task for the given `date`, JOINed with the consignee
 * surface so the day-view can render names + districts + crm_state
 * without per-row lookups. Tenant-scoped; same filter clause as the
 * grouped-by-day count. Ordered by delivery window then consignee
 * name so morning windows surface first.
 */
export async function listTasksForDayAcrossConsignees(
  tx: DbTx,
  tenantId: Uuid,
  date: string,
  filters: CalendarFilters,
): Promise<readonly CalendarDayTaskRow[]> {
  const whereClause = buildFilterClause(tenantId, filters);
  const rows = await tx.execute<DayTaskRow>(sqlTag`
    SELECT
      t.id AS task_id,
      t.consignee_id,
      c.name AS consignee_name,
      c.district,
      c.crm_state,
      t.internal_status,
      t.delivery_window_start,
      t.delivery_window_end,
      t.external_tracking_number,
      t.subscription_id
    FROM tasks t
    JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id
    WHERE ${whereClause}
      AND t.delivery_date = ${date}
    ORDER BY t.delivery_window_start ASC, c.name ASC
  `);
  return rows.map((row) => ({
    taskId: row.task_id,
    consigneeId: row.consignee_id,
    consigneeName: row.consignee_name,
    district: row.district,
    crmState: row.crm_state,
    status: row.internal_status,
    deliveryWindowStart: row.delivery_window_start,
    deliveryWindowEnd: row.delivery_window_end,
    externalTrackingNumber: row.external_tracking_number,
    subscriptionId: row.subscription_id,
  }));
}

// -----------------------------------------------------------------------------
// Tenant-scoped metric snapshot
// -----------------------------------------------------------------------------

type MetricsRow = {
  active_consignees: string | number;
  today_deliveries_scheduled: string | number;
  delivered_today: string | number;
  out_for_delivery: string | number;
  failed_at_risk: string | number;
} & Record<string, unknown>;

/**
 * Compute the five header metric-card values in a single round-trip
 * for tenant-scoped actors.
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
// Day-23n — Transcorp admin cross-tenant metric snapshot
// -----------------------------------------------------------------------------

type TranscorpAdminMetricsRow = {
  active_merchants: string | number;
  total_deliveries_today: string | number;
  delivered_today: string | number;
  in_transit: string | number;
  failed_last_7_days: string | number;
} & Record<string, unknown>;

/**
 * Cross-tenant metric snapshot for the Transcorp admin variant of
 * the `/calendar` header. Caller wraps in `withServiceRole` — RLS is
 * bypassed by design; only `task:read_all`-bearing actors reach this
 * path. No tenant-scoped WHERE predicate; aggregates span every
 * merchant.
 */
export async function computeTranscorpAdminMetrics(
  tx: DbTx,
  today: string,
): Promise<CalendarMetricsTranscorpAdmin> {
  const rows = await tx.execute<TranscorpAdminMetricsRow>(sqlTag`
    SELECT
      (
        SELECT COUNT(*) FROM tenants
        WHERE status = 'active'
      ) AS active_merchants,
      (
        SELECT COUNT(*) FROM tasks
        WHERE delivery_date = ${today}
      ) AS total_deliveries_today,
      (
        SELECT COUNT(*) FROM tasks
        WHERE delivery_date = ${today}
          AND internal_status = 'DELIVERED'
      ) AS delivered_today,
      (
        SELECT COUNT(*) FROM tasks
        WHERE internal_status = 'IN_TRANSIT'
      ) AS in_transit,
      (
        SELECT COUNT(*) FROM tasks
        WHERE internal_status = 'FAILED'
          AND delivery_date >= (${today}::date - INTERVAL '7 days')
      ) AS failed_last_7_days
  `);
  const row = rows[0];
  return {
    activeMerchants: row ? Number(row.active_merchants) : 0,
    totalDeliveriesToday: row ? Number(row.total_deliveries_today) : 0,
    deliveredToday: row ? Number(row.delivered_today) : 0,
    inTransit: row ? Number(row.in_transit) : 0,
    failedLast7Days: row ? Number(row.failed_last_7_days) : 0,
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
 * Compose a 7-day CalendarDayCount[] from the per-day count rows.
 * Missing days fill with `{ total: 0, hasHighRisk: false }`. Pure
 * helper, no I/O — exported for direct service-layer use AND for
 * unit-test coverage.
 */
export function buildWeekDays(
  weekStart: string,
  weekEnd: string,
  perDayCounts: readonly { date: string; total: number; hasHighRisk: boolean }[],
): readonly CalendarDayCount[] {
  const countsByDate = new Map<string, { total: number; hasHighRisk: boolean }>();
  for (const row of perDayCounts) {
    countsByDate.set(row.date, { total: row.total, hasHighRisk: row.hasHighRisk });
  }
  const days: CalendarDayCount[] = [];
  let cursor = weekStart;
  while (cursor <= weekEnd) {
    const count = countsByDate.get(cursor);
    days.push({
      date: cursor,
      total: count?.total ?? 0,
      hasHighRisk: count?.hasHighRisk ?? false,
    });
    // Increment cursor by one day using UTC date math.
    const next = new Date(`${cursor}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return days;
}
