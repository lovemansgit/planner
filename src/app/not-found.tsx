// Day-53/54 NIGHT — branded not-found page (Tier-1 UI polish).
//
// Replaces the unbranded Next.js default 404. Renders inside the ROOT
// layout (fonts + brand tokens available) but OUTSIDE the (app) group,
// so it has no operator nav — a clean, on-brand dead-end with a single
// way back. Behavior is unchanged: unmatched routes still 404; this only
// styles what that 404 looks like.

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <p className="font-display text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        Subscription planner
      </p>
      <p className="mt-6 font-serif text-7xl font-light tabular-nums leading-none text-navy">
        404
      </p>
      <h1 className="mt-6 font-display text-2xl font-semibold tracking-tight text-navy">
        Page not found
      </h1>
      <p className="mt-3 max-w-sm text-sm text-[color:var(--color-text-secondary)]">
        That page doesn&rsquo;t exist or may have moved. Check the address, or head
        back to your consignees.
      </p>
      <Link
        href="/consignees"
        className="mt-8 inline-flex items-center rounded-sm border border-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-opacity duration-[120ms] ease-out hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
      >
        Back to consignees
      </Link>
    </main>
  );
}
