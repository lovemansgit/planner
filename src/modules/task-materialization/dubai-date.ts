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
 * Materialization horizon in calendar days. The Phase 2 INSERT…SELECT in
 * `materializeTenant` clamps per-subscription via
 * `LEAST(today + MATERIALIZATION_HORIZON_DAYS, COALESCE(s.end_date, target))`.
 *
 * Bumped from 14 → 21 on Day-28 to cover skip-compensation tail tasks
 * that land past the original 14-day window. Skip-flow extends a
 * subscription's `end_date` to the next eligible weekday (~+3 calendar
 * days per skip on Mon-Fri subs); a 14-day horizon was too tight to
 * reach the new end_date for subs near saturation. 21 days covers the
 * demo's documented scenario (consignee a5b6eeab subscription with one
 * 2026-05-20 skip → new end_date 2026-06-01/02) plus margin.
 *
 * Cap-headroom rationale: the per-tenant guardrail
 * `TASK_MATERIALIZATION_CAP = 7000` at
 * `src/modules/task-materialization/service.ts:62` clamps Phase 2 INSERT
 * volume per tenant per cron tick. At observed days-of-week distribution
 * (largest tenant: 500 subs at 2-5 days/week) the cap-check projected
 * count stays well under 7000 even at horizon = 21 — today's run-row
 * evidence confirms `capped_by_gate: false` across all 6 cron-eligible
 * tenants at 14d; the 21d bump scales linearly and still leaves margin.
 * Going beyond ~25 days would risk a cap fire on hypothetical 7-day-a-week
 * 500-sub tenants. See Day-28 EOD addendum for the cap-math + run-row
 * working that underpins this value.
 */
const MATERIALIZATION_HORIZON_DAYS = 21;

/**
 * Compute the materialization handler's target horizon date —
 * `today + MATERIALIZATION_HORIZON_DAYS` in Asia/Dubai, formatted as YYYY-MM-DD.
 *
 * Per plan §3.2 (corrected by PR #146): the handler-level value is the
 * cron's outer horizon target. Per-subscription cap to
 * `LEAST(target, S.end_date)` is applied inside the §2.3 INSERT…SELECT
 * (Phase 2 SQL), not here.
 */
export function computeTargetDateInDubai(now: Date): string {
  const dubaiNow = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const horizon = new Date(
    Date.UTC(
      dubaiNow.getUTCFullYear(),
      dubaiNow.getUTCMonth(),
      dubaiNow.getUTCDate() + MATERIALIZATION_HORIZON_DAYS,
    ),
  );
  return horizon.toISOString().slice(0, 10);
}

/**
 * Compute today's calendar date in Asia/Dubai for the cut-off check.
 * Mirror of `computeTargetDateInDubai` without the horizon offset.
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
