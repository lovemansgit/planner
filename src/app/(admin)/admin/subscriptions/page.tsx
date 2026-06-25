// Day 19 / Phase 1.5 — Transcorp-staff cross-tenant subscriptions list.
//
// Server component. Mirrors (admin)/admin/merchants/page.tsx shell;
// columns per merged plan §3.6: Merchant | Consignee | Status |
// Cadence | Window | Start date. Sort: created_at DESC (repository).
//
// Status badge: local component mirroring operator /subscriptions
// shape (active=green dot, paused=amber dot, ended=tertiary dot).
//
// Cadence column: daysOfWeek (ISO 1-7) → human-readable abbreviated
// labels via DAY_LABELS — same DAY_LABELS shape as operator side.
//
// V1.5.1 (D57): the Consignee column shows the consignee NAME. AdminSubscriptionRow
// now carries `consigneeName` (listAllSubscriptionsRows JOINs consignees, mirroring
// the operator listSubscriptionsWithConsignee path) — the raw consignee_id 8-char
// prefix it rendered before was unreadable to staff.
//
// Pagination added per Day-19 PR #213 §3.6 counter-review
// (UX-FINDING-2). Same v1.5 limitation as /admin/tasks: backend ships
// listAllSubscriptions with offset+limit only; "Page N of M" total
// deferred (see followup memo Lane D — countAll<X> aggregator).

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import {
  ALLOWED_PAGE_SIZES,
  PAGE_SIZE_DEFAULT,
  parsePageParam,
  parsePerPageParam,
} from "@/app/(app)/tasks/status";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { DeliveryWindowTrack } from "@/components/DeliveryWindowTrack";
import { StatusBadge } from "@/components/StatusBadge";
import { statusMeta } from "@/components/status-badge-recipe";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  type AdminSubscriptionRow,
  listAllSubscriptions,
} from "@/modules/subscriptions/service";

import { MaterializeButton } from "./_components/MaterializeButton";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { AdminPageSizeDropdown } from "../../_components/AdminPageSizeDropdown";
import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";
import { shellClass, tableBleedClass } from "@/components/page-shell-recipe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminSubscriptionsPageProps {
  readonly searchParams: Promise<{
    readonly merchant?: string;
    readonly page?: string;
    readonly perPage?: string;
  }>;
}

export default async function AdminSubscriptionsPage({
  searchParams,
}: AdminSubscriptionsPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const merchantSlug =
    typeof params.merchant === "string" && params.merchant.length > 0
      ? params.merchant
      : undefined;
  const page = parsePageParam(params.page);
  const perPage = parsePerPageParam(params.perPage);
  const offset = (page - 1) * perPage;

  let rows: readonly AdminSubscriptionRow[];
  let merchants: readonly Merchant[];
  try {
    const ctx = await buildRequestContext("/admin/subscriptions", requestId);
    [rows, merchants] = await Promise.all([
      listAllSubscriptions(ctx, { merchantSlug, limit: perPage, offset }),
      // Item 1: merchant-filter dropdown lists genuine merchants only —
      // automated-test tenants are never offered as a filter option.
      listMerchants(ctx, { excludeTestTenants: true }),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/subscriptions"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const dropdownMerchants = merchants.map((m) => ({
    slug: m.slug,
    name: m.name,
    status: m.status,
  }));
  const hasNext = rows.length === perPage;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className={shellClass("py-16")}>
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            All subscriptions across the platform. Filter by merchant.
          </p>
        </header>

        <div className="mb-8 flex flex-wrap items-end gap-6">
          <MerchantFilterDropdown
            merchants={dropdownMerchants}
            currentSlug={merchantSlug ?? null}
          />
          <AdminPageSizeDropdown value={perPage} options={ALLOWED_PAGE_SIZES} />
        </div>

        {rows.length === 0 ? (
          <EmptyState filtered={merchantSlug !== undefined} />
        ) : (
          // Item 6 — bleed the table region into the right gutter (left edge
          // stays on the shared shellClass edge); the header/filters above stay
          // narrow.
          <div className={tableBleedClass()}>
            <SubscriptionsTable rows={rows} />
          </div>
        )}

        <Pagination
          page={page}
          hasNext={hasNext}
          merchantSlug={merchantSlug}
          perPage={perPage}
        />
      </div>
    </main>
  );
}

