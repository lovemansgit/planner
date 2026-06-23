// Day-23n fleet panels — "Top merchants today" panel for the
// Transcorp admin variant of /calendar (server component).
//
// Renders the top-N merchants by today's task volume as a ranked
// list. Each row is a Link to /admin/tasks?merchantSlug=<slug> so
// the operator drills into that tenant's tasks (the cross-tenant
// /admin/tasks list filters by merchantSlug per
// src/modules/tasks/service.ts:listAllTasks).
//
// Brand-canon (Phase 10 · B5 — B+): a floating warm-white card
// (`--color-b-card` + `--shadow-b-card`) hairlined with
// `--color-border-default`, sentence-case header, mono tabular figures
// on the rank + count columns. Layout (paddings, row structure, drill
// links) is unchanged — chrome only.

import Link from "next/link";

import type { CalendarTopMerchantToday } from "../_types";

export interface TopMerchantsTodayPanelProps {
  readonly merchants: readonly CalendarTopMerchantToday[];
}

export function TopMerchantsTodayPanel({ merchants }: TopMerchantsTodayPanelProps) {
  return (
    <section
      aria-label="Top merchants today"
      className="mt-12 overflow-hidden rounded-2xl bg-[color:var(--color-b-card)] shadow-b-card ring-1 ring-[color:var(--color-border-default)]"
    >
      <header className="border-b border-[color:var(--color-border-default)] px-4 py-3">
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
        <ol className="divide-y divide-[color:var(--color-border-default)]">
          {merchants.map((merchant, idx) => (
            <li key={merchant.tenantId}>
              <Link
                href={`/admin/tasks?merchantSlug=${encodeURIComponent(merchant.tenantSlug)}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-[120ms] ease-out hover:bg-stone-100"
              >
                <div className="flex items-center gap-4">
                  <span className="font-b-mono text-sm tabular-nums text-[color:var(--color-text-tertiary)]">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-navy">{merchant.tenantName}</span>
                </div>
                <span className="font-b-mono text-base font-semibold tabular-nums text-navy">
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
