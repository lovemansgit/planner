// Day-14 cron materialization↔push decoupling — REWRITTEN HANDLER per
// memory/plans/day-14-cron-decoupling.md §2.1 (6-phase model).
//
// IN-PROGRESS: this surface is Phase 1 only; Phases 2-6 land in
// subsequent surfaces under the same code-PR drafting session.
//
// The handler runs at the existing `0 12 * * *` UTC cron schedule
// (vercel.json — unchanged per plan §0.1). Materialization-only post-
// rewrite: phase (a) generation + phase (b) inline SF push from the
// pre-Day-14 handler is replaced by a 6-phase pattern that decouples
// push to QStash. See plan §1.1 for the full model.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

// TODO Phase 5: import QStash client + flowControl + failureCallback
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import { withServiceRole } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import { listReconciliationCandidatesByTenant } from "@/modules/tasks/repository";
import { computeTargetDateInDubai } from "@/modules/task-materialization/dubai-date";
import { materializeTenant } from "@/modules/task-materialization/service";
import { listCronEligibleTenantIds } from "./list-cron-eligible-tenants";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cron handlers must run on the Node runtime (not Edge) — withServiceRole
// uses the postgres-js driver which requires Node sockets.
export const runtime = "nodejs";

const log = logger.with({ component: "cron_generate_tasks" });

