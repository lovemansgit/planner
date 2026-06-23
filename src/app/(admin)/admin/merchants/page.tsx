// Day 18 / C1 — Transcorp-staff merchant list page.
//
// Server component. Mirrors the (app)/admin/failed-pushes pattern:
// SSR fetches via direct service-layer call, no /api round-trip.
// `listMerchants` enforces `merchant:read_all` via requirePermission;
// ForbiddenError surfaces here as a redirect to `/` (matches the
// brief §3.2.2 "merchant operators get 403" rule — they don't see the
// admin surface).
//
// Brand-canon mirror of failed-pushes:
//   - bg-surface-primary; text-navy; var(--color-...) tokens
//   - 0.5px hairline borders, no shadows
//   - font-serif tabular-nums for the hero count
//   - Sentence case throughout
//
// No client query state. Activate/deactivate happens via the
// MerchantStatusModal (client) which posts a server action; the
// action revalidates this page so the table re-renders.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { SearchBar } from "@/components/SearchBar";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { MerchantStatusModal } from "./_components/MerchantStatusModal";
import {
  selectMerchantListFilters,
  statusAction,
  statusBadgeSurface,
} from "./_helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MerchantsAdminPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
  }>;
}

export default async function MerchantsAdminPage({
  searchParams,
}: MerchantsAdminPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const q = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim() : undefined;

  let merchants: readonly Merchant[];
  try {
    const ctx = await buildRequestContext("/admin/merchants", requestId);
    // Item 1: genuine-only view, always. Automated-test tenants are
    // never surfaced here — the "Show all" toggle was removed per Love's
    // "never visible, not even at the click of a button" ruling.
    merchants = await listMerchants(ctx, selectMerchantListFilters({ searchTerm: q }));
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/merchants"));
    }
    if (err instanceof ForbiddenError) {
      // Tenant operators (no merchant:read_all) get bounced to home;
      // brief §3.2.2 "merchant operators get 403" semantics — no
      // exposure of the admin surface to non-staff actors.
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const countLabel = q !== undefined ? "Matching merchants" : "Genuine merchants";

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12 flex items-end justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Merchants</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Genuine merchants on the platform. Automated-test tenants and archived rows are
              never shown. Activate provisioning merchants when ready; deactivate live merchants
              to stop new task generation.
            </p>
          </div>
          <Link
            href="/admin/merchants/new"
            className="inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
          >
            + New merchant
          </Link>
        </header>

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-6 py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {merchants.length}
          </p>
          <div className="flex flex-col items-end gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              {countLabel}
            </p>
          </div>
        </section>

        <SearchBar
          placeholder="Search by name or slug"
          label="Search merchants by name or slug"
        />

        {merchants.length === 0 ? (
          <EmptyState filtered={q !== undefined} />
        ) : (
          <MerchantsTable rows={merchants} />
        )}
      </div>
    </main>
  );
}

// Phase 10 · Batch B1 — the admin merchants list adopts the shared <DataTable>
// (Gap C, B+ skin): floating card, never-wrap eyebrow headers, mono figures,
// truncation, hover, mobile-overflow containment. Pure presentation — columns,
// order, the whole-row detail link (PR #270 §9.3), the local status badge
// (statusBadgeSurface), and the Actions cell (MerchantStatusModal / "—" / no
// row-link) are all preserved. No LED status-spine: TenantStatus has no
// canonical StatusBadge tone-domain, so the existing local badge stays as-is.
const MERCHANT_COLUMNS: ReadonlyArray<DataTableColumn<Merchant>> = [
  {
    key: "name",
    header: "Name",
    cellClassName: "font-b-display font-semibold text-navy",
    cell: (m) => m.name,
    title: (m) => m.name,
  },
  {
    key: "slug",
    header: "Slug",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (m) => m.slug,
    title: (m) => m.slug,
  },
  {
    key: "status",
    header: "Status",
    cell: (m) => {
      const badge = statusBadgeSurface(m.status);
      return (
        <span
          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${badge.className}`}
        >
          {badge.label}
        </span>
      );
    },
  },
  {
    key: "created",
    header: "Created",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (m) => formatCreatedAt(m.createdAt),
  },
  {
    key: "actions",
    header: "Actions",
    noRowLink: true,
    cell: (m) => {
      const action = statusAction(m.status);
      return action === null ? (
        <span className="text-[color:var(--color-text-tertiary)]">—</span>
      ) : (
        <MerchantStatusModal
          tenantId={m.tenantId}
          merchantName={m.name}
          variant={action}
        />
      );
    },
  },
];

function MerchantsTable({ rows }: { rows: readonly Merchant[] }) {
  return (
    <DataTable
      columns={MERCHANT_COLUMNS}
      rows={rows}
      getRowKey={(m) => m.tenantId}
      rowHref={(m) => `/admin/merchants/${m.tenantId}`}
      caption="Genuine merchants on the platform"
    />
  );
}

/**
 * Render a UTC ISO timestamp as `YYYY-MM-DD`. Operator-facing format
 * intentionally drops time-of-day — created-at granularity isn't
 * load-bearing for the admin list view; the date is enough to scan
 * for ordering.
 */
function formatCreatedAt(iso: string): string {
  return iso.slice(0, 10);
}

function EmptyState({ filtered }: { readonly filtered: boolean }) {
  const headline = filtered
    ? "No merchants match the search."
    : "No genuine merchants to show.";
  const detail = filtered
    ? "Clear the search to see all merchants."
    : "Create your first merchant to get started.";
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">{headline}</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">{detail}</p>
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
