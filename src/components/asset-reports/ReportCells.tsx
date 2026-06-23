// Shared report table cells — Day-54 P2 (plan PR #502 §6).
//
// CountCell: a report value that links to its AWB set on the tasks
// list (plan Q4 ruling). Zero / empty-set values render as plain text
// — no dead links.
//
// ReportHeaderCells: the shared column header run. "Supp. Qty" and
// "Assets Allocated" carry Aqib's confirmed semantics verbatim as
// title tooltips (ruling: "use verbatim in column footnotes/tooltips").

import Link from "next/link";

import {
  TOOLTIP_ALLOCATED,
  TOOLTIP_SUPP_QTY,
} from "./report-helpers";
import { REPORT_TD, REPORT_TH } from "./report-table";

export function CountCell({
  value,
  href,
}: {
  readonly value: number;
  readonly href: string | null;
}) {
  if (value === 0 || href === null) {
    return <td className={`${REPORT_TD} text-[color:var(--color-text-secondary)]`}>{value}</td>;
  }
  return (
    <td className={REPORT_TD}>
      <Link
        href={href}
        className="underline decoration-[color:var(--color-border-strong)] underline-offset-4 transition-colors hover:text-navy"
      >
        {value}
      </Link>
    </td>
  );
}

export function ReportHeaderCells() {
  return (
    <>
      <th className={REPORT_TH} title={TOOLTIP_ALLOCATED}>
        Assets allocated
      </th>
      <th className={REPORT_TH} title={TOOLTIP_SUPP_QTY}>
        Supp. qty
      </th>
      <th className={REPORT_TH}>Collected</th>
      <th className={REPORT_TH}>Received</th>
      <th className={REPORT_TH}>Sorted</th>
      <th className={REPORT_TH}>En route</th>
      <th className={REPORT_TH}>Returned</th>
    </>
  );
}
