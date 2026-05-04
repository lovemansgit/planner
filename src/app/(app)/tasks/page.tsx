// /tasks — Day 11 / P5
//
// Operator workflow surface. Server component renders the list view +
// pagination + filters; the client component owns multi-select state
// for the Print Labels button.
//
// State decisions:
//   - Filter status + page index are URL state (`?status=…&page=…`)
//     so the operator can share / bookmark a specific filtered view;
//     pagination + filter mutations re-render the server component.
//   - Selection state for label printing is React state at the client
//     layer — selections survive within the page render but reset on
//     navigation, matching the "I'm picking these tasks right now"
//     expectation. Multi-select via URL would either bloat the query
//     string or require complex sync; React state is the simpler fit.
//
// Permission boundary:
//   - `task:read` gates the list (via the listTasks service path)
//   - `task:print_labels` gates the action (verified inside the
//     printLabelsForTasks service when the POST hits).
//
// Failed-push overlay:
//   - listUnresolvedFailedPushes scopes to the same tenant via RLS
//     and returns ALL unresolved rows; we project to a Set<taskId>
//     once per page render to mark tasks visually without a per-row
//     query.
//
// Brand: matches /admin/webhook-config + /admin/failed-pushes.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { listUnresolvedFailedPushes } from "@/modules/failed-pushes";
import { countTasks, listTasks, type Task } from "@/modules/tasks";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { measure } from "@/shared/latency-log";
import { buildRequestContext } from "@/shared/request-context";

import { TasksClient } from "./client";
import {
  PAGE_SIZE,
  TASK_STATUS_FILTERS,
  parsePageParam,
  parseStatusParam,
} from "./status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TasksPageProps {
  readonly searchParams: Promise<{
    readonly status?: string;
    readonly page?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const status = parseStatusParam(params.status);
  const page = parsePageParam(params.page);
  const offset = (page - 1) * PAGE_SIZE;

  let tasks: readonly Task[];
  let totalCount: number;
  let failedPushTaskIds: ReadonlySet<string>;
  try {
    const fetched = await measure("tasksPage.dataFetch", async () => {
      const ctx = await measure("tasksPage.buildRequestContext", () =>
        buildRequestContext("/tasks", requestId),
      );
      const [t, c, f] = await Promise.all([
        measure("tasksPage.listTasks", () =>
          listTasks(ctx, { limit: PAGE_SIZE, offset, status }),
        ),
        measure("tasksPage.countTasks", () => countTasks(ctx, { status })),
        measure("tasksPage.listUnresolvedFailedPushes", () =>
          listUnresolvedFailedPushes(ctx).then(
            (rows) => new Set(rows.map((r) => r.taskId)),
          ),
        ),
      ]);
      return { tasks: t, totalCount: c, failedPushTaskIds: f };
    });
    tasks = fetched.tasks;
    totalCount = fetched.totalCount;
    failedPushTaskIds = fetched.failedPushTaskIds;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/tasks"));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Operations · Tasks
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Tenant-scoped delivery tasks. Filter by status, page through, select rows to print
            shipment labels in bulk.
          </p>
        </header>

        <StatusFilterBar activeStatus={status} />

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">{totalCount}</p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {status ? `Showing ${status.toLowerCase().replace("_", " ")} only` : "Total tasks"}
          </p>
        </section>

        {tasks.length === 0 ? (
          <EmptyState filtered={status !== undefined} />
        ) : (
          <TasksClient initialTasks={tasks} failedPushTaskIds={Array.from(failedPushTaskIds)} />
        )}

        <Pagination page={page} totalPages={totalPages} status={status} />
      </div>
    </main>
  );
}

function StatusFilterBar({
  activeStatus,
}: {
  readonly activeStatus: string | undefined;
}) {
  return (
    <nav aria-label="Status filter" className="mb-8 flex flex-wrap items-center gap-2">
      <FilterPill href="/tasks" active={activeStatus === undefined} label="All" />
      {TASK_STATUS_FILTERS.map((s) => (
        <FilterPill
          key={s.value}
          href={`/tasks?status=${s.value}`}
          active={activeStatus === s.value}
          label={s.label}
        />
      ))}
    </nav>
  );
}

function FilterPill({
  href,
  active,
  label,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly label: string;
}) {
  const base =
    "inline-flex items-center px-4 py-2 text-xs uppercase tracking-[0.15em] transition-opacity";
  const variant = active
    ? "border border-navy text-navy"
    : "border border-[color:var(--color-border-default)] text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-strong)] hover:text-navy";
  return (
    <Link href={href} className={`${base} ${variant}`} aria-current={active ? "true" : undefined}>
      {label}
    </Link>
  );
}

function Pagination({
  page,
  totalPages,
  status,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly status: string | undefined;
}) {
  if (totalPages <= 1) return null;
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };
  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex items-center justify-between border-t border-[color:var(--color-border-default)] pt-6"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-3">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            className="text-xs uppercase tracking-[0.2em] text-navy hover:opacity-80"
          >
            ← Previous
          </Link>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-tertiary)]">
            ← Previous
          </span>
        )}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            className="text-xs uppercase tracking-[0.2em] text-navy hover:opacity-80"
          >
            Next →
          </Link>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-tertiary)]">
            Next →
          </span>
        )}
      </div>
    </nav>
  );
}

function EmptyState({ filtered }: { readonly filtered: boolean }) {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">
        {filtered ? "No tasks match this filter." : "No tasks yet."}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {filtered
          ? "Clear the filter to see all tenant tasks."
          : "Tasks generate nightly from active subscriptions."}
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Operations · Tasks
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the operator views.
        </p>
      </div>
    </main>
  );
}
