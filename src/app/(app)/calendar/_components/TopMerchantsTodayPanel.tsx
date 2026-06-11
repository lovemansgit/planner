// Day-23n fleet panels — "Top merchants today" panel for the
// Transcorp admin variant of /calendar (server component).
//
// Renders the top-N merchants by today's task volume as a ranked
// list. Each row is a Link to /admin/tasks?merchantSlug=<slug> so
// the operator drills into that tenant's tasks (the cross-tenant
// /admin/tasks list filters by merchantSlug per
// src/modules/tasks/service.ts:listAllTasks).
//
// Brand-canon: hairline border-stone-200, no shadow, navy table
// header, stone-100 zebra rows, sentence case, tabular-nums on the
// count column.

import Link from "next/link";

import type { CalendarTopMerchantToday } from "../_types";

export interface TopMerchantsTodayPanelProps {
  readonly merchants: readonly CalendarTopMerchantToday[];
}

export function TopMerchantsTodayPanel({ merchants }: TopMerchantsTodayPanelProps) {
  return (
    <section
      aria-label="Top merchants today"
      className="mt-12 border border-stone-200 bg-paper"
    >
      <header className="border-b border-stone-200 bg-surface-primary px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-navy">
          Top merchants today
        </h2>
        <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
          Ranked by task volume — top 10 by total deliveries scheduled
        </p>
      </header>
      {merchants.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-[color:var(--color-text-secondary)]">
          No deliveries scheduled across any merchant today.
        </p>
      ) : (
        <ol className="divide-y divide-stone-200">
          {merchants.map((merchant, idx) => (
            <li key={merchant.tenantId}>
              <Link
                href={`/admin/tasks?merchantSlug=${encodeURIComponent(merchant.tenantSlug)}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-[120ms] ease-out hover:bg-stone-100"
              >
                <div className="flex items-center gap-4">
                  <span className="font-display text-sm tabular-nums text-[color:var(--color-text-tertiary)]">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-navy">{merchant.tenantName}</span>
                </div>
                <span className="font-display text-base font-semibold tabular-nums text-navy">
                  {merchant.taskCount}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
