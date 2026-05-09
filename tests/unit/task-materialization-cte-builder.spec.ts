// tests/unit/task-materialization-cte-builder.spec.ts
//
// CONCERN C — SQL builder snapshot test per
// memory/plans/day-19-phase-1-merchant-crud.md §M.1.
//
// Pins the SQL output of `buildCandidateAndEligibleDatesCte` and
// `buildResolvedAddressesCte` against captured baselines for fixed
// inputs. Catches accidental drift during refactors of the materialization
// CTE chain — the CTE body is consumed by 4 call sites today (cron
// cap-check, cron Phase 2 INSERT, cron quarantine counter, per-sub
// manual trigger) and the snapshot is the single source of truth that
// keeps them coherent.
//
// Snapshot updates: any intentional change to the builder's SQL output
// requires re-running tests with --update-snapshots and a code-PR
// reviewer body-read on the snapshot diff. The diff lives in this file
// (toMatchInlineSnapshot), not a separate `.snap` file, so the diff
// is part of the standard PR diff review surface.

import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildCandidateAndEligibleDatesCte,
  buildResolvedAddressesCte,
} from "@/modules/task-materialization/cte-builder";

import type { Uuid } from "@/shared/types";

const TENANT_ID = "11111111-1111-4111-8111-111111111111" as Uuid;
const SUBSCRIPTION_ID = "22222222-2222-4222-8222-222222222222" as Uuid;
const TARGET_DATE = "2026-05-19";
const START_DATE = "2026-05-19";
const END_DATE = "2026-06-02";

const dialect = new PgDialect();

function toSqlString(sql: ReturnType<typeof buildCandidateAndEligibleDatesCte>): {
  query: string;
  params: readonly unknown[];
} {
  const result = dialect.sqlToQuery(sql);
  return { query: result.sql, params: result.params };
}

