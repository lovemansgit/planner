// Day-22n PR-C-A + Day-23n polish — Service-layer input shapes for
// `/calendar` consolidated cross-consignee view (brief §3.3.4).
//
// Domain-output shapes (CalendarMetrics, CalendarMetricsTranscorpAdmin,
// CalendarDayCount) live in the UI-side type contract at
// src/app/(app)/calendar/_types.ts so the week-view primitives and
// the service-layer agree on a single source of truth. This module
// re-exports them and adds the filter-input shape used by repo +
// service.

export type {
  CalendarMetrics,
  CalendarMetricsTranscorpAdmin,
  CalendarTopMerchantToday,
  CalendarPerMerchantBreakdownRow,
  CalendarDayCount,
  CalendarDayTaskRow,
} from "@/app/(app)/calendar/_types";

/**
 * Filter input accepted by the calendar service-layer reads. Each
 * field is optional; an undefined / empty value means "no filter
 * applied for this dimension". Mirrors the URL-state shape on the
 * page side (CalendarFiltersValue in `_types.ts`) — kept as a
 * separate type so the service signature is independent of the
 * URL-parser layer.
 *
 * Day-23n polish — `window` (time-of-day) filter dropped; no consumer
 * in the post-narrowing UX.
 */
export interface CalendarFilters {
  /** Substring match against consignees.name (case-insensitive). */
  readonly q?: string;
  /** Exact match against consignees.crm_state. */
  readonly crm?: string;
  /** Exact match against consignees.district. */
  readonly district?: string;
  /**
   * D56 Phase 8 / Lane 4 (Love's E1 ruling) — exact match against the FINE
   * `tasks.courier_status` (the 14-state vocabulary), NOT the coarse
   * `internal_status`. Single source of truth: `?status=` carries the fine
   * filter on `/calendar` exactly as on `/tasks`. NULL-courier rows never
   * match a fine filter (appear only under "All"). A stale coarse value is
   * dropped to undefined ("All") at the page boundary via parseCourierStatusParam.
   */
  readonly status?: string;
}
