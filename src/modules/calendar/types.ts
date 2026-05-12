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
  /** Exact match against tasks.internal_status. */
  readonly status?: string;
}
