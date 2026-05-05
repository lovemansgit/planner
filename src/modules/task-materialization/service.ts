// src/modules/task-materialization/service.ts
//
// Day-14 materialization service per memory/plans/day-14-cron-decoupling.md
// §2.1 Phases 2-4. This module replaces the retiring task-generation
// service per plan §1.3 — same data plane (subscriptions → tasks),
// different orchestration (6-phase model with QStash decoupling at
// Phase 5 instead of inline SF push).
//
// IN-PROGRESS: this surface implements Phases 2-3 (bulk INSERT…SELECT +
// §2.2 quarantine counter emission + horizon advance via UPDATE on
// subscription_materialization). Phase 4 (run-row write with §4.4
// stale-running CAS branching) lands in the next surface under the
// same code-PR drafting session.
//
// Caller wraps in withServiceRole; this function expects an open tx.
// Phases 2-3 currently run in their own short-lived withServiceRole
// block; the next surface extends the same tx to cover Phase 4 before
// commit. Re-INSERT idempotency holds via the partial UNIQUE on
// (subscription_id, delivery_date) per 0012:230-232 — re-runs of the
// same target_date for the same subscription collapse to ON CONFLICT
// DO NOTHING. Re-UPDATE idempotency on subscription_materialization
// is natural: setting materialized_through_date to the same value is
// a no-op, and the WHERE filters out rows that already advanced.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

const log = logger.with({ component: "task_materialization_service" });

export interface MaterializeTenantInput {
  tenantId: Uuid;
  /** ISO date in Asia/Dubai (e.g., '2026-05-19'). Computed at handler entry per §3.2. */
  targetDate: string;
  /** Request id from the cron handler — propagated for log/Sentry context. */
  requestId: string;
}

export interface MaterializeTenantResult {
  /** Task IDs INSERTed by this tenant's Phase 2 — feeds Phase 5 batchJSON. */
  newInsertedTaskIds: readonly Uuid[];
  /**
   * Count of (subscription_id, delivery_date) tuples that were eligible by
   * subscription rules + days_of_week + non-skipped, but had NULL address
   * resolution per §2.2 refuse-to-materialize policy. These are NOT
   * inserted; the counter is bumped here for ops visibility (Sentry +
   * structured warn-log per tuple).
   */
  addressResolutionFailedCount: number;
  /**
   * Subscription IDs whose `materialized_through_date` was advanced by
   * Phase 3. Cardinality bounded by per-tenant active sub count
   * (~280 at full demo volume). Used by Phase 6 logging + observability.
   * Note: a subscription appears here even if Phase 2 produced zero
   * INSERTs for it — Phase 3 horizon-advance is independent of row
   * production per §3.2 plan intent.
   */
  advancedSubscriptionIds: readonly Uuid[];
}

/**
 * Phases 2-3 of the §2.1 6-phase model.
 *
 * Phase 2 — single per-tenant bulk INSERT…SELECT into tasks for every
 * (subscription, date) tuple where:
 *   - subscription.status = 'active' (lowercase per
 *     0009_subscription.sql:136-137; corrected by PR #146)
 *   - candidate_date in (GREATEST(materialized_through_date + 1,
 *     start_date), LEAST(targetDate, COALESCE(end_date, targetDate))]
 *   - ISODOW(candidate_date) ∈ subscription.days_of_week
 *   - no skip-the-date exception covers the date (skip + pause_window
 *     per §2.4)
 *   - 4-layer COALESCE address resolution returns NON-NULL
 *     (§2.2 quarantine guard)
 *
 * Open-ended subscriptions (`end_date IS NULL`) cap at targetDate via
 * the COALESCE — without the COALESCE, `LEAST(target, NULL) = NULL`
 * collapses generate_series to zero rows and silently breaks
 * materialization for open-ended subs.
 *
 * Address resolution per §2.3 (4 layers, most-specific-first):
 *   1. address_override_one_off for THIS date
 *   2. address_override_forward whose start_date <= target,
 *      MAX(start_date) wins
 *   3. subscription_address_rotations for ISODOW(date)
 *   4. consignees primary address (is_primary=true partial UNIQUE in 0014)
 *
 * COALESCE hoisted via CTE (per §2.3 implementation note) so SELECT
 * and the §2.2 quarantine guard share a single computation per row.
 *
 * §2.2 counter emission: option (b) two-pass within the same tx per
 * the §2.2 amendment direction. After the INSERT, a second statement
 * re-runs the same CTE and selects the quarantined tuples (where
 * COALESCE was NULL but everything else passed). The cardinality is
 * small (bounded by quarantined tuples per tenant, expected to be 0
 * in steady state), so re-running the CTE is cheap (<100ms). Same-tx
 * semantics eliminate the inconsistency window with concurrent paths.
 *
 * IMPORTANT: Future contributors must NOT "optimize" by:
 *   - moving the counter emission post-commit (introduces inconsistency
 *     window with concurrent INSERTs that could change address
 *     resolution outcomes)
 *   - using a temp table (extra DDL round-trip; same-tx CTE
 *     re-evaluation is cheaper at the cardinality this scan returns)
 *   - merging into a single statement via CTE-with-OUTPUT (Postgres
 *     lacks a native equivalent that surfaces both INSERTed-and-
 *     quarantined tuples in one round-trip without DELETE/RETURNING
 *     gymnastics)
 *
 * Phase 3 — UPDATE subscription_materialization to advance
 * materialized_through_date for every active subscription whose
 * current horizon is below the per-subscription cap of
 * LEAST(targetDate, COALESCE(end_date, targetDate)). Per §3.2
 * amendment 3, the cap ensures we don't claim materialization past
 * a subscription's natural end. Per the implementation choice (c)
 * locked at Phase 3 review: horizon advances for ALL qualifying
 * subs, regardless of whether Phase 2 produced any INSERTs for them
 * — Phase 3 horizon-advance is independent of Phase 2 row production
 * (a sub whose entire 14-day window was skip-excluded should still
 * advance its horizon, since the calendar progressed).
 *
 * Returns newInsertedTaskIds[] (Phase 2 RETURNING id) for Phase 5
 * to enqueue, addressResolutionFailedCount (Phase 2 quarantine
 * counter) for Phase 6 logging, and advancedSubscriptionIds[] (Phase 3
 * RETURNING) for Phase 6 logging + observability.
 */
