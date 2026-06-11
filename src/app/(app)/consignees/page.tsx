// /consignees — operator subscriber-base list.
//
// Server component. Fetches via listConsignees through
// buildRequestContext. Full chain:
//
//   migration (0004) → repository (C-2) → service + audit (C-3)
//   → buildRequestContext (Day 10) → server-rendered HTML (this file)
//   → ConsigneesTable (server) + SearchBar (client) — Day-24
//
// Auth: UnauthorizedError redirects to /login.
//
// Day-24 search: ?q= URL param threaded into listConsignees as
// searchTerm; ILIKE runs server-side against name + digit-stripped
// phone. Replaces the Day-22 client-side filter so /tasks,
// /subscriptions, and /consignees share the same URL-state contract.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { SearchBar } from "@/components/SearchBar";
import {
  countConsigneesByTenant,
  listConsigneesWithTaskCount,
  type Consignee,
} from "@/modules/consignees";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";

import { ConsigneesTable } from "./_components/ConsigneesTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ConsigneesPageProps {
  readonly searchParams: Promise<{
    readonly q?: string;
  }>;
}

export default async function ConsigneesPage({ searchParams }: ConsigneesPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const query = (params.q ?? "").trim();

  let consignees: readonly (Consignee & { taskCount: number })[];
  let totalCount: number;
  let canOnboard = false;
  try {
    const ctx = await buildRequestContext("/consignees", requestId);
    const listOpts = query.length > 0 ? { searchTerm: query } : {};
    [consignees, totalCount] = await Promise.all([
      listConsigneesWithTaskCount(ctx, listOpts),
      countConsigneesByTenant(ctx, listOpts),
    ]);
    if (ctx.actor.kind === "user") {
      const perms = ctx.actor.permissions as ReadonlySet<Permission>;
      // Day-25 / brief v1.12 §3.3.1 — onboarding decoupled from
      // subscription creation. consignee:create alone is sufficient.
      canOnboard = perms.has("consignee:create");
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
            {totalCount}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {query.length > 0 ? `Matching "${query}"` : "Total consignees"}
          </p>
        </section>

        <SearchBar
          label="Search consignees by name or phone"
          placeholder="Search by name or phone"
        />

        <ConsigneesTable rows={consignees} query={query} />
      </div>
    </main>
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
