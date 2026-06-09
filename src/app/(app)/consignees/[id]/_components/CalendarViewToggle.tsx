// Day-21 PR-A2 / Session B — Month / Year view toggle (server
// component). Renders a 2-segment pill button group that switches
// between CalendarMonthView and CalendarYearView.
//
// Day-51 / R9: the Week view was removed (calendar-management lane
// diagnostic R9). `?view=month|year` (default `month`); any unknown
// value — including the retired `?view=week` — falls back SILENTLY to
// Month via `resolveCalendarView` (R7.2 default, R7.3 deep-link
// fallback). Old `?view=week` bookmarks keep working, on Month.
//
// URL state survives browser back/forward navigation because the pills
// are <Link> components — Next.js push-state preserves the URL on
// transition, and back/forward re-renders with the previous URL's
// `view` param. No client-side state, no React Context.
//
// Brand-pass restraint per brief §3.3.11: hairline border, sentence
// case, no shadow. Active segment uses navy/paper inversion (filled
// pill); inactive uses paper/navy outline (matches the chip-button
// pattern from /tasks filter pills at status.ts:21-29 + the prev/next
// nav buttons inside the Month/Year views). Group sits top-right of
// the calendar surface per brief §3.3.3 line 484.

import Link from "next/link";

export type CalendarViewName = "month" | "year";

export const VALID_CALENDAR_VIEWS: readonly CalendarViewName[] = ["month", "year"];

/**
 * Resolve the `?view=` URL param to a calendar view. R9 (Day-51): the
 * Week view was removed; any unknown value — including the retired
 * `week` — falls back SILENTLY to the Month default (no error, no
 * toast), preserving old `?view=week` bookmarks per R7.2 / R7.3.
 */
export function resolveCalendarView(viewParam: string | undefined): CalendarViewName {
  return (VALID_CALENDAR_VIEWS as readonly string[]).includes(viewParam ?? "")
    ? (viewParam as CalendarViewName)
    : "month";
}

export interface CalendarViewToggleProps {
  readonly consigneeId: string;
  readonly activeView: CalendarViewName;
  /**
   * Anchor params per view. Each is the ISO YYYY-MM-DD anchor for that
   * view (month's first day, year's Jan 1). The toggle preserves the
   * matching anchor when the user switches between Month and Year.
   */
  readonly monthAnchor: string;
  readonly yearAnchor: string;
}

export const CALENDAR_VIEW_SEGMENTS: ReadonlyArray<{
  readonly name: CalendarViewName;
  readonly label: string;
}> = [
  { name: "month", label: "Month" },
  { name: "year", label: "Year" },
];

export function CalendarViewToggle({
  consigneeId,
  activeView,
  monthAnchor,
  yearAnchor,
}: CalendarViewToggleProps) {
  function hrefFor(view: CalendarViewName): string {
    const base = `/consignees/${consigneeId}?tab=calendar&view=${view}`;
    if (view === "month") return `${base}&month=${monthAnchor}`;
    return `${base}&year=${yearAnchor}`;
  }
  return (
    <nav
      aria-label="Calendar view"
      className="inline-flex overflow-hidden rounded-sm border border-stone-200"
    >
      {CALENDAR_VIEW_SEGMENTS.map((seg, idx) => {
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
