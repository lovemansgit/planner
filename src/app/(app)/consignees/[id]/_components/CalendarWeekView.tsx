// Day 17 / Session A — Calendar Week view (server component).
// Day-20 §3.3.3 — extended with DayDisplayStatus projection (DECISION-2 ii)
// + CalendarStatusLegend + AddressIndicator + SKIPPED-no-task render.
//
// Renders a 7-column ISO-weekday grid (Mon-Sun) with task cards
// stacked per day. Per brief §3.3.3: Week is the operator-default
// view; Month + Year deferred to Day-21 AM lane.
//
// URL state: `?week=YYYY-MM-DD` (Monday-anchored). Default = current
// week's Monday in Asia/Dubai. Prev/Next/Today nav via Link components.
//
// Tasks + skip/append exceptions fetched server-side; the data + per-day
// partition + DayDisplayStatus projection happens here. Individual day
// cells render via DayActionPopover or CalendarPodCard (when
// DELIVERED + populated POD photos).

import Link from "next/link";

import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { ConsigneeAddressRow } from "@/modules/subscription-addresses";
import type { Task } from "@/modules/tasks/types";

import { addDays, computeWeekStart, toIsoDate } from "./calendar-dates";
import { CalendarPodCard } from "./CalendarPodCard";
import { CalendarStatusLegend } from "./CalendarStatusLegend";
import {
  DAY_DISPLAY_VISUALS,
  projectDayDisplayStatus,
} from "./DayDisplayStatus";
import { DayActionPopover, type CalendarActionPermissions } from "./DayActionPopover";

export interface CalendarWeekViewProps {
  readonly consigneeId: string;
  /** ISO date (YYYY-MM-DD) anchoring the visible week's Monday. */
  readonly weekStart: string;
  /** Tasks within the visible week, pre-fetched by the page. */
  readonly tasks: readonly Task[];
  /**
   * Day-20 §3.3.3 — skip + append exceptions overlapping the visible
   * week, pre-fetched by the page. Drive SKIPPED-no-task render +
   * APPENDED visual override on existing tasks.
   */
  readonly exceptions: readonly SubscriptionException[];
  /** Day-22 / PR-B — actor's calendar-action permissions. Drives popover button visibility per brief §3.3.10 rule 1. */
  readonly permissions: CalendarActionPermissions;
  /** Day-22 / PR-B — consignee's addresses for the popover address-override actions (4 + 5). */
  readonly availableAddresses: readonly ConsigneeAddressRow[];
}

/** Display the day name + numeric date in header rows. */
function formatDayHeader(isoDate: string): { weekday: string; dayNum: string } {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const dayNum = String(d.getUTCDate()).padStart(2, "0");
  return { weekday, dayNum };
}

export function CalendarWeekView({
  consigneeId,
  weekStart,
  tasks,
  exceptions,
  permissions,
  availableAddresses,
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

      <CalendarStatusLegend />

      <div className="grid grid-cols-7 gap-px border border-stone-200 bg-stone-200">
        {days.map((isoDate) => {
          const header = formatDayHeader(isoDate);
          const dayTasks = tasksByDate[isoDate] ?? [];
          const isToday = isoDate === today;
          // Day-20 §3.3.3 — skip-no-task render: when there's no task
          // for this date but a skip exception falls on it, show a
          // SKIPPED marker. projectDayDisplayStatus(null, ...) returns
          // "SKIPPED" in this branch.
          const skipForDay = dayTasks.length === 0
            ? projectDayDisplayStatus(null, exceptions, isoDate)
            : null;
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
              {dayTasks.length === 0 && skipForDay === null ? (
                <p className="text-[10px] text-[color:var(--color-text-tertiary)]">—</p>
              ) : null}
              {dayTasks.length === 0 && skipForDay !== null ? (
                <span
                  className={`block w-full rounded-sm px-1.5 py-1 text-left text-[10px] font-medium uppercase tracking-[0.1em] ${DAY_DISPLAY_VISUALS[skipForDay].classes}`}
                >
                  {DAY_DISPLAY_VISUALS[skipForDay].label}
                </span>
              ) : null}
              {dayTasks.length > 0 ? (
                <ul className="space-y-1.5">
                  {dayTasks.map((task) => {
                    const displayStatus = projectDayDisplayStatus(
                      task,
                      exceptions,
                      isoDate,
                    );
                    // displayStatus is non-null when task is non-null
                    // (projection contract). Type-narrow defensively.
                    if (displayStatus === null) return null;
                    const visual = DAY_DISPLAY_VISUALS[displayStatus];
                    const subscriptionId = task.subscriptionId;
                    // Plan §6.2 interpretation (ii): swap trigger to inline
                    // POD card when DELIVERED + populated photos. All
                    // other states (incl. DELIVERED with no POD yet)
                    // keep the popover.
                    const showPodCard =
                      task.internalStatus === "DELIVERED" &&
                      task.podPhotos !== null &&
                      task.podPhotos.length > 0;
                    return (
                      <li key={task.id}>
                        {showPodCard ? (
                          <CalendarPodCard
                            photos={task.podPhotos as readonly string[]}
                            statusLabel={visual.label}
                            statusClasses={visual.classes}
                            timeWindow={`${task.deliveryStartTime.slice(0, 5)}–${task.deliveryEndTime.slice(0, 5)}`}
                            deliveryDate={task.deliveryDate}
                            addressLabel={task.addressLabel}
                          />
                        ) : (
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
                            addressLabel={task.addressLabel}
                            outboundSyncState={task.outboundSyncState}
                          />
                        )}
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
