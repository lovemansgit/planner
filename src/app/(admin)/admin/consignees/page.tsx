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
// No pagination in v1.5 — mirrors operator /consignees. If demo data
// volume warrants, follow-up PR adds it (same structure as
// /admin/tasks pagination).

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { CrmStateBadge } from "@/app/(app)/consignees/[id]/_components/CrmStateBadge";
import {
  type AdminConsigneeRow,
  listAllConsignees,
} from "@/modules/consignees/service";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminConsigneesPageProps {
  readonly searchParams: Promise<{ readonly merchant?: string }>;
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

  let rows: readonly AdminConsigneeRow[];
  let merchants: readonly Merchant[];
  try {
    const ctx = await buildRequestContext("/admin/consignees", requestId);
    [rows, merchants] = await Promise.all([
      listAllConsignees(ctx, { merchantSlug }),
      listMerchants(ctx),
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

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Consignees</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            All consignees across the platform. Filter by merchant.
          </p>
        </header>

        <div className="mb-8 flex flex-wrap items-end gap-6">
          <MerchantFilterDropdown
            merchants={dropdownMerchants}
            currentSlug={merchantSlug ?? null}
          />
        </div>

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {rows.length}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {merchantSlug ? "Filtered consignees" : "Total consignees"}
          </p>
        </section>

        {rows.length === 0 ? (
          <EmptyState filtered={merchantSlug !== undefined} />
        ) : (
          <ConsigneesTable rows={rows} />
        )}
      </div>
    </main>
  );
}

function ConsigneesTable({ rows }: { rows: readonly AdminConsigneeRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Merchant</Th>
          <Th>Name</Th>
          <Th>Phone</Th>
          <Th>District</Th>
          <Th>CRM state</Th>
          <Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.consignee.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row }: { row: AdminConsigneeRow }) {
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-b-0">
      <Td>
        <span className="font-medium text-navy">{row.merchant.name}</span>
        <span className="ml-2 text-[color:var(--color-text-tertiary)] font-mono text-xs tabular-nums">
          {row.merchant.slug}
        </span>
      </Td>
      <Td className="text-navy">{row.consignee.name}</Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {row.consignee.phone}
      </Td>
      <Td className="text-[color:var(--color-text-secondary)]">{row.consignee.district}</Td>
      <Td>
        <CrmStateBadge state={row.consignee.crmState} />
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {row.consignee.createdAt.slice(0, 10)}
      </Td>
    </tr>
  );
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
        {filtered ? "No consignees match the merchant filter." : "No consignees yet."}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {filtered ? "Reset to All merchants to see everything." : "Onboard a merchant and seed consignees to see them here."}
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
