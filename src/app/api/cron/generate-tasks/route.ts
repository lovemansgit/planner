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

  // D8-4a: per-tenant accumulator is a Map keyed by tenantId carrying
  // BOTH phase outcomes (generation + push). Single entry per tenant
  // in the response — clearer than two flat-array entries with
  // different `kind` discriminators per tenant. Ops triage on a 500:
  // open the response payload, find the tenant, see both phases at a
  // glance.
  const perTenantMap = new Map<Uuid, PerTenantPair>();
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
      perTenantMap.set(tenantId, {
        tenantId,
        generation: {
          kind: "failed",
          message: err instanceof Error ? err.message : String(err),
        },
        push: { kind: "skipped_due_to_generation_failure" },
      });
      anyAbnormal = true;
      // Skip the push phase if generation threw — generation throwing
      // is a hard infrastructure error (tenant_id missing, DB connection
      // dead) that the push phase will likely repeat. Continue to the
      // next tenant.
      continue;
    }

    const generation = summariseGenerationOutcome(outcome);
    if (outcome.kind === "capped" || outcome.kind === "failed") {
      anyAbnormal = true;
    }

    // ----- Phase (b): push (D8-4a) -------------------------------------------
    // Push runs even if generation was 'capped' or returned
    // 'skipped_already_run' — the unpushed-tasks backlog is
    // independent of THIS run's generate phase.
    let push: PushOutcomeSummary;
    try {
      const pushOutcome = await pushTasksForTenant(ctx, tenantId, adapter);
      push = summarisePushOutcome(pushOutcome);
      if (pushOutcome.kind === "tenant_skipped") {
        // operationally meaningful — operator needs to backfill
        // customer_code; flag for Vercel-logs surfacing.
        anyAbnormal = true;
      }
      if (
        pushOutcome.kind === "pushed" &&
        (pushOutcome.failedToDLQ > 0 || pushOutcome.awbExists > 0)
      ) {
        anyAbnormal = true;
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
      push = {
        kind: "push_failed",
        message: err instanceof Error ? err.message : String(err),
      };
      anyAbnormal = true;
    }

    perTenantMap.set(tenantId, { tenantId, generation, push });
  }

  // --------------------------------------------------------------------------
  // 5. Aggregate + return summary
  // --------------------------------------------------------------------------
  // Per-tenant array is enumerated in the same order tenants were
  // walked (Map preserves insertion order in JS). The response body
  // carries both per-tenant pairs AND a top-level summary rollup so
  // ops triage doesn't require counting per-tenant entries.
  //
  // Status:
  //   200 if every tenant landed cleanly (no anomalies).
  //   500 if ANY tenant hit an abnormal outcome (generation capped /
  //       failed; push tenant_skipped / push_failed; or any failedToDLQ
  //       / awbExists > 0). Vercel logs flag this as a failed cron
  //       invocation — operational signal for ops triage. The structured
  //       per-tenant body lets ops see WHICH phase failed for WHICH
  //       tenant without parsing message strings.
  const perTenant = Array.from(perTenantMap.values());
  const summary = computeRunSummary(perTenant);
  const status = anyAbnormal ? 500 : 200;
  const body = {
    request_id: requestId,
    window_start: windowStart,
    window_end: windowEnd,
    target_date: targetDate,
    tenant_count: tenantIds.length,
    abnormal: anyAbnormal,
    summary,
    per_tenant: perTenant,
  };
  runLog.info({ status, abnormal: anyAbnormal, summary }, "task generation cron run complete");
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

// -----------------------------------------------------------------------------
// Response body shape (D8-4a — per-tenant pair structure)
// -----------------------------------------------------------------------------
// Per-tenant entry carries BOTH phase outcomes side-by-side. Ops
// triage opens the response, finds the tenant, sees:
//   - generation: { kind: 'completed' | 'capped' | ... , ... }
//   - push:       { kind: 'pushed' | 'tenant_skipped' | ... , ... }
// without having to parse a flat array with mixed-kind entries.
//
// The top-level `summary` rollup counts each phase-kind across all
// tenants — saves ops from counting entries by hand on a 500.

