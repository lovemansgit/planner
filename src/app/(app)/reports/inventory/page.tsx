// Day-54 P2 — merchant Inventory report (bag-tracking plan PR #502 §6.B).
//
// Server component, /admin/tasks page shell conventions. Permission
// gate is service-layer (`asset_tracking:read`); the DARK SWITCH
// (posture 7b) gates the whole surface — a tenant whose
// task_asset_tracking_enabled flag is off gets the not-enabled state
// (and never sees the nav item; this page state covers direct URLs).
//
// Date range: 30-day default, 90-day max (plan Q3 accepted). The
// "as of" stamp shows the last successful sync; "history since"
// carries the no-backfill note (plan Q7 accepted).

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { InventoryView } from "@/components/asset-reports/InventoryView";
import { RefreshButton } from "@/components/asset-reports/RefreshButton";
import {
  formatAsOf,
  formatHistorySince,
  parseReportRange,
} from "@/components/asset-reports/report-helpers";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import {
  getInventoryReport,
  getTenantAssetTrackingEnabled,
} from "@/modules/asset-tracking/report-service";
import type { InventoryReport } from "@/modules/asset-tracking/report-service";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface InventoryPageProps {
  readonly searchParams: Promise<{
    readonly from?: string;
    readonly to?: string;
  }>;
}

export default async function InventoryReportPage({ searchParams }: InventoryPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const today = computeTodayInDubai(new Date());
  const { from, to } = parseReportRange(params.from, params.to, today);

  let report: InventoryReport | null = null;
  let enabled = false;
  try {
    const ctx = await buildRequestContext("/reports/inventory", requestId);
    if (ctx.tenantId) {
      enabled = (await getTenantAssetTrackingEnabled(ctx.tenantId)).enabled;
    }
    if (enabled) {
      report = await getInventoryReport(ctx, { dateFrom: from, dateTo: to });
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/reports/inventory"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      redirect("/");
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Reports
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Inventory</h1>
          {enabled && report ? (
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              {formatAsOf(report.meta.asOf)} · {formatHistorySince(report.meta.historySince)}
            </p>
          ) : null}
        </header>

        {!enabled ? (
          <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              Asset tracking is not enabled for your account.
            </p>
          </section>
        ) : report ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <DateRangeFilter
                today={today}
                initialFrom={from}
                initialTo={to}
                basePath="/reports/inventory"
              />
              <RefreshButton />
            </div>
            <div className="mt-8">
              <InventoryView
                byDate={report.byDate}
                byConsignee={report.byConsignee}
                tasksBasePath="/tasks"
              />
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
