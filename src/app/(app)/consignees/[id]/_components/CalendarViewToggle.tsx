// Day-21 PR-A2 / Session B — Week / Month / Year view toggle (server
// component). Renders a 3-segment pill button group that switches
// between CalendarWeekView, CalendarMonthView, and CalendarYearView.
//
// URL state: `?view=week|month|year` (default `week`). State survives
// browser back/forward navigation because the pills are <Link>
// components — Next.js push-state preserves the URL on transition,
// and back/forward triggers a re-render with the previous URL's
// `view` param. No client-side state, no React Context.
//
// Brand-pass restraint per brief §3.3.11: hairline border, sentence
// case, no shadow. Active segment uses navy/paper inversion (filled
// pill); inactive uses paper/navy outline (matches the chip-button
// pattern from /tasks filter pills at status.ts:21-29 + the prev/next
// nav buttons inside Week/Month/Year views). Group sits top-right of
// the calendar surface per brief §3.3.3 line 484.

import Link from "next/link";

export type CalendarViewName = "week" | "month" | "year";

export interface CalendarViewToggleProps {
  readonly consigneeId: string;
  readonly activeView: CalendarViewName;
  /**
   * Anchor params per view. Each is the ISO YYYY-MM-DD anchor for
   * that view (week's Monday, month's first day, year's Jan 1). The
   * toggle preserves the matching anchor when the user switches,
   * so toggling Week→Month at a Monday in May 2026 lands on May 2026's
   * month grid (instead of resetting to today).
   */
  readonly weekAnchor: string;
  readonly monthAnchor: string;
  readonly yearAnchor: string;
}

const SEGMENTS: ReadonlyArray<{
  readonly name: CalendarViewName;
  readonly label: string;
}> = [
  { name: "week", label: "Week" },
  { name: "month", label: "Month" },
  { name: "year", label: "Year" },
];

export function CalendarViewToggle({
  consigneeId,
  activeView,
  weekAnchor,
  monthAnchor,
  yearAnchor,
}: CalendarViewToggleProps) {
  function hrefFor(view: CalendarViewName): string {
    const base = `/consignees/${consigneeId}?tab=calendar&view=${view}`;
    if (view === "week") return `${base}&week=${weekAnchor}`;
    if (view === "month") return `${base}&month=${monthAnchor}`;
    return `${base}&year=${yearAnchor}`;
  }
  return (
    <nav
      aria-label="Calendar view"
      className="inline-flex overflow-hidden rounded-sm border border-stone-200"
    >
      {SEGMENTS.map((seg, idx) => {
        const isActive = seg.name === activeView;
        const sep = idx > 0 ? "border-l border-stone-200" : "";
        const tone = isActive
          ? "bg-navy text-paper"
          : "bg-paper text-navy hover:bg-ivory";
        return (
          <Link
            key={seg.name}
            href={hrefFor(seg.name)}
            aria-current={isActive ? "page" : undefined}
            className={`${sep} ${tone} px-3 py-1 text-xs font-medium uppercase tracking-[0.1em] transition-colors duration-[120ms] ease-out`}
          >
            {seg.label}
          </Link>
        );
      })}
    </nav>
  );
}
