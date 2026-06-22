// Day-54 P2 — Transcorp Inventory report (bag-tracking plan PR #502
// §6.B, admin variant). Same two sections as the merchant page when
// scoped to ONE merchant via the shared dropdown.
//
// No merchant selected → the all-merchants view (Day-54 walk F1,
// Love's ruling): one row per lit merchant with its rollup totals,
// expandable to the by-consignee breakdown, same drill-down
// behaviour as the rest. The dropdown is a filter, not a
// prerequisite. Refresh stays on the single-merchant view only — an
// all-merchants refresh would fan one click out to every lit
// merchant's SF sweep (the #509 cost trigger, deliberately avoided).

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { InventoryView } from "@/components/asset-reports/InventoryView";
import { MerchantRows } from "@/components/asset-reports/MerchantRows";
import { RefreshButton } from "@/components/asset-reports/RefreshButton";
import {
  formatAsOf,
  formatHistorySince,
  parseReportRange,
} from "@/components/asset-reports/report-helpers";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import {
  getAdminAllMerchantsInventoryReport,
  getAdminInventoryReport,
} from "@/modules/asset-tracking/report-service";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminInventoryPageProps {
  readonly searchParams: Promise<{
    readonly from?: string;
    readonly to?: string;
    readonly merchant?: string;
  }>;
}

export default async function AdminInventoryPage({ searchParams }: AdminInventoryPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const today = computeTodayInDubai(new Date());
  const { from, to } = parseReportRange(params.from, params.to, today);
  const merchantSlug =
    typeof params.merchant === "string" && params.merchant.length > 0 ? params.merchant : undefined;

  let merchants: readonly Merchant[];
  let report: Awaited<ReturnType<typeof getAdminInventoryReport>> = null;
  let allMerchants: Awaited<ReturnType<typeof getAdminAllMerchantsInventoryReport>> | null = null;
  try {
    const ctx = await buildRequestContext("/admin/inventory", requestId);
    // Item 1: merchant-filter dropdown lists genuine merchants only —
    // automated-test tenants are never offered as a filter option.
    merchants = await listMerchants(ctx, { excludeTestTenants: true });
    if (merchantSlug !== undefined) {
      report = await getAdminInventoryReport(ctx, { merchantSlug, dateFrom: from, dateTo: to });
    } else {
      allMerchants = await getAdminAllMerchantsInventoryReport(ctx, { dateFrom: from, dateTo: to });
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/inventory"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const dropdownMerchants = merchants.map((m) => ({ slug: m.slug, name: m.name, status: m.status }));
  const meta = report?.meta ?? allMerchants?.meta ?? null;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Reports
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Inventory</h1>
          {meta ? (
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              {formatAsOf(meta.asOf)} · {formatHistorySince(meta.historySince)}
            </p>
          ) : null}
        </header>

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <DateRangeFilter
            today={today}
            initialFrom={from}
            initialTo={to}
            basePath="/admin/inventory"
          />
          <span className="flex items-center gap-4">
            {merchantSlug !== undefined && report !== null && report.enabled ? (
              <RefreshButton merchantSlug={merchantSlug} />
            ) : null}
            <MerchantFilterDropdown merchants={dropdownMerchants} currentSlug={merchantSlug ?? null} />
          </span>
        </div>

        {merchantSlug === undefined ? (
          allMerchants === null || allMerchants.sections.length === 0 ? (
            <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
              <p className="text-sm text-[color:var(--color-text-secondary)]">
                No merchants have asset tracking enabled.
              </p>
            </section>
          ) : (
            <MerchantRows sections={allMerchants.sections} tasksBasePath="/admin/tasks" />
          )
        ) : report === null ? (
          <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              Unknown merchant.
            </p>
          </section>
        ) : !report.enabled ? (
          <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              Asset tracking is not enabled for this merchant.
            </p>
          </section>
        ) : (
          <InventoryView
            byDate={report.byDate}
            byConsignee={report.byConsignee}
            tasksBasePath="/admin/tasks"
            extraTaskParams={{ merchant: merchantSlug }}
          />
        )}
      </div>
    </main>
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
