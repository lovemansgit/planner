// Day-24 PM — URL-synced date-range filter primitive.
//
// Renders 5 preset shortcuts (Today / Yesterday / Last 7 days /
// Last 30 days / Custom) that bind to `?from=YYYY-MM-DD&to=YYYY-MM-DD`
// in the URL. Custom expands a row of two `<input type="date">`
// controls (debounced 300ms before pushing to the URL, same
// CalendarFilterBar pattern Session A established in PR #251).
//
// Two consumers from day one: `/admin/tasks` (cross-tenant, admin
// shell) and `/tasks` (tenant operator shell). The 2-consumer
// extraction rule (Day-23 PM handoff §4.1) justifies the shared
// `src/components/` location.
//
// The component never queries the server for "today" — the consuming
// server-rendered page passes `today` (YYYY-MM-DD) as a prop, sourced
// from the same date helper that powers `/calendar`. This avoids
// client-side timezone fragility: the client only renders the string
// the server resolved.

"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DEBOUNCE_MS = 300;

export type DateRangePreset = "today" | "yesterday" | "last7" | "last30" | "custom";

export interface DateRangeFilterProps {
  /** YYYY-MM-DD anchor for the "today"/"yesterday" math. Server-resolved. */
  readonly today: string;
  /** Initial `from` value (already swapped/normalised at page boundary). */
  readonly initialFrom: string;
  /** Initial `to` value (already swapped/normalised at page boundary). */
  readonly initialTo: string;
  /** Path used for `router.push` (e.g. `/admin/tasks` or `/tasks`). */
  readonly basePath: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for node-env testing — no jsdom)
// ---------------------------------------------------------------------------

/**
 * Compute the inclusive `{ from, to }` pair for a preset, anchored to
 * the server-resolved `today` string (YYYY-MM-DD). "today" returns the
 * same anchor on both bounds; "last7" / "last30" return rolling
 * windows ending today.
 */
export function computePresetRange(
  preset: Exclude<DateRangePreset, "custom">,
  today: string,
): { from: string; to: string } {
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const y = shiftDate(today, -1);
    return { from: y, to: y };
  }
  if (preset === "last7") return { from: shiftDate(today, -6), to: today };
  return { from: shiftDate(today, -29), to: today };
}

/**
 * Detect which preset a `{ from, to }` pair matches against the
 * server-resolved `today` anchor. Returns "custom" when no preset
 * exactly matches — the consuming UI then renders the date-input row.
 */
export function detectActivePreset(
  from: string,
  to: string,
  today: string,
): DateRangePreset {
  const presets: ReadonlyArray<Exclude<DateRangePreset, "custom">> = [
    "today",
    "yesterday",
    "last7",
    "last30",
  ];
  for (const preset of presets) {
    const range = computePresetRange(preset, today);
    if (range.from === from && range.to === to) return preset;
  }
  return "custom";
}

/**
 * Build a router-push URL with the new from/to applied. Preserves
 * every other search param. Always drops `page` so a filter write
 * resets pagination (mirrors SearchBar + CalendarFilterBar behaviour).
 */
export function buildDateRangeUrl(
  currentParams: URLSearchParams,
  from: string,
  to: string,
  basePath: string,
): string {
  const params = new URLSearchParams(currentParams.toString());
  if (from) params.set("from", from);
  else params.delete("from");
  if (to) params.set("to", to);
  else params.delete("to");
  params.delete("page");
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Shift a YYYY-MM-DD date by N days (positive or negative). UTC-safe. */
function shiftDate(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => Number.parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PRESETS: ReadonlyArray<{
  readonly key: Exclude<DateRangePreset, "custom">;
  readonly label: string;
}> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
];

export function DateRangeFilter({
  today,
  initialFrom,
  initialTo,
  basePath,
}: DateRangeFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active = detectActivePreset(initialFrom, initialTo, today);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  function pushRange(nextFrom: string, nextTo: string) {
    const url = buildDateRangeUrl(
      new URLSearchParams(searchParams.toString()),
      nextFrom,
      nextTo,
      basePath,
    );
    router.push(url);
  }

  function onPresetClick(preset: Exclude<DateRangePreset, "custom">) {
    const range = computePresetRange(preset, today);
    setFrom(range.from);
    setTo(range.to);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    pushRange(range.from, range.to);
  }

  function onCustomFromChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setFrom(value);
    scheduleCustomPush(value, to);
  }

  function onCustomToChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    setTo(value);
    scheduleCustomPush(from, value);
  }

  function scheduleCustomPush(nextFrom: string, nextTo: string) {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Empty values skip the URL write; full pair required.
      if (nextFrom && nextTo) pushRange(nextFrom, nextTo);
    }, DEBOUNCE_MS);
  }

  return (
    <div className="mb-6">
      <nav
        aria-label="Date range filter"
        className="flex flex-wrap items-center gap-2"
      >
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPresetClick(key)}
            aria-current={active === key ? "true" : undefined}
            className={
              active === key
                ? "inline-flex items-center border-2 border-green px-4 py-2 text-xs uppercase tracking-[0.15em] text-navy"
                : "inline-flex items-center border border-[color:var(--color-border-default)] px-4 py-2 text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:border-[color:var(--color-border-strong)] hover:text-navy"
            }
          >
            {label}
          </button>
        ))}
        <span
          aria-current={active === "custom" ? "true" : undefined}
          className={
            active === "custom"
              ? "inline-flex items-center border-2 border-green px-4 py-2 text-xs uppercase tracking-[0.15em] text-navy"
              : "inline-flex items-center border border-[color:var(--color-border-default)] px-4 py-2 text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]"
          }
        >
          Custom
        </span>
      </nav>
      {active === "custom" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
            <span className="sr-only">From date</span>
            <input
              type="date"
              value={from}
              onChange={onCustomFromChange}
              className="ml-2 border border-stone-200 bg-paper px-3 py-1.5 text-sm text-navy focus:border-navy focus:outline-none transition-colors duration-[120ms] ease-out"
            />
          </label>
          <span className="text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-tertiary)]">to</span>
          <label className="text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
            <span className="sr-only">To date</span>
            <input
              type="date"
              value={to}
              onChange={onCustomToChange}
              className="ml-2 border border-stone-200 bg-paper px-3 py-1.5 text-sm text-navy focus:border-navy focus:outline-none transition-colors duration-[120ms] ease-out"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
