// /api/cron/auto-resume — Day-16 Block 4-C, Service B Option A scheduler.
//
// Per merged plan PR #155 §10.3 (locked) + §4.3 Option A: cron-based
// polling at 15-min cadence. Walks `subscription_exceptions` for
// `type='pause_window' AND end_date <= today_in_dubai AND NOT EXISTS
// (subscription.resumed audit event for the same correlation_id)` and
// calls `resumeSubscription` with `is_auto_resume: true` for each.
//
// Idempotency:
//   - Cross-tick: the NOT EXISTS resume-audit guard returns no rows
//     for already-resumed subscriptions; subsequent ticks short-circuit.
//   - Within a tick: each subscription's resumeSubscription call writes
//     the audit event before commit; concurrent ticks would race on the
//     row's FOR UPDATE lock and the second tick's read of the audit
//     event filter out by the time it runs.
//
// System actor: `cron:auto_resume` (registered in
// src/shared/tenant-context.ts:SystemActor union per Day-16 Block 4-C).
// Per-row context built with the subscription's `tenant_id` (the cron
// has no inherent tenant scope; each row is processed under its
// owning tenant's RLS).
//
// Crash safety: per merged plan §4.4 — if a tick crashes mid-loop, the
// next 15-min tick re-finds the same rows (audit-event guard not yet
// fired for crashed-mid-loop rows) and retries. Self-healing.

import "server-only";

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { NextResponse } from "next/server";

import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import { withServiceRole } from "@/shared/db";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { resumeSubscription } from "@/modules/subscriptions";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "cron_auto_resume" });

interface DueResumeRow extends Record<string, unknown> {
  readonly id: string;
  readonly subscription_id: string;
  readonly tenant_id: string;
  readonly correlation_id: string;
  readonly start_date: string;
  readonly end_date: string;
}

interface RowOutcome {
  readonly tenant_id: string;
  readonly subscription_id: string;
  readonly outcome: "resumed" | "already_active" | "error";
  readonly error?: string;
}

export async function GET(req: Request): Promise<Response> {
  const handlerEntryMs = Date.now();
  const requestId = randomUUID();
  const requestLog = log.with({ request_id: requestId });

  // CRON_SECRET auth — same pattern as /api/cron/generate-tasks.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    requestLog.error(
      { error_code: "missing_cron_secret_env" },
      "CRON_SECRET env var unset; refusing to run auto-resume cron",
    );
    return new Response(null, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (presented !== expected) {
    requestLog.warn(
      { error_code: "cron_secret_mismatch" },
      "CRON_SECRET mismatch on auto-resume invocation",
    );
    return new Response(null, { status: 401 });
  }

  const now = new Date();
  const todayDubai = computeTodayInDubai(now);

  // Find pause windows whose end_date has elapsed AND no resume audit
  // event has fired for the same correlation_id. Per merged plan
  // §10.3 Option A spec.
  let dueRows: readonly DueResumeRow[];
  try {
    dueRows = await withServiceRole(
      "cron:auto_resume — find due pause windows",
      async (tx) => {
        const result = await tx.execute<DueResumeRow>(sqlTag`
          SELECT id, subscription_id, tenant_id, correlation_id, start_date, end_date
          FROM subscription_exceptions
          WHERE type = 'pause_window'
            AND end_date <= ${todayDubai}::date
            AND NOT EXISTS (
              SELECT 1 FROM audit_events
              WHERE event_type = 'subscription.resumed'
                AND (metadata->>'correlation_id')::uuid = subscription_exceptions.correlation_id
            )
          ORDER BY end_date ASC
        `);
        return result;
      },
    );
  } catch (err) {
    captureException(err, { component: "cron_auto_resume", phase: "query" });
    requestLog.error(
      { error_code: "due_query_threw" },
      "auto-resume cron query failed; surfacing 500",
    );
    return new Response(null, { status: 500 });
  }

  // Per-row processing — each call into resumeSubscription is its own
  // transaction. A single crashed row does not abort the whole batch;
  // outcomes are aggregated and surfaced in the handler-exit summary.
  const outcomes: RowOutcome[] = [];
  let resumedCount = 0;
  let alreadyActiveCount = 0;
  let errorCount = 0;

  for (const row of dueRows) {
    const ctx = buildSystemActorCtx(row.tenant_id as Uuid, requestId);

    try {
      const result = await resumeSubscription(
        ctx,
        row.subscription_id as Uuid,
        // Idempotency: derive the resume's idempotency_key
        // deterministically from the pause's correlation_id so cron
        // retries within the same audit-event window don't double-emit.
        // (The NOT EXISTS guard above is the primary idempotency layer;
        // this is defense-in-depth.)
        { idempotency_key: row.correlation_id },
        { now, is_auto_resume: true },
      );

      if (result.status === "resumed") {
        resumedCount += 1;
      } else {
        alreadyActiveCount += 1;
      }

      outcomes.push({
        tenant_id: row.tenant_id,
        subscription_id: row.subscription_id,
        outcome: result.status === "resumed" ? "resumed" : "already_active",
      });

      requestLog.info(
        {
          tenant_id: row.tenant_id,
          subscription_id: row.subscription_id,
          outcome: result.status,
          correlation_id: row.correlation_id,
        },
        "auto-resume row processed",
      );
    } catch (err) {
      errorCount += 1;
      const errorMessage = err instanceof Error ? err.message : String(err);
      outcomes.push({
        tenant_id: row.tenant_id,
        subscription_id: row.subscription_id,
        outcome: "error",
        error: errorMessage,
      });
      captureException(err, {
        component: "cron_auto_resume",
        phase: "resume_row",
        tenant_id: row.tenant_id,
        subscription_id: row.subscription_id,
      });
      requestLog.error(
        {
          tenant_id: row.tenant_id,
          subscription_id: row.subscription_id,
          error: errorMessage,
        },
        "auto-resume row failed",
      );
    }
  }

  const elapsedMs = Date.now() - handlerEntryMs;
  requestLog.info(
    {
      total_due: dueRows.length,
      resumed_count: resumedCount,
      already_active_count: alreadyActiveCount,
      error_count: errorCount,
      elapsed_ms: elapsedMs,
      today_dubai: todayDubai,
    },
    "auto-resume cron tick complete",
  );

  // 500 if ANY row threw; 200 otherwise. Mirrors the materialization
  // cron's "any abnormal → 500" posture.
  const status = errorCount > 0 ? 500 : 200;
  return NextResponse.json(
    {
      total_due: dueRows.length,
      resumed_count: resumedCount,
      already_active_count: alreadyActiveCount,
      error_count: errorCount,
      outcomes,
    },
    { status },
  );
}

/**
 * Build a per-tenant `RequestContext` with the `cron:auto_resume`
 * system actor. The actor carries `subscription:resume` so that
 * `resumeSubscription`'s `assertSystemActor` branch + any future
 * permission-bound branches succeed without a user actor.
 */
function buildSystemActorCtx(tenantId: Uuid, requestId: string): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:auto_resume",
    tenantId,
    permissions: new Set(["subscription:resume"]),
  };
  return {
    actor,
    tenantId,
    requestId,
    path: "/api/cron/auto-resume",
  };
}