export async function materializeTenant(
  tx: DbTx,
  input: MaterializeTenantInput,
): Promise<MaterializeTenantResult> {
  const { tenantId, targetDate, requestId } = input;
  const tenantLog = log.with({ tenant_id: tenantId, request_id: requestId });

  // ---------------------------------------------------------------------------
  // INSERT…SELECT — happy-path materialization with 4-layer COALESCE address
  // resolution + skip-the-date EXISTS guard + refuse-to-materialize guard.
  // ---------------------------------------------------------------------------
  type InsertedRow = { id: Uuid };
  const insertedRows = await tx.execute<InsertedRow>(sqlTag`
    WITH candidate_dates AS (
      -- Per-subscription date range from
      --   GREATEST(materialized_through_date + 1, start_date)
      -- through
      --   LEAST(targetDate, COALESCE(end_date, targetDate)),
      -- expanded by generate_series.
      --
      -- COALESCE on end_date is load-bearing: without it,
      -- LEAST(target, NULL) = NULL collapses generate_series to zero
      -- rows and silently breaks materialization for open-ended subs.
      -- COALESCE caps open-ended subs at targetDate naturally.
      --
      -- GREATEST on the lower bound handles the case where a brand-new
      -- subscription was created with start_date in the future and
      -- materialized_through_date = today (set at subscription create
      -- time) — picks the later bound so materialization only proceeds
      -- from start_date onward.
      SELECT
        s.id            AS subscription_id,
        s.tenant_id     AS tenant_id,
        s.consignee_id  AS consignee_id,
        s.delivery_window_start AS delivery_window_start,
        s.delivery_window_end   AS delivery_window_end,
        d::date         AS delivery_date
      FROM subscriptions s
      JOIN subscription_materialization sm
        ON sm.subscription_id = s.id
      CROSS JOIN LATERAL generate_series(
        GREATEST(sm.materialized_through_date + 1, s.start_date),
        LEAST(${targetDate}::date, COALESCE(s.end_date, ${targetDate}::date)),
        INTERVAL '1 day'
      ) AS d
      WHERE s.tenant_id = ${tenantId}
        AND s.status = 'active'
        AND EXTRACT(ISODOW FROM d)::int = ANY(s.days_of_week)
    ),
    eligible_dates AS (
      -- Skip-the-date exclusion: drop dates covered by skip OR pause_window
      -- (§2.4 row 1 + row 2 — these are no-INSERT exception types)
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
    ),
    resolved_addresses AS (
      -- 4-layer COALESCE per §2.3, hoisted to compute once per row
      SELECT
        ed.*,
        COALESCE(
          -- Layer 1: address_override_one_off for THIS date (most specific)
          -- §2.4 row 3
          (SELECT e.address_override_id
             FROM subscription_exceptions e
            WHERE e.subscription_id = ed.subscription_id
              AND e.type = 'address_override_one_off'
              AND e.start_date = ed.delivery_date
              AND e.address_override_id IS NOT NULL
            LIMIT 1),
          -- Layer 2: most-recent active address_override_forward
          -- §2.4 row 4 (most-recent start_date wins per §2.3 ORDER BY DESC)
          (SELECT e.address_override_id
             FROM subscription_exceptions e
            WHERE e.subscription_id = ed.subscription_id
              AND e.type = 'address_override_forward'
              AND e.start_date <= ed.delivery_date
              AND e.address_override_id IS NOT NULL
            ORDER BY e.start_date DESC
            LIMIT 1),
          -- Layer 3: per-weekday rotation rule
          (SELECT r.address_id
             FROM subscription_address_rotations r
            WHERE r.subscription_id = ed.subscription_id
              AND r.weekday = EXTRACT(ISODOW FROM ed.delivery_date)::int),
          -- Layer 4: consignee's primary address
          -- (is_primary partial UNIQUE in 0014 guarantees AT MOST one;
          -- ORDER BY a.id is defense-in-depth deterministic tie-break)
          (SELECT a.id
             FROM addresses a
            WHERE a.consignee_id = ed.consignee_id
              AND a.is_primary = true
            ORDER BY a.id
            LIMIT 1)
        ) AS resolved_address_id
      FROM eligible_dates ed
    )
    INSERT INTO tasks (
      tenant_id,
      consignee_id,
      subscription_id,
      created_via,
      customer_order_number,
      internal_status,
      delivery_date,
      delivery_start_time,
      delivery_end_time,
      delivery_type,
      task_kind,
      address_id
    )
    SELECT
      ra.tenant_id,
      ra.consignee_id,
      ra.subscription_id,
      'subscription'                                                     AS created_via,
      -- Mirror existing convention from task-generation/repository.ts:309
      -- verbatim — 'SUB-' + 12-char sub-id-prefix + '-' + YYYYMMDD.
      'SUB-' || substring(replace(ra.subscription_id::text, '-', ''), 1, 12)
              || '-' || to_char(ra.delivery_date, 'YYYYMMDD')            AS customer_order_number,
      'CREATED'                                                          AS internal_status,
      ra.delivery_date,
      ra.delivery_window_start                                           AS delivery_start_time,
      ra.delivery_window_end                                             AS delivery_end_time,
      'STANDARD'                                                         AS delivery_type,
      'DELIVERY'                                                         AS task_kind,
      ra.resolved_address_id                                             AS address_id
    FROM resolved_addresses ra
    -- §2.2 refuse-to-materialize guard: drop rows where address
    -- resolution returned NULL. The COALESCE in resolved_addresses
    -- produces NULL only when ALL four layers fail; this WHERE catches
    -- the quarantine case. Counter emission for these tuples runs in
    -- the second statement below (option-b two-pass per §2.2 amendment).
    WHERE ra.resolved_address_id IS NOT NULL
    -- Pre-existing partial UNIQUE on tasks (subscription_id, delivery_date)
    -- WHERE subscription_id IS NOT NULL absorbs duplicate INSERTs
    -- idempotently — re-runs of the same target_date for the same
    -- subscription collapse to no-op. Predicate must be stated verbatim
    -- to match the partial index per Postgres ON CONFLICT inference rules
    -- (verified at 0012_task_generation_runs.sql:230-232).
    ON CONFLICT (subscription_id, delivery_date) WHERE subscription_id IS NOT NULL DO NOTHING
    RETURNING id
  `);

  const newInsertedTaskIds = insertedRows.map((row) => row.id);

  // ---------------------------------------------------------------------------
  // §2.2 counter emission — second statement, SAME tx — option (b) two-pass.
  //
  // LOAD-BEARING: this MUST run inside the same tx as the INSERT above.
  // Future contributors should NOT "optimize" by moving this post-commit,
  // using a temp table, or merging into a single CTE-with-OUTPUT
  // statement (see function header for rationale).
  //
  // Cardinality is small (bounded by quarantined tuples per tenant,
  // expected to be 0 in steady state). Re-running the CTE is <100ms.
  //
  // Same NULL-end_date COALESCE guard as the INSERT side — both CTE
  // usages must agree on the date-range computation or the counter
  // would surface tuples that the INSERT didn't see (false positives).
  // ---------------------------------------------------------------------------
  type QuarantinedRow = {
    subscription_id: Uuid;
    consignee_id: Uuid;
    delivery_date: string;
  };
  const quarantinedRows = await tx.execute<QuarantinedRow>(sqlTag`
    WITH candidate_dates AS (
      SELECT
        s.id            AS subscription_id,
        s.consignee_id  AS consignee_id,
        d::date         AS delivery_date
      FROM subscriptions s
      JOIN subscription_materialization sm
        ON sm.subscription_id = s.id
      CROSS JOIN LATERAL generate_series(
        GREATEST(sm.materialized_through_date + 1, s.start_date),
        LEAST(${targetDate}::date, COALESCE(s.end_date, ${targetDate}::date)),
        INTERVAL '1 day'
      ) AS d
      WHERE s.tenant_id = ${tenantId}
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
    SELECT
      ed.subscription_id,
      ed.consignee_id,
      ed.delivery_date
    FROM eligible_dates ed
    WHERE COALESCE(
      (SELECT e.address_override_id FROM subscription_exceptions e
        WHERE e.subscription_id = ed.subscription_id
          AND e.type = 'address_override_one_off'
          AND e.start_date = ed.delivery_date
          AND e.address_override_id IS NOT NULL LIMIT 1),
      (SELECT e.address_override_id FROM subscription_exceptions e
        WHERE e.subscription_id = ed.subscription_id
          AND e.type = 'address_override_forward'
          AND e.start_date <= ed.delivery_date
          AND e.address_override_id IS NOT NULL
        ORDER BY e.start_date DESC LIMIT 1),
      (SELECT r.address_id FROM subscription_address_rotations r
        WHERE r.subscription_id = ed.subscription_id
          AND r.weekday = EXTRACT(ISODOW FROM ed.delivery_date)::int),
      (SELECT a.id FROM addresses a
        WHERE a.consignee_id = ed.consignee_id
          AND a.is_primary = true
        ORDER BY a.id LIMIT 1)
    ) IS NULL
  `);

  for (const row of quarantinedRows) {
    tenantLog.warn(
      {
        event: "materialization.address_resolution_failed",
        tenant_id: tenantId,
        consignee_id: row.consignee_id,
        subscription_id: row.subscription_id,
        target_date: row.delivery_date,
      },
      "address resolution failed — row not materialized (consignee data gap: no rotation, no primary, no override)",
    );
    captureException(
      new Error(
        `materialization.address_resolution_failed: tenant=${tenantId} consignee=${row.consignee_id} subscription=${row.subscription_id} target_date=${row.delivery_date}`,
      ),
      {
        component: "task_materialization_service",
        operation: "address_resolution_failed",
        tenant_id: tenantId,
        consignee_id: row.consignee_id,
        subscription_id: row.subscription_id,
        target_date: row.delivery_date,
        request_id: requestId,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // PHASE 3 — UPDATE subscription_materialization horizon advance.
  //
  // Per plan §3.2 amendment 3: cap at LEAST(targetDate, end_date), with
  // COALESCE on end_date to handle open-ended subscriptions (same fix as
  // Phase 2's CTE — without COALESCE, LEAST(target, NULL) = NULL collapses
  // and the WHERE predicate becomes `materialized_through_date < NULL`
  // which is always UNKNOWN, so no rows update for open-ended subs).
  //
  // Implementation choice (c) per Phase 3 review: advance horizon for
  // ALL qualifying subs (status='active' AND below the cap), regardless
  // of whether Phase 2 produced INSERTs for them. A subscription whose
  // entire 14-day window was skip-excluded still advances horizon — the
  // calendar progressed even if no tasks were generated.
  //
  // Edge case: if subscription.end_date was reduced AFTER Phase 2 already
  // materialized future tasks, materialized_through_date can exceed the new
  // LEAST(target, end_date) cap. The WHERE clause filters this row out
  // (no UPDATE), leaving materialized_through_date at its earlier higher
  // value. The already-materialized future tasks are NOT auto-removed —
  // shrinking end_date is an explicit operator action that requires its
  // own cancellation flow (Phase 2 part-2 service surface, not this cron).
  // Documenting so future contributors don't read this as a bug.
  // ---------------------------------------------------------------------------
  type AdvancedRow = { subscription_id: Uuid };
  const advancedRows = await tx.execute<AdvancedRow>(sqlTag`
    UPDATE subscription_materialization sm
    SET
      materialized_through_date =
        LEAST(${targetDate}::date, COALESCE(s.end_date, ${targetDate}::date)),
      last_materialized_at = now()
    FROM subscriptions s
    WHERE sm.subscription_id = s.id
      AND sm.tenant_id = ${tenantId}
      -- s.tenant_id filter is defense-in-depth — the JOIN via sm already
      -- enforces tenant scope via FK chain, but explicit predicate makes
      -- the intent legible without requiring readers to trace FK semantics.
      AND s.tenant_id = ${tenantId}
      AND s.status = 'active'
      AND sm.materialized_through_date <
          LEAST(${targetDate}::date, COALESCE(s.end_date, ${targetDate}::date))
    RETURNING sm.subscription_id
  `);

  const advancedSubscriptionIds = advancedRows.map((row) => row.subscription_id);

  return {
    newInsertedTaskIds,
    addressResolutionFailedCount: quarantinedRows.length,
    advancedSubscriptionIds,
  };
}
