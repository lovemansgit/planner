// /calendar — consolidated cross-consignee merchant calendar view
// (brief §3.3.4). Day-22n PR-C-A + Day-23n polish.
//
// Server component. Renders five header metric cards + filter bar +
// view toggle + ConsolidatedWeekView. Month + day views render a
// placeholder (Day-23 follow-on scope).
//
// Day-23n polish:
//   - WeekView day cells now click through to /calendar?view=day&date=<iso>;
//     inline top-3 task preview rows removed.
//   - Time-of-day URL filter (`window`) dropped — no consumer.
//   - Transcorp admin actor (carries `task:read_all`) sees a
//     cross-tenant metric variant instead of the tenant-scoped one.
//
// URL state (read at the page boundary, threaded through children
// without intermediate parsing):
//   view   week | month | day      (default: week)
//   week   ISO YYYY-MM-DD Monday  (default: current week's Monday in Asia/Dubai)
//   month  ISO YYYY-MM-01         (default: current month start)
//   date   ISO YYYY-MM-DD         (default: today in Dubai)
//   q      consignee name/phone substring
//   crm    CRM-state filter (exact match)
//   district address district filter (exact match)
//   status task internal_status filter (exact match)
//
// Permission boundary: `task:read`. Transcorp admin variant requires
// `task:read_all` (only transcorp-sysadmin carries it). Auth flow
// matches /tasks/page.tsx — UnauthorizedError → /login redirect;
// NoTenantConfiguredError → SystemNotInitialised; everything else
// propagates.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import {
  countTasksByDayAcrossConsignees,
  getCalendarFilterOptions,
  getCalendarMetrics,
  getCalendarMetricsTranscorpAdmin,
  type CalendarDayCount,
  type CalendarFilters,
  type CalendarMetrics,
  type CalendarMetricsTranscorpAdmin,
} from "@/modules/calendar";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { CalendarFilterBar } from "./_components/CalendarFilterBar";
import { CalendarViewToggle } from "./_components/CalendarViewToggle";
import { ConsolidatedWeekView } from "./_components/ConsolidatedWeekView";
import { MetricCard } from "./_components/MetricCard";
import type { CalendarConsolidatedView, CalendarFiltersValue } from "./_types";
import { computeWeekStart } from "../consignees/[id]/_components/calendar-dates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CalendarPageProps {
  readonly searchParams: Promise<{
    readonly view?: string;
    readonly week?: string;
    readonly month?: string;
    readonly date?: string;
    readonly q?: string;
    readonly crm?: string;
    readonly district?: string;
    readonly status?: string;
  }>;
}

function parseView(raw: string | undefined): CalendarConsolidatedView {
  if (raw === "month" || raw === "day") return raw;
  return "week";
}

