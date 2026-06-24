// Day-54 P2 — Transcorp Asset Tracking report (bag-tracking plan PR
// #502 §6.A). Server component, /admin/tasks shell conventions.
//
// Rows: merchant × delivery date behind a date-range + merchant
// filter, with a merchant-rollup row on top of each merchant's date
// rows (plan Q5 accepted). Only tenants whose dark switch is ON
// appear (query-level scoping); an all-dark fleet renders the empty
// state.
//
// "Allocated Asset" links to the Asset Log (P3 — the business spec's
// log hyperlink); every other value drills down to /admin/tasks
// filtered to its AWB set.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { CountCell, ReportHeaderCells } from "@/components/asset-reports/ReportCells";
import {
  awbsHref,
  formatAsOf,
  formatHistorySince,
  parseReportRange,
} from "@/components/asset-reports/report-helpers";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { getAdminAssetTrackingReport } from "@/modules/asset-tracking/report-service";
import type { AdminAssetTrackingReport } from "@/modules/asset-tracking/report-service";
import type { AdminAssetTrackingRow } from "@/modules/asset-tracking/report-repository";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";
import { shellClass } from "@/components/page-shell-recipe";

import { MerchantRefreshControl } from "./_components/MerchantRefreshControl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TH = "px-4 py-3 text-left text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]";
const TD = "px-4 py-3 text-sm tabular-nums";

interface MerchantGroup {
  readonly merchantSlug: string;
  readonly merchantName: string;
  readonly dates: readonly AdminAssetTrackingRow[];
}

function groupByMerchant(rows: readonly AdminAssetTrackingRow[]): readonly MerchantGroup[] {
  const bySlug = new Map<string, AdminAssetTrackingRow[]>();
  for (const row of rows) {
    const list = bySlug.get(row.merchantSlug) ?? [];
    list.push(row);
    bySlug.set(row.merchantSlug, list);
  }
  return [...bySlug.entries()]
    .map(([merchantSlug, dates]) => ({
      merchantSlug,
      merchantName: dates[0].merchantName,
      dates,
    }))
    .sort((a, b) => a.merchantName.localeCompare(b.merchantName));
}

function sum(dates: readonly AdminAssetTrackingRow[], pick: (r: AdminAssetTrackingRow) => number): number {
  return dates.reduce((total, row) => total + pick(row), 0);
}

function unionAwbs(dates: readonly AdminAssetTrackingRow[], pick: (r: AdminAssetTrackingRow) => readonly string[]): readonly string[] {
  return [...new Set(dates.flatMap(pick))];
}

interface AdminAssetTrackingPageProps {
  readonly searchParams: Promise<{
    readonly from?: string;
    readonly to?: string;
    readonly merchant?: string;
  }>;
}

