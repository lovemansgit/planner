// /admin/failed-pushes/resolved — Day-53 R12 (Path B per
// memory/followup_resolved_rows_visibility_gap.md; plan at
// memory/plans/day-53-session-c-r12-resolved-rows.md).
//
// Read-only review log for RESOLVED failed_pushes rows — the page that
// answers "did my resolve actually save?" one click after the
// work-queue's bulk-resolve, and "did the MPL backlog get resolved on
// date X?" weeks later. Server component ONLY, deliberately no
// client.tsx: zero actions on resolved rows is structural, not
// conditional (the work-queue page stays the only mutation surface).
//
// Permission boundary: `listResolvedFailedPushes` gates on
// `failed_pushes:retry` — the same Tenant-Admin permission as the
// work-queue page this extends (resolution notes + failure context
// stay away from read-but-not-retry roles per the Day-30 perm split).
//
// Brand language matches the work-queue page: Operations · SuiteFleet
// eyebrow, hero numeral, hairline borders, sentence case, no shadows.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { HeroCount } from "@/components/HeroCount";
import {
  listResolvedFailedPushes,
  type ResolvedFailedPush,
} from "@/modules/failed-pushes";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ResolvedFailedPushesPage() {
  const requestId = randomUUID();

  let rows: readonly ResolvedFailedPush[];
  try {
    const ctx = await buildRequestContext("/admin/failed-pushes/resolved", requestId);
    rows = await listResolvedFailedPushes(ctx);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/failed-pushes/resolved"));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Operations · SuiteFleet
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Resolved pushes</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Read-only history of resolved failed pushes — who resolved what, when, and why. The
            active work queue lives at{" "}
            <Link href="/admin/failed-pushes" className="underline underline-offset-2 hover:text-navy">
              Failed pushes
            </Link>
            .
          </p>
        </header>

        {/* Component-lib rollout (audit H1) — adopts the canonical
            <HeroCount> strip. Presentational only. */}
        <HeroCount count={rows.length} label="Resolved rows" />

        {rows.length === 0 ? <EmptyState /> : <ResolvedTable rows={rows} />}
      </div>
    </main>
  );
}

function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function ResolvedTable({ rows }: { readonly rows: readonly ResolvedFailedPush[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)] text-left">
          <Th>Resolved at</Th>
          <Th>Resolved by</Th>
          <Th>Notes</Th>
          <Th>Task</Th>
          <Th>Failure</Th>
          <Th>Attempts</Th>
          <Th>First failed</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className="border-b border-[color:var(--color-border-default)] align-top"
          >
            <Td>
              <span className="tabular-nums">{formatTimestamp(row.resolvedAt)}</span>
            </Td>
            <Td>{row.resolvedByEmail ?? "System"}</Td>
            <Td>
              {row.resolutionNotes ?? (
                <span className="text-[color:var(--color-text-tertiary)]">—</span>
              )}
            </Td>
            <Td>
              <span className="font-mono text-xs">{row.taskId}</span>
            </Td>
            <Td>
              {row.failureReason}
              {row.httpStatus !== null ? (
                <span className="ml-1 text-[color:var(--color-text-secondary)] tabular-nums">
                  ({row.httpStatus})
                </span>
              ) : null}
            </Td>
            <Td>
              <span className="tabular-nums">{row.attemptCount}</span>
            </Td>
            <Td>
              <span className="tabular-nums">{formatTimestamp(row.firstFailedAt)}</span>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: { readonly children: React.ReactNode }) {
  return (
    <th className="py-3 pr-6 text-xs font-medium uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function Td({ children }: { readonly children: React.ReactNode }) {
  return <td className="py-3 pr-6">{children}</td>;
}

function EmptyState() {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">No resolved failed pushes yet.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        Rows appear here after an operator or the system resolves entries on the work queue.
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Operations · SuiteFleet
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before opening the admin views.
        </p>
      </div>
    </main>
  );
}
