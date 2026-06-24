// Day 17 / Session B — page-size dropdown for /tasks.
//
// URL-driven (`?perPage=`) so an operator running a high-volume batch
// can bookmark / share a wider viewport. Native <select> for keyboard
// accessibility + zero-bundle styling — matches the FilterPill posture
// of "minimal client surface, server owns the data".
//
// Changing the page size always resets `?page=1` because page 7 of a
// 50-per-page view is meaningless after switching to 500-per-page; the
// existing `status` filter is preserved.

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent } from "react";

import { PAGE_SIZE_DEFAULT } from "./status";

interface PageSizeDropdownProps {
  readonly value: number;
  readonly options: readonly number[];
}

/**
 * Build the `/tasks` URL for a page-size change. Clones the CURRENT search
 * params so every sibling filter (status, q, from, to) survives the change —
 * the page-size control must not narrow the result set. `page` is dropped
 * (page-N at 50/page is meaningless at 500/page) and the default size omits
 * `perPage` to keep bookmarked URLs clean. Mirrors the admin sibling
 * (AdminPageSizeDropdown) and the DateRangeFilter URL discipline. Pure +
 * exported for unit coverage (the codebase's no-render convention).
 */
export function buildPageSizeUrl(currentParams: URLSearchParams, next: number): string {
  const params = new URLSearchParams(currentParams.toString());
  params.delete("page");
  if (next === PAGE_SIZE_DEFAULT) {
    params.delete("perPage");
  } else {
    params.set("perPage", String(next));
  }
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

export function PageSizeDropdown({ value, options }: PageSizeDropdownProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(e: ChangeEvent<HTMLSelectElement>) {
    const next = Number.parseInt(e.target.value, 10);
    router.push(buildPageSizeUrl(new URLSearchParams(searchParams?.toString() ?? ""), next));
  }

  return (
    <label className="inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
      <span>Per page</span>
      <select
        value={value}
        onChange={onChange}
        aria-label="Tasks per page"
        className="border border-[color:var(--color-border-default)] bg-transparent px-3 py-2 text-xs uppercase tracking-[0.15em] text-navy transition-opacity hover:border-[color:var(--color-border-strong)] focus:outline-none focus:border-[color:var(--color-border-strong)]"
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
