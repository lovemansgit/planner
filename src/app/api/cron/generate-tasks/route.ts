// Day-14 cron materialization↔push decoupling — REWRITTEN HANDLER per
// memory/plans/day-14-cron-decoupling.md §2.1 (6-phase model).
//
// FEATURE-COMPLETE: all 6 phases implemented. Materialization-handler
// side of the decoupling is done; queue-side handlers
// (/api/queue/push-task per §5.1, /api/queue/push-task-failed per §5.2
// amendment 5) are separate route files drafted in subsequent surfaces.
//
// The handler runs at the existing `0 12 * * *` UTC cron schedule
// (vercel.json — unchanged per plan §0.1). Materialization-only post-
// rewrite: phase (a) generation + phase (b) inline SF push from the
// pre-Day-14 handler is replaced by a 6-phase pattern that decouples
// push to QStash. See plan §1.1 for the full model.
//
// Response shape is FULL REDESIGN per plan §1.3 retirement table — no
// legacy field name continuity (per_tenant.generation, summary.push,
// PerTenantPair, RunSummary). The new shape reflects the 6-phase model
// directly. Ops dashboards/alerting that grep the legacy shape need
// rebuild post-cutover.
//
// HTTP status mirrors legacy posture: 500 if ANY tenant had abnormal
// outcome (cap-gate fired, any phase threw, or Phase 5 chunk failure
// > 0); 200 only on all-clean.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import { withServiceRole } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import { listReconciliationCandidatesByTenant } from "@/modules/tasks/repository";
import { computeTargetDateInDubai } from "@/modules/task-materialization/dubai-date";
import { enqueueTaskPushBatch } from "@/modules/task-materialization/queue";
import { materializeTenant } from "@/modules/task-materialization/service";
import { listCronEligibleTenantIds } from "./list-cron-eligible-tenants";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cron handlers must run on the Node runtime (not Edge) — withServiceRole
// uses the postgres-js driver which requires Node sockets.
export const runtime = "nodejs";

const log = logger.with({ component: "cron_generate_tasks" });

/**
 * Per-tenant outcome aggregated at handler exit for the Phase 6
 * summary response. Captured at each terminal point inside the
 * per-tenant loop — successful end-of-iteration OR `continue` on
 * any-phase throw.
 */
interface PerTenantSummary {
  tenantId: Uuid;
  reconciliationCount: number;
  newInsertedCount: number;
  addressResolutionFailedCount: number;
  advancedSubscriptionCount: number;
  /** §4.4 conflict outcome kind; null when Phases 2-4 didn't run (Phase 1 throw) or threw. */
  runRowOutcomeKind: string | null;
  cappedByGate: boolean;
  phase5EnqueuedCount: number;
  phase5FailedChunks: number;
  phase5TotalCount: number;
  /**
   * Which phase threw, if any. Captures observability one level
   * finer than a single `threw: boolean` — surfaces at the per-row
   * level whether the failure was in reconciliation, materialization,
   * or enqueue.
   */
  failedPhase:
    | "phase1_reconciliation"
    | "phase2_4_materialize"
    | "phase5_enqueue"
    | null;
}

