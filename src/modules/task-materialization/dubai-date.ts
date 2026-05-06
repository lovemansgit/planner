// Asia/Dubai date computation for the Day-14 materialization cron.
// Relocated + renamed from src/modules/task-generation/dubai-date.ts
// (which retires per memory/plans/day-14-cron-decoupling.md §1.3
// alongside task-generation/service.ts).
//
// Dubai is UTC+4 with no DST. The "calendar day in Dubai" of a UTC
// instant `t` is the date part of `(t + 4 hours)` formatted as
// YYYY-MM-DD. Implemented inline here (no Intl-locale dependency
// to keep the date logic auditable).
//
// Why TS-side rather than SQL-side:
//   - Handler-entry deterministic computation: targetDate is computed
//     once per cron invocation and passed as a parameter to each
//     per-tenant SQL. All tenants share the same target_date.
//   - SQL-side `now() AT TIME ZONE 'Asia/Dubai'` would re-evaluate
//     per query and risk midnight-boundary drift (the ~200s flow-
//     control drainage window per plan §6.3 spans potentially across
//     a Dubai-day boundary; SQL-side re-evaluation would compute
//     different target_dates for early-loop vs late-loop tenants).

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Compute the Day-14 materialization handler's target horizon date —
 * `today + 14 days` in Asia/Dubai, formatted as YYYY-MM-DD.
 *
 * Per plan §3.2 (corrected by PR #146): the handler-level value is
 * `today + 14`. Per-subscription cap to `LEAST(target, S.end_date)`
 * is applied inside the §2.3 INSERT…SELECT (Phase 2 SQL), not here.
 */
export function computeTargetDateInDubai(now: Date): string {
  const dubaiNow = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const horizon = new Date(
    Date.UTC(
      dubaiNow.getUTCFullYear(),
      dubaiNow.getUTCMonth(),
      dubaiNow.getUTCDate() + 14,
    ),
  );
  return horizon.toISOString().slice(0, 10);
}

/**
 * Compute today's calendar date in Asia/Dubai for the cut-off check.
 * Mirror of `computeTargetDateInDubai` without the +14 horizon offset.
 */
export function computeTodayInDubai(now: Date): string {
  const dubaiNow = new Date(now.getTime() + DUBAI_OFFSET_MS);
  return dubaiNow.toISOString().slice(0, 10);
}

/**
 * Day-16 / brief §3.1.8 — cut-off check for skip / pause / append-without-skip
 * services. Returns true iff `now` is past the 18:00 Dubai cut-off the
 * day BEFORE `targetDate`.
 *
 * MVP is hardcoded to 18:00 Dubai per brief §3.1.8 + plan §7.2. Phase 2
 * lands per-merchant configurable cut-off via `tenants.cut_off_offset_minutes`
 * (column-add migration) and replaces the hardcoded constant here with
 * a tenant-config read.
 *
 * Mechanics:
 *   - The cut-off instant for `targetDate` is `(targetDate - 1 day) at 18:00 Dubai`.
 *   - 18:00 Dubai = 14:00 UTC (Dubai is UTC+4, no DST).
 *   - Returns true iff `now` is at or past that UTC instant.
 *
 * Same UTC-only date arithmetic posture as the rest of this module —
 * all calendar-date math sidesteps local-tz drift by working in UTC
 * with the +4h offset applied explicitly.
 */
const CUT_OFF_HOUR_DUBAI = 18;

export function isCutOffElapsedForDate(now: Date, targetDate: string): boolean {
  // Parse targetDate as midnight UTC, then walk back one calendar day.
  const target = new Date(`${targetDate}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) {
    throw new Error(`isCutOffElapsedForDate: invalid targetDate '${targetDate}'`);
  }
  // (targetDate - 1 day) at 18:00 Dubai = (targetDate - 1 day) at (18 - 4) UTC = (targetDate - 1 day) at 14:00 UTC.
  const cutOffUtc = new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate() - 1,
      CUT_OFF_HOUR_DUBAI - 4,
      0,
      0,
      0,
    ),
  );
  return now.getTime() >= cutOffUtc.getTime();
}