function isIsoDate(raw: string | undefined): raw is string {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

function defaultWeekAnchor(today: string): string {
  return computeWeekStart(new Date(`${today}T00:00:00Z`));
}

function defaultMonthAnchor(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function buildPreservedQuery(filters: CalendarFiltersValue): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.crm) params.set("crm", filters.crm);
  if (filters.district) params.set("district", filters.district);
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

function toFilters(value: CalendarFiltersValue): CalendarFilters {
  return {
    q: value.q || undefined,
    crm: value.crm || undefined,
    district: value.district || undefined,
    status: value.status || undefined,
  };
}

function formatWeekdayLabel(iso: string): { weekday: string; date: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
  return { weekday, date };
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const requestId = randomUUID();
  const today = computeTodayInDubai(new Date());
  const params = await searchParams;

  const view = parseView(params.view);
  const weekAnchor = isIsoDate(params.week) ? params.week : defaultWeekAnchor(today);
  const monthAnchor = isIsoDate(params.month) ? params.month : defaultMonthAnchor(today);
  const dayAnchor = isIsoDate(params.date) ? params.date : today;

  const filterValues: CalendarFiltersValue = {
    q: params.q ?? "",
    crm: params.crm ?? "",
    district: params.district ?? "",
    status: params.status ?? "",
  };
  const filters = toFilters(filterValues);

  let tenantMetrics: CalendarMetrics | null = null;
  let transcorpMetrics: CalendarMetricsTranscorpAdmin | null = null;
  let weekDays: readonly CalendarDayCount[] = [];
  let filterOptions: Awaited<ReturnType<typeof getCalendarFilterOptions>> | null = null;
  let isTranscorpAdmin = false;
  try {
    const ctx = await buildRequestContext("/calendar", requestId);
    isTranscorpAdmin =
      ctx.actor.kind === "user" && ctx.actor.permissions.has("task:read_all");

    if (isTranscorpAdmin) {
      // Transcorp admin variant — cross-tenant metrics only; the
      // WeekView / filter bar stay tenant-scoped so this branch
      // intentionally skips them (Transcorp admin lands on /calendar
      // primarily for the at-a-glance fleet metrics).
      transcorpMetrics = await getCalendarMetricsTranscorpAdmin(ctx, today);
    } else {
      const [metricsResult, optionsResult, weekResult] = await Promise.all([
        getCalendarMetrics(ctx, today, filters),
        getCalendarFilterOptions(ctx),
        view === "week"
          ? countTasksByDayAcrossConsignees(ctx, weekAnchor, filters)
          : Promise.resolve([] as readonly CalendarDayCount[]),
      ]);
      tenantMetrics = metricsResult;
      filterOptions = optionsResult;
      weekDays = weekResult;
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/calendar"));
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
            Subscription planner
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            {isTranscorpAdmin ? "Fleet overview" : "All deliveries"}
          </h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            {todayHeader}
          </p>
        </header>

        {isTranscorpAdmin && transcorpMetrics ? (
          <TranscorpAdminMetricsRow metrics={transcorpMetrics} />
        ) : tenantMetrics ? (
          <TenantMetricsRow metrics={tenantMetrics} />
        ) : null}

        {!isTranscorpAdmin && filterOptions ? (
          <CalendarFilterBar
            initialValues={filterValues}
            crmOptions={filterOptions.crmStates.map((s) => ({ value: s, label: s }))}
            districtOptions={filterOptions.districts.map((d) => ({ value: d, label: d }))}
            statusOptions={filterOptions.statuses.map((s) => ({ value: s, label: s }))}
          />
        ) : null}

        {!isTranscorpAdmin ? (
          <>
            <div className="mt-6 flex items-center justify-between">
              <CalendarViewToggle
                activeView={view}
                weekAnchor={weekAnchor}
                monthAnchor={monthAnchor}
                dayAnchor={dayAnchor}
                preservedQuery={buildPreservedQuery(filterValues)}
              />
              {view === "week" ? (
                <WeekAnchorNav
                  weekAnchor={weekAnchor}
                  preservedQuery={buildPreservedQuery(filterValues)}
                />
              ) : null}
            </div>

            <section className="mt-8">
              {view === "week" ? (
                <ConsolidatedWeekView
                  weekStart={weekAnchor}
                  days={weekDays}
                  today={today}
                  formatWeekdayLabel={formatWeekdayLabel}
                  preservedQuery={buildPreservedQuery(filterValues)}
                />
              ) : (
                <PlaceholderView view={view} />
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function TenantMetricsRow({ metrics }: { readonly metrics: CalendarMetrics }) {
  return (
    <section
      aria-label="Metrics"
      className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      <MetricCard
        label="Active consignees"
        value={metrics.activeConsignees}
        context="Currently in your book of business"
      />
      <MetricCard
        label="Today's deliveries"
        value={metrics.todayDeliveriesScheduled}
        context="Scheduled and not yet final"
      />
      <MetricCard
        label="Delivered today"
        value={metrics.deliveredToday}
        context="Completed deliveries"
      />
      <MetricCard
        label="Out for delivery"
        value={metrics.outForDelivery}
        context="In transit right now"
      />
      <MetricCard
        label="Failed and at-risk"
        value={metrics.failedAtRisk}
        tone="risk"
        context="Last 7 days + high-risk consignees"
      />
    </section>
  );
}

function TranscorpAdminMetricsRow({
  metrics,
}: {
  readonly metrics: CalendarMetricsTranscorpAdmin;
}) {
  return (
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
  );
}

function WeekAnchorNav({
  weekAnchor,
  preservedQuery,
}: {
  readonly weekAnchor: string;
  readonly preservedQuery: string;
}) {
  const start = new Date(`${weekAnchor}T00:00:00Z`);
  const prev = new Date(start);
  prev.setUTCDate(start.getUTCDate() - 7);
  const next = new Date(start);
  next.setUTCDate(start.getUTCDate() + 7);
  const prevIso = prev.toISOString().slice(0, 10);
  const nextIso = next.toISOString().slice(0, 10);
  const trail = preservedQuery ? `&${preservedQuery}` : "";
  return (
    <nav aria-label="Week navigation" className="flex items-center gap-3 text-xs uppercase tracking-[0.14em]">
      <a
        href={`/calendar?view=week&week=${prevIso}${trail}`}
        className="text-navy underline decoration-stone-300 underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
      >
        ← Previous
      </a>
      <span className="text-[color:var(--color-text-tertiary)]">|</span>
      <a
        href={`/calendar?view=week${trail}`}
        className="text-navy underline decoration-stone-300 underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
      >
        This week
      </a>
      <span className="text-[color:var(--color-text-tertiary)]">|</span>
      <a
        href={`/calendar?view=week&week=${nextIso}${trail}`}
        className="text-navy underline decoration-stone-300 underline-offset-4 transition-colors duration-[120ms] ease-out hover:decoration-navy"
      >
        Next →
      </a>
    </nav>
  );
}

function PlaceholderView({ view }: { readonly view: CalendarConsolidatedView }) {
  const label = view === "month" ? "Month view" : "Day view";
  return (
    <div className="border border-dashed border-stone-300 bg-paper px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        Coming soon
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {label} renders in a follow-up PR. Use Week view to explore today&apos;s deliveries.
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-primary text-navy">
      <div className="max-w-md px-12 py-16 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Configuration required
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Calendar not ready</h1>
        <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
          No tenant is currently configured for this session. Contact your administrator.
        </p>
      </div>
    </main>
  );
}
