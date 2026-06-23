// Day 26 / T3 Sub-PR 3 — Transcorp-staff SuiteFleet regions list page.
//
// Server component. Mirrors merchants/page.tsx posture:
//   - buildRequestContext + listRegionsWithUsage preflight
//   - UnauthorizedError      → redirect /login
//   - ForbiddenError         → redirect / (merchant operators don't see admin)
//   - NoTenantConfiguredError→ render SystemNotInitialised inline
//
// Columns per v1.15 plan amendment §7.1:
//   Display Name · Client ID (mono) · Auth Method (badge: OAuth/API Key)
//   · Status (badge) · In-Use Count · Created · Actions (DEACTIVATE row)
//
// Sort: static alphabetical by display_name ASC per ratified OQ-7.
// ACTIVATE is intentionally omitted (Sub-PR 2's deactivateRegion is
// PLAN-STRICT active→inactive; reactivation is out of v1 scope).
// Inactive rows render "—" in the actions column.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { listRegionsWithUsage, type RegionWithUsage } from "@/modules/credentials";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { RegionDeactivateModal } from "./_components/RegionDeactivateModal";
import { authMethodBadge, regionStatusBadge } from "./_helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RegionsAdminPage() {
  const requestId = randomUUID();

  let regions: readonly RegionWithUsage[];
  try {
    const ctx = await buildRequestContext("/admin/regions", requestId);
    regions = await listRegionsWithUsage(ctx);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/regions"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12 flex items-end justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">SuiteFleet regions</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Per-region routing configuration. Each merchant is routed via its assigned region —
              the region&rsquo;s authentication method governs how the merchant&rsquo;s credentials authenticate
              against SuiteFleet.
            </p>
          </div>
          <Link
            href="/admin/regions/new"
            className="inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
          >
            + New region
          </Link>
        </header>

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-6 py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {regions.length}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Total regions
          </p>
        </section>

        {regions.length === 0 ? <EmptyState /> : <RegionsTable rows={regions} />}
      </div>
    </main>
  );
}

// Phase 10 · Batch B1 — the admin SuiteFleet-regions list adopts the shared
// <DataTable> (Gap C, B+ skin): floating card, never-wrap eyebrow headers, mono
// figures, truncation, hover, mobile-overflow containment. Pure presentation —
// the seven columns + order, the static display_name ASC sort, the whole-row
// detail link, both local badges (authMethodBadge, regionStatusBadge), and the
// Actions cell (RegionDeactivateModal when active / "—" / no row-link) are all
// preserved. No LED status-spine: region status/auth have no canonical
// StatusBadge tone-domain, so the existing local badges stay as-is.
const REGION_COLUMNS: ReadonlyArray<DataTableColumn<RegionWithUsage>> = [
  {
    key: "displayName",
    header: "Display name",
    cellClassName: "font-b-display font-semibold text-navy",
    cell: (r) => r.displayName,
    title: (r) => r.displayName,
  },
  {
    key: "clientId",
    header: "Client ID",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (r) => r.clientId,
    title: (r) => r.clientId,
  },
  {
    key: "authMethod",
    header: "Auth method",
    cell: (r) => {
      const auth = authMethodBadge(r.authMethod);
      return (
        <span
          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${auth.className}`}
        >
          {auth.label}
        </span>
      );
    },
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => {
      const status = regionStatusBadge(r.status);
      return (
        <span
          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${status.className}`}
        >
          {status.label}
        </span>
      );
    },
  },
  {
    key: "inUse",
    header: "In use",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (r) => r.inUseCount,
  },
  {
    key: "created",
    header: "Created",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (r) => formatCreatedAt(r.createdAt),
  },
  {
    key: "actions",
    header: "Actions",
    noRowLink: true,
    cell: (r) =>
      r.status === "active" ? (
        <RegionDeactivateModal
          regionId={r.id}
          regionDisplayName={r.displayName}
          inUseCount={r.inUseCount}
        />
      ) : (
        <span className="text-[color:var(--color-text-tertiary)]">—</span>
      ),
  },
];

function RegionsTable({ rows }: { rows: readonly RegionWithUsage[] }) {
  return (
    <DataTable
      columns={REGION_COLUMNS}
      rows={rows}
      getRowKey={(r) => r.id}
      rowHref={(r) => `/admin/regions/${r.id}`}
      caption="SuiteFleet regions"
    />
  );
}

function formatCreatedAt(iso: string): string {
  return iso.slice(0, 10);
}

function EmptyState() {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">No SuiteFleet regions yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Create the first region to start routing merchants.
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
