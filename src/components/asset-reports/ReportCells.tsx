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

const TD = "px-4 py-3 text-sm tabular-nums";
const TH = "px-4 py-3 text-left text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]";

export function CountCell({
  value,
  href,
}: {
  readonly value: number;
  readonly href: string | null;
}) {
  if (value === 0 || href === null) {
    return <td className={`${TD} text-[color:var(--color-text-secondary)]`}>{value}</td>;
  }
  return (
    <td className={TD}>
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
      <th className={TH} title={TOOLTIP_ALLOCATED}>
        Assets allocated
      </th>
      <th className={TH} title={TOOLTIP_SUPP_QTY}>
        Supp. qty
      </th>
      <th className={TH}>Collected</th>
      <th className={TH}>Received</th>
      <th className={TH}>Sorted</th>
      <th className={TH}>En route</th>
      <th className={TH}>Returned</th>
    </>
  );
}