// Phase 9 · 3.4 — the admin subscriptions list adopts the shared <DataTable>
// (Gap C, B+ skin): floating card, never-wrap headers, mono figures, the
// status-LED gutter, and the delivery-window track. The Consignee column keeps
// the v1.5.1 NAME render (#556); the Actions cell keeps the MaterializeButton
// (#574) and opts out of the row link. Column order is preserved from the
// pre-B+ table (status-first ordering is an available refinement, not taken
// here to avoid an information-architecture change).
const SUBSCRIPTION_COLUMNS: ReadonlyArray<DataTableColumn<AdminSubscriptionRow>> = [
  {
    key: "merchant",
    header: "Merchant",
    cell: (row) => (
      <>
        <span className="font-b-display font-semibold text-navy">{row.merchant.name}</span>
        <span className="ml-2 font-b-mono text-xs tabular-nums text-[color:var(--color-text-tertiary)]">
          {row.merchant.slug}
        </span>
      </>
    ),
    title: (row) => `${row.merchant.name} · ${row.merchant.slug}`,
    copyable: true,
  },
  {
    key: "consignee",
    header: "Consignee",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => row.consigneeName,
    title: (row) => row.consigneeName,
    copyable: true,
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => <StatusBadge domain="subscription" status={row.subscription.status} />,
  },
  {
    key: "cadence",
    header: "Cadence",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => formatDays(row.subscription.daysOfWeek),
    title: (row) => formatDays(row.subscription.daysOfWeek),
  },
  {
    key: "window",
    header: "Delivery window",
    cell: (row) => (
      <DeliveryWindowTrack
        start={row.subscription.deliveryWindowStart}
        end={row.subscription.deliveryWindowEnd}
        muted={row.subscription.status === "ended"}
      />
    ),
  },
  {
    key: "startDate",
    header: "Start date",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => row.subscription.startDate,
  },
  {
    key: "actions",
    header: "Actions",
    srHeader: true,
    align: "right",
    noRowLink: true,
    // This table overflows the shared content width on desktop; pin the
    // Materialize action to the card's right edge so it stays visible and
    // clickable while the rest of the row scrolls beneath it (Phase 12.1).
    stickyRight: true,
    cell: (row) =>
      row.subscription.status === "active" ? (
        <MaterializeButton subscriptionId={row.subscription.id} />
      ) : null,
  },
];

function SubscriptionsTable({ rows }: { rows: readonly AdminSubscriptionRow[] }) {
  return (
    <DataTable
      columns={SUBSCRIPTION_COLUMNS}
      rows={rows}
      getRowKey={(row) => row.subscription.id}
      rowHref={(row) => `/admin/subscriptions/${row.subscription.id}`}
      led={(row) => statusMeta("subscription", row.subscription.status)?.tone}
      caption="All subscriptions across the platform"
    />
  );
}

function Pagination({
  page,
  hasNext,
  merchantSlug,
  perPage,
}: {
  readonly page: number;
  readonly hasNext: boolean;
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
}) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex items-center justify-between border-t border-[color:var(--color-border-default)] pt-6"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        Page {page}
      </p>
      <div className="flex gap-3">
        {page > 1 ? (
          <Link
            href={buildAdminSubscriptionsHref({ merchantSlug, perPage, page: page - 1 })}
            className="text-xs uppercase tracking-[0.2em] text-navy hover:opacity-80"
          >
            ← Previous
          </Link>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-tertiary)]">
            ← Previous
          </span>
        )}
        {hasNext ? (
          <Link
            href={buildAdminSubscriptionsHref({ merchantSlug, perPage, page: page + 1 })}
            className="text-xs uppercase tracking-[0.2em] text-navy hover:opacity-80"
          >
            Next →
          </Link>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-tertiary)]">
            Next →
          </span>
        )}
      </div>
    </nav>
  );
}

function buildAdminSubscriptionsHref({
  merchantSlug,
  perPage,
  page,
}: {
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
  readonly page: number;
}): string {
  const params = new URLSearchParams();
  if (merchantSlug) params.set("merchant", merchantSlug);
  if (perPage !== PAGE_SIZE_DEFAULT) params.set("perPage", String(perPage));
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin/subscriptions?${qs}` : "/admin/subscriptions";
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(days: readonly number[]): string {
  return days.map((d) => DAY_LABELS[d - 1] ?? `?${d}`).join(", ");
}

function EmptyState({ filtered }: { readonly filtered: boolean }) {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">
        {filtered ? "No subscriptions match the merchant filter." : "No subscriptions on this page."}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {filtered
          ? "Reset to All merchants to see everything."
          : "Try a previous page."}
      </p>
    </div>
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
