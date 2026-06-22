// Day-21 PR-A2 / Session B — Calendar Month view (server component).
//
// Renders a 5-6 week × 7 day grid for the month containing
// `monthStart`. Leading days from the previous month + trailing days
// from the next month render muted; in-month days render the
// condensed delivery card (status pill + time only — no
// AddressIndicator, no inline POD per brief §3.3.3 line 487, which
// reserves AddressIndicator to the Week-view affordance). Operators
// open DayActionPopover for the per-delivery detail surface.
//
// URL state: `?view=month&month=YYYY-MM-DD` (first-of-month anchored).
// Default month = current calendar month in UTC. Prev/Next/Today nav
// via Link components. The Week/Month/Year toggle (CalendarViewToggle)
// sits above this surface in the page chrome.
//
// Same DayDisplayStatus projection as Week view (DECISION-2 ii) so the
// status legend reads consistently across views. Tasks + exceptions
// fetched server-side over the month-grid range
// (computeMonthGridStart..computeMonthGridEnd) so the Mon-of-first-week
// → Sun-of-last-week cells all paint without per-cell I/O.

import Link from "next/link";

import { CourierStatusFilter } from "@/app/(app)/tasks/_components/CourierStatusFilter";
import type { CourierStatus } from "@/modules/integration";
import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { ConsigneeAddressRow } from "@/modules/subscription-addresses";
import type { Task } from "@/modules/tasks/types";

import {
  addDays,
  computeMonthEnd,
  computeMonthGridEnd,
  computeMonthGridStart,
  computeMonthStart,
  enumerateDates,
  formatMonthLabel,
  toIsoDate,
} from "./calendar-dates";
import { CalendarStatusLegend } from "./CalendarStatusLegend";
import {
  dayCellVisual,
  filterTasksByCourierStatus,
  projectDayDisplayStatus,
} from "./DayDisplayStatus";
import { DayActionPopover, type CalendarActionPermissions } from "./DayActionPopover";

