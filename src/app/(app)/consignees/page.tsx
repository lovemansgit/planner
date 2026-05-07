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
//   - Background: warm off-white #FAF7F2
//   - Foreground: deep navy #0B1F3A
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

import { CrmStateBadge } from "./[id]/_components/CrmStateBadge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConsigneesPage() {
  const requestId = randomUUID();

  let consignees: readonly Consignee[];
  try {
    const ctx = await buildRequestContext("/consignees", requestId);
    consignees = await listConsignees(ctx);
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
    <main className="min-h-screen bg-[#FAF7F2] text-[#0B1F3A]">
      <div className="mx-auto max-w-5xl px-12 py-16">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[#0B1F3A]/60">
            Subscription planner
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Consignees</h1>
          <p className="mt-3 text-sm text-[#0B1F3A]/70">
            Read-only demo view, scoped to the first tenant in the database.
          </p>
        </header>

        <section className="mb-16 border-t border-b border-[#0B1F3A]/15 py-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[#0B1F3A]/60">Total consignees</p>
          <p className="mt-4 text-7xl font-light tabular-nums leading-none">
            {consignees.length}
          </p>
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
        <tr className="border-b border-[#0B1F3A]/15">
          <Th>Name</Th>
          <Th>Phone</Th>
          <Th>Emirate</Th>
          <Th>CRM state</Th>
          <Th>Address</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-b border-[#0B1F3A]/10 last:border-b-0 transition-colors hover:bg-ivory">
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
    <th className="py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[#0B1F3A]/60">
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
    <div className="border-t border-b border-[#0B1F3A]/15 py-16 text-center">
      <p className="text-base text-[#0B1F3A]">No consignees yet.</p>
      <p className="mt-3 text-sm text-[#0B1F3A]/60">
        Add your first via <code className="font-mono text-[#0B1F3A]/80">POST /api/consignees</code>.
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-[#FAF7F2] text-[#0B1F3A]">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[#0B1F3A]/60">
          Subscription planner
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[#0B1F3A]/70">
          No tenants are configured. Onboard at least one tenant before using the demo views.
        </p>
      </div>
    </main>
  );
}
