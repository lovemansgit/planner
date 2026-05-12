// Day-22n PR-C-B — TaskPreviewRow primitive for the WeekView
// "top tasks today" preview pane (server component).
//
// Wired into Session A's ConsolidatedWeekView day cells per
// reviewer Q1 Option (b): each day cell renders the aggregate count
// plus up to 3 TaskPreviewRow instances (ordered by
// deliveryWindowStart ASC). The row wraps a Next.js <Link> targeting
// /consignees/[id]?tab=calendar&week=[mondayOf(deliveryDate)] —
// reviewer OQ-4 ruling: route, not drawer.
//
// Visual treatment per brief §3.3.11 brand pass + reviewer ruling:
// hairline 1px stone-200 top-border between rows, consignee name in
// navy body, time window in tabular-nums secondary text, inline
// StatusChip (TaskStatusBadge does not exist on main HEAD — the
// chip lives inline here to avoid scope expansion; if a second
// consumer materialises, extract to its own primitive).
// HIGH_RISK row tint via bg-red/[0.04] backdrop per the existing
// consignees detail-page precedent (page.tsx:211).
//
// Pure-logic extraction: `getTaskStatusVisuals(status)` and
// `STATUS_VISUAL_KEYS` exposed for spec coverage per the codebase's
// no-render-test convention.

import Link from "next/link";

import type { TaskInternalStatus } from "@/modules/tasks/types";

import { linkToConsigneeCalendar } from "../_lib/links";
import type { CalendarTopTaskForDay } from "../_types";

export interface TaskPreviewRowProps {
  readonly task: CalendarTopTaskForDay;
  readonly deliveryDate: string; // ISO YYYY-MM-DD — for drill-down link
}

interface StatusVisual {
  readonly label: string;
  readonly classes: string;
}

const STATUS_VISUALS: Readonly<Record<TaskInternalStatus, StatusVisual>> = {
  CREATED: {
    label: "Created",
    classes: "bg-stone-200 text-[color:var(--color-text-secondary)]",
  },
  ASSIGNED: {
    label: "Assigned",
    classes: "bg-navy/10 text-navy",
  },
  IN_TRANSIT: {
    label: "In transit",
    classes: "bg-navy/10 text-navy",
  },
  DELIVERED: {
    label: "Delivered",
    classes: "bg-green/15 text-green",
  },
  FAILED: {
    label: "Failed",
    classes: "bg-red/15 text-red",
  },
  CANCELED: {
    label: "Canceled",
    classes: "bg-stone-200 text-[color:var(--color-text-tertiary)]",
  },
  ON_HOLD: {
    label: "On hold",
    classes: "bg-stone-200 text-[color:var(--color-text-secondary)]",
  },
};

export const STATUS_VISUAL_KEYS: readonly TaskInternalStatus[] = [
  "CREATED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "CANCELED",
  "ON_HOLD",
];

export function getTaskStatusVisuals(status: TaskInternalStatus): StatusVisual {
  return STATUS_VISUALS[status];
}

export function TaskPreviewRow({ task, deliveryDate }: TaskPreviewRowProps) {
  const visual = getTaskStatusVisuals(task.status);
  const tint = task.isHighRisk ? "bg-red/[0.04] hover:bg-red/[0.07]" : "hover:bg-stone-100";
  return (
    <Link
      href={linkToConsigneeCalendar(task.consigneeId, deliveryDate)}
      aria-label={`Open ${task.consigneeName} delivery on ${deliveryDate}`}
      className={`flex items-center justify-between gap-3 border-t border-stone-200 px-3 py-2 transition-colors duration-[120ms] ease-out ${tint}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-sm text-navy">{task.consigneeName}</p>
        <p className="text-xs tabular-nums text-[color:var(--color-text-secondary)]">
          {task.deliveryWindowStart}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${visual.classes}`}
      >
        {visual.label}
      </span>
    </Link>
  );
}

/**
 * Overflow line rendered beneath the 3 preview rows when the day
 * has more tasks than were sliced into `topTasks`. Composed by
 * Session A's WeekView day cell. Singular form for N=1, plural for
 * N>1, per brand-canon sentence-case copy.
 */
export interface TaskPreviewOverflowProps {
  readonly hiddenCount: number;
}

export function TaskPreviewOverflow({ hiddenCount }: TaskPreviewOverflowProps) {
  if (hiddenCount <= 0) return null;
  const copy =
    hiddenCount === 1
      ? "+ 1 more"
      : `and ${hiddenCount} more deliveries`;
  return (
    <p className="border-t border-stone-200 px-3 py-2 text-xs text-[color:var(--color-text-secondary)]">
      {copy}
    </p>
  );
}

/** Exposed for spec coverage of the overflow copy branch logic. */
export function buildOverflowCopy(hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  return hiddenCount === 1
    ? "+ 1 more"
    : `and ${hiddenCount} more deliveries`;
}
