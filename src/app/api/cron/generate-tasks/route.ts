// Vercel Cron handler — Day 7 / C-2.
//
// GET /api/cron/generate-tasks
//
// Triggered by Vercel Cron at the schedule defined in vercel.json
// (12:00 UTC = 16:00 Asia/Dubai per memory/decision_daily_cutoff_and_throughput.md).
// Vercel Cron sends a GET request with `Authorization: Bearer <CRON_SECRET>`.
//
// Responsibilities:
//   1. Verify the CRON_SECRET bearer header. Reject 401 on mismatch.
//   2. Compute the [windowStart, windowEnd] timestamps and the
//      `targetDate` (next-day calendar date in Asia/Dubai).
//   3. Enumerate all tenants via withServiceRole.
//   4. For each tenant, build a system RequestContext and call
//      generateTasksForWindow.
//   5. Aggregate the per-tenant outcomes into a summary payload.
//   6. Return 200 with the summary on the all-completed / all-skipped
//      / mixed path. Return 500 with a summary if ANY tenant hit
//      'capped' or 'failed' so Vercel logs visibly flag the run for
//      operations review (per memory/decision_daily_cutoff_and_throughput.md
//      hard-cap semantics confirmed pre-C-2).
//
// Why GET, not POST: Vercel Cron historically uses GET requests for
// scheduled invocations and forwards a query-string-empty Authorization
// header. The endpoint is idempotent at the per-(tenant, window) layer
// (run-level UNIQUE in 0012) so a retry — Vercel's GET semantics — is
// safe.
//
// Window math:
//   - Vercel Cron schedule "0 12 * * *" fires at 12:00 UTC, which is
//     16:00 Asia/Dubai (no DST in UAE).
//   - windowStart = the firing time (server-clock UTC at handler entry).
//   - windowEnd   = windowStart + 1 hour (the 16:00–17:00 cutoff window
//                   per the throughput memo).
//   - targetDate  = the next calendar date in Asia/Dubai.
//
// Asia/Dubai date computation: Dubai is UTC+4 with no DST. The
// "calendar day in Dubai" of a UTC instant `t` is the date part of
// `(t + 4 hours)` formatted as YYYY-MM-DD. Implemented inline below
// (no Intl-locale dependency to keep the date logic auditable).

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { generateTasksForWindow } from "@/modules/task-generation";
import type { GenerateForWindowResult } from "@/modules/task-generation";
import { nextCalendarDateInDubai } from "@/modules/task-generation/dubai-date";
import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import { pushTasksForTenant, type PushTenantOutcome } from "@/modules/task-push";
import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { sql as sqlTag } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Cron handlers must run on the Node runtime (not Edge) — withServiceRole
// uses the postgres-js driver which requires Node sockets.
export const runtime = "nodejs";

/**
 * Hard cap from memory/decision_daily_cutoff_and_throughput.md. The
 * value is recorded on every task_generation_runs row in
 * cap_threshold so historical capped runs stay interpretable if this
 * constant ever changes.
 */
const TASK_GENERATION_CAP = 7000;

/** Window length: 16:00–17:00 Asia/Dubai → 1 hour. */
const WINDOW_DURATION_MS = 60 * 60 * 1000;

const log = logger.with({ component: "cron_generate_tasks" });

