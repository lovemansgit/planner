// Skip-and-append algorithm — pure helper.
//
// Implements the canonical pseudocode from PLANNER_PRODUCT_BRIEF.md §3.1.6.
// This file is the algorithmic core of the brief's tail-end reinsertion
// semantic: when an operator skips a delivery, the subscription's end_date
// extends to the next eligible weekday outside any blackout / pause window,
// preserving the contracted total delivery count.
//
// Pure: no DB calls, no I/O, no async. Inputs in / result out. The service
// layer (part 2) wraps the helper in a transaction that reads current
// subscription state, calls computeCompensatingDate, applies the result to
// subscription_exceptions + subscriptions.end_date + tasks.internal_status
// in one tx with shared correlation_id.
//
// All dates are ISO YYYY-MM-DD strings — no Date objects in the public API.
// Internally Date objects appear only for arithmetic and are kept in UTC
// space to avoid local-tz drift (same posture as
// src/modules/task-generation/dubai-date.ts).
//
// -----------------------------------------------------------------------------
// Edge cases (brief §3.1.6 A–I) — coverage map
// -----------------------------------------------------------------------------
//   A. Compensating date lands on blackout    → walk forward to next
//                                                 eligible non-blackout
//                                                 day (loop body)
//   B. Multiple skips stacking                → service-layer concern;
//                                                 helper test exercises
//                                                 monotonic stacking via
//                                                 sequential calls with
//                                                 increasing endDate inputs
//   C. Operator double-tap / retry            → service-layer concern;
//                                                 idempotency UNIQUE on
//                                                 subscription_exceptions
//                                                 (subscription_id,
//                                                  idempotency_key) is the
//                                                 DB-layer guard
//   D. Skip exhausts max_skips_per_subscription → reject with reason
//                                                 'max_skips_exceeded'
//   E. Skip near original end_date            → tail-end semantic; covered
//                                                 by the standard loop
//   F. Subscription currently paused          → reject with reason
//                                                 'subscription_not_active'
//   G. Skip on past date                      → reject with reason
//                                                 'past_date'
//   H. Skip on very last delivery             → loop extends end_date by
//                                                 exactly one slot; covered
//                                                 by the standard loop
//   I. Skip on multi-task date                → MVP not relevant (1 sub =
//                                                 1 task/date); helper
//                                                 operates per-subscription
//
// -----------------------------------------------------------------------------
// Why this is in its own module instead of subscriptions/
// -----------------------------------------------------------------------------
// The exception model (subscription_exceptions, the skip algorithm, the
// pause/resume bounded-window logic) is a distinct concern from the
// subscriptions CRUD module (subscriptions/service.ts handles create /
// update / read / lifecycle transitions like pause/resume). Plan §1
// introduces a sibling module subscription-exceptions/ for the exception
// surface; part-2 service code lands the addSubscriptionException,
// pauseSubscription, resumeSubscription, appendWithoutSkip surface here.
//
// =============================================================================

/** YYYY-MM-DD ISO calendar date string. */
export type IsoDate = string;

/** ISO weekday: Mon=1, Tue=2, …, Sun=7. Matches Postgres EXTRACT(ISODOW). */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Subscription state required for the skip algorithm. The full
 * subscriptions row carries more (consignee_id, addresses, etc.); the
 * helper takes only what it needs so tests can construct minimal fixtures.
 */
export interface SubscriptionForSkip {
  /** Inclusive end of the current delivery window. */
  readonly endDate: IsoDate;
  /** ISO weekdays the subscription is eligible to deliver on. */
  readonly daysOfWeek: readonly IsoWeekday[];
  /** Subscription lifecycle state. Only 'active' permits skip. */
  readonly status: "active" | "paused" | "ended";
}

/** A pause window — both dates inclusive. */
export interface PauseWindow {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

export interface ComputeCompensatingDateInput {
  readonly subscription: SubscriptionForSkip;
  /** The date being skipped. Must be in the future per cut-off rules. */
  readonly skipDate: IsoDate;
  /** "Today" in the relevant tenant timezone. Caller's responsibility. */
  readonly today: IsoDate;
  readonly blackoutDates?: readonly IsoDate[];
  readonly pauseWindows?: readonly PauseWindow[];
  /**
   * Hard cap from merchant onboarding config (brief §3.1.6 edge D). When
   * undefined, no cap is enforced (MVP default per brief §4 Phase 2 list —
   * configurable max_skips_per_subscription is Phase 2).
   */
  readonly maxSkipsPerSubscription?: number;
  /**
   * Existing skip count for this subscription. Service layer reads from
   * subscription_exceptions WHERE type='skip' AND skip_without_append=false
   * before calling.
   */
  readonly existingSkipCount?: number;
}

export type ComputeCompensatingDateResult =
  | { readonly kind: "ok"; readonly compensatingDate: IsoDate }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "subscription_not_active"
        | "past_date"
        | "skip_date_not_eligible_weekday"
        | "skip_date_in_blackout"
        | "skip_date_in_pause_window"
        | "max_skips_exceeded"
        | "no_compensating_date_found";
    };

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Maximum forward walk before giving up (brief §3.1.6 safety stop). */
const MAX_FORWARD_DAYS = 365;

