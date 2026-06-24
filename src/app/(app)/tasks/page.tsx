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

import { parseAwbsParam } from "@/components/asset-reports/report-helpers";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { HeroCount } from "@/components/HeroCount";
import { SearchBar } from "@/components/SearchBar";
import { listUnresolvedFailedPushes } from "@/modules/failed-pushes";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";
import {
  countTasks,
  listTasks,
  PRINT_LABELS_MAX_TASKS_PER_REQUEST,
  type TaskListRow,
  type TaskStatusFilter,
} from "@/modules/tasks";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(raw: string | undefined, fallback: string): string {
  if (typeof raw !== "string" || !DATE_PATTERN.test(raw)) return fallback;
  return raw;
}

function normaliseDateRange(from: string, to: string): { from: string; to: string } {
  return from > to ? { from: to, to: from } : { from, to };
}

import { PageSizeDropdown } from "./page-size-dropdown";
import { TasksClient } from "./client";
import { CourierStatusFilter } from "./_components/CourierStatusFilter";
import {
  ALLOWED_PAGE_SIZES,
  COURIER_STATUS_FILTER_OPTIONS,
  PAGE_SIZE_DEFAULT,
  parseCourierStatusParam,
  parsePageParam,
  parsePerPageParam,
} from "./status";
import { shellClass } from "@/components/page-shell-recipe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TasksPageProps {
  readonly searchParams: Promise<{
    readonly status?: string;
    readonly page?: string;
    readonly perPage?: string;
    readonly q?: string;
    readonly from?: string;
    readonly to?: string;
    readonly awbs?: string;
  }>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const status = parseCourierStatusParam(params.status);
  const page = parsePageParam(params.page);
  const perPage = parsePerPageParam(params.perPage);
  const offset = (page - 1) * perPage;
  const query = (params.q ?? "").trim();
  const searchTerm = query.length > 0 ? query : undefined;
  const today = computeTodayInDubai(new Date());
  // Day-54 P2 — report drill-down: an AWB-set filter spans whatever
  // dates the report row covered, so it suspends the default-today
  // date window unless the URL pins one explicitly.
  const awbs = parseAwbsParam(params.awbs);
  const hasAwbsFilter = awbs.length > 0;
  const rawFrom = parseDateParam(params.from, today);
  const rawTo = parseDateParam(params.to, today);
  const { from: parsedFrom, to: parsedTo } = normaliseDateRange(rawFrom, rawTo);
  const dateFrom = hasAwbsFilter && params.from === undefined ? undefined : parsedFrom;
  const dateTo = hasAwbsFilter && params.to === undefined ? undefined : parsedTo;

  let tasks: readonly TaskListRow[];
  let totalCount: number;
  let failedPushTaskIds: ReadonlySet<string>;
  try {
    const ctx = await buildRequestContext("/tasks", requestId);
    [tasks, totalCount, failedPushTaskIds] = await Promise.all([
      listTasks(ctx, { limit: perPage, offset, status, searchTerm, dateFrom, dateTo, awbs: hasAwbsFilter ? awbs : undefined }),
      countTasks(ctx, { status, searchTerm, dateFrom, dateTo, awbs: hasAwbsFilter ? awbs : undefined }),
      listUnresolvedFailedPushes(ctx).then(
        (rows) => new Set(rows.map((r) => r.taskId)),
      ),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/tasks"));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className={shellClass("py-16")}>
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

        <HeroCount
          count={totalCount}
          label={buildCountLabel(status, query)}
          trailing={
            <PageSizeDropdown value={perPage} options={ALLOWED_PAGE_SIZES} />
          }
        />

        {/* #431 click-reduction — the three filter controls (search, status
            pills, date range) collapse onto ONE compact wrapping row so the
            table sits higher instead of being pushed below three stacked
            full-width blocks. `[&>*]:mb-0` neutralises each control's own
            bottom margin (the shared SearchBar/DateRangeFilter components are
            untouched — they're used on 8 pages). No filter removed; same URL
            state. The hero-count band above keeps its treatment per the
            <HeroCount> deferral (#437). */}
        <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3 [&>*]:mb-0">
          <SearchBar
            label="Search tasks by AWB, consignee name or order number"
            placeholder="Search by AWB, consignee name or order #"
          />
          <CourierStatusFilter />
          <DateRangeFilter
            today={today}
            initialFrom={parsedFrom}
            initialTo={parsedTo}
            basePath="/tasks"
          />
        </div>

        {hasAwbsFilter ? (
          <div className="mb-6 flex items-center gap-3 border border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-4 py-3 text-sm">
            <span>
              Showing {awbs.length} AWB{awbs.length === 1 ? "" : "s"} from a report
              drill-down{dateFrom === undefined ? " (all dates)" : ""}.
            </span>
            <Link href="/tasks" className="underline underline-offset-4 hover:text-navy">
              Clear filter
            </Link>
          </div>
        ) : null}

        {tasks.length === 0 ? (
          <EmptyState filtered={status !== undefined || query.length > 0} query={query} />
        ) : (
          <TasksClient
            initialTasks={tasks}
            failedPushTaskIds={Array.from(failedPushTaskIds)}
            totalCount={totalCount}
            status={status}
            printLabelsMaxPerRequest={PRINT_LABELS_MAX_TASKS_PER_REQUEST}
          />
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          status={status}
          perPage={perPage}
          query={query}
          dateFrom={parsedFrom}
          dateTo={parsedTo}
        />
      </div>
    </main>
  );
}

// D56 Lane 3 — the hero count band reacts to the fine courier_status filter.
// Uses the shared display label (e.g. "Out for delivery") rather than
// lower-casing the raw SCREAMING_SNAKE value.
function buildCountLabel(status: TaskStatusFilter | undefined, query: string): string {
  // D57 Item B — label from the filter-options set so CREATED/SKIPPED resolve
  // too (the fine-only COURIER_STATUS_DISPLAY map has no entry for them).
  const statusLabel = status
    ? (COURIER_STATUS_FILTER_OPTIONS.find((o) => o.value === status)?.label ?? status).toLowerCase()
    : "";
  if (query.length > 0 && status) {
    return `${statusLabel} matching "${query}"`;
  }
  if (query.length > 0) {
    return `Matching "${query}"`;
  }
  if (status) {
    return `Showing ${statusLabel} only`;
  }
  return "Total tasks";
}

function Pagination({
  page,
  totalPages,
  status,
  perPage,
  query,
  dateFrom,
  dateTo,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly status: string | undefined;
  readonly perPage: number;
  readonly query: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}) {
  if (totalPages <= 1) return null;
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (query.length > 0) params.set("q", query);
    if (perPage !== PAGE_SIZE_DEFAULT) params.set("perPage", String(perPage));
    if (p > 1) params.set("page", String(p));
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
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

function EmptyState({
  filtered,
  query,
}: {
  readonly filtered: boolean;
  readonly query: string;
}) {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">
        {query.length > 0
          ? `No tasks match "${query}".`
          : filtered
            ? "No tasks match this filter."
            : "No tasks yet."}
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
