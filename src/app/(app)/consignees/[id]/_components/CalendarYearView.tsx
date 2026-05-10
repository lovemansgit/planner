// Day-21 PR-A2 / Session B — Calendar Year view (server component).
//
// Renders a 12-month aggregate heat-map per BRD §6.2.1 + DECISION-1 (b)
// (aggregate-only-with-drilldown) locked at PR #221 plan-PR. Each cell
// = one day; density (delivery count) drives bg opacity from the brand
// green token. Skip exceptions on empty days render the muted SKIPPED
// tint; append exceptions on counted days render the green-bordered
// APPENDED tint. Clicking a month header drills to that month's
// CalendarMonthView via ?view=month&month=YYYY-MM-01.
//
// Perf optimization (locked into PR-A2 scope per bootstrap brief §5.2,
// NOT a Phase 2 deferral): exceptions are pre-bucketed into a
// Map<isoDate, SubscriptionException[]> ONCE at the top of render,
// before the per-cell loop. Naive scan would be O(cells × exceptions)
// = ~365 × ~50 = ~18k iterations per render at full demo volume; the
// bucketed Map gives O(cells) walk with O(1) lookup per cell. Counts
// also bucket into Map<isoDate, { total, byStatus }> so per-cell
// density read is O(1) too.
//
// URL state: `?view=year&year=YYYY-MM-DD` (Jan-1 anchored). Default
// year = current calendar year in UTC. Prev/Next/Today nav via Link.

import Link from "next/link";

import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { DayBucketCount } from "@/modules/tasks";
import type { TaskInternalStatus } from "@/modules/tasks/types";

import {
  computeMonthEnd,
  enumerateDates,
  formatYearLabel,
  toIsoDate,
} from "./calendar-dates";

export interface CalendarYearViewProps {
  readonly consigneeId: string;
  /** First day of the displayed year — YYYY-01-01. */
  readonly yearStart: string;
  /**
   * Per-day-per-status counts within the year window, fetched server-
   * side via getConsigneeTaskCountByDayBucket. May be empty (no
   * deliveries in the window).
   */
  readonly counts: readonly DayBucketCount[];
  /**
   * Skip + append exceptions overlapping the year window. Pre-bucketed
   * into a Map for O(1) per-cell lookup before the render loop.
   */
  readonly exceptions: readonly SubscriptionException[];
}

interface DayBucket {
  readonly total: number;
  readonly byStatus: ReadonlyMap<TaskInternalStatus, number>;
}

/**
 * Density → Tailwind background class mapping. Three-channel encoding
 * per BRD §6.2.1 ("delivery, skip, and failure density"):
 *   - Failures dominate: red ramp (failure read as alarm signal,
 *     overrides delivery green even if other statuses landed same day)
 *   - Append overlay: green-bordered (anomaly highlight)
 *   - Skip-on-empty-day: muted grey + line-through (handled inline)
 *   - Delivery density: green ramp (brand canon)
 *   - Empty (no signal): visible neutral (`bg-stone-200/40`) — must
 *     NOT match `bg-paper` because the page background is paper too;
 *     blending was the root cause of the Day-21 visual gate failure.
 */
function deliveryDensityClass(total: number): string {
  if (total === 1) return "bg-green/20";
  if (total === 2) return "bg-green/40";
  return "bg-green/60";
}

