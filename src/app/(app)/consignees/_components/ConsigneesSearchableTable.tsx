// Day-22 §3.22 fixup — searchable consignees list (client component).
//
// Wraps the read-only ConsigneesTable with a client-side filter input.
// The full row set comes server-rendered (page.tsx → listConsignees)
// and the filter runs against the in-memory array. Pilot tenants
// currently have <100 rows; client-side filter is the cheapest path
// to "operator can find Sarah without scrolling". If row counts grow
// past ~1000, defer to server-side search in Phase 2.
//
// Brand-canon search input: hairline stone-200 border at rest,
// navy focus border, 120ms ease-out transition, sentence-case
// placeholder, no shadow.

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { Consignee } from "@/modules/consignees";

import { CrmStateBadge } from "../[id]/_components/CrmStateBadge";
import { filterConsigneesByQuery } from "../_helpers";

interface Props {
  readonly rows: readonly Consignee[];
}

export function ConsigneesSearchableTable({ rows }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => filterConsigneesByQuery(rows, query),
    [rows, query],
  );

  return (
    <>
      <div className="mb-6">
        <label
          htmlFor="consignees-search"
          className="sr-only"
        >
          Search consignees by name or phone
        </label>
        <input
          id="consignees-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone"
          inputMode="search"
          autoComplete="off"
          className="w-full max-w-md rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] transition-colors duration-[120ms] ease-out focus:border-navy focus:outline-none"
        />
        {query.trim().length > 0 ? (
          <p className="mt-2 text-xs text-[color:var(--color-text-secondary)]">
            {filtered.length} of {rows.length} consignee{rows.length === 1 ? "" : "s"} matching{" "}
            <span className="font-medium text-navy">&quot;{query.trim()}&quot;</span>
          </p>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
          <p className="text-base text-navy">
            {query.trim().length > 0
              ? `No consignees match "${query.trim()}".`
              : "No consignees yet."}
          </p>
        </div>
      ) : (
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
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="border-b border-[color:var(--color-border-default)] last:border-b-0 transition-colors hover:bg-ivory"
              >
                <Td>
                  <Link
                    href={`/consignees/${c.id}`}
                    className="text-navy hover:underline"
                  >
                    {c.name}
                  </Link>
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
      )}
    </>
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
