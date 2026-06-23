// Day-22n PR-C-B — CalendarViewToggle for the consolidated `/calendar`
// view (server component).
//
// Three segments: Week / Month / Day. NO Year segment per reviewer
// OQ-7 ruling — year is consignee-detail only (heat-map per brief
// §3.3.3). Mirrors the per-consignee CalendarViewToggle pattern at
// src/app/(app)/consignees/[id]/_components/CalendarViewToggle.tsx
// (navy/paper inversion, hairline 0.5px stone border, uppercase
// tracking-[0.1em], 120ms ease-out transitions).
//
// Each segment preserves the matching anchor when toggled so the
// operator's contextual week / month / day position survives the
// switch. Filter state (`q`, `crm`, etc.) is preserved by the
// `preservedQuery` prop — the page component composes the current
// search-params (minus `view`+anchor keys) and passes them through
// so toggling doesn't drop the active filters.
//
// Pure-logic extraction: `hrefFor(view, ...)` exposed for spec
// coverage per the codebase's no-render-test convention.
//
// Phase 10 · Batch B5 — B+ chrome: the segmented control is hairlined
// with --color-border-default; inactive segments sit on --color-b-card
// with a navy-subtle hover, the active segment keeps the navy fill.
// hrefFor and the anchor-preservation logic are unchanged — chrome only.

import Link from "next/link";

import type { CalendarConsolidatedView } from "../_types";

export interface CalendarViewToggleProps {
  readonly activeView: CalendarConsolidatedView;
  readonly weekAnchor: string; // ISO YYYY-MM-DD Monday
  readonly monthAnchor: string; // ISO YYYY-MM-01
  readonly dayAnchor: string; // ISO YYYY-MM-DD
  /**
   * Filter / search params to preserve across view toggles, already
   * URL-encoded. Omit the `view`, `week`, `month`, `date` keys —
   * those are owned by this component.
   */
  readonly preservedQuery?: string;
}

const SEGMENTS: readonly {
  readonly name: CalendarConsolidatedView;
  readonly label: string;
}[] = [
  { name: "week", label: "Week" },
  { name: "month", label: "Month" },
  { name: "day", label: "Day" },
];

export interface HrefForArgs {
  readonly view: CalendarConsolidatedView;
  readonly weekAnchor: string;
  readonly monthAnchor: string;
  readonly dayAnchor: string;
  readonly preservedQuery?: string;
}

export function hrefFor({
  view,
  weekAnchor,
  monthAnchor,
  dayAnchor,
  preservedQuery,
}: HrefForArgs): string {
  const params = new URLSearchParams();
  params.set("view", view);
  if (view === "week") params.set("week", weekAnchor);
  else if (view === "month") params.set("month", monthAnchor);
  else params.set("date", dayAnchor);
  const ownQs = params.toString();
  const tail = preservedQuery ? `${ownQs}&${preservedQuery}` : ownQs;
  return `/calendar?${tail}`;
}

export function CalendarViewToggle({
  activeView,
  weekAnchor,
  monthAnchor,
  dayAnchor,
  preservedQuery,
}: CalendarViewToggleProps) {
  return (
    <nav
      aria-label="Calendar view"
      className="inline-flex overflow-hidden rounded-[10px] ring-1 ring-[color:var(--color-border-default)]"
    >
      {SEGMENTS.map((seg, idx) => {
        const isActive = seg.name === activeView;
        const separator = idx > 0 ? "border-l border-[color:var(--color-border-default)]" : "";
        const tone = isActive
          ? "bg-navy text-paper"
          : "bg-[color:var(--color-b-card)] text-navy hover:bg-[color:var(--color-tint-navy-subtle)]";
        const href = hrefFor({
          view: seg.name,
          weekAnchor,
          monthAnchor,
          dayAnchor,
          preservedQuery,
        });
        return (
          <Link
            key={seg.name}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`${separator} ${tone} px-3 py-1 text-xs font-medium uppercase tracking-[0.1em] transition-colors duration-[120ms] ease-out`}
          >
            {seg.label}
          </Link>
        );
      })}
    </nav>
  );
}
