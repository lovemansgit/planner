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

import type { SubscriptionException } from "@/modules/subscription-exceptions";
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
  DAY_DISPLAY_VISUALS,
  projectDayDisplayStatus,
} from "./DayDisplayStatus";
import { DayActionPopover } from "./DayActionPopover";

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
  /** Whether the actor has subscription:skip permission. */
  readonly canSkip: boolean;
}

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function CalendarMonthView({
  consigneeId,
  monthStart,
  tasks,
  exceptions,
  canSkip,
}: CalendarMonthViewProps) {
  const monthEnd = computeMonthEnd(new Date(`${monthStart}T00:00:00Z`));
  const gridStart = computeMonthGridStart(monthStart);
  const gridEnd = computeMonthGridEnd(monthEnd);
  const days = enumerateDates(gridStart, gridEnd);

  // Partition tasks by deliveryDate for O(1) per-cell lookup.
  const tasksByDate: Record<string, Task[]> = {};
  for (const t of tasks) {
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${prevMonth}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Previous month"
          >
            ←
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${nextMonth}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Next month"
          >
            →
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${todayMonth}`}
            className="ml-2 rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
          >
            Today
          </Link>
        </div>
        <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          {formatMonthLabel(monthStart)}
        </p>
      </div>

      <CalendarStatusLegend />

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
          const skipForDay =
            dayTasks.length === 0
              ? projectDayDisplayStatus(null, exceptions, isoDate)
              : null;
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
              {dayTasks.length === 0 && skipForDay !== null ? (
                <span
                  className={`block w-full rounded-sm px-1 py-0.5 text-left text-[9px] font-medium uppercase tracking-[0.1em] ${DAY_DISPLAY_VISUALS[skipForDay].classes}`}
                >
                  {DAY_DISPLAY_VISUALS[skipForDay].label}
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
                    const visual = DAY_DISPLAY_VISUALS[displayStatus];
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
                          canSkip={canSkip}
                          addressLabel={null}
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
    </div>
  );
}
