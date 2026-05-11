// /consignees — operator subscriber-base list.
//
// Server component. Fetches via listConsignees through
// buildRequestContext. Full chain:
//
//   migration (0004) → repository (C-2) → service + audit (C-3)
//   → buildRequestContext (Day 10) → server-rendered HTML (this file)
//   → ConsigneesSearchableTable client wrapper (Day-22 fixup)
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
// Day-22 fixup per PR #238 §3.22:
//   - Onboard CTA in header (gated on consignee:create +
//     subscription:create)
//   - Client-side search by name / phone via
//     ConsigneesSearchableTable wrapper
//   - Inline ConsigneesTable / Th / Td / EmptyState helpers moved
//     into the client component (single source of truth)

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { listConsignees, type Consignee } from "@/modules/consignees";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";

import { ConsigneesSearchableTable } from "./_components/ConsigneesSearchableTable";

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

        <ConsigneesSearchableTable rows={consignees} />
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
