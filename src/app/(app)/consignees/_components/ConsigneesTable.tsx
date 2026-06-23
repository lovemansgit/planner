// Server-rendered consignees table. Day-24 successor to the
// client-side ConsigneesSearchableTable (whose in-memory filter was
// replaced by server-side ILIKE search via ?q= URL param).
//
// Phase 10 · Batch B2 — adopts the shared <DataTable> (Gap C, B+ skin):
// a floating warm-white card, never-wrap eyebrow headers, mono phone
// figures, full-row links to the detail page, and the status-LED gutter
// lit from CRM tone. The CRM cell adopts the canonical
// <StatusBadge domain="crm">, retiring the bordered CrmStateBadge variant
// on the list per #558 Gap B (CHURNED loses its strikethrough by design).
// Data, column order, the ?q= search contract, and the /consignees/[id]
// link target are unchanged. The consignee detail page keeps CrmStateBadge
// (detail pages are out of scope for this batch).
//
// Pure render — no client state, no filter logic. The page reads
// `searchParams.q` and threads it into `listConsignees`; this
// component receives only the filtered rows.

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { statusMeta } from "@/components/status-badge-recipe";
import type { Consignee } from "@/modules/consignees";
import { formatPhone } from "@/shared/humanize";

type Row = Consignee & { taskCount?: number };

interface Props {
  readonly rows: readonly Row[];
  readonly query: string;
}

const COLUMNS: ReadonlyArray<DataTableColumn<Row>> = [
  {
    key: "name",
    header: "Name",
    cell: (c) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-b-display font-semibold text-navy">{c.name}</span>
        {c.taskCount === 0 ? <NoTasksBadge /> : null}
      </span>
    ),
    title: (c) => c.name,
  },
  {
    key: "phone",
    header: "Phone",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (c) => formatPhone(c.phone),
  },
  {
    key: "emirate",
    header: "Emirate",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (c) => c.emirateOrRegion,
    title: (c) => c.emirateOrRegion,
  },
  {
    key: "crmState",
    header: "CRM state",
    cell: (c) => <StatusBadge domain="crm" status={c.crmState} />,
  },
  {
    key: "address",
    header: "Address",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (c) => c.addressLine,
    title: (c) => c.addressLine,
  },
];

export function ConsigneesTable({ rows, query }: Props) {
  if (rows.length === 0) {
    return (
      <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
        <p className="text-base text-navy">
          {query.length > 0 ? `No consignees match "${query}".` : "No consignees yet."}
        </p>
      </div>
    );
  }

  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      getRowKey={(c) => c.id}
      rowHref={(c) => `/consignees/${c.id}`}
      led={(c) => statusMeta("crm", c.crmState)?.tone}
      caption="Consignees you deliver to"
    />
  );
}

/**
 * Day-25 / brief v1.12 §3.4 — amber pill rendered next to the name
 * when the consignee has zero tasks across any internal_status. Flag
 * clears the moment the first task lands (subscription-materialised
 * or ad-hoc). Task-based, NOT subscription-based.
 */
function NoTasksBadge() {
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em]"
      style={{
        backgroundColor: "var(--color-amber-300)",
        color: "var(--color-amber-deep)",
      }}
    >
      No tasks
    </span>
  );
}
