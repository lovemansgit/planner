// Day 11 / P4 — landing page (`/`) for the operator UI.
//
// Workflow shortcut, not metrics dashboard. Two link cards directing
// to the highest-frequency operator destinations (Today's tasks +
// Failed pushes), gated by permission. No service-layer fetches —
// keeps TTFB tight and avoids the permission-error surface area on
// the home page.
//
// Brand: matches /admin/webhook-config and /admin/failed-pushes.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { type LandingCard, visibleLandingCards } from "./nav-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LandingPage() {
  const requestId = randomUUID();

  let cards: readonly LandingCard[];
  let greeting: string;
  try {
    const ctx = await buildRequestContext("/", requestId);
    if (ctx.actor.kind !== "user") {
      throw new UnauthorizedError("non-user actor in operator UI");
    }
    cards = visibleLandingCards(ctx.actor.permissions);
    greeting = ctx.actor.displayName ?? ctx.actor.email ?? "operator";
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Subscription planner
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Signed in as {greeting}.
          </p>
        </header>

        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {cards.map((card) => (
              <Link
                key={card.path}
                href={card.path}
                className="block border border-[color:var(--color-border-strong)] p-8 transition-opacity hover:opacity-80"
              >
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
                  Shortcut
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight">{card.label}</h2>
                <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
                  {card.description}
                </p>
                <p className="mt-6 text-xs uppercase tracking-[0.2em] text-navy">View →</p>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">Nothing actionable yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Your role does not currently grant any landing-page shortcuts. Use the navigation above.
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Subscription planner
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the operator views.
        </p>
      </div>
    </main>
  );
}