export interface CalendarMonthViewProps {
  readonly consigneeId: string;
  /** First day of the displayed month — YYYY-MM-01. */
  readonly monthStart: string;
  /**
   * Tasks within the month-grid range
   * (computeMonthGridStart..computeMonthGridEnd, NOT just the calendar
   * month). Off-month leading/trailing days stay rendered too —
   * standard month-grid UX.
   */
  readonly tasks: readonly Task[];
  /**
   * Skip + append exceptions overlapping the month-grid range.
   * Drives SKIPPED-no-task render + APPENDED visual override on
   * existing tasks per DECISION-2 (ii) projection.
   */
  readonly exceptions: readonly SubscriptionException[];
  /** Day-22 / PR-B — actor's calendar-action permissions. Drives popover button visibility per brief §3.3.10 rule 1. */
  readonly permissions: CalendarActionPermissions;
  /** Day-22 / PR-B — consignee's addresses for the popover address-override actions (4 + 5). */
  readonly availableAddresses: readonly ConsigneeAddressRow[];
  /**
   * Day-30 / Fix-A2 (Aqib UAT 2026-05-18) — tenant-scoped set of task
   * IDs with unresolved failed_pushes; threaded to DayActionPopover
   * for the "Failed push" badge. Empty when the operator lacks
   * `failed_pushes:read`.
   */
  readonly failedPushTaskIds: ReadonlySet<string>;
  /**
   * Day-54 / R-E — whether this consignee is CHURNED. Drives the
   * recall badges on driver-bound rows ("Recall requested — awaiting
   * vendor" / "Vendor refused recall — final delivery").
   */
  readonly consigneeChurned: boolean;
  /**
   * D56 Phase 8 / Lane 4 — active fine courier-status filter (`?status=`),
   * or null for the "All" view. Narrows the rendered deliveries to a single
   * fine state (mirrors /tasks); when set, the no-task skip markers are
   * suppressed (a skipped day has no delivery of the filtered status).
   */
  readonly courierStatusFilter?: CourierStatus | null;
}

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function CalendarMonthView({
  consigneeId,
  monthStart,
  tasks,
  consigneeChurned,
  exceptions,
  permissions,
  availableAddresses,
  failedPushTaskIds,
  courierStatusFilter = null,
}: CalendarMonthViewProps) {
  const monthEnd = computeMonthEnd(new Date(`${monthStart}T00:00:00Z`));
  const gridStart = computeMonthGridStart(monthStart);
  const gridEnd = computeMonthGridEnd(monthEnd);
  const days = enumerateDates(gridStart, gridEnd);

  // D56 Lane 4 — narrow to the single fine courier state when a filter is
  // active (NULL-courier rows drop out, mirroring the /tasks server filter).
  const visibleTasks = filterTasksByCourierStatus(tasks, courierStatusFilter);
  const isFiltered = courierStatusFilter !== null;

  // Partition tasks by deliveryDate for O(1) per-cell lookup.
  const tasksByDate: Record<string, Task[]> = {};
  for (const t of visibleTasks) {
    if (!tasksByDate[t.deliveryDate]) tasksByDate[t.deliveryDate] = [];
    tasksByDate[t.deliveryDate].push(t);
  }

  const today = toIsoDate(new Date());
  const prevMonth = computeMonthStart(
    new Date(`${addDays(monthStart, -1)}T00:00:00Z`),
  );
  const nextMonth = computeMonthStart(
    new Date(`${addDays(monthEnd, 1)}T00:00:00Z`),
  );
  const todayMonth = computeMonthStart(new Date());
  // Preserve the active fine-status filter across month navigation.
  const statusSuffix = courierStatusFilter ? `&status=${courierStatusFilter}` : "";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${prevMonth}${statusSuffix}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Previous month"
          >
            ←
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${nextMonth}${statusSuffix}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Next month"
          >
            →
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${todayMonth}${statusSuffix}`}
            className="ml-2 rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
          >
            Today
          </Link>
        </div>
        <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          {formatMonthLabel(monthStart)}
        </p>
      </div>

      {/* D56 Lane 4 — fine-14 courier-status filter (shared ?status= param,
          Lane 3's component). Single fine state at a time; preserved across
          month nav above. */}
      <div className="mb-6 flex justify-end">
        <CourierStatusFilter />
      </div>

      <div className="grid grid-cols-7 gap-px border border-stone-200 bg-stone-200">
        {WEEKDAY_HEADERS.map((wd) => (
          <div
            key={wd}
            className="bg-paper px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
          >
            {wd}
          </div>
        ))}
        {days.map((isoDate) => {
          const dayTasks = tasksByDate[isoDate] ?? [];
          const isToday = isoDate === today;
          const isOffMonth = isoDate < monthStart || isoDate > monthEnd;
          // Skip markers (no-task days) are suppressed under an active fine
          // filter — a skipped day has no delivery of the filtered status.
          const skipForDay =
            dayTasks.length === 0 && !isFiltered
              ? projectDayDisplayStatus(null, exceptions, isoDate)
              : null;
          const skipVisual = skipForDay !== null ? dayCellVisual(skipForDay) : null;
          const dayNum = String(parseInt(isoDate.slice(8, 10), 10));
          return (
            <div
              key={isoDate}
              className={`min-h-[96px] p-1.5 ${isOffMonth ? "bg-ivory/40" : "bg-paper"}`}
            >
              <p
                className={
                  isToday
                    ? "mb-1 font-display text-xs font-semibold text-green"
                    : isOffMonth
                      ? "mb-1 font-display text-xs text-[color:var(--color-text-tertiary)]"
                      : "mb-1 font-display text-xs text-navy"
                }
              >
                {dayNum}
              </p>
              {skipVisual !== null ? (
                <span
                  className={`block w-full rounded-sm px-1 py-0.5 text-left text-[9px] font-medium uppercase tracking-[0.1em] ${skipVisual.classes}`}
                >
                  {skipVisual.label}
                </span>
              ) : null}
              {dayTasks.length > 0 ? (
                <ul className="space-y-1">
                  {dayTasks.map((task) => {
                    const displayStatus = projectDayDisplayStatus(
                      task,
                      exceptions,
                      isoDate,
                    );
                    if (displayStatus === null) return null;
                    const visual = dayCellVisual(displayStatus);
                    const subscriptionId = task.subscriptionId;
                    return (
                      <li key={task.id}>
                        <DayActionPopover
                          consigneeId={consigneeId}
                          subscriptionId={subscriptionId}
                          taskId={task.id}
                          deliveryDate={task.deliveryDate}
                          deliveryStartTime={task.deliveryStartTime}
                          deliveryEndTime={task.deliveryEndTime}
                          internalStatus={task.internalStatus}
                          statusLabel={visual.label}
                          statusClasses={visual.classes}
                          permissions={permissions}
                          availableAddresses={availableAddresses}
                          addressLabel={null}
                          outboundSyncState={task.outboundSyncState}
                          failedPush={failedPushTaskIds.has(task.id)}
                          consigneeChurned={consigneeChurned}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* D56 S1 (item 3) — status colour key relocated below the grid in a
          collapsed disclosure so the calendar leads the page rather than ~180px
          of colour key. The legend still teaches all 14 fine courier states;
          this is PLACEMENT only — CalendarStatusLegend + LEGEND_FAMILIES are
          unchanged, and the fine-status filter dropdown above is untouched. */}
      <details className="group mt-8 border-t border-stone-200 pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary [&::-webkit-details-marker]:hidden">
          <span>Status colour key</span>
          <span className="text-[color:var(--color-text-tertiary)] group-open:hidden" aria-hidden="true">
            Show
          </span>
          <span className="hidden text-[color:var(--color-text-tertiary)] group-open:inline" aria-hidden="true">
            Hide
          </span>
        </summary>
        <div className="mt-4">
          <CalendarStatusLegend />
        </div>
      </details>
    </div>
  );
}
