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
                <StatusBadge status={t.internalStatus} />
              </Td>
              <Td className="font-mono text-xs">
                {t.externalTrackingNumber ?? (
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

type Status = Task["internalStatus"];

function StatusBadge({ status }: { readonly status: Status }) {
  switch (status) {
    case "CREATED":
      return tone("text-[color:var(--color-text-secondary)]", "Created");
    case "ASSIGNED":
      return tone("text-navy", "Assigned");
    case "IN_TRANSIT":
      return tone("text-amber", "In transit");
    case "DELIVERED":
      return tone("text-green font-medium", "Delivered");
    case "FAILED":
      return tone("text-red font-medium", "Failed");
    case "CANCELED":
      return tone("text-[color:var(--color-text-tertiary)]", "Cancelled");
    case "ON_HOLD":
      return tone("text-amber", "On hold");
  }
}

function tone(className: string, label: string) {
  return (
    <span
      className={`inline-flex items-center text-xs font-medium uppercase tracking-[0.14em] ${className}`}
    >
      {label}
    </span>
  );
}
