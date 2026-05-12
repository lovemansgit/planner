// Day-23 PM — ConsolidatedDayView (server component).
//
// Vertical task list for one specific day across every consignee in
// the tenant. Day-click drill-down target from WeekView + MonthView
// (brief §3.3.4 line 523-524). Each row:
//
//   - Delivery window (HH:MM — HH:MM, tabular-nums)
//   - Consignee name (link to /consignees/[id]?tab=calendar&week=…)
//   - HIGH_RISK marker on the consignee name when applicable
//   - District
//   - Task internal-status pill
//   - AWB (external_tracking_number) when present
//
// Empty state: hairline-border panel with a sentence-case explainer
// pointing the operator back at the week / month views.
//
// Status pill palette inlined (STATUS_VISUALS). The /tasks list page
// has its own `TASK_STATUS_FILTERS` palette but cross-route imports
// from app routes are a code smell; tonight's surface lives entirely
// in /calendar, so the visual map ships here. If a second consumer
// materialises, lift to a shared primitive.
//
// Pure-logic exports (`formatDeliveryWindow`, `getStatusVisuals`,
// `getDayHeaderLabel`) covered by spec per the codebase's
// no-render-test convention.

import Link from "next/link";

import type { CalendarDayTaskRow } from "../_types";

export interface ConsolidatedDayViewProps {
  /** ISO YYYY-MM-DD day being displayed. */
  readonly date: string;
  /** Tasks ordered by delivery-window-start ASC, then consignee name. */
  readonly tasks: readonly CalendarDayTaskRow[];
}

interface StatusVisual {
  readonly label: string;
  readonly classes: string;
}

const STATUS_VISUALS: Readonly<Record<string, StatusVisual>> = {
  CREATED: {
    label: "Created",
    classes: "bg-stone-200 text-[color:var(--color-text-secondary)]",
  },
  ASSIGNED: {
    label: "Assigned",
    classes: "bg-amber/15 text-amber",
  },
  IN_TRANSIT: {
    label: "In transit",
    classes: "bg-amber/20 text-amber",
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
    label: "Cancelled",
    classes: "bg-stone-200 text-[color:var(--color-text-tertiary)]",
  },
  ON_HOLD: {
    label: "On hold",
    classes: "bg-stone-200 text-[color:var(--color-text-secondary)]",
  },
};

const STATUS_FALLBACK: StatusVisual = {
  label: "Unknown",
  classes: "bg-stone-200 text-[color:var(--color-text-tertiary)]",
};

export function getStatusVisuals(status: string): StatusVisual {
  return STATUS_VISUALS[status] ?? STATUS_FALLBACK;
}

/**
 * Format a Postgres TIME column (HH:MM:SS or HH:MM:SS.NNN) to the
 * operator-facing HH:MM shape used in the calendar surface. Returns
 * the raw value if it does not match the expected shape so a corrupted
 * time still surfaces in the UI for inspection.
 */
export function formatDeliveryTime(raw: string): string {
  if (typeof raw !== "string") return String(raw);
  if (raw.length >= 5 && raw[2] === ":") return raw.slice(0, 5);
  return raw;
}

export function formatDeliveryWindow(start: string, end: string): string {
  return `${formatDeliveryTime(start)} — ${formatDeliveryTime(end)}`;
}

/**
 * Format the day label header — e.g. "Friday, 12 May 2026". Uses
 * en-GB locale + UTC time-zone to avoid drift relative to the
 * Asia/Dubai server-side calendar date.
 */
export function getDayHeaderLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build the drill-down URL for a single task row → the owning
 * consignee's calendar tab anchored to the week containing the day.
 * Mirrors the WeekView preview-row drill-down convention.
 */
export function buildConsigneeLink(consigneeId: string, isoDate: string): string {
  const week = computeWeekStart(isoDate);
  return `/consignees/${consigneeId}?tab=calendar&week=${week}`;
}

function computeWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (isoDay - 1));
  return d.toISOString().slice(0, 10);
}

export function ConsolidatedDayView({ date, tasks }: ConsolidatedDayViewProps) {
  const dayLabel = getDayHeaderLabel(date);
  return (
    <div data-day-anchor={date}>
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-navy">
          {dayLabel}
        </h2>
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)] tabular-nums">
          {tasks.length} {tasks.length === 1 ? "delivery" : "deliveries"}
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="border border-stone-200 bg-paper px-6 py-16 text-center">
          <p className="text-sm text-[color:var(--color-text-secondary)]">
            No deliveries scheduled for this day. Try a different day or clear filters.
          </p>
        </div>
      ) : (
        <ol className="overflow-hidden border border-stone-200">
          {tasks.map((task) => (
            <DayTaskRow key={task.taskId} task={task} date={date} />
          ))}
        </ol>
      )}
    </div>
  );
}

interface DayTaskRowProps {
  readonly task: CalendarDayTaskRow;
  readonly date: string;
}

function DayTaskRow({ task, date }: DayTaskRowProps) {
  const visual = getStatusVisuals(task.status);
  const isHighRisk = task.crmState === "HIGH_RISK";
  const href = buildConsigneeLink(task.consigneeId, date);
  return (
    <li
      data-task-id={task.taskId}
      data-status={task.status}
      data-high-risk={isHighRisk ? "true" : "false"}
      className={`flex items-center gap-4 border-t border-stone-200 px-4 py-3 first:border-t-0 transition-colors duration-[120ms] ease-out hover:bg-stone-100 ${
        isHighRisk ? "bg-red/[0.04]" : "bg-paper"
      }`}
    >
      <p className="w-32 shrink-0 text-xs tabular-nums text-[color:var(--color-text-secondary)]">
        {formatDeliveryWindow(task.deliveryWindowStart, task.deliveryWindowEnd)}
      </p>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="text-sm text-navy underline decoration-transparent underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
        >
          {task.consigneeName}
        </Link>
        {isHighRisk ? (
          <span
            aria-label="High-risk consignee"
            title="High risk"
            className="ml-2 text-[10px] font-medium uppercase tracking-[0.14em] text-red"
          >
            ● High risk
          </span>
        ) : null}
        <p className="mt-0.5 text-xs text-[color:var(--color-text-secondary)]">
          {task.district ?? "—"}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${visual.classes}`}
      >
        {visual.label}
      </span>
      <p className="hidden w-32 shrink-0 text-right text-xs tabular-nums text-[color:var(--color-text-tertiary)] sm:block">
        {task.externalTrackingNumber ?? "—"}
      </p>
    </li>
  );
}
