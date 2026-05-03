// /subscriptions — read-only list view, Day-6 demo artifact.
//
// Server component. Mirrors the Day-3 /consignees page architecture
// (full chain: RLS + permission check → service layer → server-
// rendered HTML) but uses the Z-1 brand tokens introduced in Day 6
// rather than hard-coded hex values. Future brand-team corrections
// land as a CSS-variable swap in src/styles/brand-tokens.css, not as
// a sweep through component code.
//
// Design language (matches Z-1 brand tokens):
//   - Background:   var(--color-surface-primary)   (warm off-white)
//   - Foreground:   var(--color-navy)              (deep navy)
//   - Tints:        var(--color-text-{secondary|tertiary})
//                   var(--color-border-{default|strong})
//   - Sentence case throughout
//   - Hero numeral for the headline count, serif (Sanchez) treatment
//   - 0.5px hairline borders, no shadows, generous whitespace
//
// No hardcoded hex anywhere — colour values flow through CSS
// variables registered by Z-1, validated by the brand-token regression
// test in this commit.

import { randomUUID } from "node:crypto";

import { listSubscriptions, type Subscription } from "@/modules/subscriptions";
import { buildDemoContext } from "@/shared/demo-context";
import { NoTenantConfiguredError } from "@/shared/errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SubscriptionsPage() {
  const requestId = randomUUID();

  let subscriptions: readonly Subscription[];
  try {
    const ctx = await buildDemoContext("/subscriptions", requestId);
    subscriptions = await listSubscriptions(ctx);
  } catch (err) {
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-5xl px-12 py-16">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Subscription planner
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Read-only demo view, scoped to the first tenant in the database.
          </p>
        </header>

        <section className="mb-16 border-t border-b border-[color:var(--color-border-strong)] py-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Total subscriptions
          </p>
          <p className="mt-4 font-serif text-7xl font-light tabular-nums leading-none">
            {subscriptions.length}
          </p>
        </section>

        {subscriptions.length === 0 ? (
          <EmptyState />
        ) : (
          <SubscriptionsTable rows={subscriptions} />
        )}
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------------

function SubscriptionsTable({ rows }: { rows: readonly Subscription[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Status</Th>
          <Th>Consignee</Th>
          <Th>Start date</Th>
          <Th>Days</Th>
          <Th>Window</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr
            key={s.id}
            className="border-b border-[color:var(--color-border-default)] last:border-b-0"
          >
            <Td>
              <StatusBadge status={s.status} />
            </Td>
            <Td className="font-mono text-xs tabular-nums">{shortId(s.consigneeId)}</Td>
            <Td className="tabular-nums">{s.startDate}</Td>
            <Td className="tabular-nums">{formatDays(s.daysOfWeek)}</Td>
            <Td className="tabular-nums">
              {s.deliveryWindowStart.slice(0, 5)} – {s.deliveryWindowEnd.slice(0, 5)}
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

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-5 align-top ${className}`}>{children}</td>;
}

function StatusBadge({ status }: { status: Subscription["status"] }) {
  // Status-to-token mapping is intentional: 'active' → green (positive
  // operational state), 'paused' → amber (operator attention),
  // 'ended' → tertiary text (low-attention historical state). All
  // colours flow through Z-1 tokens.
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-green">
          <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden />
          Active
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" aria-hidden />
          Paused
        </span>
      );
    case "ended":
      return (
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-tertiary)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-text-tertiary)]" aria-hidden />
          Ended
        </span>
      );
  }
}

function EmptyState() {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">No subscriptions yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Create your first via{" "}
        <code className="font-mono text-[color:var(--color-text-primary)]">
          POST /api/subscriptions
        </code>
        .
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
          No tenants are configured. Onboard at least one tenant before using the demo views.
        </p>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatDays(days: readonly number[]): string {
  // ISO 1-7 → short labels. Order preserved as stored; the pilot
  // doesn't sort daysOfWeek arrays at the schema layer, so the UI
  // renders whatever sequence the operator provided.
  return days.map((d) => DAY_LABELS[d - 1] ?? `?${d}`).join(", ");
}

function shortId(uuid: string): string {
  return uuid.slice(0, 8);
}
