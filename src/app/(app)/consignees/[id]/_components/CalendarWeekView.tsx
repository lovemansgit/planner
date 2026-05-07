// Day 17 / Session A — Calendar Week view (server component).
//
// Renders a 7-column ISO-weekday grid (Mon-Sun) with task cards
// stacked per day. Per brief §3.3.3: Week is the operator-default
// view; Month + Year deferred to Day-18 brand pass.
//
// URL state: `?week=YYYY-MM-DD` (Monday-anchored). Default = current
// week's Monday in Asia/Dubai. Prev/Next/Today nav via Link components.
//
// Tasks fetched server-side via getConsigneeTasksForDateRange; the
// data + per-day partition happens in this component, then individual
// day cells render as <DayCell> with click target wired to the
// DayActionPopover client component.

import Link from "next/link";

import type { Task, TaskInternalStatus } from "@/modules/tasks/types";

import { DayActionPopover } from "./DayActionPopover";

export interface CalendarWeekViewProps {
  readonly consigneeId: string;
  /** ISO date (YYYY-MM-DD) anchoring the visible week's Monday. */
  readonly weekStart: string;
  /** Tasks within the visible week, pre-fetched by the page. */
  readonly tasks: readonly Task[];
  /** Whether the actor has subscription:skip permission. Drives popover button visibility. */
  readonly canSkip: boolean;
}

/** Compute the ISO Monday of the week containing the given date. */
export function computeWeekStart(date: Date): string {
  // ISO weekday: Mon=1...Sun=7. JS getDay(): Sun=0...Sat=6.
  const jsDay = date.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const daysToMonday = isoDay - 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysToMonday);
  return toIsoDate(monday);
}

/** Add `days` to an ISO date string, returning a new ISO date string. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Stringify a Date as YYYY-MM-DD (UTC). */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Display the day name + numeric date in header rows. */
function formatDayHeader(isoDate: string): { weekday: string; dayNum: string } {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const dayNum = String(d.getUTCDate()).padStart(2, "0");
  return { weekday, dayNum };
}

/**
 * Status visual mapping for tasks shown in the calendar.
 *
 * Aligned with TaskInternalStatus enum at src/modules/tasks/types.ts:33-39.
 * If/when SKIPPED is added to the wire enum (currently set via
 * tasks.internal_status='SKIPPED' per migration 0011), extend this
 * map to add the visual.
 */
const STATUS_VISUALS: Record<TaskInternalStatus, { readonly label: string; readonly classes: string }> = {
  CREATED: { label: "Scheduled", classes: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-secondary)]" },
  ASSIGNED: { label: "Assigned", classes: "bg-amber/15 text-amber" },
  IN_TRANSIT: { label: "In transit", classes: "bg-amber/20 text-amber" },
  DELIVERED: { label: "Delivered", classes: "bg-green/15 text-green" },
  FAILED: { label: "Failed", classes: "bg-red/15 text-red" },
  CANCELED: { label: "Canceled", classes: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-tertiary)] line-through" },
  ON_HOLD: { label: "On hold", classes: "bg-[color:var(--color-text-secondary)]/20 text-[color:var(--color-text-secondary)]" },
};

export function CalendarWeekView({
  consigneeId,
  weekStart,
  tasks,
  canSkip,
}: CalendarWeekViewProps) {
  // Build 7-day window starting from weekStart.
  const days: readonly string[] = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Partition tasks by deliveryDate (ISO YYYY-MM-DD).
  const tasksByDate: Record<string, Task[]> = {};
  for (const t of tasks) {
    if (!tasksByDate[t.deliveryDate]) tasksByDate[t.deliveryDate] = [];
    tasksByDate[t.deliveryDate].push(t);
  }

  const today = toIsoDate(new Date());
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);
  const todayWeek = computeWeekStart(new Date());

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&week=${prevWeek}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Previous week"
          >
            ←
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&week=${nextWeek}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Next week"
          >
            →
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&week=${todayWeek}`}
            className="ml-2 rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
          >
            Today
          </Link>
        </div>
        <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          Week of {weekStart}
        </p>
      </div>

      <div className="grid grid-cols-7 gap-px border border-stone-200 bg-stone-200">
        {days.map((isoDate) => {
          const header = formatDayHeader(isoDate);
          const dayTasks = tasksByDate[isoDate] ?? [];
          const isToday = isoDate === today;
          return (
            <div
              key={isoDate}
              className="min-h-[140px] bg-paper p-2"
            >
              <div className="mb-2 flex items-baseline justify-between">
                <p
                  className={
                    isToday
                      ? "text-[10px] font-medium uppercase tracking-[0.14em] text-green"
                      : "text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
                  }
                >
                  {header.weekday}
                </p>
                <p
                  className={
                    isToday
                      ? "font-display text-sm font-semibold text-green"
                      : "font-display text-sm text-navy"
                  }
                >
                  {header.dayNum}
                </p>
              </div>
              {dayTasks.length === 0 ? (
                <p className="text-[10px] text-[color:var(--color-text-tertiary)]">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {dayTasks.map((task) => {
                    const visual = STATUS_VISUALS[task.internalStatus];
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
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
