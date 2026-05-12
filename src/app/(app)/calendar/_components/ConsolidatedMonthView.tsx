// Day-23 PM — ConsolidatedMonthView (server component).
//
// Calendar-grid month view for the /calendar consolidated surface
// (brief §3.3.4 line 522-525). Renders a 7-column Mon-Sun grid spanning
// the month-grid window (Monday of week-of-1st → Sunday of week-of-last
// day), so the grid is always 28, 35, or 42 cells.
//
// Each cell renders:
//   - Date number (DD)
//   - Aggregate task count (font-display tabular-nums) when total > 0
//   - HIGH_RISK marker when any task on that day is for a HIGH_RISK
//     consignee
//   - Click-through link to /calendar?view=day&date=<iso>, preserving
//     active filters in the URL trail
//
// Visual states (brand-canon per brief §3.3.11):
//   - In-month + today: navy-subtle backdrop, navy text
//   - In-month + not today: paper backdrop, navy text
//   - Out-of-month (leading / trailing cells from prev / next month):
//     muted text + reduced opacity. Still clickable so an operator can
//     drill into adjacent days without first moving the month anchor.
//
// Weekday headers (Mon..Sun) render once above the grid. No nav inside
// the component — month nav lives in the page header alongside the
// view toggle (mirroring the WeekAnchorNav pattern).

import Link from "next/link";

import type { CalendarDayCount } from "../_types";

export interface ConsolidatedMonthViewProps {
  /** Anchor for the displayed month (YYYY-MM-01). */
  readonly monthAnchor: string;
  /** 28-42 day cells covering the month-grid window. */
  readonly days: readonly CalendarDayCount[];
  /** Today in Asia/Dubai, ISO YYYY-MM-DD. */
  readonly today: string;
  /** Pre-URL-encoded filter trail (q, crm, district, status). */
  readonly preservedQuery?: string;
}

const WEEKDAY_HEADERS: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ConsolidatedMonthView({
  monthAnchor,
  days,
  today,
  preservedQuery,
}: ConsolidatedMonthViewProps) {
  const monthIndex = parseMonthIndex(monthAnchor);
  return (
    <div data-month-anchor={monthAnchor}>
      <div
        aria-hidden="true"
        className="mb-px grid grid-cols-7 gap-px bg-stone-200 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
      >
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="bg-surface-primary px-3 py-2">
            {label}
          </div>
        ))}
      </div>
      <div
        role="grid"
        aria-label={`Month grid anchored at ${monthAnchor}`}
        className="grid grid-cols-7 gap-px overflow-hidden border border-stone-200 bg-stone-200"
      >
        {days.map((day) => (
          <MonthCell
            key={day.date}
            day={day}
            isToday={day.date === today}
            isInMonth={isDateInMonth(day.date, monthIndex)}
            preservedQuery={preservedQuery}
          />
        ))}
      </div>
    </div>
  );
}

interface MonthCellProps {
  readonly day: CalendarDayCount;
  readonly isToday: boolean;
  readonly isInMonth: boolean;
  readonly preservedQuery?: string;
}

function MonthCell({ day, isToday, isInMonth, preservedQuery }: MonthCellProps) {
  const trail = preservedQuery ? `&${preservedQuery}` : "";
  const href = `/calendar?view=day&date=${day.date}${trail}`;
  const dayNumber = day.date.slice(8, 10);
  const backdrop = isToday
    ? "bg-[color:var(--color-tint-navy-subtle)]"
    : "bg-paper";
  const numberTone = isInMonth
    ? "text-navy"
    : "text-[color:var(--color-text-tertiary)]";
  const totalTone = isInMonth
    ? "text-navy"
    : "text-[color:var(--color-text-tertiary)]/70";
  return (
    <Link
      href={href}
      data-day={day.date}
      data-in-month={isInMonth ? "true" : "false"}
      data-is-today={isToday ? "true" : "false"}
      aria-label={`View deliveries on ${day.date}`}
      className={`group flex min-h-[96px] flex-col transition-colors duration-[120ms] ease-out hover:bg-stone-100 ${backdrop}`}
    >
      <header className="flex items-baseline justify-between px-3 pt-2">
        <p className={`text-sm tabular-nums ${numberTone}`}>{dayNumber}</p>
        {day.hasHighRisk ? (
          <span
            aria-label="High-risk consignee on this day"
            title="High-risk consignee"
            className="text-[9px] font-medium uppercase tracking-[0.14em] text-red"
          >
            ●
          </span>
        ) : null}
      </header>
      <div className="px-3 pb-2">
        {day.total > 0 ? (
          <p className={`font-display text-xl font-semibold tabular-nums leading-none ${totalTone}`}>
            {day.total}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * Parse the year + month index from an ISO YYYY-MM-DD anchor. Pure
 * helper — exported for spec coverage.
 */
export function parseMonthIndex(monthAnchor: string): {
  readonly year: number;
  readonly month: number; // 1-12
} {
  return {
    year: Number(monthAnchor.slice(0, 4)),
    month: Number(monthAnchor.slice(5, 7)),
  };
}

/**
 * True iff the given ISO YYYY-MM-DD date falls within the same year +
 * month as the anchor. Used to dim out-of-month cells (leading /
 * trailing days from the previous / next month) in the grid.
 */
export function isDateInMonth(
  date: string,
  monthIndex: { readonly year: number; readonly month: number },
): boolean {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return year === monthIndex.year && month === monthIndex.month;
}
