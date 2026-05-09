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
// V1.5 Consignee column simplification: AdminSubscriptionRow shape is
// { subscription, merchant } — no consignee details JOINed. Renders
// the consignee_id short (8 chars) like operator /subscriptions does.
// Phase-1.5.1 follow-up if Transcorp staff demand consignee names
// inline (would extend the backend AdminSubscriptionRow shape).
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
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  type AdminSubscriptionRow,
  listAllSubscriptions,
} from "@/modules/subscriptions/service";
import type { Subscription } from "@/modules/subscriptions/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { AdminPageSizeDropdown } from "../../_components/AdminPageSizeDropdown";
import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";

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
      listMerchants(ctx),
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
      <div className="mx-auto max-w-6xl px-12 py-16">
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

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {rows.length}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {merchantSlug ? "Filtered (this page)" : "On this page"}
          </p>
        </section>

        {rows.length === 0 ? (
          <EmptyState filtered={merchantSlug !== undefined} />
        ) : (
          <SubscriptionsTable rows={rows} />
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

function SubscriptionsTable({ rows }: { rows: readonly AdminSubscriptionRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Merchant</Th>
          <Th>Consignee</Th>
          <Th>Status</Th>
          <Th>Cadence</Th>
          <Th>Window</Th>
          <Th>Start date</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.subscription.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row }: { row: AdminSubscriptionRow }) {
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-b-0">
      <Td>
        <span className="font-medium text-navy">{row.merchant.name}</span>
        <span className="ml-2 text-[color:var(--color-text-tertiary)] font-mono text-xs tabular-nums">
          {row.merchant.slug}
        </span>
      </Td>
      <Td className="font-mono text-xs tabular-nums text-[color:var(--color-text-secondary)]">
        {shortId(row.subscription.consigneeId)}
      </Td>
      <Td>
        <StatusBadge status={row.subscription.status} />
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {formatDays(row.subscription.daysOfWeek)}
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {row.subscription.deliveryWindowStart.slice(0, 5)} – {row.subscription.deliveryWindowEnd.slice(0, 5)}
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {row.subscription.startDate}
      </Td>
    </tr>
  );
}

function StatusBadge({ status }: { status: Subscription["status"] }) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-green">
          <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden />
          Active
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
          Paused
        </span>
      );
    case "ended":
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-tertiary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-text-tertiary)]" aria-hidden />
          Ended
        </span>
      );
  }
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

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-4 align-middle ${className}`}>{children}</td>;
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
