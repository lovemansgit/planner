// Day-24 — /admin/calendar route for the Transcorp-staff fleet view.
//
// Existed before today only as the Transcorp-variant branch of
// /calendar (in (app)/calendar/page.tsx). Day-24 dry-run surfaced a
// navigation inconsistency: when a Transcorp sysadmin clicked the
// Calendar entry in the admin nav (PR #254), they landed on the
// tenant /calendar route which renders the tenant nav shell. Click
// chain from there routed back through tenant pages, breaking the
// admin storyline. Fix: split the Transcorp fleet view onto its own
// /admin/calendar route under the (admin)/ layout so it renders with
// the AdminTopNav and stays in the admin click context.
//
// Reuses the same service-layer fns + presentation components that
// the (app)/calendar Transcorp branch uses — no service duplication,
// no service-layer fork. Tenant /calendar continues to render the
// tenant variant for non-Transcorp actors and remains the operator's
// home base for tenant-scoped weekly + monthly + day-detail views.
//
// Permission gate: task:read_all (only transcorp-sysadmin carries it
// in v1.5). ForbiddenError → / per the established admin pattern.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import {
  getCalendarMetricsTranscorpAdmin,
  getPerMerchantBreakdown,
  getTopMerchantsToday,
  type CalendarMetricsTranscorpAdmin,
  type CalendarPerMerchantBreakdownRow,
  type CalendarTopMerchantToday,
} from "@/modules/calendar";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { MetricCard } from "@/app/(app)/calendar/_components/MetricCard";
import { PerMerchantBreakdownPanel } from "@/app/(app)/calendar/_components/PerMerchantBreakdownPanel";
import { TopMerchantsTodayPanel } from "@/app/(app)/calendar/_components/TopMerchantsTodayPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminCalendarPage() {
  const requestId = randomUUID();
  const today = computeTodayInDubai(new Date());

  let metrics: CalendarMetricsTranscorpAdmin;
  let topMerchants: readonly CalendarTopMerchantToday[];
  let perMerchantBreakdown: readonly CalendarPerMerchantBreakdownRow[];
  try {
    const ctx = await buildRequestContext("/admin/calendar", requestId);
    [metrics, topMerchants, perMerchantBreakdown] = await Promise.all([
      getCalendarMetricsTranscorpAdmin(ctx, today),
      getTopMerchantsToday(ctx, today),
      getPerMerchantBreakdown(ctx, today),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/calendar"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const todayHeader = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Fleet overview</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            {todayHeader}
          </p>
        </header>

        <section
          aria-label="Fleet metrics"
          className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          <MetricCard
            label="Active merchants"
            value={metrics.activeMerchants}
            context="Tenants in active status"
          />
          <MetricCard
            label="Total deliveries today"
            value={metrics.totalDeliveriesToday}
            context="All tenants combined"
          />
          <MetricCard
            label="Delivered today"
            value={metrics.deliveredToday}
            context="Completed across all tenants"
          />
          <MetricCard
            label="In transit"
            value={metrics.inTransit}
            context="On the road right now"
          />
          <MetricCard
            label="Failed"
            value={metrics.failedLast7Days}
            tone="risk"
            context="Last 7 days, all tenants"
          />
        </section>

        <TopMerchantsTodayPanel merchants={topMerchants} />
        <PerMerchantBreakdownPanel rows={perMerchantBreakdown} />
      </div>
    </main>
  );
}

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
