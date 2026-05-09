// Day 19 / Phase 1.5 — page-size dropdown for /admin/tasks.
//
// Mirrors the operator-side PageSizeDropdown (Day-17 Session B / PR
// #175) but path-agnostic via usePathname() so future admin pages
// with pagination can reuse without an additional prop. Today only
// /admin/tasks paginates; /admin/consignees + /admin/subscriptions
// mirror their operator-side counterparts (unpaginated). If those
// later need pagination, this component is the consumer.
//
// Param mutation discipline (matches MerchantFilterDropdown):
//   - Resets `page` on size change (page-N at 50/page ≠ page-N at
//     500/page; preserving stale page is a worse UX than resetting).
//   - Preserves all other params (merchant, status).
//   - Default page size is omitted from URL to keep bookmark-friendly
//     `/admin/tasks` form clean.
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent } from "react";

import { PAGE_SIZE_DEFAULT } from "@/app/(app)/tasks/status";

interface AdminPageSizeDropdownProps {
  readonly value: number;
  readonly options: readonly number[];
}

export function AdminPageSizeDropdown({
  value,
  options,
}: AdminPageSizeDropdownProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = Number.parseInt(e.target.value, 10);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("page");
    if (next === PAGE_SIZE_DEFAULT) {
      params.delete("perPage");
    } else {
      params.set("perPage", String(next));
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <label className="inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
      <span>Per page</span>
      <select
        value={value}
        onChange={onChange}
        className="border border-[color:var(--color-border-default)] bg-paper px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-navy hover:border-[color:var(--color-border-strong)] focus:outline-none focus:border-navy"
        aria-label="Page size"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}
