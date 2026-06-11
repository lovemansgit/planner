// Day-22n PR-C-A + Day-23n polish — ConsolidatedWeekView (server
// component).
//
// 7-column day grid (Mon → Sun) for the /calendar week view. Each
// cell renders:
//   - eyebrow weekday label + DD MMM date (date label underlined
//     on hover per brand-canon)
//   - hero count numeral when total > 0 (font-display, tabular-nums)
//   - "No deliveries" sentence-case copy when total === 0
//   - HIGH_RISK marker on the header eyebrow when any task on the
//     day is for a HIGH_RISK consignee
//
// Day-23n polish: top-3 task-preview rows + overflow line removed.
// The day cell is now a click-through `<Link>` to
// `/calendar?view=day&date=<iso>` so the operator drills into the
// day view for full task detail.
//
// Today's column carries the --color-tint-navy-subtle atmosphere
// background per §J-3.

import Link from "next/link";

import type { CalendarDayCount } from "../_types";

export interface ConsolidatedWeekViewProps {
  readonly weekStart: string; // ISO YYYY-MM-DD Monday
  readonly days: readonly CalendarDayCount[]; // expected length 7
  readonly today: string; // ISO YYYY-MM-DD in Dubai
  readonly formatWeekdayLabel: (iso: string) => { weekday: string; date: string };
  /**
   * Already-URL-encoded query string of active filters (q, crm,
   * district, status) preserved on the day-drill link. Empty when no
   * filters are active.
   */
  readonly preservedQuery?: string;
}

export function ConsolidatedWeekView({
  weekStart,
  days,
  today,
  formatWeekdayLabel,
  preservedQuery,
}: ConsolidatedWeekViewProps) {
  if (days.length === 0) {
    return (
      <div className="border border-stone-200 bg-paper px-6 py-16 text-center">
        <p className="text-sm text-[color:var(--color-text-secondary)]">
          No deliveries this week. Adjust filters or pick a different week.
        </p>
      </div>
    );
  }

  return (
    <div
      data-week-start={weekStart}
      className="grid grid-cols-1 gap-px overflow-hidden border border-stone-200 bg-stone-200 sm:grid-cols-2 lg:grid-cols-7"
    >
      {days.map((day) => (
        <DayCell
          key={day.date}
          day={day}
          isToday={day.date === today}
          formatWeekdayLabel={formatWeekdayLabel}
          preservedQuery={preservedQuery}
        />
      ))}
    </div>
  );
}

interface DayCellProps {
  readonly day: CalendarDayCount;
  readonly isToday: boolean;
  readonly formatWeekdayLabel: (iso: string) => { weekday: string; date: string };
  readonly preservedQuery?: string;
}

function DayCell({ day, isToday, formatWeekdayLabel, preservedQuery }: DayCellProps) {
  const { weekday, date } = formatWeekdayLabel(day.date);
  const backdrop = isToday
    ? "bg-[color:var(--color-tint-navy-subtle)]"
    : "bg-paper";
  const trail = preservedQuery ? `&${preservedQuery}` : "";
  const href = `/calendar?view=day&date=${day.date}${trail}`;
  return (
    <Link
      href={href}
      data-day={day.date}
      data-is-today={isToday ? "true" : "false"}
      aria-label={`View deliveries on ${day.date}`}
      className={`group flex min-h-[140px] flex-col transition-colors duration-[120ms] ease-out hover:bg-stone-100 ${backdrop}`}
    >
      <header className="flex items-baseline justify-between px-3 pt-3 pb-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            {weekday}
          </p>
          <p className="text-xs tabular-nums text-[color:var(--color-text-secondary)] underline decoration-transparent underline-offset-4 group-hover:decoration-navy">
            {date}
          </p>
        </div>
        {day.hasHighRisk ? (
          <span
            aria-label="High-risk consignee on this day"
            title="High-risk consignee"
            className="text-[10px] font-medium uppercase tracking-[0.14em] text-red"
          >
            ● High risk
          </span>
        ) : null}
      </header>
      <div className="px-3 pb-3">
        {day.total > 0 ? (
          <p className="font-display text-3xl font-semibold tabular-nums leading-none text-navy">
            {day.total}
          </p>
        ) : (
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            No deliveries
          </p>
        )}
      </div>
    </Link>
  );
}
