// Day-23n fleet panels — "Per-merchant breakdown" panel for the
// Transcorp admin variant of /calendar (client component for sort
// state).
//
// One row per active merchant. Five columns: merchant name, total
// today, delivered today, in transit, failed last 7 days. Click any
// column header to sort by that column; clicking the active column
// header toggles direction. Default sort: total today DESC.
//
// Each merchant row is a Link to /admin/tasks?merchantSlug=<slug>
// for drill-through. Brand-canon: hairline border-stone-200, no
// shadow, navy header, stone-100 hover, sentence case, tabular-nums
// on numeric columns.
//
// Pure-logic extraction: `sortRows(rows, sortKey, sortDir)` exposed
// for spec coverage per the codebase's no-render-test convention.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { CalendarPerMerchantBreakdownRow } from "../_types";

export type PerMerchantSortKey =
  | "tenantName"
  | "totalToday"
  | "deliveredToday"
  | "inTransit"
  | "failedLast7Days";

export type SortDirection = "asc" | "desc";

export interface PerMerchantBreakdownPanelProps {
  readonly rows: readonly CalendarPerMerchantBreakdownRow[];
}

/**
 * Pure sort helper. Returns a new array; does not mutate the input.
 * Numeric columns compare numerically; tenantName compares via
 * locale-aware string compare.
 */
export function sortRows(
  rows: readonly CalendarPerMerchantBreakdownRow[],
  sortKey: PerMerchantSortKey,
  sortDir: SortDirection,
): readonly CalendarPerMerchantBreakdownRow[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (sortKey === "tenantName") {
      const cmp = a.tenantName.localeCompare(b.tenantName, "en-GB");
      return sortDir === "asc" ? cmp : -cmp;
    }
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    const cmp = aVal - bVal;
    return sortDir === "asc" ? cmp : -cmp;
  });
  return copy;
}

const COLUMNS: readonly { key: PerMerchantSortKey; label: string; align: "left" | "right" }[] = [
  { key: "tenantName", label: "Merchant", align: "left" },
  { key: "totalToday", label: "Total today", align: "right" },
  { key: "deliveredToday", label: "Delivered", align: "right" },
  { key: "inTransit", label: "In transit", align: "right" },
  { key: "failedLast7Days", label: "Failed (7d)", align: "right" },
];

export function PerMerchantBreakdownPanel({ rows }: PerMerchantBreakdownPanelProps) {
  const [sortKey, setSortKey] = useState<PerMerchantSortKey>("totalToday");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const sortedRows = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);

  function onHeaderClick(key: PerMerchantSortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "tenantName" ? "asc" : "desc");
    }
  }

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
          Active merchants only. Click any column header to sort.
        </p>
      </header>
      {sortedRows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-[color:var(--color-text-secondary)]">
          No active merchants configured.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-200 bg-surface-primary">
              {COLUMNS.map((col) => {
                const isActive = col.key === sortKey;
                const arrow = isActive ? (sortDir === "asc" ? "↑" : "↓") : "";
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      isActive
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={`${col.align === "right" ? "text-right" : "text-left"} px-4 py-3`}
                  >
                    <button
                      type="button"
                      onClick={() => onHeaderClick(col.key)}
                      className="inline-flex items-baseline gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out hover:text-navy"
                    >
                      <span>{col.label}</span>
                      <span className="text-navy" aria-hidden="true">
                        {arrow}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const tint = idx % 2 === 1 ? "bg-stone-100/40" : "bg-paper";
              return (
                <tr
                  key={row.tenantId}
                  data-tenant-slug={row.tenantSlug}
                  className={`${tint} border-b border-stone-200 transition-colors duration-[120ms] ease-out hover:bg-stone-100`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/tasks?merchantSlug=${encodeURIComponent(row.tenantSlug)}`}
                      className="text-navy underline decoration-stone-300 underline-offset-4 hover:decoration-navy"
                    >
                      {row.tenantName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-navy">
                    {row.totalToday}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-navy">
                    {row.deliveredToday}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-navy">
                    {row.inTransit}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      row.failedLast7Days > 0 ? "text-red font-medium" : "text-navy"
                    }`}
                  >
                    {row.failedLast7Days}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
