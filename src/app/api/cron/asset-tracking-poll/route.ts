// Day-54 P1 — the 30-minute asset-tracking poll (bag-tracking plan PR
// #502; Love's cadence ruling).
//
// Trigger: a QStash SCHEDULE (cron `*/30 * * * *`) POSTing this route.
// QStash chosen as the tier-proof scheduling route per Love's
// constraint — Vercel Hobby kills sub-daily Vercel crons, QStash
// schedules are part of the existing stack and cost $0 at this volume
// (free tier: 1,000 messages/day + 10 active schedules, verified
// 2026-06-12 against upstash.com/pricing/qstash; this schedule
// consumes 48/day). Signature-gated exactly like the /api/queue/*
// consumers — same signing keys, no new secrets.
//
// The schedule is NOT created by this code. It is registered once via
// scripts/create-qstash-asset-poll-schedule.mjs on Love's go AFTER the
// lane merges (staged posture: until then there is no production route
// for it to call).
//
// Tenant gating: ONLY tenants whose `task_asset_tracking_enabled` flag
// is on (0034 — Love's dark switch; default false, flipped per tenant
// by Love's sentence only). While every tenant is dark, the poll wakes,
// finds zero tenants, and exits without touching SF — running the
// schedule before any tenant is lit is harmless by construction.
//
// Per-tenant failures are isolated: one tenant's SF auth failure logs
// + Sentry-captures and the sweep continues; the response reports
// per-tenant outcomes. 200 always (a failed tenant shouldn't make
// QStash re-fire the whole sweep — the next 30-minute tick is the
// retry).

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import { sql as sqlTag } from "drizzle-orm";

import { runAssetTrackingPoll } from "@/modules/asset-tracking";
import type { AssetTrackingPollSummary } from "@/modules/asset-tracking";
import { withServiceRole } from "@/shared/db";
import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import type { Uuid } from "@/shared/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "cron_asset_tracking_poll" });

async function listAssetTrackingTenantIds(): Promise<readonly Uuid[]> {
  type Row = { id: string } & Record<string, unknown>;
  const rows = await withServiceRole("asset_tracking_poll_list_tenants", async (tx) =>
    tx.execute<Row>(sqlTag`
      SELECT id FROM tenants
      WHERE task_asset_tracking_enabled = true
        AND status = 'active'
      ORDER BY created_at ASC
    `),
  );
  return rows.map((r) => r.id as Uuid);
}

export const POST = verifySignatureAppRouter(async () => {
  const startedAt = Date.now();
  const tenantIds = await listAssetTrackingTenantIds();

  const summaries: AssetTrackingPollSummary[] = [];
  const failures: Array<{ tenant_id: string; error: string }> = [];

  for (const tenantId of tenantIds) {
    try {
      summaries.push(await runAssetTrackingPoll(tenantId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ tenant_id: tenantId, error: message }, "asset-tracking poll failed for tenant");
      captureException(err, { tags: { component: "cron_asset_tracking_poll" } });
      failures.push({ tenant_id: tenantId, error: message });
    }
  }

  const body = {
    tenants_polled: tenantIds.length,
    duration_ms: Date.now() - startedAt,
    summaries,
    failures,
  };
  log.info(body, "asset-tracking poll sweep complete");
  return NextResponse.json(body, { status: 200 });
});
