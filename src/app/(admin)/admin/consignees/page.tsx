// Day 19 / Phase 1.5 — Transcorp-staff cross-tenant consignees list.
//
// Server component. Mirrors (admin)/admin/merchants/page.tsx shell;
// columns per merged plan §3.6: Merchant | Name | Phone | District |
// CRM State | Created. Sort: created_at DESC (repository-side).
//
// Reuses CrmStateBadge from operator-side
// (app)/consignees/[id]/_components/CrmStateBadge — cross-route import
// precedent established by PR #206 (PodIcon imported into consignees
// detail page).
//
// Brand-canon throughout — uses var(--color-...) tokens (brand v1.5+),
// NOT the legacy hex codes still on operator (app)/consignees/page.tsx
// (out-of-scope brand-pass per existing followup).
//
// Pagination added per Day-19 PR #213 §3.6 counter-review
// (UX-FINDING-2). Same v1.5 limitation as /admin/tasks: backend ships
// listAllConsignees with offset+limit only; "Page N of M" total
// deferred (see followup memo Lane D — countAll<X> aggregator).

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { CrmStateBadge } from "@/app/(app)/consignees/[id]/_components/CrmStateBadge";
import {
  ALLOWED_PAGE_SIZES,
  PAGE_SIZE_DEFAULT,
  parsePageParam,
  parsePerPageParam,
} from "@/app/(app)/tasks/status";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { SearchBar } from "@/components/SearchBar";
import {
  type AdminConsigneeRow,
  countAllConsignees,
  listAllConsignees,
} from "@/modules/consignees/service";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { formatPhone } from "@/shared/humanize";
import { buildRequestContext } from "@/shared/request-context";

import { AdminPageSizeDropdown } from "../../_components/AdminPageSizeDropdown";
import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";
import { shellClass } from "@/components/page-shell-recipe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminConsigneesPageProps {
  readonly searchParams: Promise<{
    readonly merchant?: string;
    readonly page?: string;
    readonly perPage?: string;
    readonly q?: string;
  }>;
}

export default async function AdminConsigneesPage({
  searchParams,
}: AdminConsigneesPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const merchantSlug =
    typeof params.merchant === "string" && params.merchant.length > 0
      ? params.merchant
      : undefined;
  const page = parsePageParam(params.page);
  const perPage = parsePerPageParam(params.perPage);
  const offset = (page - 1) * perPage;
  const q = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim() : undefined;

  let rows: readonly AdminConsigneeRow[];
  let merchants: readonly Merchant[];
  let totalCount: number;
  try {
    const ctx = await buildRequestContext("/admin/consignees", requestId);
    [rows, merchants, totalCount] = await Promise.all([
      listAllConsignees(ctx, { merchantSlug, limit: perPage, offset, searchTerm: q }),
      // Item 1: merchant-filter dropdown lists genuine merchants only —
      // automated-test tenants are never offered as a filter option.
      listMerchants(ctx, { excludeTestTenants: true }),
      countAllConsignees(ctx, { merchantSlug, searchTerm: q }),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/consignees"));
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
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Consignees</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            All consignees across the platform. Filter by merchant.
          </p>
        </header>

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-6 py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {totalCount}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {merchantSlug !== undefined || q !== undefined ? "Matching consignees" : "Total consignees"}
          </p>
        </section>

        <SearchBar
          placeholder="Search by name, phone, or merchant"
          label="Search consignees by name, phone, or merchant"
        />

        <div className="mb-8 flex flex-wrap items-end gap-6">
          <MerchantFilterDropdown
            merchants={dropdownMerchants}
            currentSlug={merchantSlug ?? null}
          />
          <AdminPageSizeDropdown value={perPage} options={ALLOWED_PAGE_SIZES} />
        </div>

        {rows.length === 0 ? (
          <EmptyState filtered={merchantSlug !== undefined || q !== undefined} />
        ) : (
          <ConsigneesTable rows={rows} />
        )}

        <Pagination
          page={page}
          hasNext={hasNext}
          merchantSlug={merchantSlug}
          perPage={perPage}
          q={q}
        />
      </div>
    </main>
  );
}

// Phase 10 · Batch B1 — the admin consignees list adopts the shared <DataTable>
// (Gap C, B+ skin): floating card, never-wrap eyebrow headers, mono figures,
// truncation, hover, mobile-overflow containment. Pure presentation — columns,
// order, the whole-row detail link, and the existing CrmStateBadge are all
// preserved (Item 3 row-link now lives in the component's rowHref). The status
// spine (LED gutter) is intentionally not lit here: the canonical crm tone map
// would clash with the preserved legacy CrmStateBadge (e.g. ON_HOLD), and the
// CRM badge has an in-flight vocab ruling — a future badge-adoption pass can
// swap CrmStateBadge→StatusBadge(crm) on list + detail together, then light it.
const CONSIGNEE_COLUMNS: ReadonlyArray<DataTableColumn<AdminConsigneeRow>> = [
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
  },
  {
    key: "name",
    header: "Name",
    cellClassName: "text-navy",
    cell: (row) => row.consignee.name,
    title: (row) => row.consignee.name,
  },
  {
    key: "phone",
    header: "Phone",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => formatPhone(row.consignee.phone),
    title: (row) => formatPhone(row.consignee.phone),
  },
  {
    key: "district",
    header: "District",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => row.consignee.district,
    title: (row) => row.consignee.district,
  },
  {
    key: "crmState",
    header: "CRM state",
    cell: (row) => <CrmStateBadge state={row.consignee.crmState} />,
  },
  {
    key: "created",
    header: "Created",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => row.consignee.createdAt.slice(0, 10),
  },
];

function ConsigneesTable({ rows }: { rows: readonly AdminConsigneeRow[] }) {
  return (
    <DataTable
      columns={CONSIGNEE_COLUMNS}
      rows={rows}
      getRowKey={(row) => row.consignee.id}
      rowHref={(row) => `/admin/consignees/${row.consignee.id}`}
      caption="All consignees across the platform"
    />
  );
}

function Pagination({
  page,
  hasNext,
  merchantSlug,
  perPage,
  q,
}: {
  readonly page: number;
  readonly hasNext: boolean;
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
  readonly q: string | undefined;
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
            href={buildAdminConsigneesHref({ merchantSlug, perPage, page: page - 1, q })}
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
            href={buildAdminConsigneesHref({ merchantSlug, perPage, page: page + 1, q })}
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

function buildAdminConsigneesHref({
  merchantSlug,
  perPage,
  page,
  q,
}: {
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
  readonly page: number;
  readonly q: string | undefined;
}): string {
  const params = new URLSearchParams();
  if (merchantSlug) params.set("merchant", merchantSlug);
  if (perPage !== PAGE_SIZE_DEFAULT) params.set("perPage", String(perPage));
  if (page > 1) params.set("page", String(page));
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `/admin/consignees?${qs}` : "/admin/consignees";
}

function EmptyState({ filtered }: { readonly filtered: boolean }) {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">
        {filtered ? "No consignees match the current filters." : "No consignees on this page."}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {filtered ? "Clear the search or merchant filter to see everything." : "Try a previous page."}
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
