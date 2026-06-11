// Day-19 / Phase 1 / §M.1 — pure SQL builder for the materialization
// CTE chain (`candidate_dates → eligible_dates → resolved_addresses`).
//
// Replaces the 3× inline duplication that existed within materializeTenant
// (cap-check projection + Phase 2 INSERT + quarantine counter) and adds
// the per-subscription manual-trigger entry point materializeSubscriptionForDateRange
// per OQ-2 (memory/plans/day-19-phase-1-merchant-crud.md §M.1 recommendation
// (a) — pure SQL builder over inline duplication).
//
// The builder is intentionally split into TWO functions:
//
//   1. buildCandidateAndEligibleDatesCte — emits the first two CTEs
//      (candidate_dates + eligible_dates). All four call sites consume
//      this. Cap-check stops here (no resolved_addresses needed; the
//      projection only needs eligible_dates rows for COUNT).
//
//   2. buildResolvedAddressesCte — emits the third CTE
//      (resolved_addresses) with the 4-layer COALESCE address resolution.
//      Phase 2 INSERT and quarantine counter compose this on top of the
//      first builder. materializeSubscriptionForDateRange composes both.
//
// CONCERN C — SQL builder snapshot test at tests/cte-builder.spec.ts pins
// the SQL output of both builders against captured baselines for fixed
// inputs. Catches accidental drift during refactors before existing
// happy-path materializeTenant tests would surface a behavioral
// regression.
//
// LOAD-BEARING for both call paths:
//   - All four CTE-using sites MUST evolve the CTE body together. The
//     snapshot test enforces this — any change to the SQL output of the
//     builder requires updating the snapshot intentionally.
//   - Same NULL-end_date COALESCE pattern as the original Phase 2
//     INSERT — without COALESCE, LEAST(target, NULL) = NULL collapses
//     generate_series to zero rows and silently breaks materialization
//     for open-ended subscriptions (existing comment at line 121-124 of
//     pre-refactor service.ts).
//   - The lower bound `GREATEST(materialized_through_date+1, start_date)`
//     vs `GREATEST(startDate, start_date)` parameterizes on the
//     date-range-mode discriminator. The MaterializationJoin for
//     subscription_materialization is dropped entirely in the explicit
//     mode (no horizon-advance metric to read).

import { sql, type SQL } from "drizzle-orm";

import type { Uuid } from "@/shared/types";

/**
 * Filter parameter for the candidate_dates CTE — drives subscription
 * selection in the WHERE clause.
 *
 * - tenant: cron path (materializeTenant) — ALL active subs for this
 *   tenant for the target date.
 * - subscription: manual-trigger path (materializeSubscriptionForDateRange)
 *   — single sub by id, regardless of tenant (the caller's permission
 *   gate is the tenant scope).
 */
export type SubscriptionFilter =
  | { kind: "tenant"; tenantId: Uuid }
  | { kind: "subscription"; subscriptionId: Uuid };

/**
 * Date-range parameter for generate_series — bounds for delivery-date
 * enumeration.
 *
 * - horizonAdvance: cron path uses the rolling 14-day horizon advance
 *   semantic — lower bound is `GREATEST(materialized_through_date+1,
 *   start_date)`, upper bound is `LEAST(targetDate, COALESCE(end_date,
 *   targetDate))`. Requires JOIN to subscription_materialization.
 * - explicit: manual-trigger path uses caller-supplied range — lower
 *   bound is `GREATEST(startDate, start_date)`, upper bound is
 *   `LEAST(endDate, COALESCE(end_date, endDate))`. NO JOIN to
 *   subscription_materialization (per-sub trigger doesn't read horizon
 *   metric).
 */
export type DateRangeMode =
  | { kind: "horizonAdvance"; targetDate: string }
  | { kind: "explicit"; startDate: string; endDate: string };

export interface BuildCteArgs {
  filter: SubscriptionFilter;
  dateRange: DateRangeMode;
}

/**
 * Build candidate_dates + eligible_dates CTE prefix as a drizzle SQL
 * fragment. Caller composes after `WITH` and (optionally) appends
 * resolved_addresses via buildResolvedAddressesCte.
 *
 * Column shape (carried through both CTEs):
 *   - subscription_id, tenant_id, consignee_id
 *   - delivery_window_start, delivery_window_end
 *   - delivery_date
 *
 * Cap-check + quarantine sites SELECT a subset; Postgres CTE optimizer
 * prunes unused columns at planning time. Phase 2 INSERT consumes the
 * full set.
 */