type GenerationOutcomeSummary =
  | {
      kind: "completed";
      runId: Uuid;
      subscriptionsWalked: number;
      tasksCreated: number;
      tasksSkippedExisting: number;
    }
  | {
      kind: "capped";
      runId: Uuid;
      projectedCount: number;
      capThreshold: number;
    }
  | {
      kind: "skipped_already_run";
      runId: Uuid;
    }
  | {
      kind: "failed";
      runId?: Uuid;
      message: string;
    };

type PushOutcomeSummary =
  | {
      kind: "pushed";
      attemptedCount: number;
      succeeded: number;
      failedToDLQ: number;
      skippedDistrict: number;
      awbExists: number;
    }
  | {
      kind: "tenant_skipped";
      reason: "missing_customer_code";
      skippedTaskCount: number;
    }
  | {
      kind: "push_failed";
      message: string;
    }
  | {
      // Generation phase threw — push never attempted. Distinct from
      // 'push_failed' (which means push WAS attempted and threw) so
      // ops can tell the failure mode at a glance.
      kind: "skipped_due_to_generation_failure";
    };

interface PerTenantPair {
  tenantId: Uuid;
  generation: GenerationOutcomeSummary;
  push: PushOutcomeSummary;
}

interface RunSummary {
  generation: {
    completed: number;
    capped: number;
    skipped_already_run: number;
    failed: number;
  };
  push: {
    pushed_passes: number;
    tenant_skipped: number;
    push_failed: number;
    skipped_due_to_generation_failure: number;
    total_attempted: number;
    total_succeeded: number;
    total_failed_to_dlq: number;
    total_skipped_district: number;
    total_awb_exists: number;
  };
}

function summariseGenerationOutcome(outcome: GenerateForWindowResult): GenerationOutcomeSummary {
  switch (outcome.kind) {
    case "completed":
      return {
        kind: "completed",
        runId: outcome.run.id,
        subscriptionsWalked: outcome.subscriptionsWalked,
        tasksCreated: outcome.tasksCreated,
        tasksSkippedExisting: outcome.tasksSkippedExisting,
      };
    case "capped":
      return {
        kind: "capped",
        runId: outcome.run.id,
        projectedCount: outcome.projectedCount,
        capThreshold: outcome.capThreshold,
      };
    case "skipped_already_run":
      return {
        kind: "skipped_already_run",
        runId: outcome.existingRun.id,
      };
    case "failed":
      return {
        kind: "failed",
        runId: outcome.run.id,
        message: outcome.errorText,
      };
  }
}

function summarisePushOutcome(outcome: PushTenantOutcome): PushOutcomeSummary {
  if (outcome.kind === "tenant_skipped") {
    return {
      kind: "tenant_skipped",
      reason: outcome.reason,
      skippedTaskCount: outcome.skippedTaskCount,
    };
  }
  return {
    kind: "pushed",
    attemptedCount: outcome.attemptedCount,
    succeeded: outcome.succeeded,
    failedToDLQ: outcome.failedToDLQ,
    skippedDistrict: outcome.skippedDistrict,
    awbExists: outcome.awbExists,
  };
}

function computeRunSummary(perTenant: readonly PerTenantPair[]): RunSummary {
  const summary: RunSummary = {
    generation: { completed: 0, capped: 0, skipped_already_run: 0, failed: 0 },
    push: {
      pushed_passes: 0,
      tenant_skipped: 0,
      push_failed: 0,
      skipped_due_to_generation_failure: 0,
      total_attempted: 0,
      total_succeeded: 0,
      total_failed_to_dlq: 0,
      total_skipped_district: 0,
      total_awb_exists: 0,
    },
  };
  for (const entry of perTenant) {
    summary.generation[entry.generation.kind] += 1;
    switch (entry.push.kind) {
      case "pushed":
        summary.push.pushed_passes += 1;
        summary.push.total_attempted += entry.push.attemptedCount;
        summary.push.total_succeeded += entry.push.succeeded;
        summary.push.total_failed_to_dlq += entry.push.failedToDLQ;
        summary.push.total_skipped_district += entry.push.skippedDistrict;
        summary.push.total_awb_exists += entry.push.awbExists;
        break;
      case "tenant_skipped":
        summary.push.tenant_skipped += 1;
        break;
      case "push_failed":
        summary.push.push_failed += 1;
        break;
      case "skipped_due_to_generation_failure":
        summary.push.skipped_due_to_generation_failure += 1;
        break;
    }
  }
  return summary;
}

