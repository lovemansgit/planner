// D56 Phase 8 / Lane 3 — fine-14 courier-status filter dropdown.
//
// Replaces the coarse-7 status pills on /tasks (Love ruling: a single
// dropdown of all 14 fine courier states + "All"). URL-state rides the
// existing `?status=` param — single filter, single param — so it composes
// with the search / date-range / page-size controls already on the row. The
// value vocabulary is the fine `courier_status` (see `parseCourierStatusParam`
// on the server side); a stale coarse bookmark degrades to "All".
//
// Native <select> for keyboard accessibility + zero-bundle styling, matching
// the PageSizeDropdown posture. Changing the filter resets `?page=` (page N
// of the old filter is meaningless under the new one) and preserves every
// other param (q / from / to / perPage) via the SearchBar URL idiom.

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent } from "react";

import { COURIER_STATUS_FILTER_OPTIONS } from "../status";

export function CourierStatusFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("status") ?? "";

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) {
      params.set("status", next);
    } else {
      params.delete("status");
    }
    params.delete("page");
    const qs = params.toString();
    router.push(qs.length > 0 ? `?${qs}` : "?");
  }

  return (
    <label className="inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
      <span>Status</span>
      <select
        value={current}
        onChange={onChange}
        aria-label="Filter by delivery status"
        className="border border-[color:var(--color-border-default)] bg-transparent px-3 py-2 text-xs uppercase tracking-[0.15em] text-navy transition-opacity hover:border-[color:var(--color-border-strong)] focus:outline-none focus:border-[color:var(--color-border-strong)]"
      >
        <option value="">All</option>
        {COURIER_STATUS_FILTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