export async function GET(req: Request): Promise<Response> {
  const handlerEntryMs = Date.now();
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
  // Handler entry — compute target horizon date + window timestamps
  // (Phase 0b per plan §2.1; window timestamps mirror legacy run-row shape)
  // --------------------------------------------------------------------------
  // target_date = today + 14 days in Asia/Dubai per plan §3.2.
  // Per-subscription cap to LEAST(target, COALESCE(end_date, target))
  // is applied inside the §2.3 INSERT…SELECT (Phase 2 SQL); the handler-
  // level value here is the unconditional 14-day horizon shared by all
  // tenants on this invocation.
  //
  // windowStart / windowEnd preserve the legacy task_generation_runs
  // window shape — runs carry both target_date AND window timestamps for
  // operational continuity. windowEnd = windowStart + 1h matches the
  // pre-Day-14 cutoff window semantic.
  const now = new Date();
  const targetDate = computeTargetDateInDubai(now);
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  requestLog.info(
    { target_date: targetDate, window_start: windowStart, window_end: windowEnd },
    "target horizon date computed",
  );

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
  // Per-tenant 6-phase loop — feature-complete materialization handler.
  // Each tenant captures a PerTenantSummary into perTenantMap at its
  // terminal point (successful end-of-iteration OR `continue` on throw).
  // Phase 6 aggregates the map into the handler-level summary at exit.
  // --------------------------------------------------------------------------
  const perTenantMap = new Map<Uuid, PerTenantSummary>();
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
      perTenantMap.set(tenantId, {
        tenantId,
        reconciliationCount: 0,
        newInsertedCount: 0,
        addressResolutionFailedCount: 0,
        advancedSubscriptionCount: 0,
        runRowOutcomeKind: null,
        cappedByGate: false,
        phase5EnqueuedCount: 0,
        phase5FailedChunks: 0,
        phase5TotalCount: 0,
        failedPhase: "phase1_reconciliation",
      });
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
    let runRowOutcomeKind: string;
    let cappedByGate: boolean;
    try {
      const phaseResult = await withServiceRole(
        `cron:materialize for tenant ${tenantId}`,
        async (tx) =>
          materializeTenant(tx, {
            tenantId,
            targetDate,
            windowStart,
            windowEnd,
            requestId,
          }),
      );
      newInsertedTaskIds = phaseResult.newInsertedTaskIds;
      addressResolutionFailedCount = phaseResult.addressResolutionFailedCount;
      advancedSubscriptionIds = phaseResult.advancedSubscriptionIds;
      runRowOutcomeKind = phaseResult.runRowOutcome.kind;
      cappedByGate = phaseResult.cappedByGate;
    } catch (err) {
      tenantLog.error(
        { error: err instanceof Error ? err.message : String(err) },
        "phases 2-4 materialization threw",
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
      perTenantMap.set(tenantId, {
        tenantId,
        reconciliationCount: reconciliationTaskIds.length,
        newInsertedCount: 0,
        addressResolutionFailedCount: 0,
        advancedSubscriptionCount: 0,
        runRowOutcomeKind: null,
        cappedByGate: false,
        phase5EnqueuedCount: 0,
        phase5FailedChunks: 0,
        phase5TotalCount: 0,
        failedPhase: "phase2_4_materialize",
      });
      continue;
    }
    tenantLog.info(
      {
        new_inserted_count: newInsertedTaskIds.length,
        address_resolution_failed_count: addressResolutionFailedCount,
        advanced_subscription_count: advancedSubscriptionIds.length,
        run_row_outcome: runRowOutcomeKind,
        capped_by_gate: cappedByGate,
      },
      "phases 2-4 materialization complete",
    );

    // ----- PHASE 3 — UPDATE subscription_materialization (per §3.2) ----------
    // Folded into the materializeTenant call above (Phases 2-3 single tx).
    // See src/modules/task-materialization/service.ts for the UPDATE.

    // ----- PHASE 4 — INSERT task_generation_runs row (per §4.4) --------------
    // Folded into the materializeTenant call above (Phases 2-3-4 single tx).
    // See src/modules/task-materialization/run-row.ts for the §4.4 6-status
    // conflict-resolution state machine + stale-running CAS recovery branch.

    // ----- (commit boundary — Phases 2-4 single tx) --------------------------

    // ----- PHASE 5 — post-commit batchJSON enqueue (per §1.1, §5.2, §6.3) ----
    // Phase 5 runs OUTSIDE the Phase 2-4 tx (the withServiceRole block above
    // has already committed). Already-committed materialization rows are
    // durable; failed Phase 5 enqueue does NOT roll back.
    //
    // Even on capped path (Phases 2-3 SKIPped, newInsertedTaskIds empty),
    // Phase 1 reconciliation rows from earlier ticks are still enqueued —
    // capped only blocks NEW materialization, not draining prior-tick
    // backlog. Per Q4 direction.
    //
    // Per Q5 (b): chunk failures inside enqueueTaskPushBatch are logged +
    // Sentry-captured + counted but do NOT throw. enqueueTaskPushBatch
    // throws ONLY on env-var misconfiguration (QSTASH_TOKEN /
    // PUBLIC_BASE_URL / QSTASH_FLOW_CONTROL_KEY missing); a throw here
    // means the cron handler is misconfigured. Per-tenant continue per
    // §1.1 self-healing — next tick re-attempts.
    const phase5TaskIds = [...reconciliationTaskIds, ...newInsertedTaskIds];
    let phase5Enqueued = 0;
    let phase5FailedChunks = 0;
    try {
      const phase5Result = await enqueueTaskPushBatch({
        tenantId,
        taskIds: phase5TaskIds,
        requestId,
      });
      phase5Enqueued = phase5Result.enqueuedCount;
      phase5FailedChunks = phase5Result.failedChunks;
    } catch (err) {
      tenantLog.error(
        { error: err instanceof Error ? err.message : String(err) },
        "phase 5 enqueue threw on env-var misconfig",
      );
      captureException(err, {
        component: "cron_generate_tasks",
        operation: "phase5_enqueue",
        tenant_id: tenantId,
        request_id: requestId,
      });
      perTenantMap.set(tenantId, {
        tenantId,
        reconciliationCount: reconciliationTaskIds.length,
        newInsertedCount: newInsertedTaskIds.length,
        addressResolutionFailedCount,
        advancedSubscriptionCount: advancedSubscriptionIds.length,
        runRowOutcomeKind,
        cappedByGate,
        phase5EnqueuedCount: 0,
        phase5FailedChunks: 0,
        phase5TotalCount: phase5TaskIds.length,
        failedPhase: "phase5_enqueue",
      });
      continue;
    }
    tenantLog.info(
      {
        phase5_enqueued: phase5Enqueued,
        phase5_failed_chunks: phase5FailedChunks,
        phase5_total: phase5TaskIds.length,
      },
      "phase 5 enqueue complete",
    );

    // Successful end-of-iteration: capture full per-tenant summary.
    perTenantMap.set(tenantId, {
      tenantId,
      reconciliationCount: reconciliationTaskIds.length,
      newInsertedCount: newInsertedTaskIds.length,
      addressResolutionFailedCount,
      advancedSubscriptionCount: advancedSubscriptionIds.length,
      runRowOutcomeKind,
      cappedByGate,
      phase5EnqueuedCount: phase5Enqueued,
      phase5FailedChunks,
      phase5TotalCount: phase5TaskIds.length,
      failedPhase: null,
    });
  }

  // --------------------------------------------------------------------------
  // PHASE 6 — handler-exit summary log + return.
  //
  // Aggregates per-tenant outcomes from perTenantMap into the handler-
  // level summary. Response shape is full-redesign per plan §1.3 retirement
  // table — no legacy field name continuity. Ops dashboards that grep
  // legacy field names need rebuild.
  //
  // HTTP status:
  //   200 — every tenant landed on the all-clean path (failedPhase=null,
  //         cappedByGate=false, phase5FailedChunks=0)
  //   500 — ANY tenant hit an abnormal outcome. Vercel cron logs flag
  //         the run for ops triage; the structured per_tenant body lets
  //         ops see WHICH phase failed for WHICH tenant without parsing
  //         message strings.
  // --------------------------------------------------------------------------
  const handlerExitMs = Date.now();
  const totalWallClockMs = handlerExitMs - handlerEntryMs;

  const perTenantSummaries = Array.from(perTenantMap.values());
  const cappedTenants = perTenantSummaries.filter((t) => t.cappedByGate).length;
  const failedPhase1 = perTenantSummaries.filter(
    (t) => t.failedPhase === "phase1_reconciliation",
  ).length;
  const failedPhase2_4 = perTenantSummaries.filter(
    (t) => t.failedPhase === "phase2_4_materialize",
  ).length;
  const failedPhase5 = perTenantSummaries.filter(
    (t) => t.failedPhase === "phase5_enqueue",
  ).length;

  const summary = {
    total_wall_clock_ms: totalWallClockMs,
    tenant_count: tenantIds.length,
    capped_tenants: cappedTenants,
    failed_phase1_reconciliation: failedPhase1,
    failed_phase2_4_materialize: failedPhase2_4,
    failed_phase5_enqueue: failedPhase5,
    total_reconciliation: perTenantSummaries.reduce(
      (s, t) => s + t.reconciliationCount,
      0,
    ),
    total_inserted: perTenantSummaries.reduce(
      (s, t) => s + t.newInsertedCount,
      0,
    ),
    total_advanced: perTenantSummaries.reduce(
      (s, t) => s + t.advancedSubscriptionCount,
      0,
    ),
    total_address_resolution_failed: perTenantSummaries.reduce(
      (s, t) => s + t.addressResolutionFailedCount,
      0,
    ),
    total_phase5_enqueued: perTenantSummaries.reduce(
      (s, t) => s + t.phase5EnqueuedCount,
      0,
    ),
    total_phase5_failed_chunks: perTenantSummaries.reduce(
      (s, t) => s + t.phase5FailedChunks,
      0,
    ),
    abnormal: perTenantSummaries.some(
      (t) =>
        t.cappedByGate ||
        t.failedPhase !== null ||
        t.phase5FailedChunks > 0,
    ),
  };

  const status = summary.abnormal ? 500 : 200;
  const body = {
    request_id: requestId,
    target_date: targetDate,
    window_start: windowStart,
    window_end: windowEnd,
    summary,
    per_tenant: perTenantSummaries,
  };
  requestLog.info(
    { status, summary },
    "phase 6 handler exit — materialization cron run complete",
  );
  return NextResponse.json(body, { status });
}
