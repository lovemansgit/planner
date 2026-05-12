// Day-24 PM — URL-synced date-range filter primitive.
//
// Renders a single dropdown button that shows the active selection
// ("Today" / "Custom: 12 May – 19 May" etc.) and opens a menu with
// preset shortcuts grouped by past / future / custom. Mirrors the
// Datadog/Stripe/Mixpanel/Looker quick-pick pattern.
//
// Menu structure:
//   Today / Yesterday / Last 7 days / Last 30 days
//   ───────── (divider)
//   Tomorrow / Next 7 days / Next 30 days
//   ───────── (divider)
//   Custom range...
//
// Custom range reveals two `<input type="date">` controls inline below
// the dropdown, debounced 300ms before pushing to the URL.
//
// URL state: ?from=YYYY-MM-DD&to=YYYY-MM-DD. The component never
// queries the server for "today" — the consuming server-rendered page
// passes `today` (YYYY-MM-DD) as a prop, sourced from
// computeTodayInDubai(). The client only renders the string the
// server resolved (no client-side TZ fragility).
//
// Two consumers from day one: /admin/tasks (cross-tenant, admin shell)
// and /tasks (tenant operator shell). Shared `src/components/`
// location per the SearchBar 2-consumer extraction precedent.

"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DEBOUNCE_MS = 300;

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "tomorrow"
  | "next7"
  | "next30"
  | "custom";

export interface DateRangeFilterProps {
  /** YYYY-MM-DD anchor for the preset date math. Server-resolved. */
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
 * the server-resolved `today` string (YYYY-MM-DD). Backward presets
 * end today; forward presets start today; "today"/"yesterday"/"tomorrow"
 * are single-day ranges (from = to).
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
  if (preset === "tomorrow") {
    const t = shiftDate(today, 1);
    return { from: t, to: t };
  }
  if (preset === "last7") return { from: shiftDate(today, -6), to: today };
  if (preset === "last30") return { from: shiftDate(today, -29), to: today };
  if (preset === "next7") return { from: today, to: shiftDate(today, 6) };
  return { from: today, to: shiftDate(today, 29) };
}

/**
 * Detect which preset a `{ from, to }` pair matches against the
 * server-resolved `today` anchor. Returns "custom" when no preset
 * matches exactly — the consuming UI then formats the label as
 * "Custom: <from> – <to>" and renders the date-input row.
 */
export function detectActivePreset(
  from: string,
  to: string,
  today: string,
): DateRangePreset {
  const presets: ReadonlyArray<Exclude<DateRangePreset, "custom">> = [
    "today",
    "yesterday",
    "tomorrow",
    "last7",
    "last30",
    "next7",
    "next30",
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

/**
 * Format a YYYY-MM-DD string as "DD Mon" (e.g. "12 May"). Used for
 * the custom-range button label. No locale dep; English short month
 * names hardcoded since the app is single-locale.
 */
export function formatShortDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => Number.parseInt(s, 10));
  if (!y || !m || !d) return yyyyMmDd;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[m - 1]}`;
}

/**
 * Compute the dropdown button's display label for the current active
 * preset + date pair.
 */
export function buildButtonLabel(
  active: DateRangePreset,
  from: string,
  to: string,
): string {
  switch (active) {
    case "today":
      return "Today";
    case "yesterday":
      return "Yesterday";
    case "tomorrow":
      return "Tomorrow";
    case "last7":
      return "Last 7 days";
    case "last30":
      return "Last 30 days";
    case "next7":
      return "Next 7 days";
    case "next30":
      return "Next 30 days";
    case "custom":
      return from === to
        ? `Custom: ${formatShortDate(from)}`
        : `Custom: ${formatShortDate(from)} – ${formatShortDate(to)}`;
  }
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

const MENU_PRESETS_PAST: ReadonlyArray<{
  readonly key: Exclude<DateRangePreset, "custom">;
  readonly label: string;
}> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
];

const MENU_PRESETS_FUTURE: ReadonlyArray<{
  readonly key: Exclude<DateRangePreset, "custom">;
  readonly label: string;
}> = [
  { key: "tomorrow", label: "Tomorrow" },
  { key: "next7", label: "Next 7 days" },
  { key: "next30", label: "Next 30 days" },
];

export function DateRangeFilter({
  today,
  initialFrom,
  initialTo,
  basePath,
}: DateRangeFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialActive = detectActivePreset(initialFrom, initialTo, today);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(initialActive === "custom");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const active = customMode ? "custom" : detectActivePreset(from, to, today);
  const buttonLabel = buildButtonLabel(active, from, to);

  // Cleanup pending debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // Click-outside-to-close.
  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [open]);

  function onContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      setOpen(false);
    }
  }

  function pushRange(nextFrom: string, nextTo: string) {
    const url = buildDateRangeUrl(
      new URLSearchParams(searchParams.toString()),
      nextFrom,
      nextTo,
      basePath,
    );
    router.push(url);
  }

  function onPresetSelect(preset: Exclude<DateRangePreset, "custom">) {
    const range = computePresetRange(preset, today);
    setFrom(range.from);
    setTo(range.to);
    setCustomMode(false);
    setOpen(false);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    pushRange(range.from, range.to);
  }

  function onCustomSelect() {
    setCustomMode(true);
    setOpen(false);
    // Don't push yet — wait for user to pick dates.
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
      if (nextFrom && nextTo) pushRange(nextFrom, nextTo);
    }, DEBOUNCE_MS);
  }

  return (
    <div className="mb-6" ref={containerRef} onKeyDown={onContainerKeyDown}>
      <label className="inline-flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        <span>Date range</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="inline-flex items-center gap-2 border border-[color:var(--color-border-default)] bg-paper px-3 py-1.5 text-xs uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:border-[color:var(--color-border-strong)] focus:outline-none focus:border-navy"
          >
            {buttonLabel}
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open ? (
            <div
              role="menu"
              aria-label="Date range presets"
              className="absolute left-0 top-[calc(100%+4px)] z-10 min-w-[200px] border border-[color:var(--color-border-strong)] bg-paper py-1 shadow-none"
            >
              {MENU_PRESETS_PAST.map(({ key, label }) => (
                <MenuItem
                  key={key}
                  label={label}
                  active={active === key}
                  onSelect={() => onPresetSelect(key)}
                />
              ))}
              <hr className="my-1 border-t border-[color:var(--color-border-default)]" />
              {MENU_PRESETS_FUTURE.map(({ key, label }) => (
                <MenuItem
                  key={key}
                  label={label}
                  active={active === key}
                  onSelect={() => onPresetSelect(key)}
                />
              ))}
              <hr className="my-1 border-t border-[color:var(--color-border-default)]" />
              <MenuItem
                label="Custom range..."
                active={active === "custom"}
                onSelect={onCustomSelect}
              />
            </div>
          ) : null}
        </div>
      </label>
      {customMode ? (
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

function MenuItem({
  label,
  active,
  onSelect,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "block w-full px-4 py-2 text-left text-xs uppercase tracking-[0.1em] text-navy bg-[color:var(--color-tint-navy-subtle)]"
          : "block w-full px-4 py-2 text-left text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:bg-[color:var(--color-tint-navy-subtle)] hover:text-navy transition-colors duration-[120ms] ease-out"
      }
    >
      {label}
    </button>
  );
}
