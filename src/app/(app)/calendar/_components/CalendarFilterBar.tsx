// Day-22n PR-C-B + Day-23n polish — CalendarFilterBar (client component).
//
// Four-filter bar atop the consolidated `/calendar` view per brief
// §3.3.4: search by consignee name/phone + CRM state + area/district
// + task status. Day-23n polish dropped the time-window dropdown
// (no consumer in the post-narrowing UX). URL-state precedent
// mirrored from /tasks (per reviewer OQ-3 ruling: no shared-primitive
// extraction; build inline). Each filter change pushes a new URL via
// useRouter().push so the operator can share / bookmark a filtered
// view; non-filter params (view, week/month/date anchors, etc.) are
// preserved across writes.
//
// Search input is debounced ~300ms; selects fire immediately on
// change. `page` param is dropped on every filter write so the
// next-page cursor doesn't carry into a different result set.
//
// Pure-logic extraction: `buildCalendarFiltersUrl(currentParams,
// filters)` exposed for spec coverage per the codebase's
// no-render-test convention. The fn is the single source of truth
// for the filter URL shape.

"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CalendarFiltersValue } from "../_types";

export interface CalendarFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface CalendarFilterBarProps {
  readonly initialValues: CalendarFiltersValue;
  readonly crmOptions: readonly CalendarFilterOption[];
  readonly districtOptions: readonly CalendarFilterOption[];
  readonly statusOptions: readonly CalendarFilterOption[];
}

const FILTER_KEYS = ["q", "crm", "district", "status"] as const;

/**
 * Build the next /calendar URL from the current search-params plus a
 * fully-resolved set of filter values. Empty strings clear the
 * corresponding key. The `page` cursor is always dropped on a filter
 * write so the operator lands on page 1 of the new filtered set.
 * Non-filter params (view, week, month, date, plus any future
 * additions) are preserved as-is.
 */
export function buildCalendarFiltersUrl(
  currentSearchParams: URLSearchParams,
  filters: CalendarFiltersValue,
): string {
  const params = new URLSearchParams(currentSearchParams.toString());
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete("page");
  const qs = params.toString();
  return qs ? `/calendar?${qs}` : "/calendar";
}

const DEBOUNCE_MS = 300;

export function CalendarFilterBar({
  initialValues,
  crmOptions,
  districtOptions,
  statusOptions,
}: CalendarFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(initialValues.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function pushFilters(next: Partial<CalendarFiltersValue>) {
    const baseParams = new URLSearchParams(searchParams.toString());
    const current: CalendarFiltersValue = {
      q: baseParams.get("q") ?? "",
      crm: baseParams.get("crm") ?? "",
      district: baseParams.get("district") ?? "",
      status: baseParams.get("status") ?? "",
    };
    const merged = { ...current, ...next };
    const url = buildCalendarFiltersUrl(baseParams, merged);
    router.push(url);
  }

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushFilters({ q: value });
    }, DEBOUNCE_MS);
  }

  function onSelectChange(
    key: keyof CalendarFiltersValue,
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    pushFilters({ [key]: event.target.value });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-stone-200 bg-surface-primary px-4 py-3">
      <input
        type="search"
        value={q}
        onChange={onSearchChange}
        placeholder="Search consignee name or phone"
        aria-label="Search consignee name or phone"
        className="min-w-[220px] flex-1 rounded-sm border border-stone-200 bg-paper px-3 py-1.5 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none transition-colors duration-[120ms] ease-out"
      />
      <FilterSelect
        ariaLabel="CRM state"
        placeholder="All CRM states"
        value={initialValues.crm}
        options={crmOptions}
        onChange={(event) => onSelectChange("crm", event)}
      />
      <FilterSelect
        ariaLabel="Area"
        placeholder="All areas"
        value={initialValues.district}
        options={districtOptions}
        onChange={(event) => onSelectChange("district", event)}
      />
      <FilterSelect
        ariaLabel="Task status"
        placeholder="All statuses"
        value={initialValues.status}
        options={statusOptions}
        onChange={(event) => onSelectChange("status", event)}
      />
    </div>
  );
}

interface FilterSelectProps {
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly value: string;
  readonly options: readonly CalendarFilterOption[];
  readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}

function FilterSelect({
  ariaLabel,
  placeholder,
  value,
  options,
  onChange,
}: FilterSelectProps) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      className="rounded-sm border border-stone-200 bg-paper px-2 py-1.5 text-sm text-navy focus:border-navy focus:outline-none transition-colors duration-[120ms] ease-out"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
