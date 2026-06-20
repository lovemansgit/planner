"use client";

// All-merchants Inventory sections — Day-54 walk F1 (Love's ruling:
// the admin Inventory page at "All Merchants" renders one section per
// lit merchant with its rollup row, expandable to the by-consignee
// breakdown, same drill-down behaviour as the rest; the merchant
// dropdown remains a filter, not a prerequisite).
//
// Same shape as ConsigneeRows one level up: a summary row per
// merchant (totals across the date range, every value linking to its
// AWB set on /admin/tasks scoped to that merchant), toggling open a
// full-width subrow that hosts the merchant's by-consignee breakdown
// — the existing ConsigneeRows component, which itself expands per
// delivery date. Client component for the expand state only.

import { useState } from "react";

import type { AdminInventoryMerchantSection } from "@/modules/asset-tracking/report-service";

import { ConsigneeRows } from "./ConsigneeRows";
import { CountCell, ReportHeaderCells } from "./ReportCells";
import { RefreshButton } from "./RefreshButton";
import { awbsHref } from "./report-helpers";

const TD = "px-4 py-3 text-sm tabular-nums";
const TH = "px-4 py-3 text-left text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]";

export function MerchantRows({
  sections,
  tasksBasePath,
}: {
  readonly sections: readonly AdminInventoryMerchantSection[];
  readonly tasksBasePath: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  function toggle(tenantId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(tenantId)) {
        next.delete(tenantId);
      } else {
        next.add(tenantId);
      }
      return next;
    });
  }

  return (
    <div className="overflow-x-auto border border-[color:var(--color-border-strong)]">
      <table className="w-full border-collapse">
        <thead className="border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)]">
          <tr>
            <th className={TH}>Merchant</th>
            <ReportHeaderCells />
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <MerchantSectionRows
              key={section.tenantId}
              section={section}
              isOpen={open.has(section.tenantId)}
              onToggle={() => toggle(section.tenantId)}
              tasksBasePath={tasksBasePath}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MerchantSectionRows({
  section,
  isOpen,
  onToggle,
  tasksBasePath,
}: {
  readonly section: AdminInventoryMerchantSection;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly tasksBasePath: string;
}) {
  const extraTaskParams = { merchant: section.merchantSlug };
  const rollup = section.rollup;
  return (
    <>
      <tr className="border-b border-[color:var(--color-border-subtle)] last:border-b-0">
        <td className={`${TD} font-medium`}>
          {/* Refresh sits beside the toggle (a sibling, not nested — it must
              not toggle the section). Scoped to this one merchant, so it
              never fans out across the fleet (the #509 cost guard). */}
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              className="flex items-center gap-2 rounded-sm text-left hover:text-[color:var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
            >
              <span aria-hidden="true" className="inline-block w-3 text-xs">
                {isOpen ? "▾" : "▸"}
              </span>
              {section.merchantName}
              <span className="text-xs text-[color:var(--color-text-secondary)]">
                ({new Set(section.consignees.map((row) => row.consigneeId)).size} consignees)
              </span>
            </button>
            <RefreshButton merchantSlug={section.merchantSlug} />
          </span>
        </td>
        <CountCell
          value={rollup?.allocatedAssets ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbs, extraTaskParams) : null}
        />
        <CountCell
          value={rollup?.suppQuantity ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbs, extraTaskParams) : null}
        />
        <CountCell
          value={rollup?.collected ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbsByState.collected, extraTaskParams) : null}
        />
        <CountCell
          value={rollup?.received ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbsByState.received, extraTaskParams) : null}
        />
        <CountCell
          value={rollup?.sorted ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbsByState.sorted, extraTaskParams) : null}
        />
        <CountCell
          value={rollup?.enRoute ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbsByState.enRoute, extraTaskParams) : null}
        />
        <CountCell
          value={rollup?.returned ?? 0}
          href={rollup ? awbsHref(tasksBasePath, rollup.awbsByState.returned, extraTaskParams) : null}
        />
      </tr>
      {isOpen ? (
        <tr className="border-b border-[color:var(--color-border-subtle)] bg-[color:var(--color-tint-navy-subtle)] last:border-b-0">
          <td colSpan={8} className="px-4 py-4 pl-9">
            {section.consignees.length === 0 ? (
              <p className="text-sm text-[color:var(--color-text-secondary)]">
                No asset data in this date range.
              </p>
            ) : (
              <ConsigneeRows
                rows={section.consignees}
                tasksBasePath={tasksBasePath}
                extraTaskParams={extraTaskParams}
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
