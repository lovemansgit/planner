// Day 19 / Phase 1.5 — shared page-size dropdown for admin pages.
//
// Mirrors the operator-side PageSizeDropdown (Day-17 Session B / PR
// #175) but path-agnostic via usePathname(). Consumed by /admin/tasks,
// /admin/consignees, and /admin/subscriptions — lifted from
// (admin)/admin/tasks/_components/ to (admin)/_components/ per Day-19
// PR #213 §3.6 counter-review (UX-FINDING-2: pagination needed on
// /admin/consignees + /admin/subscriptions for cross-tenant volume).
//
// Param mutation discipline (matches MerchantFilterDropdown):
//   - Resets `page` on size change (page-N at 50/page ≠ page-N at
//     500/page; preserving stale page is a worse UX than resetting).
//   - Preserves all other params (merchant, status).
//   - Default page size is omitted from URL to keep bookmark-friendly
//     URLs clean.
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
