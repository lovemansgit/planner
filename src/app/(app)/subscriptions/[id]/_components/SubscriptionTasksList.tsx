// Day 22 / §3.3.5 Fix 2 — tasks list panel on subscription detail.
//
// Renders the (default 30) tasks materialised for this subscription,
// ordered by delivery_date ASC. Columns: date | window | status | AWB
// | action (link to consignee's calendar tab on that date).
//
// Empty state: covers fresh subscriptions where materialisation
// hasn't filled the horizon yet (e.g., end_date < today, or a wizard
// submit where materialization succeeded with zero rows due to skip
// rules / address-resolution misses).
//
// v1 scope: no in-component filtering / sorting / pagination. "View
// all" link is deferred — /tasks list doesn't yet support a
// subscriptionId query-param filter (Phase 2 followup).

import Link from "next/link";

import { StatusIcon } from "@/app/(app)/tasks/_components/StatusIcon";
import { resolveCourierDisplay } from "@/app/(app)/tasks/status";
import type { Task } from "@/modules/tasks";

interface SubscriptionTasksListProps {
  readonly tasks: readonly Task[];
  readonly consigneeId: string;
}

export function SubscriptionTasksList({
  tasks,
  consigneeId,
}: SubscriptionTasksListProps) {
  if (tasks.length === 0) {
    return (
      <section className="mt-12">
        <h2 className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
          Tasks
        </h2>
        <p className="mt-4 text-sm text-[color:var(--color-text-secondary)]">
          No tasks yet. Tasks materialise on subscription creation and over the
          rolling 14-day horizon.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
        Tasks
      </h2>
      <p className="mt-2 text-xs text-[color:var(--color-text-tertiary)]">
        {tasks.length === 30
          ? "Showing first 30 (chronological)."
          : `Showing ${tasks.length} (chronological).`}
      </p>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-200">
            <Th>Date</Th>
            <Th>Window</Th>
            <Th>Status</Th>
            <Th>AWB</Th>
            <Th aria-label="Calendar link" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="border-b border-stone-200 last:border-b-0"
            >
              <Td className="tabular-nums">{t.deliveryDate}</Td>
              <Td className="tabular-nums">
                {t.deliveryStartTime.slice(0, 5)} – {t.deliveryEndTime.slice(0, 5)}
              </Td>
              <Td>
                <StatusCell task={t} />
              </Td>
              <Td className="font-mono text-xs">
                {t.externalTrackingNumber !== null ? (
                  <span className="flex flex-col gap-0.5">
                    <span>{t.externalTrackingNumber}</span>
                    <span className="font-sans text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
                      <span className="text-navy">✓</span> Pushed to SuiteFleet
                    </span>
                  </span>
                ) : (
                  <span className="text-[color:var(--color-text-tertiary)]">—</span>
                )}
              </Td>
              <Td className="text-right">
                <Link
                  href={`/consignees/${consigneeId}?tab=calendar&week=${t.deliveryDate}`}
                  className="text-xs uppercase tracking-[0.14em] text-navy underline decoration-stone-300 underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
                >
                  Calendar
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Th({
  children,
  ...rest
}: {
  readonly children?: React.ReactNode;
} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      className="py-2 text-left text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]"
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return <td className={`py-3 align-middle ${className}`}>{children}</td>;
}

// D56 Phase 8 / Lane 5 — render the FINE courier_status (label + family colour
// + glyph) via the shared map, falling back to the coarse internal_status when
// it is NULL. Replaces the local text-only StatusBadge so this surface renders
// the 14 distinct courier states identically to /tasks + /admin/tasks.
function StatusCell({ task }: { readonly task: Task }) {
  const display = resolveCourierDisplay(task.courierStatus, task.internalStatus);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium uppercase tracking-[0.1em] ${display.pillClass}`}
    >
      <StatusIcon courierStatus={task.courierStatus} status={task.internalStatus} />
      {display.label}
    </span>
  );
}
