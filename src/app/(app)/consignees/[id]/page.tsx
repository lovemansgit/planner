// /consignees/[id] — Day-17 detail page.
//
// Server component. Composes against:
//   - getConsignee (existing) for header card data
//   - getConsigneeCrmHistory (NEW Day 17) for the History tab
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
  type ConsigneeCrmEvent,
  getConsignee,
  getConsigneeCrmHistory,
} from "@/modules/consignees";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";
import type { Uuid } from "@/shared/types";

import { CrmStateBadge, CRM_STATE_LABELS } from "./_components/CrmStateBadge";
import { CrmStateModal } from "./_components/CrmStateModal";
import { HistoryTab } from "./_components/HistoryTab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TabName = "overview" | "subscription" | "calendar" | "history";
const VALID_TABS: readonly TabName[] = ["overview", "subscription", "calendar", "history"];

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly tab?: string }>;
}

export default async function ConsigneeDetailPage({ params, searchParams }: PageProps) {
  const requestId = randomUUID();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const activeTab: TabName = (VALID_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabName)
    : "overview";

  let consignee: Consignee | null;
  let history: readonly ConsigneeCrmEvent[] = [];
  let canChangeState = false;
  try {
    const ctx = await buildRequestContext(`/consignees/${id}`, requestId);
    consignee = await getConsignee(ctx, id as Uuid);
    if (!consignee) notFound();

    if (ctx.actor.kind === "user") {
      canChangeState = (ctx.actor.permissions as ReadonlySet<Permission>).has(
        "consignee:change_crm_state",
      );
    }

    // Only fetch history if the History tab is active — defers the
    // DB roundtrip when the operator's on Overview. Same scope check
    // (consignee:read via the service fn) applies whichever tab.
    if (activeTab === "history") {
      history = await getConsigneeCrmHistory(ctx, id as Uuid);
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
      <div className="mx-auto max-w-5xl px-12 py-12">
        <Link
          href="/consignees"
          className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)] hover:text-navy"
        >
          ← Consignees
        </Link>

        <header className="mt-6 border-b border-stone-200 pb-8">
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
            </div>
          </div>
        </header>

        <Tabs activeTab={activeTab} consigneeId={consignee.id} />

        <section className="mt-8">
          {activeTab === "overview" ? <OverviewTab consignee={consignee} /> : null}
          {activeTab === "history" ? <HistoryTab events={history} /> : null}
          {activeTab === "subscription" ? <PlaceholderTab label="Subscription" /> : null}
          {activeTab === "calendar" ? <PlaceholderTab label="Calendar" /> : null}
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

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div className="border-t border-stone-200 py-12 text-center">
      <p className="text-sm text-[color:var(--color-text-secondary)]">
        {label} — coming in Day-17 next PRs.
      </p>
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