describe("cte-builder — buildCandidateAndEligibleDatesCte (CONCERN C)", () => {
  it("emits the tenant-batch + horizonAdvance variant — pins cron path SQL", () => {
    const cte = buildCandidateAndEligibleDatesCte({
      filter: { kind: "tenant", tenantId: TENANT_ID },
      dateRange: { kind: "horizonAdvance", targetDate: TARGET_DATE },
    });
    const { query, params } = toSqlString(cte);
    expect({ query, params }).toMatchInlineSnapshot(`
      {
        "params": [
          "2026-05-19",
          "2026-05-19",
          "11111111-1111-4111-8111-111111111111",
        ],
        "query": "
          candidate_dates AS (
            SELECT
              s.id            AS subscription_id,
              s.tenant_id     AS tenant_id,
              s.consignee_id  AS consignee_id,
              s.delivery_window_start AS delivery_window_start,
              s.delivery_window_end   AS delivery_window_end,
              d::date         AS delivery_date
            FROM subscriptions s
            JOIN subscription_materialization sm ON sm.subscription_id = s.id
            CROSS JOIN LATERAL generate_series(
              GREATEST(sm.materialized_through_date + 1, s.start_date),
              LEAST($1::date, COALESCE(s.end_date, $2::date)),
              INTERVAL '1 day'
            ) AS d
            WHERE s.tenant_id = $3
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
        ",
      }
    `);
  });

  it("emits the subscription + explicit-range variant — pins per-sub manual-trigger path SQL", () => {
    const cte = buildCandidateAndEligibleDatesCte({
      filter: { kind: "subscription", subscriptionId: SUBSCRIPTION_ID },
      dateRange: { kind: "explicit", startDate: START_DATE, endDate: END_DATE },
    });
    const { query, params } = toSqlString(cte);
    expect({ query, params }).toMatchInlineSnapshot(`
      {
        "params": [
          "2026-05-19",
          "2026-06-02",
          "2026-06-02",
          "22222222-2222-4222-8222-222222222222",
        ],
        "query": "
          candidate_dates AS (
            SELECT
              s.id            AS subscription_id,
              s.tenant_id     AS tenant_id,
              s.consignee_id  AS consignee_id,
              s.delivery_window_start AS delivery_window_start,
              s.delivery_window_end   AS delivery_window_end,
              d::date         AS delivery_date
            FROM subscriptions s
            
            CROSS JOIN LATERAL generate_series(
              GREATEST($1::date, s.start_date),
              LEAST($2::date, COALESCE(s.end_date, $3::date)),
              INTERVAL '1 day'
            ) AS d
            WHERE s.id = $4
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
        ",
      }
    `);
  });

  it("emits the tenant + explicit-range variant — pins admin-backfill / hot-fix path SQL", () => {
    // Defensive snapshot — no production caller today, but the builder
    // accepts this combination. Future Day-22+ admin-backfill tools or
    // ops-driven re-materialization scripts may invoke this shape; the
    // snapshot pre-locks the SQL output so accidental builder drift
    // doesn't silently change behavior in those callers.
    const cte = buildCandidateAndEligibleDatesCte({
      filter: { kind: "tenant", tenantId: TENANT_ID },
      dateRange: { kind: "explicit", startDate: START_DATE, endDate: END_DATE },
    });
    const { query, params } = toSqlString(cte);
    expect({ query, params }).toMatchInlineSnapshot(`
      {
        "params": [
          "2026-05-19",
          "2026-06-02",
          "2026-06-02",
          "11111111-1111-4111-8111-111111111111",
        ],
        "query": "
          candidate_dates AS (
            SELECT
              s.id            AS subscription_id,
              s.tenant_id     AS tenant_id,
              s.consignee_id  AS consignee_id,
              s.delivery_window_start AS delivery_window_start,
              s.delivery_window_end   AS delivery_window_end,
              d::date         AS delivery_date
            FROM subscriptions s
            
            CROSS JOIN LATERAL generate_series(
              GREATEST($1::date, s.start_date),
              LEAST($2::date, COALESCE(s.end_date, $3::date)),
              INTERVAL '1 day'
            ) AS d
            WHERE s.tenant_id = $4
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
        ",
      }
    `);
  });

  it("emits the subscription + horizonAdvance variant — pins per-sub cron-style trigger SQL", () => {
    // Defensive snapshot — no production caller today (per-sub manual
    // trigger uses caller-supplied date range), but the builder
    // accepts this combination. Future per-sub admin tools that want
    // to "run cron logic for one sub" (e.g., a debug endpoint that
    // re-fires the rolling 14-day horizon for a single subscription)
    // may invoke this shape.
    const cte = buildCandidateAndEligibleDatesCte({
      filter: { kind: "subscription", subscriptionId: SUBSCRIPTION_ID },
      dateRange: { kind: "horizonAdvance", targetDate: TARGET_DATE },
    });
    const { query, params } = toSqlString(cte);
    expect({ query, params }).toMatchInlineSnapshot(`
      {
        "params": [
          "2026-05-19",
          "2026-05-19",
          "22222222-2222-4222-8222-222222222222",
        ],
        "query": "
          candidate_dates AS (
            SELECT
              s.id            AS subscription_id,
              s.tenant_id     AS tenant_id,
              s.consignee_id  AS consignee_id,
              s.delivery_window_start AS delivery_window_start,
              s.delivery_window_end   AS delivery_window_end,
              d::date         AS delivery_date
            FROM subscriptions s
            JOIN subscription_materialization sm ON sm.subscription_id = s.id
            CROSS JOIN LATERAL generate_series(
              GREATEST(sm.materialized_through_date + 1, s.start_date),
              LEAST($1::date, COALESCE(s.end_date, $2::date)),
              INTERVAL '1 day'
            ) AS d
            WHERE s.id = $3
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
        ",
      }
    `);
  });

  it("differs between tenant + sub variants only at the JOIN, lower-bound, and filter — invariants", () => {
    const tenantCte = buildCandidateAndEligibleDatesCte({
      filter: { kind: "tenant", tenantId: TENANT_ID },
      dateRange: { kind: "horizonAdvance", targetDate: TARGET_DATE },
    });
    const subCte = buildCandidateAndEligibleDatesCte({
      filter: { kind: "subscription", subscriptionId: SUBSCRIPTION_ID },
      dateRange: { kind: "explicit", startDate: START_DATE, endDate: END_DATE },
    });
    const tenantStr = toSqlString(tenantCte).query;
    const subStr = toSqlString(subCte).query;

    // Tenant variant has the JOIN to subscription_materialization; sub variant doesn't.
    expect(tenantStr).toContain("JOIN subscription_materialization sm");
    expect(subStr).not.toContain("JOIN subscription_materialization sm");

    // Tenant variant uses materialized_through_date in the lower bound;
    // sub variant uses caller-supplied startDate.
    expect(tenantStr).toContain("GREATEST(sm.materialized_through_date + 1, s.start_date)");
    expect(subStr).toContain("GREATEST($1::date, s.start_date)");

    // Filter clause shifts on the discriminator.
    expect(tenantStr).toContain("WHERE s.tenant_id = $3");
    expect(subStr).toContain("WHERE s.id = $4");

    // Eligible-dates skip+pause_window EXISTS guard is byte-for-byte
    // identical (same NOT EXISTS predicate against subscription_exceptions
    // matching skip OR pause_window types).
    const eligibleGuard = /NOT EXISTS \(\s*SELECT 1 FROM subscription_exceptions e/;
    expect(tenantStr).toMatch(eligibleGuard);
    expect(subStr).toMatch(eligibleGuard);
    const skipPauseClause =
      /\(e\.type = 'skip' AND e\.start_date = cd\.delivery_date\)\s+OR \(e\.type = 'pause_window'/;
    expect(tenantStr).toMatch(skipPauseClause);
    expect(subStr).toMatch(skipPauseClause);
  });
});

describe("cte-builder — buildResolvedAddressesCte (CONCERN C)", () => {
  it("pins the 4-layer COALESCE address-resolution CTE — invariant across tenant + sub paths", () => {
    const cte = buildResolvedAddressesCte();
    const { query, params } = toSqlString(cte);
    expect({ query, params }).toMatchInlineSnapshot(`
      {
        "params": [],
        "query": "
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
        ",
      }
    `);
  });

  it("emits zero parameters — pure DDL relative to the eligible_dates CTE", () => {
    const cte = buildResolvedAddressesCte();
    const { params } = toSqlString(cte);
    expect(params).toEqual([]);
  });
});
