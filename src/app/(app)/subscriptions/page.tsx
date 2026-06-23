// /subscriptions — read-only list view, Day-6 demo artifact.
//
// Server component. Mirrors the Day-3 /consignees page architecture
// (full chain: RLS + permission check → service layer → server-
// rendered HTML) but uses the Z-1 brand tokens introduced in Day 6
// rather than hard-coded hex values. Future brand-team corrections
// land as a CSS-variable swap in src/styles/brand-tokens.css, not as
// a sweep through component code.
//
// Design language (matches Z-1 brand tokens):
//   - Background:   var(--color-surface-primary)   (warm off-white)
//   - Foreground:   var(--color-navy)              (deep navy)
//   - Tints:        var(--color-text-{secondary|tertiary})
//                   var(--color-border-{default|strong})
//   - Sentence case throughout
//   - Hero numeral for the headline count, serif (Sanchez) treatment
//   - 0.5px hairline borders, no shadows, generous whitespace
//
// No hardcoded hex anywhere — colour values flow through CSS
// variables registered by Z-1, validated by the brand-token regression
// test in this commit.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { DeliveryWindowTrack } from "@/components/DeliveryWindowTrack";
import { HeroCount } from "@/components/HeroCount";
import { SearchBar } from "@/components/SearchBar";
import { StatusBadge } from "@/components/StatusBadge";
import { statusMeta } from "@/components/status-badge-recipe";
import {
  listSubscriptionsWithConsignee,
  type SubscriptionWithConsignee,
} from "@/modules/subscriptions";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SubscriptionsPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
  }>;
}

export default async function SubscriptionsPage({ searchParams }: SubscriptionsPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const query = (params.q ?? "").trim();

  let subscriptions: readonly SubscriptionWithConsignee[];
  let canCreate = false;
  try {
    const ctx = await buildRequestContext("/subscriptions", requestId);
    subscriptions = await listSubscriptionsWithConsignee(
      ctx,
      query.length > 0 ? { searchTerm: query } : {},
    );
    if (ctx.actor.kind === "user") {
      const perms = ctx.actor.permissions as ReadonlySet<Permission>;
      canCreate = perms.has("subscription:create") && perms.has("task:create");
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/subscriptions"));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-5xl px-12 py-16">
        <header className="mb-16 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Subscription planner
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Subscriptions</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Recurring delivery rules + ad-hoc tasks. Create new from here.
            </p>
          </div>
          {canCreate ? (
            <Link
              href="/subscriptions/new"
              className="inline-flex items-center justify-center rounded-sm border border-navy bg-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90"
            >
              New subscription
            </Link>
          ) : null}
        </header>

        {/* Component-lib rollout (audit H1 / 4b) — structural unification:
            the bespoke vertical hero (label-over-numeral, py-12, no tint)
            adopts the canonical <HeroCount> strip already used on /tasks +
            /consignees (numeral-left, label-right, tinted band). Visible
            change, not a zero-change swap; it brings subscriptions in line
            with the shared treatment. Session-A surface — structural only. */}
        <HeroCount
          count={subscriptions.length}
          label={query.length > 0 ? `Matching "${query}"` : "Total subscriptions"}
        />

        <SearchBar
          label="Search subscriptions by consignee name or order number"
          placeholder="Search by consignee name or order #"
        />

        {subscriptions.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <SubscriptionsTable rows={subscriptions} />
        )}
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------

// Phase 10 · Batch B2 — the operator subscriptions list adopts the shared
// <DataTable> (Gap C, B+ skin): floating card, never-wrap eyebrow headers, mono
// figures, the status-LED gutter, and the <DeliveryWindowTrack> signature cell —
// bringing the operator surface in line with the admin subscriptions table.
// Column order is preserved (Status-first) to avoid an information-architecture
// change; the bespoke dot+text status badge is retired for the canonical
// <StatusBadge domain="subscription"> per #558 Gap B.
const SUBSCRIPTION_COLUMNS: ReadonlyArray<DataTableColumn<SubscriptionWithConsignee>> = [
  {
    key: "status",
    header: "Status",
    cell: ({ subscription: s }) => <StatusBadge domain="subscription" status={s.status} />,
  },
  {
    key: "consignee",
    header: "Consignee",
    cell: ({ consigneeName }) => (
      <span className="font-b-display font-semibold text-navy">{consigneeName}</span>
    ),
    title: ({ consigneeName }) => consigneeName,
  },
  {
    key: "startDate",
    header: "Start date",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: ({ subscription: s }) => s.startDate,
  },
  {
    key: "days",
    header: "Days",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: ({ subscription: s }) => formatDays(s.daysOfWeek),
    title: ({ subscription: s }) => formatDays(s.daysOfWeek),
  },
  {
    key: "window",
    header: "Window",
    cell: ({ subscription: s }) => (
      <DeliveryWindowTrack
        start={s.deliveryWindowStart}
        end={s.deliveryWindowEnd}
        muted={s.status === "ended"}
      />
    ),
  },
];

function SubscriptionsTable({ rows }: { rows: readonly SubscriptionWithConsignee[] }) {
  return (
    <DataTable
      columns={SUBSCRIPTION_COLUMNS}
      rows={rows}
      getRowKey={({ subscription: s }) => s.id}
      rowHref={({ subscription: s }) => `/subscriptions/${s.id}`}
      led={({ subscription: s }) => statusMeta("subscription", s.status)?.tone}
      caption="Your subscriptions"
    />
  );
}

function EmptyState({ query }: { readonly query: string }) {
  if (query.length > 0) {
    return (
      <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
        <p className="text-base text-navy">
          No subscriptions match &quot;{query}&quot;.
        </p>
        <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
          Try searching by consignee name or order number.
        </p>
      </div>
    );
  }
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">No subscriptions yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Create your first via{" "}
        <code className="font-mono text-[color:var(--color-text-primary)]">
          POST /api/subscriptions
        </code>
        .
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Subscription planner
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the demo views.
        </p>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(days: readonly number[]): string {
  // ISO 1-7 → short labels. Order preserved as stored; the pilot
  // doesn't sort daysOfWeek arrays at the schema layer, so the UI
  // renders whatever sequence the operator provided.
  return days.map((d) => DAY_LABELS[d - 1] ?? `?${d}`).join(", ");
}