export function buildCandidateAndEligibleDatesCte(args: BuildCteArgs): SQL {
  const filterClause = buildFilterClause(args.filter);
  const lowerBound = buildLowerBound(args.dateRange);
  const upperBound = buildUpperBound(args.dateRange);
  const joinClause =
    args.dateRange.kind === "horizonAdvance"
      ? sql`JOIN subscription_materialization sm ON sm.subscription_id = s.id`
      : sql``;
  return sql`
    candidate_dates AS (
      SELECT
        s.id            AS subscription_id,
        s.tenant_id     AS tenant_id,
        s.consignee_id  AS consignee_id,
        s.delivery_window_start AS delivery_window_start,
        s.delivery_window_end   AS delivery_window_end,
        d::date         AS delivery_date
      FROM subscriptions s
      ${joinClause}
      CROSS JOIN LATERAL generate_series(
        ${lowerBound},
        ${upperBound},
        INTERVAL '1 day'
      ) AS d
      WHERE ${filterClause}
        AND s.status = 'active'
        AND EXTRACT(ISODOW FROM d)::int = ANY(s.days_of_week)
    ),
    eligible_dates AS (
      SELECT cd.*
      FROM candidate_dates cd
      WHERE NOT EXISTS (
        SELECT 1 FROM subscription_exceptions e
        WHERE e.subscription_id = cd.subscription_id
          AND (
            (e.type = 'skip' AND e.start_date = cd.delivery_date)
            OR (e.type = 'pause_window'
                AND cd.delivery_date BETWEEN e.start_date AND e.end_date)
          )
      )
    )
  `;
}

/**
 * Build the resolved_addresses CTE. Composes after candidate_dates +
 * eligible_dates. Emits the brief §2.3 4-layer COALESCE address
 * resolution:
 *   1. address_override_one_off for THIS date (most specific)
 *   2. most-recent active address_override_forward
 *   3. per-weekday rotation rule
 *   4. consignee's primary address (defense-in-depth deterministic via
 *      ORDER BY a.id; the is_primary partial UNIQUE in 0014 already
 *      guarantees AT MOST one row, so the LIMIT 1 is belt-and-suspenders)
 *
 * The full eligible_dates column shape passes through (`ed.*`) plus
 * `resolved_address_id` is appended. Callers filter by
 * `resolved_address_id IS NULL` (quarantine) or `IS NOT NULL` (insert).
 */
export function buildResolvedAddressesCte(): SQL {
  return sql`
    resolved_addresses AS (
      SELECT
        ed.*,
        COALESCE(
          (SELECT e.address_override_id
             FROM subscription_exceptions e
            WHERE e.subscription_id = ed.subscription_id
              AND e.type = 'address_override_one_off'
              AND e.start_date = ed.delivery_date
              AND e.address_override_id IS NOT NULL
            LIMIT 1),
          (SELECT e.address_override_id
             FROM subscription_exceptions e
            WHERE e.subscription_id = ed.subscription_id
              AND e.type = 'address_override_forward'
              AND e.start_date <= ed.delivery_date
              AND e.address_override_id IS NOT NULL
            ORDER BY e.start_date DESC
            LIMIT 1),
          (SELECT r.address_id
             FROM subscription_address_rotations r
            WHERE r.subscription_id = ed.subscription_id
              AND r.weekday = EXTRACT(ISODOW FROM ed.delivery_date)::int),
          (SELECT a.id
             FROM addresses a
            WHERE a.consignee_id = ed.consignee_id
              AND a.is_primary = true
            ORDER BY a.id
            LIMIT 1)
        ) AS resolved_address_id
      FROM eligible_dates ed
    )
  `;
}

function buildFilterClause(filter: SubscriptionFilter): SQL {
  return filter.kind === "tenant"
    ? sql`s.tenant_id = ${filter.tenantId}`
    : sql`s.id = ${filter.subscriptionId}`;
}

function buildLowerBound(dateRange: DateRangeMode): SQL {
  return dateRange.kind === "horizonAdvance"
    ? sql`GREATEST(sm.materialized_through_date + 1, s.start_date)`
    : sql`GREATEST(${dateRange.startDate}::date, s.start_date)`;
}

function buildUpperBound(dateRange: DateRangeMode): SQL {
  if (dateRange.kind === "horizonAdvance") {
    return sql`LEAST(${dateRange.targetDate}::date, COALESCE(s.end_date, ${dateRange.targetDate}::date))`;
  }
  return sql`LEAST(${dateRange.endDate}::date, COALESCE(s.end_date, ${dateRange.endDate}::date))`;
}
