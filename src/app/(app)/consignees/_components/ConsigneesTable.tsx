// Server-rendered consignees table. Day-24 successor to the
// client-side ConsigneesSearchableTable (whose in-memory filter was
// replaced by server-side ILIKE search via ?q= URL param).
//
// Pure render — no client state, no filter logic. The page reads
// `searchParams.q` and threads it into `listConsignees`; this
// component receives only the filtered rows.

import Link from "next/link";

import type { Consignee } from "@/modules/consignees";

import { CrmStateBadge } from "../[id]/_components/CrmStateBadge";

type Row = Consignee & { taskCount?: number };

interface Props {
  readonly rows: readonly Row[];
  readonly query: string;
}

export function ConsigneesTable({ rows, query }: Props) {
  if (rows.length === 0) {
    return (
      <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
        <p className="text-base text-navy">
          {query.length > 0
            ? `No consignees match "${query}".`
            : "No consignees yet."}
        </p>
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Name</Th>
          <Th>Phone</Th>
          <Th>Emirate</Th>
          <Th>CRM state</Th>
          <Th>Address</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr
            key={c.id}
            className="border-b border-[color:var(--color-border-default)] last:border-b-0 transition-colors hover:bg-ivory"
          >
            <Td>
              <div className="flex items-center gap-2">
                <Link
                  href={`/consignees/${c.id}`}
                  className="text-navy hover:underline"
                >
                  {c.name}
                </Link>
                {c.taskCount === 0 ? <NoTasksBadge /> : null}
              </div>
            </Td>
            <Td className="tabular-nums">{c.phone}</Td>
            <Td>{c.emirateOrRegion}</Td>
            <Td>
              <CrmStateBadge state={c.crmState} />
            </Td>
            <Td className="max-w-xs truncate" title={c.addressLine}>
              {c.addressLine}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
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
      className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]"
      style={{
        backgroundColor: "var(--color-amber-300)",
        color: "var(--color-amber-deep)",
      }}
    >
      No tasks
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`py-5 align-top ${className}`} title={title}>
      {children}
    </td>
  );
}
