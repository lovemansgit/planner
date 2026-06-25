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
import {
  REPORT_ROW,
  REPORT_SUBROW,
  REPORT_TD,
  REPORT_TH,
  TABLE,
  TABLE_CARD,
  TABLE_SCROLL,
} from "./report-table";

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
    <div className={TABLE_CARD}>
      <div className={TABLE_SCROLL}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={REPORT_TH}>Merchant</th>
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
      <tr className={REPORT_ROW}>
        <td className={`${REPORT_TD} font-medium`}>
          {/* Phase 12.2 cosmetic — line the per-merchant controls into clean
              columns. The ▸ toggle + merchant name keep the shared LEFT edge,
              while the "(N consignees)" count and the Refresh button right-align
              as a group (justify-between) to the Merchant column's right edge —
              so they no longer sit ragged at variable x after variable-length
              merchant names. Refresh stays a sibling of the toggle (not nested —
              it must not toggle the section) and scoped to this one merchant
              (the #509 cost guard); the count is now an info label beside it. */}
          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              className="flex items-center gap-2 rounded-sm text-left hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy"
            >
              <span aria-hidden="true" className="inline-block w-3 shrink-0 text-xs">
                {isOpen ? "▾" : "▸"}
              </span>
              {section.merchantName}
            </button>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-xs tabular-nums text-[color:var(--color-text-secondary)]">
                ({new Set(section.consignees.map((row) => row.consigneeId)).size} consignees)
              </span>
              <RefreshButton merchantSlug={section.merchantSlug} />
            </span>
          </div>
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
        <tr className={REPORT_SUBROW}>
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
