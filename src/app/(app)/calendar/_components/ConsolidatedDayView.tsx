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
//   - Task delivery-status pill (FINE courier_status)
//   - AWB (external_tracking_number) when present
//
// Empty state: hairline-border panel with a sentence-case explainer
// pointing the operator back at the week / month views.
//
// D56 Phase 8 / Lane 5 (brief v1.31 §3.1.10 + §3.3.11) — the status pill
// now renders the FINE SuiteFleet courier state via the shared
// `resolveCourierDisplay` + `StatusIcon` (the single source of truth Lane 3
// established), falling back to the coarse internal status when courier_status
// is NULL. The previously-inlined STATUS_VISUALS map (which only knew the
// coarse 7) is retired — this is the "second consumer" the original note
// anticipated, so the lift-to-shared-primitive happened.
//
// Pure-logic exports (`formatDeliveryWindow`, `getDayHeaderLabel`,
// `buildConsigneeLink`) covered by spec per the codebase's no-render-test
// convention.
//
// Phase 10 · Batch B5 — B+ chrome: the task list is a floating warm-white
// card (--color-b-card rows, --shadow-b-card, hairline --color-border-default
// dividers/ring); the window + AWB figures render in font-b-mono. The status
// pill keeps the SHIPPED `resolveCourierDisplay` colour token (not
// re-derived); high-risk tint, drill links, delivery-window logic, and the
// fine/coarse status fallback are unchanged — chrome only.

import Link from "next/link";

import { StatusIcon } from "@/app/(app)/tasks/_components/StatusIcon";
import { resolveCourierDisplay } from "@/app/(app)/tasks/status";
import type { TaskInternalStatus } from "@/modules/tasks/types";

import type { CalendarDayTaskRow } from "../_types";

export interface ConsolidatedDayViewProps {
  /** ISO YYYY-MM-DD day being displayed. */
  readonly date: string;
  /** Tasks ordered by delivery-window-start ASC, then consignee name. */
  readonly tasks: readonly CalendarDayTaskRow[];
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
        <h2 className="text-2xl font-semibold tracking-tight text-navy">
          {dayLabel}
        </h2>
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)] tabular-nums">
          {tasks.length} {tasks.length === 1 ? "delivery" : "deliveries"}
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="rounded-2xl bg-[color:var(--color-b-card)] px-6 py-16 text-center shadow-[var(--shadow-b-card)] ring-1 ring-[color:var(--color-border-default)]">
          <p className="text-sm text-[color:var(--color-text-secondary)]">
            No deliveries scheduled for this day. Try a different day or clear filters.
          </p>
        </div>
      ) : (
        <ol className="overflow-hidden rounded-2xl bg-[color:var(--color-b-card)] shadow-[var(--shadow-b-card)] ring-1 ring-[color:var(--color-border-default)]">
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
  // D56 Lane 5 — fine courier_status pill (label + family colour + glyph),
  // NULL-courier rows fall back to the coarse internal status. `task.status` is
  // the coarse internal_status (DB CHECK guarantees the 8-value set).
  const display = resolveCourierDisplay(
    task.courierStatus,
    task.status as TaskInternalStatus,
  );
  const isHighRisk = task.crmState === "HIGH_RISK";
  const href = buildConsigneeLink(task.consigneeId, date);
  return (
    <li
      data-task-id={task.taskId}
      data-status={task.status}
      data-high-risk={isHighRisk ? "true" : "false"}
      className={`flex items-center gap-4 border-t border-[color:var(--color-border-default)] px-4 py-3 first:border-t-0 transition-colors duration-[120ms] ease-out hover:bg-stone-100 ${
        isHighRisk ? "bg-red/[0.04]" : "bg-[color:var(--color-b-card)]"
      }`}
    >
      <p className="w-32 shrink-0 font-b-mono text-xs tabular-nums text-[color:var(--color-text-secondary)]">
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
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${display.pillClass}`}
      >
        <StatusIcon courierStatus={task.courierStatus} status={task.status as TaskInternalStatus} />
        {display.label}
      </span>
      <p className="hidden w-32 shrink-0 text-right font-b-mono text-xs tabular-nums text-[color:var(--color-text-tertiary)] sm:block">
        {task.externalTrackingNumber ?? "—"}
      </p>
    </li>
  );
}
