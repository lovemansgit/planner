// Day 22 / §3.3.5 — recent exceptions panel.
//
// Read-only list of the most recent exception events (skip / pause /
// address overrides / append_without_skip), newest first. Sourced
// from `getRecentExceptionsForSubscription` per brief §3.3.5 line 536.
// Default cap = 10 (matches brief "last 10").

import type { SubscriptionException } from "@/modules/subscription-exceptions";

interface RecentExceptionsProps {
  readonly exceptions: readonly SubscriptionException[];
}

export function RecentExceptions({ exceptions }: RecentExceptionsProps) {
  if (exceptions.length === 0) {
    return (
      <section className="mt-12">
        <h2 className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
          Recent exceptions
        </h2>
        <p className="mt-4 text-sm text-[color:var(--color-text-secondary)]">
          No skips, pauses, or address overrides recorded yet.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12">
      <h2 className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
        Recent exceptions
      </h2>
      <ol className="mt-6 border-t border-stone-200">
        {exceptions.map((e) => (
          <li
            key={e.id}
            className="flex flex-col gap-2 border-b border-stone-200 py-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-navy">{formatException(e)}</p>
              {e.reason ? (
                <p className="mt-2 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
                  {e.reason}
                </p>
              ) : null}
            </div>
            <div className="text-right text-xs text-[color:var(--color-text-tertiary)]">
              <p className="font-mono tabular-nums">{formatTimestamp(e.createdAt)}</p>
              <p className="mt-0.5 truncate" title={e.createdBy}>
                {e.createdBy.slice(0, 8)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatException(e: SubscriptionException): string {
  switch (e.type) {
    case "pause_window":
      return e.endDate
        ? `Subscription paused ${e.startDate} to ${e.endDate}`
        : `Subscription paused from ${e.startDate}`;
    case "skip":
      if (e.compensatingDate)
        return `Skip applied for ${e.startDate}; compensating date ${e.compensatingDate}`;
      if (e.skipWithoutAppend)
        return `Skip applied for ${e.startDate} (no append — cancel only)`;
      if (e.targetDateOverride)
        return `Skip moved from ${e.startDate} to ${e.targetDateOverride}`;
      return `Skip applied for ${e.startDate}`;
    case "address_override_one_off":
      return `One-off address override on ${e.startDate}`;
    case "address_override_forward":
      return e.endDate
        ? `Forward address override from ${e.startDate} to ${e.endDate}`
        : `Forward address override from ${e.startDate}`;
    case "append_without_skip":
      return `Compensating delivery appended on ${e.startDate}`;
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}`;
}