export default async function AdminAssetTrackingPage({ searchParams }: AdminAssetTrackingPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const today = computeTodayInDubai(new Date());
  const { from, to } = parseReportRange(params.from, params.to, today);
  const merchantSlug =
    typeof params.merchant === "string" && params.merchant.length > 0 ? params.merchant : undefined;

  let report: AdminAssetTrackingReport;
  let merchants: readonly Merchant[];
  try {
    const ctx = await buildRequestContext("/admin/asset-tracking", requestId);
    [report, merchants] = await Promise.all([
      getAdminAssetTrackingReport(ctx, { dateFrom: from, dateTo: to, merchantSlug }),
      // Item 1: merchant-filter dropdown lists genuine merchants only —
      // automated-test tenants are never offered as a filter option.
      listMerchants(ctx, { excludeTestTenants: true }),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/asset-tracking"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const groups = groupByMerchant(report.rows);
  const dropdownMerchants = merchants.map((m) => ({ slug: m.slug, name: m.name, status: m.status }));

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className={shellClass("py-16")}>
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Reports
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Asset Tracking</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            {formatAsOf(report.meta.asOf)} · {formatHistorySince(report.meta.historySince)}
          </p>
        </header>

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <DateRangeFilter
            today={today}
            initialFrom={from}
            initialTo={to}
            basePath="/admin/asset-tracking"
          />
          <span className="flex flex-wrap items-end gap-4">
            <MerchantFilterDropdown merchants={dropdownMerchants} currentSlug={merchantSlug ?? null} />
            <MerchantRefreshControl
              merchants={dropdownMerchants.map((m) => ({ slug: m.slug, name: m.name }))}
              currentSlug={merchantSlug ?? null}
            />
          </span>
        </div>

        {groups.length === 0 ? (
          <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              No asset data in this range. Merchants appear here once asset
              tracking is enabled for them and their first scans sync.
            </p>
          </section>
        ) : (
          <div className="overflow-x-auto border border-[color:var(--color-border-strong)]">
            <table className="w-full border-collapse">
              <thead className="border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)]">
                <tr>
                  <th className={TH}>Merchant / delivery date</th>
                  <ReportHeaderCells />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <MerchantRows key={group.merchantSlug} group={group} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function MerchantRows({ group }: { readonly group: MerchantGroup }) {
  const base = "/admin/tasks";
  const extra = { merchant: group.merchantSlug };
  return (
    <>
      <tr className="border-b border-[color:var(--color-border-default)] bg-[color:var(--color-tint-navy-subtle)]">
        {/* Refresh moved out of the rows into the single page-level
            MerchantRefreshControl (Batch AT) — one select + select-all control
            replaces the per-row buttons; same per-merchant #509 scoping. */}
        <td className={`${TD} font-semibold`}>{group.merchantName}</td>
        <CountCell
          value={sum(group.dates, (r) => r.allocatedAssets)}
          href={awbsHref("/admin/asset-tracking/log", unionAwbs(group.dates, (r) => r.awbs))}
        />
        <CountCell
          value={sum(group.dates, (r) => r.suppQuantity)}
          href={awbsHref(base, unionAwbs(group.dates, (r) => r.awbs), extra)}
        />
        <CountCell
          value={sum(group.dates, (r) => r.collected)}
          href={awbsHref(base, unionAwbs(group.dates, (r) => r.awbsByState.collected), extra)}
        />
        <CountCell
          value={sum(group.dates, (r) => r.received)}
          href={awbsHref(base, unionAwbs(group.dates, (r) => r.awbsByState.received), extra)}
        />
        <CountCell
          value={sum(group.dates, (r) => r.sorted)}
          href={awbsHref(base, unionAwbs(group.dates, (r) => r.awbsByState.sorted), extra)}
        />
        <CountCell
          value={sum(group.dates, (r) => r.enRoute)}
          href={awbsHref(base, unionAwbs(group.dates, (r) => r.awbsByState.enRoute), extra)}
        />
        <CountCell
          value={sum(group.dates, (r) => r.returned)}
          href={awbsHref(base, unionAwbs(group.dates, (r) => r.awbsByState.returned), extra)}
        />
      </tr>
      {group.dates.map((row) => (
        <tr
          key={`${group.merchantSlug}-${row.deliveryDate}`}
          className="border-b border-[color:var(--color-border-default)] last:border-b-0"
        >
          <td className={`${TD} pl-12 text-[color:var(--color-text-secondary)]`}>{row.deliveryDate}</td>
          <CountCell value={row.allocatedAssets} href={awbsHref("/admin/asset-tracking/log", row.awbs)} />
          <CountCell value={row.suppQuantity} href={awbsHref(base, row.awbs, extra)} />
          <CountCell value={row.collected} href={awbsHref(base, row.awbsByState.collected, extra)} />
          <CountCell value={row.received} href={awbsHref(base, row.awbsByState.received, extra)} />
          <CountCell value={row.sorted} href={awbsHref(base, row.awbsByState.sorted, extra)} />
          <CountCell value={row.enRoute} href={awbsHref(base, row.awbsByState.enRoute, extra)} />
          <CountCell value={row.returned} href={awbsHref(base, row.awbsByState.returned, extra)} />
        </tr>
      ))}
    </>
  );
}

// Local copy of the admin not-initialised fallback (the admin pages each
// carry their own — there is no shared component yet; same as /admin/tasks).
function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Transcorp · Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the admin views.
        </p>
      </div>
    </main>
  );
}
