// Day-24 fleet panels — "Per-merchant breakdown" as a horizontal
// bar chart. Replaces the Day-23n sortable table per Love's PR #249
// feedback ("scales beyond ~10 merchants, table version doesn't").
//
// One row per active merchant, sorted DESC by total tasks today.
// Each row is a Link to `/admin/tasks?merchantSlug=<slug>` for drill-
// through. The bar shows three stacked segments — delivered (navy),
// in transit (stone-400), and scheduled-remaining (stone-200) —
// scaled so the widest merchant is the full row width and shorter
// merchants render proportionally narrower. The 7-day failed count
// is surfaced as a separate red badge on the right when non-zero;
// it isn't part of the today bar because the time windows differ.
//
// Native title attribute carries exact counts per segment for hover
// inspection. The whole row is a single click target — bar segments
// are visual only, not separately interactive.
//
// Brand-canon: hairline stone-200 borders, no shadow, navy/stone
// tones, sentence case. Pure component — `computeMerchantBarSegments`
// is exported below for spec coverage per the codebase's no-render
// convention.

import Link from "next/link";

import type { CalendarPerMerchantBreakdownRow } from "../_types";

export interface MerchantBarSegment {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly totalToday: number;
  readonly deliveredToday: number;
  readonly inTransit: number;
  readonly failedLast7Days: number;
  /** Bar width as a percentage of the widest merchant's bar (0-100). */
  readonly totalPct: number;
  /** Delivered segment as a percentage of this row's bar (0-100). */
  readonly deliveredPct: number;
  /** In-transit segment as a percentage of this row's bar (0-100). */
  readonly inTransitPct: number;
  /** Scheduled-remaining segment as a percentage of this row's bar. */
  readonly remainingPct: number;
}

/**
 * Pure derivation: turn raw breakdown rows into bar-chart-ready
 * segments, sorted DESC by totalToday.
 *
 *   - `totalPct` scales the bar's width across the row container, so
 *     the merchant with the most tasks today renders at 100% and
 *     smaller merchants render proportionally.
 *   - Segment percentages (delivered / inTransit / remaining) split
 *     each merchant's bar into the three operationally-meaningful
 *     buckets. Remaining = totalToday - delivered - inTransit, floored
 *     at zero to defend against count drift between the FILTER
 *     aggregates and the COUNT total.
 *   - When maxTotal === 0 every bar collapses to 0% width, but rows
 *     still render so the operator can see "X merchants, none active
 *     today".
 */
export function computeMerchantBarSegments(
  rows: readonly CalendarPerMerchantBreakdownRow[],
): readonly MerchantBarSegment[] {
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.totalToday), 0);
  const sorted = rows.slice().sort((a, b) => b.totalToday - a.totalToday);
  return sorted.map((row) => {
    const totalPct = maxTotal > 0 ? (row.totalToday / maxTotal) * 100 : 0;
    if (row.totalToday === 0) {
      return {
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        totalToday: row.totalToday,
        deliveredToday: row.deliveredToday,
        inTransit: row.inTransit,
        failedLast7Days: row.failedLast7Days,
        totalPct,
        deliveredPct: 0,
        inTransitPct: 0,
        remainingPct: 0,
      };
    }
    const deliveredPct = (row.deliveredToday / row.totalToday) * 100;
    const inTransitPct = (row.inTransit / row.totalToday) * 100;
    const remainingPct = Math.max(0, 100 - deliveredPct - inTransitPct);
    return {
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      tenantSlug: row.tenantSlug,
      totalToday: row.totalToday,
      deliveredToday: row.deliveredToday,
      inTransit: row.inTransit,
      failedLast7Days: row.failedLast7Days,
      totalPct,
      deliveredPct,
      inTransitPct,
      remainingPct,
    };
  });
}

export interface PerMerchantBreakdownPanelProps {
  readonly rows: readonly CalendarPerMerchantBreakdownRow[];
}

export function PerMerchantBreakdownPanel({ rows }: PerMerchantBreakdownPanelProps) {
  const segments = computeMerchantBarSegments(rows);

  return (
    <section
      aria-label="Per-merchant breakdown"
      className="mt-8 border border-stone-200 bg-paper"
    >
      <header className="border-b border-stone-200 bg-surface-primary px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-navy">
          Per-merchant breakdown
        </h2>
        <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">
          Active merchants only. Bars scaled to today&apos;s busiest merchant.
        </p>
        <Legend />
      </header>
      {segments.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-[color:var(--color-text-secondary)]">
          No active merchants configured.
        </p>
      ) : (
        <ul role="list" className="divide-y divide-stone-200">
          {segments.map((seg) => (
            <li key={seg.tenantId}>
              <BarRow segment={seg} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Legend() {
  return (
    <ul
      aria-label="Bar segment legend"
      className="mt-3 flex flex-wrap items-center gap-4 text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-text-secondary)]"
    >
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-3 bg-navy" />
        Delivered
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-3 bg-stone-400" />
        In transit
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-3 bg-stone-200" />
        Scheduled
      </li>
    </ul>
  );
}

function BarRow({ segment }: { readonly segment: MerchantBarSegment }) {
  const scheduledCount = Math.max(
    0,
    segment.totalToday - segment.deliveredToday - segment.inTransit,
  );
  const tooltipParts = [
    `Delivered ${segment.deliveredToday}`,
    `In transit ${segment.inTransit}`,
    `Scheduled ${scheduledCount}`,
  ];
  if (segment.failedLast7Days > 0) {
    tooltipParts.push(`Failed last 7d ${segment.failedLast7Days}`);
  }
  const tooltip = tooltipParts.join(" · ");

  const deliveredWidth = (segment.deliveredPct * segment.totalPct) / 100;
  const inTransitWidth = (segment.inTransitPct * segment.totalPct) / 100;

  return (
    <Link
      href={`/admin/tasks?merchantSlug=${encodeURIComponent(segment.tenantSlug)}`}
      data-tenant-slug={segment.tenantSlug}
      title={tooltip}
      className="block px-4 py-4 transition-colors duration-[120ms] ease-out hover:bg-stone-100"
    >
      <div className="flex items-center gap-4">
        <span className="w-40 shrink-0 truncate text-sm font-medium text-navy">
          {segment.tenantName}
        </span>
        <div className="relative h-3 flex-1 bg-stone-100" aria-hidden>
          <div
            className="absolute inset-y-0 left-0 bg-stone-200"
            style={{ width: `${segment.totalPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-navy"
            style={{ width: `${deliveredWidth}%` }}
          />
          <div
            className="absolute inset-y-0 bg-stone-400"
            style={{
              left: `${deliveredWidth}%`,
              width: `${inTransitWidth}%`,
            }}
          />
        </div>
        <span className="w-12 shrink-0 text-right text-sm tabular-nums text-navy">
          {segment.totalToday}
        </span>
        {segment.failedLast7Days > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 border border-red/30 bg-red/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-red">
            <span aria-hidden>⚠</span>
            {segment.failedLast7Days} failed/7d
          </span>
        ) : (
          <span className="w-24 shrink-0" aria-hidden />
        )}
      </div>
    </Link>
  );
}
