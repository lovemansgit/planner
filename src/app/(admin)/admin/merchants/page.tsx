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

import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { MerchantStatusModal } from "./_components/MerchantStatusModal";
import { statusAction, statusBadgeSurface } from "./_helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MerchantsAdminPage() {
  const requestId = randomUUID();

  let merchants: readonly Merchant[];
  try {
    const ctx = await buildRequestContext("/admin/merchants", requestId);
    merchants = await listMerchants(ctx);
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
              All merchants on the platform. Activate provisioning merchants when ready; deactivate
              live merchants to stop new task generation.
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
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Total merchants
          </p>
        </section>

        {merchants.length === 0 ? <EmptyState /> : <MerchantsTable rows={merchants} />}
      </div>
    </main>
  );
}

function MerchantsTable({ rows }: { rows: readonly Merchant[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Name</Th>
          <Th>Slug</Th>
          <Th>Status</Th>
          <Th>Created</Th>
          <Th>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <Row key={m.tenantId} merchant={m} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ merchant }: { merchant: Merchant }) {
  const badge = statusBadgeSurface(merchant.status);
  const action = statusAction(merchant.status);
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-b-0">
      <Td>
        <span className="font-medium text-navy">{merchant.name}</span>
      </Td>
      <Td className="font-mono text-xs tabular-nums text-[color:var(--color-text-secondary)]">
        {merchant.slug}
      </Td>
      <Td>
        <span
          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${badge.className}`}
        >
          {badge.label}
        </span>
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {formatCreatedAt(merchant.createdAt)}
      </Td>
      <Td>
        {action === null ? (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        ) : (
          <MerchantStatusModal
            tenantId={merchant.tenantId}
            merchantName={merchant.name}
            variant={action}
          />
        )}
      </Td>
    </tr>
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
      <p className="text-base text-navy">No merchants yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Create your first merchant to get started.
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
