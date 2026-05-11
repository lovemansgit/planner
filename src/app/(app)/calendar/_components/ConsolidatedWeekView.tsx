// Day-22n PR-C-A § §2.4 — ConsolidatedWeekView (server component).
//
// 7-column day grid (Mon → Sun) for the /calendar week view. Each
// cell renders:
//   - eyebrow weekday label + DD MMM date
//   - hero count numeral when total > 0 (font-display, tabular-nums)
//   - "No deliveries" sentence-case copy when total === 0
//   - up to 3 TaskPreviewRow primitives (Session B's PR-C-B
//     component), ordered by delivery_start_time ASC
//   - TaskPreviewOverflow line for `total - topTasks.length` when > 0
//
// Today's column carries the --color-tint-navy-subtle atmosphere
// background per §J-3. HIGH_RISK marker on the header eyebrow when
// any task on the day is for a HIGH_RISK consignee.
//
// Pure server component — no client-side state. The interactive
// elements (TaskPreviewRow's <Link>, the filter bar above) live in
// their own components.

import {
  TaskPreviewOverflow,
  TaskPreviewRow,
} from "./TaskPreviewRow";
import type { CalendarDayCount } from "../_types";

export interface ConsolidatedWeekViewProps {
  readonly weekStart: string; // ISO YYYY-MM-DD Monday
  readonly days: readonly CalendarDayCount[]; // expected length 7
  readonly today: string; // ISO YYYY-MM-DD in Dubai
  readonly formatWeekdayLabel: (iso: string) => { weekday: string; date: string };
}

export function ConsolidatedWeekView({
  weekStart,
  days,
  today,
  formatWeekdayLabel,
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
        />
      ))}
    </div>
  );
}

interface DayCellProps {
  readonly day: CalendarDayCount;
  readonly isToday: boolean;
  readonly formatWeekdayLabel: (iso: string) => { weekday: string; date: string };
}

function DayCell({ day, isToday, formatWeekdayLabel }: DayCellProps) {
  const { weekday, date } = formatWeekdayLabel(day.date);
  const hiddenCount = day.total - day.topTasks.length;
  const backdrop = isToday
    ? "bg-[color:var(--color-tint-navy-subtle)]"
    : "bg-paper";
  return (
    <article
      data-day={day.date}
      data-is-today={isToday ? "true" : "false"}
      className={`flex min-h-[180px] flex-col ${backdrop}`}
    >
      <header className="flex items-baseline justify-between px-3 pt-3 pb-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            {weekday}
          </p>
          <p className="text-xs tabular-nums text-[color:var(--color-text-secondary)]">
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
      <div className="px-3 pb-2">
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
      {day.topTasks.length > 0 ? (
        <div className="flex flex-col">
          {day.topTasks.map((task) => (
            <TaskPreviewRow key={task.taskId} task={task} deliveryDate={day.date} />
          ))}
          <TaskPreviewOverflow hiddenCount={hiddenCount} />
        </div>
      ) : null}
    </article>
  );
}
