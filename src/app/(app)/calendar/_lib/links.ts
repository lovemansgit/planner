// Day-22n PR-C-B — Drill-down URL helpers for /calendar.
//
// `linkToConsigneeCalendar` is the single source of truth for the
// task-row → consignee-detail-calendar drill-down route per reviewer
// OQ-4 ruling ("route, NOT drawer"). TaskPreviewRow + any future
// consumer imports from here so the URL shape stays consistent if
// the consignee-detail calendar route ever moves.
//
// Returns shape: /consignees/${id}?tab=calendar&week=${mondayOf(date)}
// so the consignee detail lands on the matching week directly,
// matching the Day-21 PR-A2 week-anchor convention.
//
// `mondayOf` duplicates the 6-line `computeWeekStart` helper at
// src/app/(app)/consignees/[id]/_components/calendar-dates.ts:24-33
// inline rather than cross-route-importing. If a Phase-2 refactor
// lifts the date helpers to src/lib/, both surfaces should adopt
// the lifted version.

/**
 * Compute the ISO Monday of the week containing the given ISO date.
 * JS getDay() returns Sun=0..Sat=6; ISO weekday Mon=1..Sun=7. Sunday
 * wraps back to the previous Monday (6 days earlier).
 */
export function mondayOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const jsDay = date.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const daysToMonday = isoDay - 1;
  date.setUTCDate(date.getUTCDate() - daysToMonday);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Drill-down link from a /calendar task-preview row to that
 * consignee's detail-page calendar tab, anchored to the week
 * containing the delivery date.
 */
export function linkToConsigneeCalendar(
  consigneeId: string,
  deliveryDate: string,
): string {
  const week = mondayOf(deliveryDate);
  return `/consignees/${consigneeId}?tab=calendar&week=${week}`;
}
