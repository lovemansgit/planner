// /consignees/[id] — Day-17 detail page.
//
// Server component. Composes against:
//   - getConsignee (existing) for header card data
//   - getConsigneeTimeline (Day 22 — broadened from Day-17's
//     getConsigneeCrmHistory to the unified §3.3.7 timeline view)
//   - changeCrmStateAction (NEW Day 17) wired into CrmStateModal
//
// Tab navigation is URL-based (`?tab=overview|history`) so the page
// stays server-rendered and operators can deep-link to a specific tab.
// Default tab: overview.
//
// Subscription + Calendar tabs are placeholders ("Coming in Day-17
// next PRs") per CRM plan §3.0 — separate workstreams own those
// surfaces. Overview + History are the two tabs this PR ships
// substantively.
//
// Permission gate: consignee:read for the page. Modal trigger
// gated on consignee:change_crm_state per brief §3.3.10 rule 1
// (hidden, not disabled, because the audience for this page is
// always operators with consignee read access).

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  type Consignee,
  type TimelineEvent,
  getConsignee,
  getConsigneeTimeline,
} from "@/modules/consignees";
import {
  getConsigneeCalendarExceptions,
  getRecentExceptionsForSubscription,
  type SubscriptionException,
} from "@/modules/subscription-exceptions";
import {
  type ConsigneeAddressRow,
  listConsigneeAddresses,
} from "@/modules/subscription-addresses";
import {
  listSubscriptionsByConsignee,
  type Subscription,
} from "@/modules/subscriptions";
import {
  type DayBucketCount,
  getConsigneeTaskCountByDayBucket,
  getConsigneeTasksForDateRange,
  getTasksForSubscription,
} from "@/modules/tasks";
import type { Task } from "@/modules/tasks/types";

import { Toast } from "@/components/Toast";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";
import type { Uuid } from "@/shared/types";

import {
  addDays,
  computeMonthEnd,
  computeMonthGridEnd,
  computeMonthGridStart,
  computeMonthStart,
  computeWeekStart,
  computeYearEnd,
  computeYearStart,
} from "./_components/calendar-dates";
import { CalendarMonthView } from "./_components/CalendarMonthView";
import {
  type CalendarViewName,
  CalendarViewToggle,
} from "./_components/CalendarViewToggle";
import { CalendarWeekView } from "./_components/CalendarWeekView";
import { CalendarYearView } from "./_components/CalendarYearView";
import { CrmStateBadge, CRM_STATE_LABELS } from "./_components/CrmStateBadge";
import { CrmStateModal } from "./_components/CrmStateModal";
import { HistoryTab } from "./_components/HistoryTab";
import {
  type SubscriptionDetailGroup,
  SubscriptionTab,
} from "./_components/SubscriptionTab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TabName = "overview" | "subscription" | "calendar" | "history";
const VALID_TABS: readonly TabName[] = ["overview", "subscription", "calendar", "history"];

const VALID_VIEWS: readonly CalendarViewName[] = ["week", "month", "year"];

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{
    readonly tab?: string;
    readonly view?: string;
    readonly week?: string;
    readonly month?: string;
    readonly year?: string;
    readonly created?: string;
  }>;
}

/** Validate ISO date string YYYY-MM-DD. Returns the input or null. */
function parseIsoDateParam(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
}

