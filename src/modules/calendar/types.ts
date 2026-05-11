// Day-22n PR-C-A — Service-layer input shapes for `/calendar`
// consolidated cross-consignee view (brief §3.3.4).
//
// Domain-output shapes (CalendarMetrics, CalendarDayCount,
// CalendarTopTaskForDay) live in the UI-side type contract at
// src/app/(app)/calendar/_types.ts (PR-C-B, Session B) so the
// week-view primitives and the service-layer agree on a single
// source of truth. This module re-exports them for service-layer
// consumers and adds the filter-input shape used by repo + service.

export type {
  CalendarMetrics,
  CalendarDayCount,
  CalendarTopTaskForDay,
} from "@/app/(app)/calendar/_types";

/**
 * Filter input accepted by the calendar service-layer reads. Each
 * field is optional; an undefined / empty value means "no filter
 * applied for this dimension". Mirrors the URL-state shape on the
 * page side (CalendarFiltersValue in `_types.ts`) — kept as a
 * separate type so the service signature is independent of the
 * URL-parser layer.
 */
export interface CalendarFilters {
  /** Substring match against consignees.name (case-insensitive). */
  readonly q?: string;
  /** Exact match against consignees.crm_state. */
  readonly crm?: string;
  /** Exact match against consignees.district. */
  readonly district?: string;
  /**
   * Canonical time-window key. One of {"morning", "afternoon",
   * "evening"} — translated to a delivery_start_time range inside
   * the repo. Empty / undefined disables the filter.
   */
  readonly window?: string;
  /** Exact match against tasks.internal_status. */
  readonly status?: string;
}
