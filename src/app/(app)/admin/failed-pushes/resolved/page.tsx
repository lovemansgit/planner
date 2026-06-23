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

import { DataTable, type DataTableColumn } from "@/components/DataTable";
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

// Phase 10 · Batch B2 — the resolved-pushes review log adopts the shared
// <DataTable> (Gap C, B+ skin): a floating warm-white card, never-wrap eyebrow
// headers, mono tabular figures, and truncating cells with title tooltips.
// Read-only: no row link, no actions, no status-LED (every row is resolved).
// Columns + order are preserved exactly.
const RESOLVED_COLUMNS: ReadonlyArray<DataTableColumn<ResolvedFailedPush>> = [
  {
    key: "resolvedAt",
    header: "Resolved at",
    mono: true,
    cell: (row) => formatTimestamp(row.resolvedAt),
  },
  {
    key: "resolvedBy",
    header: "Resolved by",
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => row.resolvedByEmail ?? "System",
    title: (row) => row.resolvedByEmail ?? "System",
  },
  {
    key: "notes",
    header: "Notes",
    cell: (row) =>
      row.resolutionNotes ?? <span className="text-[color:var(--color-text-tertiary)]">—</span>,
    title: (row) => row.resolutionNotes ?? undefined,
  },
  {
    key: "task",
    header: "Task",
    mono: true,
    cell: (row) => row.taskId,
    title: (row) => row.taskId,
  },
  {
    key: "failure",
    header: "Failure",
    cell: (row) => (
      <>
        {row.failureReason}
        {row.httpStatus !== null ? (
          <span className="ml-1 font-b-mono tabular-nums text-[color:var(--color-text-secondary)]">
            ({row.httpStatus})
          </span>
        ) : null}
      </>
    ),
    title: (row) =>
      row.httpStatus !== null ? `${row.failureReason} (${row.httpStatus})` : row.failureReason,
  },
  {
    key: "attempts",
    header: "Attempts",
    mono: true,
    cell: (row) => row.attemptCount,
  },
  {
    key: "firstFailed",
    header: "First failed",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => formatTimestamp(row.firstFailedAt),
  },
];

function ResolvedTable({ rows }: { readonly rows: readonly ResolvedFailedPush[] }) {
  return (
    <DataTable
      columns={RESOLVED_COLUMNS}
      rows={rows}
      getRowKey={(row) => row.id}
      caption="Resolved failed pushes — read-only history"
    />
  );
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
