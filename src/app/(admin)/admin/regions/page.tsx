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

function RegionsTable({ rows }: { rows: readonly RegionWithUsage[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Display name</Th>
          <Th>Client ID</Th>
          <Th>Auth method</Th>
          <Th>Status</Th>
          <Th>In use</Th>
          <Th>Created</Th>
          <Th>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row key={r.id} region={r} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ region }: { region: RegionWithUsage }) {
  const status = regionStatusBadge(region.status);
  const auth = authMethodBadge(region.authMethod);
  const detailHref = `/admin/regions/${region.id}`;
  return (
    <tr className="cursor-pointer border-b border-[color:var(--color-border-default)] transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-ivory">
      <Td>
        <Link href={detailHref} className="block font-medium text-navy">
          {region.displayName}
        </Link>
      </Td>
      <Td className="font-mono text-xs tabular-nums text-[color:var(--color-text-secondary)]">
        <Link href={detailHref} className="block">
          {region.clientId}
        </Link>
      </Td>
      <Td>
        <Link href={detailHref} className="block">
          <span
            className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${auth.className}`}
          >
            {auth.label}
          </span>
        </Link>
      </Td>
      <Td>
        <Link href={detailHref} className="block">
          <span
            className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${status.className}`}
          >
            {status.label}
          </span>
        </Link>
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        <Link href={detailHref} className="block">
          {region.inUseCount}
        </Link>
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        <Link href={detailHref} className="block">
          {formatCreatedAt(region.createdAt)}
        </Link>
      </Td>
      <Td>
        {region.status === "active" ? (
          <RegionDeactivateModal
            regionId={region.id}
            regionDisplayName={region.displayName}
            inUseCount={region.inUseCount}
          />
        ) : (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        )}
      </Td>
    </tr>
  );
}

function formatCreatedAt(iso: string): string {
  return iso.slice(0, 10);
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