export async function GET(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const requestLog = log.with({ request_id: requestId });

  // --------------------------------------------------------------------------
  // 1. Verify CRON_SECRET
  // --------------------------------------------------------------------------
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Misconfiguration. Fail loud — a deploy without CRON_SECRET cannot
    // process scheduled invocations safely. 500, not 401, because the
    // endpoint itself is broken regardless of caller credentials.
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
  // 2. Compute window and targetDate
  // --------------------------------------------------------------------------
  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + WINDOW_DURATION_MS).toISOString();
  const targetDate = nextCalendarDateInDubai(now);

  const runLog = requestLog.with({
    window_start: windowStart,
    window_end: windowEnd,
    target_date: targetDate,
  });
  runLog.info({}, "task generation cron invocation accepted");

  // --------------------------------------------------------------------------
  // 3. Enumerate tenants
  // --------------------------------------------------------------------------
  let tenantIds: readonly Uuid[];
  try {
    tenantIds = await listAllTenantIds();
  } catch (err) {
    runLog.error(
      { error: err instanceof Error ? err.message : String(err) },
      "failed to enumerate tenants for cron run",
    );
    // Day-7 / C-6: cron run aborted before any per-tenant work; this
    // is an outage signal worth waking ops up for.
    captureException(err, {
      component: "cron_generate_tasks",
      operation: "list_tenants",
      request_id: requestId,
    });
    return new Response(null, { status: 500 });
  }
  runLog.info({ tenant_count: tenantIds.length }, "tenants enumerated for cron run");

  // --------------------------------------------------------------------------
  // 4. Per-tenant generation + push
  // --------------------------------------------------------------------------
  // D8-4a: each tenant pass is now two phases:
  //   (a) generateTasksForWindow — C-2 (Day 7), generates next-day
  //       tasks from active subscriptions.
  //   (b) pushTasksForTenant     — D8-4a (today), walks all unpushed
  //       tasks for the tenant and pushes them to SF with the 5
  //       req/sec throttle + the two fail-closed guards.
  //
  // The push phase runs regardless of the generation outcome —
  // unpushed tasks may exist from prior runs (e.g. yesterday's
  // 'capped' generation left unpushed leftovers). The push phase
  // walks all unpushed tasks per tenant, so we always give the
  // backlog a chance to drain.
  //
  // Adapter constructed once at the top of the handler and shared
  // across all tenants. Per-tenant credentials resolve inside the
  // adapter on each call.
  const adapter = createSuiteFleetLastMileAdapter({
    fetch: globalThis.fetch,
    clock: () => new Date(),
  });

  const perTenant: PerTenantSummary[] = [];
  let anyAbnormal = false;
  for (const tenantId of tenantIds) {
    const ctx = buildSystemContext(tenantId, requestId);

    // ----- Phase (a): generation ---------------------------------------------
    let outcome: GenerateForWindowResult;
    try {
      outcome = await generateTasksForWindow(ctx, {
        tenantId,
        windowStart,
        windowEnd,
        targetDate,
        capThreshold: TASK_GENERATION_CAP,
      });
    } catch (err) {
      runLog.error(
        {
          tenant_id: tenantId,
          error: err instanceof Error ? err.message : String(err),
        },
        "task generation threw for tenant",
      );
      // Day-7 / C-6: per-tenant Sentry visibility. Without this, the
      // cron-summary 500 collapses every per-tenant failure into one
      // event — ops can't tell whether one tenant or all tenants
      // tripped tonight without reading the per-tenant payload.
      captureException(err, {
        component: "cron_generate_tasks",
        operation: "per_tenant_generate",
        tenant_id: tenantId,
        request_id: requestId,
      });
      perTenant.push({
        tenantId,
        kind: "failed",
        message: err instanceof Error ? err.message : String(err),
      });
      anyAbnormal = true;
      // Skip the push phase if generation threw — generation throwing
      // is a hard infrastructure error (tenant_id missing, DB connection
      // dead) that the push phase will likely repeat. Continue to the
      // next tenant.
      continue;
    }

    perTenant.push(summariseOutcome(tenantId, outcome));
    if (outcome.kind === "capped" || outcome.kind === "failed") {
      anyAbnormal = true;
    }

    // ----- Phase (b): push (D8-4a) -------------------------------------------
    // Push runs even if generation was 'capped' or returned
    // 'skipped_already_run' — the unpushed-tasks backlog is
    // independent of THIS run's generate phase.
    try {
      const pushOutcome = await pushTasksForTenant(ctx, tenantId, adapter);
      perTenant.push(summarisePushOutcome(pushOutcome));
      if (pushOutcome.kind === "tenant_skipped" || pushOutcome.kind === "pushed") {
        // tenant_skipped is operationally meaningful (operator needs to
        // backfill customer_code) — flag as abnormal so Vercel logs
        // surface it.
        if (pushOutcome.kind === "tenant_skipped") anyAbnormal = true;
        // Also flag when individual tasks landed in DLQ — operator
        // needs to triage failed pushes.
        if (
          pushOutcome.kind === "pushed" &&
          (pushOutcome.failedToDLQ > 0 || pushOutcome.awbExists > 0)
        ) {
          anyAbnormal = true;
        }
      }
    } catch (err) {
      runLog.error(
        {
          tenant_id: tenantId,
          error: err instanceof Error ? err.message : String(err),
        },
        "task push threw for tenant",
      );
      captureException(err, {
        component: "cron_generate_tasks",
        operation: "per_tenant_push",
        tenant_id: tenantId,
        request_id: requestId,
      });
      perTenant.push({
        tenantId,
        kind: "push_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      anyAbnormal = true;
    }
  }

  // --------------------------------------------------------------------------
  // 5. Return summary
  // --------------------------------------------------------------------------
  // 200 if every tenant landed cleanly (completed | skipped_already_run).
  // 500 if any tenant hit capped / failed / failed_partial — Vercel logs
  // flag this as a failed cron invocation, which is the operational
  // signal we want for hard-cap exceedance per the throughput memo.
  const status = anyAbnormal ? 500 : 200;
  const body = {
    request_id: requestId,
    window_start: windowStart,
    window_end: windowEnd,
    target_date: targetDate,
    tenant_count: tenantIds.length,
    abnormal: anyAbnormal,
    per_tenant: perTenant,
  };
  runLog.info({ status, abnormal: anyAbnormal }, "task generation cron run complete");
  return NextResponse.json(body, { status });
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function listAllTenantIds(): Promise<readonly Uuid[]> {
  return withServiceRole("cron:generate_tasks list tenants", async (tx) => {
    type Row = { id: string } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT id FROM tenants ORDER BY created_at ASC
    `);
    return rows.map((r) => r.id);
  });
}

/**
 * Build a system RequestContext for one per-tenant invocation. The
 * permissions Set is empty: the cron's authorisation lives in the
 * CRON_SECRET check above, not in the user-permission catalogue. The
 * generateTasksForWindow service uses `assertSystemActor`, not
 * `requirePermission`, so the empty permissions set is correct.
 */
function buildSystemContext(tenantId: Uuid, requestId: string): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:generate_tasks",
    tenantId,
    permissions: new Set(),
  };
  return {
    actor,
    tenantId,
    requestId,
    path: "/api/cron/generate-tasks",
  };
}

type PerTenantSummary =
  | {
      tenantId: Uuid;
      kind: "completed";
      runId: Uuid;
      subscriptionsWalked: number;
      tasksCreated: number;
      tasksSkippedExisting: number;
    }
  | {
      tenantId: Uuid;
      kind: "capped";
      runId: Uuid;
      projectedCount: number;
      capThreshold: number;
    }
  | {
      tenantId: Uuid;
      kind: "skipped_already_run";
      runId: Uuid;
    }
  | {
      tenantId: Uuid;
      kind: "failed";
      runId?: Uuid;
      message: string;
    }
  | {
      tenantId: Uuid;
      kind: "pushed";
      attemptedCount: number;
      succeeded: number;
      failedToDLQ: number;
      skippedDistrict: number;
      awbExists: number;
    }
  | {
      tenantId: Uuid;
      kind: "tenant_skipped";
      reason: "missing_customer_code";
      skippedTaskCount: number;
    }
  | {
      tenantId: Uuid;
      kind: "push_failed";
      message: string;
    };

function summariseOutcome(tenantId: Uuid, outcome: GenerateForWindowResult): PerTenantSummary {
  switch (outcome.kind) {
    case "completed":
      return {
        tenantId,
        kind: "completed",
        runId: outcome.run.id,
        subscriptionsWalked: outcome.subscriptionsWalked,
        tasksCreated: outcome.tasksCreated,
        tasksSkippedExisting: outcome.tasksSkippedExisting,
      };
    case "capped":
      return {
        tenantId,
        kind: "capped",
        runId: outcome.run.id,
        projectedCount: outcome.projectedCount,
        capThreshold: outcome.capThreshold,
      };
    case "skipped_already_run":
      return {
        tenantId,
        kind: "skipped_already_run",
        runId: outcome.existingRun.id,
      };
    case "failed":
      return {
        tenantId,
        kind: "failed",
        runId: outcome.run.id,
        message: outcome.errorText,
      };
  }
}

/** Map task-push outcome → per-tenant cron-summary entry. */
function summarisePushOutcome(outcome: PushTenantOutcome): PerTenantSummary {
  if (outcome.kind === "tenant_skipped") {
    return {
      tenantId: outcome.tenantId,
      kind: "tenant_skipped",
      reason: outcome.reason,
      skippedTaskCount: outcome.skippedTaskCount,
    };
  }
  return {
    tenantId: outcome.tenantId,
    kind: "pushed",
    attemptedCount: outcome.attemptedCount,
    succeeded: outcome.succeeded,
    failedToDLQ: outcome.failedToDLQ,
    skippedDistrict: outcome.skippedDistrict,
    awbExists: outcome.awbExists,
  };
}

