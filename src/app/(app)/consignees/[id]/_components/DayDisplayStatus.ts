// Day-20 §3.3.3 — calendar render-time DayDisplayStatus projection.
//
// Per DECISION-2 (ii) at memory/plans/day-20-consignee-detail-calendar-survey.md:
// the legend conflates 4 task statuses + 2 subscription-exception kinds.
// CANCELED renders muted/strikethrough on the day cell (NOT in legend
// per reviewer Day-20 ruling). The 6 legend-visible statuses are:
// Delivered / Out for delivery / Scheduled / Skipped / Appended / Failed.
//
// Pure helper — no side effects, no I/O. Exported for unit-test
// coverage via the page-test convention.

import type { SubscriptionException } from "@/modules/subscription-exceptions";
import type { Task } from "@/modules/tasks/types";

export type DayDisplayStatus =
  | "DELIVERED"
  | "OUT_FOR_DELIVERY"
  | "SCHEDULED"
  | "SKIPPED"
  | "APPENDED"
  | "FAILED"
  | "CANCELED";

/**
 * Project a single day-cell's display status from (task | null) +
 * matching subscription exceptions that fall on `date`.
 *
 * Precedence:
 *   1. No task + skip exception with start_date === date → SKIPPED
 *   2. Task + append-without-skip exception with start_date === date
 *      (which equals task.delivery_date for the appended day) → APPENDED
 *   3. Task fall-through:
 *        DELIVERED → DELIVERED
 *        IN_TRANSIT → OUT_FOR_DELIVERY
 *        ASSIGNED | CREATED | ON_HOLD → SCHEDULED
 *        FAILED → FAILED
 *        CANCELED → CANCELED
 *
 * Returns null when there's no task AND no relevant exception for the
 * date — calendar cell renders empty (— placeholder).
 */
export function projectDayDisplayStatus(
  task: Task | null,
  exceptions: readonly SubscriptionException[],
  date: string,
): DayDisplayStatus | null {
  const skipException = exceptions.find(
    (e) => e.type === "skip" && e.startDate === date,
  );
  const appendException = exceptions.find(
    (e) => e.type === "append_without_skip" && e.startDate === date,
  );

  if (task === null && skipException !== undefined) return "SKIPPED";
  if (task === null) return null;
  if (appendException !== undefined) return "APPENDED";

  switch (task.internalStatus) {
    case "DELIVERED":
      return "DELIVERED";
    case "IN_TRANSIT":
      return "OUT_FOR_DELIVERY";
    case "ASSIGNED":
    case "CREATED":
    case "ON_HOLD":
      return "SCHEDULED";
    case "FAILED":
      return "FAILED";
    case "CANCELED":
      return "CANCELED";
    case "SKIPPED":
      // Task row in SKIPPED state (set by addSubscriptionException type='skip'
      // per Day-13 §3.1.1). Routes to the existing SKIPPED visual — same
      // muted/strikethrough treatment as the no-task + skip-exception path.
      return "SKIPPED";
    default: {
      // Exhaustiveness guard: future additions to the TaskInternalStatus
      // union become a compile error here rather than a production TypeError
      // downstream (`DAY_DISPLAY_VISUALS[undefined].label` was the Day-28
      // failure mode). Render-time degrade: unknown status renders as an
      // empty day-cell rather than crashing the whole calendar render.
      const _exhaustive: never = task.internalStatus;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Visual map — 6 legend-visible statuses + CANCELED muted treatment.
 * Reuses brand-canon tokens: green (success), amber (in-progress),
 * stone-tertiary (neutral), red (alarm). Matches the existing palette
 * established by CalendarWeekView's previous local STATUS_VISUALS map
 * + TASK_STATUS_FILTERS in the operator /tasks chrome.
 *
 * `inLegend: false` for CANCELED — renders muted+strikethrough on the
 * day cell but is excluded from the legend block per Day-20 ruling.
 */
export const DAY_DISPLAY_VISUALS: Record<DayDisplayStatus, {
  readonly label: string;
  readonly classes: string;
  readonly inLegend: boolean;
}> = {
  DELIVERED: {
    label: "Delivered",
    classes: "bg-green/15 text-green",
    inLegend: true,
  },
  OUT_FOR_DELIVERY: {
    label: "Out for delivery",
    classes: "bg-amber/20 text-amber",
    inLegend: true,
  },
  SCHEDULED: {
    label: "Scheduled",
    classes:
      "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-secondary)]",
    inLegend: true,
  },
  SKIPPED: {
    label: "Skipped",
    classes:
      "bg-[color:var(--color-text-secondary)]/15 text-[color:var(--color-text-secondary)] line-through",
    inLegend: true,
  },
  APPENDED: {
    label: "Appended",
    classes: "border border-green/30 bg-green/10 text-green",
    inLegend: true,
  },
  FAILED: {
    label: "Failed",
    classes: "bg-red/15 text-red",
    inLegend: true,
  },
  CANCELED: {
    label: "Canceled",
    classes:
      "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-tertiary)] line-through opacity-70",
    inLegend: false,
  },
};
