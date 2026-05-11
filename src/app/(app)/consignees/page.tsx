// /consignees — read-only list view.
//
// Server component. Fetches via the C-3 service path through
// buildRequestContext. Full chain exercised end-to-end:
//
//   migration (0004) → repository (C-2) → service + audit (C-3)
//   → buildRequestContext (Day 10) → server-rendered HTML (this file)
//
// Auth: UnauthorizedError redirects to /login.
//
// Transcorp design language:
//   - Background: var(--color-surface-primary) (warm off-white #FAF8F4)
//   - Foreground: var(--color-navy) (#252d60)
//   - 0.5px hairline borders, no shadows
//   - Sentence case throughout
//   - Hero numeral for the headline count
//   - Generous whitespace (px-12 py-16, mb-12, etc.)
//
// Edit / create / delete UI is intentionally absent — those land Day 4
// or later. The empty-state copy directs operators to the API for now.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { listConsignees, type Consignee } from "@/modules/consignees";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";

import { CrmStateBadge } from "./[id]/_components/CrmStateBadge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConsigneesPage() {
  const requestId = randomUUID();

  let consignees: readonly Consignee[];
  let canOnboard = false;
  try {
    const ctx = await buildRequestContext("/consignees", requestId);
    consignees = await listConsignees(ctx);
    // Onboard CTA gating per Day-19 §J-5: createConsigneeWithSubscription
    // requires both consignee:create AND subscription:create. Hide the
    // CTA when either is missing (no greyed-out state; brief §3.3.10 r1).
    if (ctx.actor.kind === "user") {
      const perms = ctx.actor.permissions as ReadonlySet<Permission>;
      canOnboard = perms.has("consignee:create") && perms.has("subscription:create");
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/consignees"));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy">
      <div className="mx-auto max-w-5xl px-12 py-16">
        <header className="mb-16 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Subscription planner
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Consignees</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Subscriber base. Onboard new consignees from here.
            </p>
          </div>
          {canOnboard ? (
            <Link
              href="/consignees/new"
              className="inline-flex items-center justify-center rounded-sm border border-navy bg-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90"
            >
              Onboard new consignee
            </Link>
          ) : null}
        </header>

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-6 py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {consignees.length}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">Total consignees</p>
        </section>

        {consignees.length === 0 ? <EmptyState /> : <ConsigneesTable rows={consignees} />}
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------

function ConsigneesTable({ rows }: { rows: readonly Consignee[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Name</Th>
          <Th>Phone</Th>
          <Th>Emirate</Th>
          <Th>CRM state</Th>
          <Th>Address</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-b border-[color:var(--color-border-default)] last:border-b-0 transition-colors hover:bg-ivory">
            <Td>
              <Link href={`/consignees/${c.id}`} className="text-navy hover:underline">
                {c.name}
              </Link>
            </Td>
            <Td className="tabular-nums">{c.phone}</Td>
            <Td>{c.emirateOrRegion}</Td>
            <Td>
              <CrmStateBadge state={c.crmState} />
            </Td>
            <Td className="max-w-xs truncate" title={c.addressLine}>
              {c.addressLine}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`py-5 align-top ${className}`} title={title}>
      {children}
    </td>
  );
}

function EmptyState() {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">No consignees yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Add your first via <code className="font-mono text-[color:var(--color-text-secondary)]">POST /api/consignees</code>.
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy">
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
