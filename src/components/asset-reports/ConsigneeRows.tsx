"use client";

// By-consignee expandable rows — Day-54 P2 (plan PR #502 §6.B).
//
// The business spec: "consignee rows expand per delivery date". The
// service returns flat consignee × date rows; this component groups
// them per consignee, renders a summary row (sums across the date
// range), and toggles the per-date subrows open/closed. Client
// component because the expand state is interactive; everything else
// on the report pages stays server-rendered.

import { useState } from "react";

import type { InventoryByConsigneeRow } from "@/modules/asset-tracking/report-repository";

import { CountCell, ReportHeaderCells } from "./ReportCells";
import { awbsHref } from "./report-helpers";
import {
  REPORT_ROW,
  REPORT_SUBROW,
  REPORT_TD,
  REPORT_TH,
  TABLE,
  TABLE_CARD,
  TABLE_SCROLL,
} from "./report-table";

interface ConsigneeGroup {
  readonly consigneeId: string;
  readonly consigneeName: string;
  readonly dates: readonly InventoryByConsigneeRow[];
  readonly totals: {
    readonly allocatedAssets: number;
    readonly suppQuantity: number;
    readonly collected: number;
    readonly received: number;
    readonly sorted: number;
    readonly enRoute: number;
    readonly returned: number;
    readonly awbs: readonly string[];
  };
}

function groupByConsignee(rows: readonly InventoryByConsigneeRow[]): readonly ConsigneeGroup[] {
  const byId = new Map<string, InventoryByConsigneeRow[]>();
  for (const row of rows) {
    const list = byId.get(row.consigneeId) ?? [];
    list.push(row);
    byId.set(row.consigneeId, list);
  }
  return [...byId.entries()].map(([consigneeId, dates]) => ({
    consigneeId,
    consigneeName: dates[0].consigneeName,
    dates,
    totals: {
      allocatedAssets: dates.reduce((sum, d) => sum + d.allocatedAssets, 0),
      suppQuantity: dates.reduce((sum, d) => sum + d.suppQuantity, 0),
      collected: dates.reduce((sum, d) => sum + d.collected, 0),
      received: dates.reduce((sum, d) => sum + d.received, 0),
      sorted: dates.reduce((sum, d) => sum + d.sorted, 0),
      enRoute: dates.reduce((sum, d) => sum + d.enRoute, 0),
      returned: dates.reduce((sum, d) => sum + d.returned, 0),
      awbs: [...new Set(dates.flatMap((d) => d.awbs))],
    },
  }));
}

export function ConsigneeRows({
  rows,
  tasksBasePath,
  extraTaskParams = {},
}: {
  readonly rows: readonly InventoryByConsigneeRow[];
  readonly tasksBasePath: string;
  readonly extraTaskParams?: Readonly<Record<string, string>>;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groups = groupByConsignee(rows);

  function toggle(consigneeId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(consigneeId)) {
        next.delete(consigneeId);
      } else {
        next.add(consigneeId);
      }
      return next;
    });
  }

  return (
    <div className={TABLE_CARD}>
      <div className={TABLE_SCROLL}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={REPORT_TH}>Consignee</th>
              <ReportHeaderCells />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const isOpen = open.has(group.consigneeId);
              return (
                <ConsigneeGroupRows
                  key={group.consigneeId}
                  group={group}
                  isOpen={isOpen}
                  onToggle={() => toggle(group.consigneeId)}
                  tasksBasePath={tasksBasePath}
                  extraTaskParams={extraTaskParams}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConsigneeGroupRows({
  group,
  isOpen,
  onToggle,
  tasksBasePath,
  extraTaskParams,
}: {
  readonly group: ConsigneeGroup;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly tasksBasePath: string;
  readonly extraTaskParams: Readonly<Record<string, string>>;
}) {
  return (
    <>
      <tr className={REPORT_ROW}>
        <td className={`${REPORT_TD} font-medium`}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            className="flex items-center gap-2 rounded-sm text-left hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
          >
            <span aria-hidden="true" className="inline-block w-3 text-xs">
              {isOpen ? "▾" : "▸"}
            </span>
            {group.consigneeName}
            <span className="text-xs text-[color:var(--color-text-secondary)]">
              ({group.dates.length} {group.dates.length === 1 ? "date" : "dates"})
            </span>
          </button>
        </td>
        <CountCell
          value={group.totals.allocatedAssets}
          href={awbsHref(tasksBasePath, group.totals.awbs, extraTaskParams)}
        />
        <CountCell
          value={group.totals.suppQuantity}
          href={awbsHref(tasksBasePath, group.totals.awbs, extraTaskParams)}
        />
        <CountCell
          value={group.totals.collected}
          href={awbsHref(tasksBasePath, [...new Set(group.dates.flatMap((d) => d.awbsByState.collected))], extraTaskParams)}
        />
        <CountCell
          value={group.totals.received}
          href={awbsHref(tasksBasePath, [...new Set(group.dates.flatMap((d) => d.awbsByState.received))], extraTaskParams)}
        />
        <CountCell
          value={group.totals.sorted}
          href={awbsHref(tasksBasePath, [...new Set(group.dates.flatMap((d) => d.awbsByState.sorted))], extraTaskParams)}
        />
        <CountCell
          value={group.totals.enRoute}
          href={awbsHref(tasksBasePath, [...new Set(group.dates.flatMap((d) => d.awbsByState.enRoute))], extraTaskParams)}
        />
        <CountCell
          value={group.totals.returned}
          href={awbsHref(tasksBasePath, [...new Set(group.dates.flatMap((d) => d.awbsByState.returned))], extraTaskParams)}
        />
      </tr>
      {isOpen
        ? group.dates.map((row) => (
            <tr
              key={`${group.consigneeId}-${row.deliveryDate}`}
              className={REPORT_SUBROW}
            >
              <td className={`${REPORT_TD} pl-12 text-[color:var(--color-text-secondary)]`}>
                {row.deliveryDate}
              </td>
              <CountCell value={row.allocatedAssets} href={awbsHref(tasksBasePath, row.awbs, extraTaskParams)} />
              <CountCell value={row.suppQuantity} href={awbsHref(tasksBasePath, row.awbs, extraTaskParams)} />
              <CountCell value={row.collected} href={awbsHref(tasksBasePath, row.awbsByState.collected, extraTaskParams)} />
              <CountCell value={row.received} href={awbsHref(tasksBasePath, row.awbsByState.received, extraTaskParams)} />
              <CountCell value={row.sorted} href={awbsHref(tasksBasePath, row.awbsByState.sorted, extraTaskParams)} />
              <CountCell value={row.enRoute} href={awbsHref(tasksBasePath, row.awbsByState.enRoute, extraTaskParams)} />
              <CountCell value={row.returned} href={awbsHref(tasksBasePath, row.awbsByState.returned, extraTaskParams)} />
            </tr>
          ))
        : null}
    </>
  );
}
