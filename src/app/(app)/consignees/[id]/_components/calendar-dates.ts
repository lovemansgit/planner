// Day-21 PR-A2 / Session B — calendar date helpers shared across
// CalendarWeekView (existing), CalendarMonthView (new this PR), and
// CalendarYearView (new this PR). Pure functions, no I/O — exported
// for unit-test coverage.
//
// All inputs/outputs use ISO date strings (YYYY-MM-DD) at UTC for
// comparison with Task.deliveryDate (postgres-js DATE → ISO string)
// and with SubscriptionException.startDate. Tenant timezone (Asia/
// Dubai) is the operator-facing convention but date arithmetic stays
// in UTC because the database column type is DATE — no clock offset.

/** Stringify a Date as YYYY-MM-DD (UTC). */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add `days` to an ISO date string, returning a new ISO date string. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Compute the ISO Monday of the week containing the given date. */
export function computeWeekStart(date: Date): string {
  // ISO weekday: Mon=1...Sun=7. JS getDay(): Sun=0...Sat=6.
  const jsDay = date.getUTCDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const daysToMonday = isoDay - 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysToMonday);
  return toIsoDate(monday);
}

/** First day of the month for the given date — YYYY-MM-01. */
export function computeMonthStart(date: Date): string {
  const m = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return toIsoDate(m);
}

/** Last day of the month for the given date — YYYY-MM-{28..31}. */
export function computeMonthEnd(date: Date): string {
  // Day 0 of next month = last day of current month.
  const m = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return toIsoDate(m);
}

/**
 * Compute the month-grid start (Monday of the week containing the
 * first of the month). The month-view grid renders 5-6 week rows;
 * leading days come from the previous month and render muted.
 */
export function computeMonthGridStart(monthStart: string): string {
  return computeWeekStart(new Date(`${monthStart}T00:00:00Z`));
}

/**
 * Compute the month-grid end (Sunday of the week containing the
 * last of the month). Trailing days come from the next month and
 * render muted.
 */
export function computeMonthGridEnd(monthEnd: string): string {
  const monday = computeWeekStart(new Date(`${monthEnd}T00:00:00Z`));
  return addDays(monday, 6);
}

/**
 * First day of the year for the given date — YYYY-01-01.
 * Year view aggregates across this 365/366-day window via the
 * countTasksByConsigneeAndDayBucket aggregator (DECISION-1 b).
 */
export function computeYearStart(date: Date): string {
  const y = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return toIsoDate(y);
}

/** Last day of the year for the given date — YYYY-12-31. */
export function computeYearEnd(date: Date): string {
  const y = new Date(Date.UTC(date.getUTCFullYear(), 11, 31));
  return toIsoDate(y);
}

/** Iterate ISO dates from `start` (inclusive) to `end` (inclusive). */
export function enumerateDates(startIso: string, endIso: string): readonly string[] {
  const out: string[] = [];
  let cursor = startIso;
  while (cursor <= endIso) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * Format a YYYY-MM anchor as the human-readable month header
 * ("May 2026"). Locale fixed to en-GB for Asia/Dubai operator
 * audience consistency with brief §3.3.3 chrome conventions.
 */
export function formatMonthLabel(monthStart: string): string {
  const d = new Date(`${monthStart}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format a YYYY anchor as the year header ("2026"). */
export function formatYearLabel(yearStart: string): string {
  return yearStart.slice(0, 4);
}
