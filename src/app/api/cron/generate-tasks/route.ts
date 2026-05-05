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
import { materializeTenantPhase2 } from "@/modules/task-materialization/service";
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

    // ----- PHASE 2 — bulk INSERT…SELECT into tasks (per §2.1, §2.3) ----------
    // Single per-tenant bulk INSERT with 4-layer COALESCE address resolution
    // (override_one_off → override_forward → rotation → primary) + skip-the-
    // date EXISTS guards (skip + pause_window) + refuse-to-materialize guard
    // (§2.2 — COALESCE IS NOT NULL) + RETURNING id for Phase 5 enqueue.
    //
    // The §2.2 quarantine counter emission runs in a second statement
    // INSIDE the same withServiceRole tx (option-b two-pass per §2.2
    // amendment direction). Cardinality is small; same-tx semantics
    // eliminate the inconsistency window with concurrent paths.
    //
    // Phase 2 currently runs in its own short-lived withServiceRole block;
    // subsequent surfaces (Phase 3-4) extend the same tx to cover horizon
    // advance + run-row write before commit. Re-INSERT idempotency holds
    // via the partial UNIQUE on (subscription_id, delivery_date) per
    // 0012:230-232 — re-runs of the same target_date for the same
    // subscription collapse to ON CONFLICT DO NOTHING.
    let newInsertedTaskIds: readonly Uuid[];
    let addressResolutionFailedCount: number;
    try {
      const phase2Result = await withServiceRole(
        `cron:phase2_materialize for tenant ${tenantId}`,
        async (tx) =>
          materializeTenantPhase2(tx, { tenantId, targetDate, requestId }),
      );
      newInsertedTaskIds = phase2Result.newInsertedTaskIds;
      addressResolutionFailedCount = phase2Result.addressResolutionFailedCount;
    } catch (err) {
      tenantLog.error(
        { error: err instanceof Error ? err.message : String(err) },
        "phase 2 materialization threw",
      );
      captureException(err, {
        component: "cron_generate_tasks",
        operation: "phase2_materialize",
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
      },
      "phase 2 materialization complete",
    );

    // ----- PHASE 3 — UPDATE subscription_materialization (per §3.2) ----------
    // TODO: SET materialized_through_date = LEAST(today + 14, S.end_date)
    //       FILTER status = 'ACTIVE'

    // ----- PHASE 4 — INSERT task_generation_runs row (per §4.4) --------------
    // TODO: status='completed', target_date, started_at, completed_at,
    //       counters; on 23505 conflict, branch per §4.4 status table
    //       including stale-running CAS recovery (§4.4 amendment 2)

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