/**
 * Parse YYYY-MM-DD into a UTC midnight Date. Throws on malformed input.
 * UTC-only: the helper operates on calendar dates, not timestamps; using
 * UTC sidesteps local-tz date-boundary drift (same posture as the cron's
 * dubai-date helper).
 */
function parseIsoDate(value: IsoDate): Date {
  if (!ISO_DATE_REGEX.test(value)) {
    throw new Error(`expected YYYY-MM-DD ISO date, got '${value}'`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid calendar date '${value}'`);
  }
  return d;
}

/** Format a UTC midnight Date back to YYYY-MM-DD. */
function formatIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Add `days` to a UTC midnight Date and return a new UTC midnight Date. */
function addDaysUtc(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * ISO weekday: Mon=1, Tue=2, …, Sun=7. Postgres EXTRACT(ISODOW) returns
 * the same scheme. JavaScript getUTCDay() returns 0=Sun, 1=Mon, …, 6=Sat —
 * convert via `((day + 6) % 7) + 1` (shifts Sun from 0 to 7).
 */
function isoWeekday(d: Date): IsoWeekday {
  const jsDay = d.getUTCDay();
  return (((jsDay + 6) % 7) + 1) as IsoWeekday;
}

function isInBlackout(date: IsoDate, blackouts: readonly IsoDate[] | undefined): boolean {
  if (!blackouts) return false;
  return blackouts.includes(date);
}

function isInPauseWindow(
  date: IsoDate,
  pauseWindows: readonly PauseWindow[] | undefined,
): boolean {
  if (!pauseWindows) return false;
  // Inclusive on both ends per brief §3.1.7 bounded pause posture.
  return pauseWindows.some((w) => date >= w.start && date <= w.end);
}

/**
 * Compute the compensating date for a skip, per the brief §3.1.6 algorithm.
 *
 * Pre-validation rejects:
 *   - subscription_not_active   — F (paused / ended cannot accept skip)
 *   - past_date                 — G (skip on past date is Phase 2)
 *   - skip_date_not_eligible_weekday — D (skipDate must be a delivery day)
 *   - skip_date_in_blackout     — D (skipDate cannot be a blackout day)
 *   - skip_date_in_pause_window — D (skipDate cannot fall in a pause window)
 *   - max_skips_exceeded        — D (cap from merchant config)
 *
 * Compute path:
 *   - Walk forward from endDate + 1 day. First date that is (a) in
 *     daysOfWeek, (b) not in blackouts, (c) not in pauseWindows is the
 *     compensating date.
 *   - Safety stop after MAX_FORWARD_DAYS days returns
 *     'no_compensating_date_found'.
 *
 * The helper does NOT mutate any input. The result is plain data; the
 * service layer (part 2) is responsible for applying it to the database.
 */
export function computeCompensatingDate(
  input: ComputeCompensatingDateInput,
): ComputeCompensatingDateResult {
  const { subscription, skipDate, today } = input;

  // Edge F: subscription must be active to accept a skip.
  if (subscription.status !== "active") {
    return { kind: "rejected", reason: "subscription_not_active" };
  }

  // Edge G: skipDate must not be in the past.
  if (skipDate < today) {
    return { kind: "rejected", reason: "past_date" };
  }

  // skipDate must be a delivery day for this subscription.
  const skipDateUtc = parseIsoDate(skipDate);
  const skipWeekday = isoWeekday(skipDateUtc);
  if (!subscription.daysOfWeek.includes(skipWeekday)) {
    return { kind: "rejected", reason: "skip_date_not_eligible_weekday" };
  }

  // skipDate must not itself be a blackout day or pause-window day.
  if (isInBlackout(skipDate, input.blackoutDates)) {
    return { kind: "rejected", reason: "skip_date_in_blackout" };
  }
  if (isInPauseWindow(skipDate, input.pauseWindows)) {
    return { kind: "rejected", reason: "skip_date_in_pause_window" };
  }

  // Edge D: cap check.
  if (
    input.maxSkipsPerSubscription !== undefined &&
    (input.existingSkipCount ?? 0) >= input.maxSkipsPerSubscription
  ) {
    return { kind: "rejected", reason: "max_skips_exceeded" };
  }

  // Walk forward from endDate + 1 day to find the compensating date.
  const endDateUtc = parseIsoDate(subscription.endDate);
  let candidate = addDaysUtc(endDateUtc, 1);

  for (let walked = 1; walked <= MAX_FORWARD_DAYS; walked++) {
    const candidateIso = formatIsoDate(candidate);
    const wd = isoWeekday(candidate);
    if (
      subscription.daysOfWeek.includes(wd) &&
      !isInBlackout(candidateIso, input.blackoutDates) &&
      !isInPauseWindow(candidateIso, input.pauseWindows)
    ) {
      return { kind: "ok", compensatingDate: candidateIso };
    }
    candidate = addDaysUtc(candidate, 1);
  }

  return { kind: "rejected", reason: "no_compensating_date_found" };
}

// =============================================================================
// computePauseExtensionDate — Day-16 Block 4-C Service B pure helper
// =============================================================================

/**
 * Inputs for the pause-extension walk. The service layer pre-fetches
 * the subscription state + active pause-window exception rows + the
 * extension-days count (computed from pause_start/pause_end via the
 * same eligibility test as the cron's materialization handler) and
 * passes them through to this pure helper.
 */
export interface ComputePauseExtensionDateInput {
  readonly subscription: SubscriptionForSkip;
  /** Current `subscriptions.end_date`. The walk starts at `currentEndDate + 1`. */
  readonly currentEndDate: IsoDate;
  /**
   * Number of eligible-delivery-days to walk past `currentEndDate`.
   * Caller computes this as `count(D in [pause_start, pause_end] where
   * ISODOW(D) ∈ subscription.days_of_week)` — the same eligibility
   * test as the materialization cron's §2.3 INSERT…SELECT predicate.
   * Zero is allowed (extension_days=0 returns currentEndDate
   * unchanged — happens when a pause covers only non-eligible
   * weekdays).
   */
  readonly extensionDays: number;
  /**
   * Pause windows to skip during the walk. The new pause being
   * created is typically NOT in this list because it ends at
   * pause_end (which is before the walk starts at currentEndDate+1
   * in the common case where the operator pauses upcoming
   * deliveries). However, OTHER existing pause windows scheduled in
   * the future could overlap the walk; passing them through is
   * defensive.
   */
  readonly pauseWindows: readonly PauseWindow[];
}

export type ComputePauseExtensionDateResult =
  | { readonly kind: "ok"; readonly newEndDate: IsoDate }
  | {
      readonly kind: "rejected";
      readonly reason: "no_extension_date_found";
    };

/**
 * Compute the new `subscriptions.end_date` after extending past a
 * pause-window cancellation, per brief §3.1.7 ("end_date extends by
 * pause duration counted in eligible-delivery-days").
 *
 * Algorithm: walk forward `extensionDays` eligible weekdays starting
 * from `currentEndDate + 1`, skipping any pause-window-overlapping
 * dates. Returns the date of the `extensionDays`-th eligible weekday
 * found.
 *
 * `extensionDays = 0` → returns `currentEndDate` unchanged (no
 * extension; happens when the pause window contains zero
 * eligible-delivery-days for this subscription).
 *
 * Safety stop after `MAX_FORWARD_DAYS` (365) returns
 * `'no_extension_date_found'` (operator scenario: pause covers a
 * very long range AND many overlapping pause windows fill the
 * post-walk space; extremely rare but bounded).
 *
 * Pure: no DB calls, no I/O. Mirrors the
 * `computeCompensatingDate` pattern.
 */
export function computePauseExtensionDate(
  input: ComputePauseExtensionDateInput,
): ComputePauseExtensionDateResult {
  const { subscription, currentEndDate, extensionDays, pauseWindows } = input;

  if (extensionDays < 0) {
    throw new Error(`computePauseExtensionDate: extensionDays must be >= 0; got ${extensionDays}`);
  }

  if (extensionDays === 0) {
    return { kind: "ok", newEndDate: currentEndDate };
  }

  if (subscription.daysOfWeek.length === 0) {
    return { kind: "rejected", reason: "no_extension_date_found" };
  }

  const startUtc = parseIsoDate(currentEndDate);
  let candidate = addDaysUtc(startUtc, 1);
  let eligibleFound = 0;

  for (let walked = 1; walked <= MAX_FORWARD_DAYS; walked++) {
    const candidateIso = formatIsoDate(candidate);
    const wd = isoWeekday(candidate);
    if (
      subscription.daysOfWeek.includes(wd) &&
      !isInPauseWindow(candidateIso, pauseWindows)
    ) {
      eligibleFound += 1;
      if (eligibleFound === extensionDays) {
        return { kind: "ok", newEndDate: candidateIso };
      }
    }
    candidate = addDaysUtc(candidate, 1);
  }

  return { kind: "rejected", reason: "no_extension_date_found" };
}

/**
 * Walk backward `daysToWalk` eligible weekdays from `fromDate`,
 * skipping pause-window overlaps. Returns the date of the
 * `daysToWalk`-th eligible weekday found.
 *
 * Used by `resumeSubscription` early-manual-resume recompute path
 * per merged plan §4.2 step 6 (corrected for eligible-day arithmetic
 * per Conflict 4 B3-α). When an operator resumes a subscription
 * BEFORE `pause_end`, the effective pause extension shrinks; the
 * subscription's `end_date` shrinks by `(originalExtensionDays -
 * effectiveExtensionDays)` eligible days, which this helper
 * computes.
 *
 * `daysToWalk = 0` returns `fromDate` unchanged.
 *
 * Safety stop after `MAX_FORWARD_DAYS` (365) returns
 * `'no_extension_date_found'`.
 */
export function walkBackwardEligibleDays(
  input: {
    readonly fromDate: IsoDate;
    readonly daysToWalk: number;
    readonly daysOfWeek: readonly IsoWeekday[];
    readonly pauseWindows: readonly PauseWindow[];
  },
): ComputePauseExtensionDateResult {
  const { fromDate, daysToWalk, daysOfWeek, pauseWindows } = input;

  if (daysToWalk < 0) {
    throw new Error(
      `walkBackwardEligibleDays: daysToWalk must be >= 0; got ${daysToWalk}`,
    );
  }

  if (daysToWalk === 0) {
    return { kind: "ok", newEndDate: fromDate };
  }

  if (daysOfWeek.length === 0) {
    return { kind: "rejected", reason: "no_extension_date_found" };
  }

  const startUtc = parseIsoDate(fromDate);
  let candidate = addDaysUtc(startUtc, -1);
  let eligibleFound = 0;

  for (let walked = 1; walked <= MAX_FORWARD_DAYS; walked++) {
    const candidateIso = formatIsoDate(candidate);
    const wd = isoWeekday(candidate);
    if (
      daysOfWeek.includes(wd) &&
      !isInPauseWindow(candidateIso, pauseWindows)
    ) {
      eligibleFound += 1;
      if (eligibleFound === daysToWalk) {
        return { kind: "ok", newEndDate: candidateIso };
      }
    }
    candidate = addDaysUtc(candidate, -1);
  }

  return { kind: "rejected", reason: "no_extension_date_found" };
}

/**
 * Count eligible-delivery-days in [pauseStart, pauseEnd] (inclusive)
 * for a subscription. Mirrors the cron's §2.3 eligibility test —
 * same predicate as the materialization handler. The service layer
 * uses this at pause-creation time to compute the extensionDays
 * input to `computePauseExtensionDate`.
 *
 * Pure helper alongside the algorithm; lives here so the same shape
 * is reusable by tests + by the cron's §2.3 if ever inlined.
 */
export function countEligibleDeliveryDays(
  subscription: SubscriptionForSkip,
  pauseStart: IsoDate,
  pauseEnd: IsoDate,
): number {
  if (subscription.daysOfWeek.length === 0) return 0;
  const startUtc = parseIsoDate(pauseStart);
  const endUtc = parseIsoDate(pauseEnd);
  if (endUtc.getTime() < startUtc.getTime()) {
    return 0;
  }
  let count = 0;
  let cursor = startUtc;
  for (let walked = 0; walked <= MAX_FORWARD_DAYS; walked++) {
    if (cursor.getTime() > endUtc.getTime()) break;
    const wd = isoWeekday(cursor);
    if (subscription.daysOfWeek.includes(wd)) count += 1;
    cursor = addDaysUtc(cursor, 1);
  }
  return count;
}