export default async function ConsigneeDetailPage({ params, searchParams }: PageProps) {
  const requestId = randomUUID();
  const { id } = await params;
  const {
    tab: tabParam,
    view: viewParam,
    week: weekParam,
    month: monthParam,
    year: yearParam,
    created: createdParam,
  } = await searchParams;
  const activeTab: TabName = (VALID_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabName)
    : "overview";
  const activeView: CalendarViewName = (VALID_VIEWS as readonly string[]).includes(
    viewParam ?? "",
  )
    ? (viewParam as CalendarViewName)
    : "week";

  // Calendar anchors — each view computes its own. Defaults pin to the
  // anchor for "today" in UTC (brief §3.3.3 + tenant-tz Phase 2 caveat
  // per memory/followup_label_tz_offset_per_tenant.md).
  const today = new Date();
  const explicitWeek = parseIsoDateParam(weekParam);
  const weekStart = explicitWeek
    ? computeWeekStart(new Date(`${explicitWeek}T00:00:00Z`))
    : computeWeekStart(today);
  const explicitMonth = parseIsoDateParam(monthParam);
  const monthStart = explicitMonth
    ? computeMonthStart(new Date(`${explicitMonth}T00:00:00Z`))
    : computeMonthStart(today);
  const explicitYear = parseIsoDateParam(yearParam);
  const yearStart = explicitYear
    ? computeYearStart(new Date(`${explicitYear}T00:00:00Z`))
    : computeYearStart(today);

  let consignee: Consignee | null;
  let history: readonly TimelineEvent[] = [];
  let calendarTasks: readonly Task[] = [];
  let calendarExceptions: readonly SubscriptionException[] = [];
  let calendarYearCounts: readonly DayBucketCount[] = [];
  let calendarAddresses: readonly ConsigneeAddressRow[] = [];
  let subscriptionGroups: readonly SubscriptionDetailGroup[] = [];
  let canChangeState = false;
  let canEditConsignee = false;
  let canCreateSubscription = false;
  // Day-22 / PR-B — calendar popover action permissions per brief §3.3.3
  // + §3.3.10 rule 1 ("hide what the user cannot access"). Single source
  // of truth for which popover action buttons render.
  const calendarPermissions = {
    canSkip: false,
    canSkipOverride: false,
    canPause: false,
    canChangeAddressOneOff: false,
    canChangeAddressForward: false,
    canAddNote: false,
    canViewTimeline: false,
  };
  try {
    const ctx = await buildRequestContext(`/consignees/${id}`, requestId);
    consignee = await getConsignee(ctx, id as Uuid);
    if (!consignee) notFound();

    if (ctx.actor.kind === "user") {
      const perms = ctx.actor.permissions as ReadonlySet<Permission>;
      canChangeState = perms.has("consignee:change_crm_state");
      // Day-22 forms-lane CTAs.
      // - Edit consignee gate: consignee:update only (the edit form
      //   covers non-address scalar fields per brief v1.11 §3.1).
      // - New subscription gate: per Day-19 §J-5 SPLIT PERMS,
      //   /subscriptions/new requires BOTH subscription:create AND
      //   task:create (subscription mode dispatches createSubscription;
      //   single-task mode dispatches createTask).
      canEditConsignee = perms.has("consignee:update");
      canCreateSubscription =
        perms.has("subscription:create") && perms.has("task:create");
      calendarPermissions.canSkip = perms.has("subscription:skip");
      calendarPermissions.canSkipOverride = perms.has("subscription:override_skip_rules");
      calendarPermissions.canPause = perms.has("subscription:pause");
      calendarPermissions.canChangeAddressOneOff = perms.has(
        "subscription:change_address_one_off",
      );
      calendarPermissions.canChangeAddressForward = perms.has(
        "subscription:change_address_forward",
      );
      calendarPermissions.canAddNote = perms.has("task:add_note");
      calendarPermissions.canViewTimeline = perms.has("task:view_timeline");
    }

    // Only fetch history if the History tab is active — defers the
    // DB roundtrip when the operator's on Overview. Same scope check
    // (consignee:read via the service fn) applies whichever tab.
    // Day 22 / §3.3.7 — broadened from CRM-only to the unified
    // timeline view (CRM transitions + subscription exceptions +
    // terminal task statuses).
    if (activeTab === "history") {
      history = await getConsigneeTimeline(ctx, id as Uuid);
    }
    // Day-23 §3.3.2 — fetch subscriptions + per-subscription tasks +
    // recent exceptions for the Subscription tab. Mirrors the
    // /subscriptions/[id] page's parallel fetch pattern: one round-trip
    // per subscription's tasks + exceptions, all coordinated under one
    // Promise.all so N subscriptions stay below 2 round-trip generations.
    if (activeTab === "subscription") {
      const subs: readonly Subscription[] = await listSubscriptionsByConsignee(
        ctx,
        id as Uuid,
      );
      subscriptionGroups = await Promise.all(
        subs.map(async (subscription) => {
          const [tasks, exceptions] = await Promise.all([
            getTasksForSubscription(ctx, subscription.id as Uuid, 30),
            getRecentExceptionsForSubscription(ctx, subscription.id as Uuid, 10),
          ]);
          return { subscription, tasks, exceptions };
        }),
      );
    }
    // Only fetch calendar data when the Calendar tab is active. View
    // dispatch picks the fetch range:
    //   - week:  weekStart..weekStart+6 (7 days)
    //   - month: month-grid range (Mon-of-first-week..Sun-of-last-week)
    //   - year:  yearStart..yearEnd (~365 days; aggregator-only fetch
    //            per DECISION-1 (b))
    // Exceptions overlap the same window so DayDisplayStatus projection
    // (DECISION-2 ii) drives consistent legend semantics across views.
    if (activeTab === "calendar") {
      // Day-22 / PR-B — fetch consignee addresses for the calendar popover
      // address-override actions (4 + 5). Only fetched when the operator
      // has at least one of the address perms; otherwise the address-
      // selector branches in DayActionPopover are unreachable and the
      // round-trip is wasted.
      const needsAddresses =
        calendarPermissions.canChangeAddressOneOff ||
        calendarPermissions.canChangeAddressForward;

      if (activeView === "week") {
        const weekEnd = addDays(weekStart, 6);
        const [tasks, exceptions, addresses] = await Promise.all([
          getConsigneeTasksForDateRange(ctx, id as Uuid, weekStart, weekEnd),
          getConsigneeCalendarExceptions(ctx, id as Uuid, weekStart, weekEnd),
          needsAddresses ? listConsigneeAddresses(ctx, id as Uuid) : Promise.resolve([]),
        ]);
        calendarTasks = tasks;
        calendarExceptions = exceptions;
        calendarAddresses = addresses;
      } else if (activeView === "month") {
        const monthEnd = computeMonthEnd(new Date(`${monthStart}T00:00:00Z`));
        const gridStart = computeMonthGridStart(monthStart);
        const gridEnd = computeMonthGridEnd(monthEnd);
        const [tasks, exceptions, addresses] = await Promise.all([
          getConsigneeTasksForDateRange(ctx, id as Uuid, gridStart, gridEnd),
          getConsigneeCalendarExceptions(ctx, id as Uuid, gridStart, gridEnd),
          needsAddresses ? listConsigneeAddresses(ctx, id as Uuid) : Promise.resolve([]),
        ]);
        calendarTasks = tasks;
        calendarExceptions = exceptions;
        calendarAddresses = addresses;
      } else {
        const yearEnd = computeYearEnd(new Date(`${yearStart}T00:00:00Z`));
        [calendarYearCounts, calendarExceptions] = await Promise.all([
          getConsigneeTaskCountByDayBucket(ctx, id as Uuid, yearStart, yearEnd),
          getConsigneeCalendarExceptions(ctx, id as Uuid, yearStart, yearEnd),
        ]);
      }
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/consignees/${id}`));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy">
      {createdParam ? (
        <Toast message="Subscription created successfully" paramKey="created" />
      ) : null}
      <div className="mx-auto max-w-5xl px-12 py-12">
        <Link
          href="/consignees"
          className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)] hover:text-navy"
        >
          ← Consignees
        </Link>

        <header
          className={
            consignee.crmState === "HIGH_RISK"
              ? "mt-6 border-b border-stone-200 bg-red/[0.04] pb-8"
              : "mt-6 border-b border-stone-200 pb-8"
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Consignee
              </p>
              <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-navy">
                {consignee.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[color:var(--color-text-secondary)]">
                <span className="tabular-nums">{consignee.phone}</span>
                {consignee.email ? (
                  <>
                    <span className="text-[color:var(--color-text-tertiary)]">·</span>
                    <span>{consignee.email}</span>
                  </>
                ) : null}
                <span className="text-[color:var(--color-text-tertiary)]">·</span>
                <span>{consignee.emirateOrRegion}</span>
              </div>
              <p className="mt-4 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
                {consignee.addressLine}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <CrmStateBadge state={consignee.crmState} size="lg" />
              {canChangeState ? (
                <CrmStateModal consigneeId={consignee.id} currentState={consignee.crmState} />
              ) : null}
              {canEditConsignee || canCreateSubscription ? (
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {canEditConsignee ? (
                    <Link
                      href={`/consignees/${consignee.id}/edit`}
                      className="inline-flex items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
                    >
                      Edit
                    </Link>
                  ) : null}
                  {canCreateSubscription ? (
                    <>
                      <Link
                        href={`/subscriptions/new?consigneeId=${consignee.id}`}
                        className="inline-flex items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
                      >
                        New subscription
                      </Link>
                      <Link
                        href={`/subscriptions/new?consigneeId=${consignee.id}&mode=single-task`}
                        className="inline-flex items-center justify-center rounded-sm border border-navy bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
                      >
                        Add ad-hoc task
                      </Link>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <Tabs activeTab={activeTab} consigneeId={consignee.id} />

        <section className="mt-8">
          {activeTab === "overview" ? <OverviewTab consignee={consignee} /> : null}
          {activeTab === "history" ? <HistoryTab events={history} /> : null}
          {activeTab === "subscription" ? (
            <SubscriptionTab
              groups={subscriptionGroups}
              consigneeId={consignee.id}
              consigneeName={consignee.name}
              addressLine={consignee.addressLine}
              district={consignee.district}
              emirate={consignee.emirateOrRegion}
            />
          ) : null}
          {activeTab === "calendar" ? (
            <div>
              <div className="mb-4 flex justify-end">
                <CalendarViewToggle
                  consigneeId={consignee.id}
                  activeView={activeView}
                  weekAnchor={weekStart}
                  monthAnchor={monthStart}
                  yearAnchor={yearStart}
                />
              </div>
              {activeView === "week" ? (
                <CalendarWeekView
                  consigneeId={consignee.id}
                  weekStart={weekStart}
                  tasks={calendarTasks}
                  exceptions={calendarExceptions}
                  permissions={calendarPermissions}
                  availableAddresses={calendarAddresses}
                />
              ) : null}
              {activeView === "month" ? (
                <CalendarMonthView
                  consigneeId={consignee.id}
                  monthStart={monthStart}
                  tasks={calendarTasks}
                  exceptions={calendarExceptions}
                  permissions={calendarPermissions}
                  availableAddresses={calendarAddresses}
                />
              ) : null}
              {activeView === "year" ? (
                <CalendarYearView
                  consigneeId={consignee.id}
                  yearStart={yearStart}
                  counts={calendarYearCounts}
                  exceptions={calendarExceptions}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function Tabs({ activeTab, consigneeId }: { activeTab: TabName; consigneeId: string }) {
  const items: ReadonlyArray<{ tab: TabName; label: string }> = [
    { tab: "overview", label: "Overview" },
    { tab: "subscription", label: "Subscription" },
    { tab: "calendar", label: "Calendar" },
    { tab: "history", label: "History" },
  ];
  return (
    <nav aria-label="Detail tabs" className="mt-8 flex gap-6 border-b border-stone-200">
      {items.map((item) => {
        const active = item.tab === activeTab;
        const href =
          item.tab === "overview"
            ? `/consignees/${consigneeId}`
            : `/consignees/${consigneeId}?tab=${item.tab}`;
        return (
          <Link
            key={item.tab}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "border-b-2 border-green pb-3 text-sm font-medium text-navy"
                : "pb-3 text-sm text-[color:var(--color-text-secondary)] hover:text-navy"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function OverviewTab({ consignee }: { consignee: Consignee }) {
  return (
    <div className="space-y-8">
      <section>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          CRM state
        </p>
        <p className="mt-1 text-sm text-navy">
          Current state: <span className="font-medium">{CRM_STATE_LABELS[consignee.crmState]}</span>.
        </p>
      </section>

      <section>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Contact
        </p>
        <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[color:var(--color-text-secondary)]">Name</dt>
            <dd className="mt-0.5 text-navy">{consignee.name}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--color-text-secondary)]">Phone</dt>
            <dd className="mt-0.5 tabular-nums text-navy">{consignee.phone}</dd>
          </div>
          {consignee.email ? (
            <div>
              <dt className="text-[color:var(--color-text-secondary)]">Email</dt>
              <dd className="mt-0.5 text-navy">{consignee.email}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-[color:var(--color-text-secondary)]">District</dt>
            <dd className="mt-0.5 text-navy">{consignee.district}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--color-text-secondary)]">Emirate</dt>
            <dd className="mt-0.5 text-navy">{consignee.emirateOrRegion}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[color:var(--color-text-secondary)]">Address</dt>
            <dd className="mt-0.5 max-w-prose text-navy">{consignee.addressLine}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Subscription planner
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">
          System not yet initialised
        </h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the operator views.
        </p>
      </div>
    </main>
  );
}
