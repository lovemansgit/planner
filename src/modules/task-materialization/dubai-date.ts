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