export async function GET(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const requestLog = log.with({ request_id: requestId });

  // --------------------------------------------------------------------------
  // Handler entry — CRON_SECRET verification (unchanged from pre-Day-14)
  // --------------------------------------------------------------------------
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    requestLog.error(
      { error_code: "missing_cron_secret_env" },
      "CRON_SECRET env var unset; refusing to run cron handler",
    );
    return new Response(null, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (presented !== expected) {
    requestLog.warn(
      { error_code: "cron_secret_mismatch" },
      "CRON_SECRET mismatch on cron invocation",
    );
    return new Response(null, { status: 401 });
  }

  // --------------------------------------------------------------------------
  // Handler entry — compute target horizon date (Phase 0b per plan §2.1)
  // --------------------------------------------------------------------------
  // target_date = today + 14 days in Asia/Dubai per plan §3.2.
  // Per-subscription cap to LEAST(target, COALESCE(end_date, target))
  // is applied inside the §2.3 INSERT…SELECT (Phase 2 SQL); the handler-
  // level value here is the unconditional 14-day horizon shared by all
  // tenants on this invocation.
  const targetDate = computeTargetDateInDubai(new Date());
  requestLog.info({ target_date: targetDate }, "target horizon date computed");

  // --------------------------------------------------------------------------
  // Handler entry — enumerate cron-eligible tenants (unchanged β filter)
  // --------------------------------------------------------------------------
  let tenantIds: readonly Uuid[];
  try {
    tenantIds = await listCronEligibleTenantIds();
  } catch (err) {
    requestLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "failed to enumerate tenants for cron run",
    );
    captureException(err, {
      component: "cron_generate_tasks",
      operation: "list_cron_eligible_tenants",
      request_id: requestId,
    });
    return new Response(null, { status: 500 });
  }
  requestLog.info(
    { tenant_count: tenantIds.length },
    "cron-eligible tenants enumerated (filter: suitefleet_customer_code present)",
  );

  // --------------------------------------------------------------------------
  // Per-tenant 6-phase loop — Phase 1 only; Phases 2-6 land in
  // subsequent surfaces.
  // --------------------------------------------------------------------------
  for (const tenantId of tenantIds) {
    const tenantLog = requestLog.with({ tenant_id: tenantId });

    // ----- PHASE 1 — Reconciliation scan -------------------------------------
    // Per plan §1.1 / §2.1: scan for tasks pinned at
    // `pushed_to_external_at IS NULL AND address_id IS NOT NULL`.
    // These are: (a) rows that crashed between Phase 4 commit and
    // Phase 5 enqueue on a previous tick; (b) the cutover backlog
    // (per §0.4 Q3 probe: 114 fresh-butchers tasks at Day-14 plan time).
    // Self-healing on every tick.
    //
    // The address_id filter is the §2.2 quarantine guard at the cron
    // side — null-address rows stay quarantined until operator-actionable
    // resolution; they are NOT re-enqueued.
    //
    // Result feeds Phase 5 (post-commit batchJSON enqueue), which will
    // union these reconciliation tuples with any newly-INSERTed rows
    // from Phase 2.
    //
    // Phase 1 runs OUTSIDE the Phase 2-4 transaction (separate withServiceRole
    // call). The TOCTOU window between Phase 1 read and Phase 5 enqueue is
    // benign:
    //   - New rows inserted by Phase 2 are unioned in by Phase 5 explicitly.
    //   - No path nulls pushed_to_external_at once set, so Phase 1's snapshot
    //     can't become stale in a way that affects correctness.
    // Future contributors should not "optimize" by collapsing Phase 1 into the
    // tx — that would couple reconciliation to materialization durability,
    // breaking the §1.1 self-healing contract.
    let reconciliationTaskIds: readonly Uuid[];
    try {
      reconciliationTaskIds = await withServiceRole(
        `cron:reconciliation_scan for tenant ${tenantId}`,
        async (tx) => listReconciliationCandidatesByTenant(tx, tenantId),
      );
    } catch (err) {
      tenantLog.error(
        { error: err instanceof Error ? err.message : String(err) },
        "phase 1 reconciliation scan threw",
      );
      captureException(err, {
        component: "cron_generate_tasks",
        operation: "phase1_reconciliation_scan",
        tenant_id: tenantId,
        request_id: requestId,
      });
      // Per plan §1.1: Phase 1 failures are logged but the per-tenant
      // loop continues to the next tenant. A failed reconciliation scan
      // means we miss self-healing this tick for this tenant; the next
      // tick re-attempts. Don't abort the whole cron run.
      continue;
    }
    tenantLog.info(
      { reconciliation_count: reconciliationTaskIds.length },
      "phase 1 reconciliation scan complete",
    );

    // ----- PHASES 2-3 — bulk INSERT…SELECT + horizon advance ----------------
    // Phase 2: bulk INSERT into tasks with 4-layer COALESCE address
    // resolution (override_one_off → override_forward → rotation → primary)
    // + skip-the-date EXISTS guards (skip + pause_window) + refuse-to-
    // materialize guard (§2.2 — COALESCE IS NOT NULL) + RETURNING id for
    // Phase 5 enqueue. The §2.2 quarantine counter emission runs in a
    // second statement INSIDE the same tx (option-b two-pass per §2.2
    // amendment direction).
    //
    // Phase 3: UPDATE subscription_materialization to advance
    // materialized_through_date for every active subscription whose
    // current horizon is below the per-subscription cap of
    // LEAST(targetDate, COALESCE(end_date, targetDate)). Advances for ALL
    // qualifying subs regardless of whether Phase 2 produced INSERTs for
    // them (implementation choice (c) per Phase 3 review).
    //
    // Both phases run inside a single withServiceRole tx; Phase 4 (run-row
    // write with §4.4 stale-running CAS branching) extends the same tx in
    // the next surface before commit. Re-INSERT idempotency for Phase 2
    // holds via the partial UNIQUE per 0012:230-232; re-UPDATE idempotency
    // for Phase 3 is natural — re-running with same materialized_through_date
    // is filtered out by the WHERE predicate.
    let newInsertedTaskIds: readonly Uuid[];
    let addressResolutionFailedCount: number;
    let advancedSubscriptionIds: readonly Uuid[];
    try {
      const phaseResult = await withServiceRole(
        `cron:materialize for tenant ${tenantId}`,
        async (tx) =>
          materializeTenant(tx, { tenantId, targetDate, requestId }),
      );
      newInsertedTaskIds = phaseResult.newInsertedTaskIds;
      addressResolutionFailedCount = phaseResult.addressResolutionFailedCount;
      advancedSubscriptionIds = phaseResult.advancedSubscriptionIds;
    } catch (err) {
      tenantLog.error(
        { error: err instanceof Error ? err.message : String(err) },
        "phases 2-3 materialization threw",
      );
      captureException(err, {
        component: "cron_generate_tasks",
        operation: "materialize",
        tenant_id: tenantId,
        request_id: requestId,
      });
      // Per plan §1.1 self-healing posture: per-tenant continue on
      // failure; next tick re-attempts. Phase 5 enqueue does NOT run
      // for this tenant on this tick.
      continue;
    }
    tenantLog.info(
      {
        new_inserted_count: newInsertedTaskIds.length,
        address_resolution_failed_count: addressResolutionFailedCount,
        advanced_subscription_count: advancedSubscriptionIds.length,
      },
      "phases 2-3 materialization complete",
    );

    // ----- PHASE 3 — UPDATE subscription_materialization (per §3.2) ----------
    // Folded into the materializeTenant call above (Phases 2-3 single tx).
    // See src/modules/task-materialization/service.ts for the UPDATE.

    // ----- PHASE 4 — INSERT task_generation_runs row (per §4.4) --------------
    // TODO next surface: status='completed', target_date, started_at,
    //       completed_at, counters; on 23505 conflict, branch per §4.4
    //       status table including stale-running CAS recovery
    //       (§4.4 amendment 2: WHERE id = $stale_id AND
    //       started_at = $original_stale_started_at RETURNING id).
    //       Phase 4 will fold into the same materializeTenant call,
    //       extending its tx to cover all of Phases 2-3-4 before commit.

    // ----- (commit boundary — Phases 2-4 single tx) --------------------------

    // ----- PHASE 5 — post-commit batchJSON enqueue (per §1.1, §5.2, §6.3) ----
    // TODO: union(reconciliationTaskIds, newInsertedTaskIds)
    //       chunk at 100 messages
    //       batchJSON with deduplicationId: task_id,
    //         flowControl: { key: env.QSTASH_FLOW_CONTROL_KEY, rate: 5,
    //                        period: '1s' },
    //         failureCallback: PUBLIC_BASE_URL + '/api/queue/push-task-failed',
    //         retries: 3
    //       Failures here are logged + Sentry-captured but do NOT roll back
    //       Phase 4 commit; next-tick reconciliation re-discovers missed rows.
  }

  // --------------------------------------------------------------------------
  // Phase 6 — handler-exit summary log + return
  // --------------------------------------------------------------------------
  // TODO: structured summary per tenant + total wall-clock + tasks_created
  //       + tasks_enqueued + reconciliation_count
  return NextResponse.json({ status: "phase_1_only_in_progress" }, { status: 200 });
}