function failureDensityClass(failed: number): string {
  if (failed === 1) return "bg-red/25";
  if (failed === 2) return "bg-red/45";
  return "bg-red/65";
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function CalendarYearView({
  consigneeId,
  yearStart,
  counts,
  exceptions,
}: CalendarYearViewProps) {
  const year = parseInt(yearStart.slice(0, 4), 10);

  // Pre-bucket counts by date — single pass; keep per-status detail for
  // tooltip/aria-label even though density renders aggregate.
  const countsByDate = new Map<string, DayBucket>();
  for (const c of counts) {
    const existing = countsByDate.get(c.date);
    if (existing === undefined) {
      const byStatus = new Map<TaskInternalStatus, number>();
      byStatus.set(c.status, c.count);
      countsByDate.set(c.date, { total: c.count, byStatus });
    } else {
      const byStatus = new Map(existing.byStatus);
      byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + c.count);
      countsByDate.set(c.date, { total: existing.total + c.count, byStatus });
    }
  }

  // Pre-bucket exceptions by date — locked perf optimization per
  // bootstrap brief §5.2. Single pass; per-cell access is then O(1).
  const exceptionsByDate = new Map<string, SubscriptionException[]>();
  for (const e of exceptions) {
    const bucket = exceptionsByDate.get(e.startDate);
    if (bucket === undefined) exceptionsByDate.set(e.startDate, [e]);
    else bucket.push(e);
  }

  const today = toIsoDate(new Date());
  const prevYear = `${year - 1}-01-01`;
  const nextYear = `${year + 1}-01-01`;
  const todayYear = `${new Date().getUTCFullYear()}-01-01`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=year&year=${prevYear}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Previous year"
          >
            ←
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=year&year=${nextYear}`}
            className="rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
            aria-label="Next year"
          >
            →
          </Link>
          <Link
            href={`/consignees/${consigneeId}?tab=calendar&view=year&year=${todayYear}`}
            className="ml-2 rounded-sm border border-stone-200 px-2 py-1 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:border-navy hover:text-navy"
          >
            Today
          </Link>
        </div>
        <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          {formatYearLabel(yearStart)}
        </p>
      </div>

      {/* Density legend — three channels per BRD §6.2.1 (delivery,
          skip, failure). Each cell on the grid is a hairline-bordered
          square so the structure stays visible even on empty days
          (the original Day-21 visual-gate fix-up; bg-paper blended
          with the page bg). */}
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
        <span>Deliveries</span>
        <span>Less</span>
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-stone-200/40" />
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-green/20" />
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-green/40" />
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-green/60" />
        <span>More</span>
        <span className="ml-2">Failures</span>
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-red/25" />
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-red/45" />
        <span className="h-3 w-3 rounded-sm border border-stone-200/60 bg-red/65" />
        <span className="ml-2 inline-block h-3 w-3 rounded-sm border border-stone-200/60 bg-[color:var(--color-text-secondary)]/15 line-through" />
        <span>Skipped</span>
        <span className="ml-2 inline-block h-3 w-3 rounded-sm border border-green/40 bg-green/10" />
        <span>Appended</span>
      </div>

      {/* Outer month-block grid. xl:grid-cols-12 lays all 12 months
          side-by-side on standard ~1280px viewports per Love's spec
          ("12 month-blocks fit on the year-view surface side-by-side").
          Smaller viewports wrap progressively. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12">
        {MONTH_NAMES.map((monthName, monthIdx) => {
          const monthAnchor = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
          const monthEnd = computeMonthEnd(new Date(`${monthAnchor}T00:00:00Z`));
          const monthDays = enumerateDates(monthAnchor, monthEnd);
          // Week-grid offset — leading blank cells until the first weekday.
          const firstWeekday = new Date(`${monthAnchor}T00:00:00Z`).getUTCDay();
          const isoFirstWeekday = firstWeekday === 0 ? 7 : firstWeekday;
          const leadingBlanks = isoFirstWeekday - 1;
          const cells: ({ readonly kind: "blank" } | { readonly kind: "day"; readonly date: string })[] =
            [];
          for (let i = 0; i < leadingBlanks; i++) cells.push({ kind: "blank" });
          for (const date of monthDays) cells.push({ kind: "day", date });
          return (
            <Link
              key={monthAnchor}
              href={`/consignees/${consigneeId}?tab=calendar&view=month&month=${monthAnchor}`}
              className="block rounded-sm transition-colors duration-[120ms] ease-out hover:bg-ivory/60"
              aria-label={`Drill to ${monthName} ${year} month view`}
            >
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-navy">
                {monthName}
              </span>
              <div className="grid grid-cols-7 gap-px">
                {cells.map((cell, idx) => {
                  if (cell.kind === "blank") {
                    return <div key={`blank-${idx}`} className="aspect-square w-full" />;
                  }
                  const bucket = countsByDate.get(cell.date);
                  const dayExceptions = exceptionsByDate.get(cell.date) ?? [];
                  const total = bucket?.total ?? 0;
                  const failed = bucket?.byStatus.get("FAILED") ?? 0;
                  const isToday = cell.date === today;
                  const skipException = dayExceptions.find((e) => e.type === "skip");
                  const appendException = dayExceptions.find(
                    (e) => e.type === "append_without_skip",
                  );
                  // Render precedence — failures dominate (alarm signal
                  // overrides delivery green); append shows as anomaly
                  // border; skip on empty day reads as muted grey;
                  // otherwise delivery-density green; empty days get a
                  // visible neutral so the grid skeleton is readable.
                  let bgClass: string;
                  let lineThrough = "";
                  if (failed > 0) {
                    bgClass = failureDensityClass(failed);
                  } else if (total === 0 && skipException !== undefined) {
                    bgClass = "bg-[color:var(--color-text-secondary)]/15";
                    lineThrough = " line-through";
                  } else if (total > 0) {
                    bgClass = deliveryDensityClass(total);
                  } else {
                    bgClass = "bg-stone-200/40";
                  }
                  const borderClass =
                    appendException !== undefined
                      ? "border border-green/40"
                      : "border border-stone-200/60";
                  const todayRing = isToday ? " ring-1 ring-green" : "";
                  // Aria-label + native title surface per-status
                  // breakdown so hover + assistive tech see the same
                  // signal: "3 delivered, 1 failed" rather than just
                  // "4 deliveries".
                  const breakdown = bucket
                    ? Array.from(bucket.byStatus.entries())
                        .map(([s, n]) => `${n} ${s.toLowerCase()}`)
                        .join(", ")
                    : skipException !== undefined
                      ? "skipped"
                      : "no deliveries";
                  return (
                    <div
                      key={cell.date}
                      title={`${cell.date} — ${breakdown}`}
                      aria-label={`${cell.date}: ${breakdown}`}
                      className={`aspect-square w-full rounded-sm ${borderClass} ${bgClass}${lineThrough}${todayRing}`}
                    />
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
