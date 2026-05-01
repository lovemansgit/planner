// Pure date math for the cron handler. Lives in the module rather than
// the route so unit tests can import it without dragging the
// `server-only` boundary in tow.
//
// Dubai is UTC+4 with no DST, so the "calendar day in Dubai" of a UTC
// instant `t` is the date part of `(t + 4 hours)` formatted as
// YYYY-MM-DD. The next-day target is one day after.

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Next calendar date in Asia/Dubai for a given UTC instant. Format:
 * YYYY-MM-DD. Pure arithmetic; no Intl dependency for auditability.
 */
export function nextCalendarDateInDubai(t: Date): string {
  const dubaiInstant = new Date(t.getTime() + DUBAI_OFFSET_MS);
  const todayStr = dubaiInstant.toISOString().slice(0, 10);
  const [y, m, d] = todayStr.split("-").map((s) => parseInt(s, 10));
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  return tomorrow.toISOString().slice(0, 10);
}
