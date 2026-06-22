// Day 19 / Phase 1.5 — Transcorp-staff cross-tenant tasks list.
//
// Server component. Mirrors (admin)/admin/merchants/page.tsx shell;
// reuses operator-side status-pill helpers + POD components via
// cross-route import (precedent: PR #206 PodIcon/PodLightboxModal
// imported from (app)/tasks/_components into (app)/consignees).
//
// Filters:
//   - ?merchant=<slug>  — MerchantFilterDropdown shared with consignees + subs
//   - ?status=<CourierStatus>  — D56 Lane 5: the FINE courier-status dropdown
//                                (<CourierStatusFilter>, shared with /tasks).
//                                Migrated off the legacy coarse pill bar; stale
//                                coarse bookmarks degrade to "All".
//   - ?page=N + ?perPage=N — operator-side pagination parsers
//
// Pagination v1.5 limitation: backend ships listAllTasks with offset+
// limit only — no countAllTasks aggregator on the cross-tenant surface.
// Page numbers are 1-based; "Next" is disabled when the current page
// returns fewer rows than `perPage` (heuristic — falsely enables Next
// when the last page is exactly full, but that's a one-extra-click
// worst case, not data corruption). "Page N of M" totals deferred to a
// follow-up PR if reviewer adds count fns to plan §4.
//
// Permission gate: service-layer-only per
// memory/followup_admin_middleware_phase2.md. ForbiddenError → / per
// the merchants admin pattern (no exposure of admin surface to
// non-staff actors).

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { CourierStatusFilter } from "@/app/(app)/tasks/_components/CourierStatusFilter";
import { StatusIcon } from "@/app/(app)/tasks/_components/StatusIcon";
import {
  ALLOWED_PAGE_SIZES,
  PAGE_SIZE_DEFAULT,
  parseCourierStatusParam,
  parsePageParam,
  parsePerPageParam,
  resolveCourierDisplay,
} from "@/app/(app)/tasks/status";
import { parseAwbsParam } from "@/components/asset-reports/report-helpers";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { SearchBar } from "@/components/SearchBar";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import { computeTodayInDubai } from "@/modules/task-materialization/dubai-date";
import {
  type AdminTaskRow,
  countAllTasks,
  listAllTasks,
} from "@/modules/tasks/service";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Day-24 PM — page-boundary date param parser. Returns the parsed
 * YYYY-MM-DD string if valid; falls back to the provided default
 * otherwise (used for both individual bounds + the from > to swap).
 */
function parseDateParam(raw: string | undefined, fallback: string): string {
  if (typeof raw !== "string" || !DATE_PATTERN.test(raw)) return fallback;
  return raw;
}

/**
 * Day-24 PM — defensive swap when caller provides from > to. The
 * brief flagged this edge case; we swap rather than error so a
 * malformed URL still renders a valid page.
 */
function normaliseDateRange(from: string, to: string): { from: string; to: string } {
  return from > to ? { from: to, to: from } : { from, to };
}
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { AdminPageSizeDropdown } from "../../_components/AdminPageSizeDropdown";
import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";

import { AdminPodCell } from "./_components/AdminPodCell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminTasksPageProps {
  readonly searchParams: Promise<{
    readonly merchant?: string;
    readonly status?: string;
    readonly page?: string;
    readonly perPage?: string;
    readonly q?: string;
    readonly from?: string;
    readonly to?: string;
    readonly awbs?: string;
  }>;
}

export default async function AdminTasksPage({ searchParams }: AdminTasksPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const merchantSlug = typeof params.merchant === "string" && params.merchant.length > 0 ? params.merchant : undefined;
  const status = parseCourierStatusParam(params.status);
  const page = parsePageParam(params.page);
  const perPage = parsePerPageParam(params.perPage);
  const offset = (page - 1) * perPage;
  const q = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim() : undefined;
  const today = computeTodayInDubai(new Date());
  // Day-54 P2 — report drill-down AWB set suspends the default-today
  // date window unless the URL pins one explicitly (see /tasks).
  const awbs = parseAwbsParam(params.awbs);
  const hasAwbsFilter = awbs.length > 0;
  const rawFrom = parseDateParam(params.from, today);
  const rawTo = parseDateParam(params.to, today);
  const { from: parsedFrom, to: parsedTo } = normaliseDateRange(rawFrom, rawTo);
  const dateFrom = hasAwbsFilter && params.from === undefined ? undefined : parsedFrom;
  const dateTo = hasAwbsFilter && params.to === undefined ? undefined : parsedTo;

  let rows: readonly AdminTaskRow[];
  let merchants: readonly Merchant[];
  let totalCount: number;
  try {
    const ctx = await buildRequestContext("/admin/tasks", requestId);
    [rows, merchants, totalCount] = await Promise.all([
      listAllTasks(ctx, { merchantSlug, status, limit: perPage, offset, searchTerm: q, dateFrom, dateTo, awbs: hasAwbsFilter ? awbs : undefined }),
      listMerchants(ctx),
      countAllTasks(ctx, { merchantSlug, status, searchTerm: q, dateFrom, dateTo, awbs: hasAwbsFilter ? awbs : undefined }),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/tasks"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const dropdownMerchants = merchants.map((m) => ({
    slug: m.slug,
    name: m.name,
    status: m.status,
  }));
  const hasNext = rows.length === perPage;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Tasks</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            All tasks across the platform. Filter by date range, merchant, or status.
          </p>
        </header>

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-6 py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {totalCount}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {status !== undefined || merchantSlug !== undefined || q !== undefined ? "Matching tasks" : "Total tasks"}
          </p>
        </section>

        <DateRangeFilter
          today={today}
          initialFrom={parsedFrom}
          initialTo={parsedTo}
          basePath="/admin/tasks"
        />

        {hasAwbsFilter ? (
          <div className="mb-6 flex items-center gap-3 border border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)] px-4 py-3 text-sm">
            <span>
              Showing {awbs.length} AWB{awbs.length === 1 ? "" : "s"} from a report
              drill-down{dateFrom === undefined ? " (all dates)" : ""}.
            </span>
            <Link href="/admin/tasks" className="underline underline-offset-4 hover:text-navy">
              Clear filter
            </Link>
          </div>
        ) : null}

        <SearchBar
          placeholder="Search by AWB, consignee, or merchant"
          label="Search tasks by AWB, consignee, or merchant"
        />

        {/* D56 Lane 5 — the coarse status pill bar retired in favour of the
            shared fine-14 <CourierStatusFilter> dropdown (URL state on the same
            ?status= param, single-select; matches /tasks). It sits inline with
            the merchant + page-size controls. */}
        <div className="mb-8 flex flex-wrap items-center gap-6">
          <MerchantFilterDropdown
            merchants={dropdownMerchants}
            currentSlug={merchantSlug ?? null}
          />
          <CourierStatusFilter />
          <AdminPageSizeDropdown value={perPage} options={ALLOWED_PAGE_SIZES} />
        </div>

        {rows.length === 0 ? <EmptyState filtered={status !== undefined || merchantSlug !== undefined || q !== undefined} /> : <AdminTasksTable rows={rows} />}

        <Pagination
          page={page}
          hasNext={hasNext}
          merchantSlug={merchantSlug}
          status={status}
          perPage={perPage}
          q={q}
          dateFrom={parsedFrom}
          dateTo={parsedTo}
        />
      </div>
    </main>
  );
}

function buildAdminTasksHref({
  merchantSlug,
  perPage,
  status,
  page,
  q,
  dateFrom,
  dateTo,
}: {
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
  readonly status: string | undefined;
  readonly page?: number;
  readonly q?: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}): string {
  const params = new URLSearchParams();
  if (merchantSlug) params.set("merchant", merchantSlug);
  if (status) params.set("status", status);
  if (perPage !== PAGE_SIZE_DEFAULT) params.set("perPage", String(perPage));
  if (page !== undefined && page > 1) params.set("page", String(page));
  if (q) params.set("q", q);
  if (dateFrom) params.set("from", dateFrom);
  if (dateTo) params.set("to", dateTo);
  const qs = params.toString();
  return qs ? `/admin/tasks?${qs}` : "/admin/tasks";
}

function AdminTasksTable({ rows }: { rows: readonly AdminTaskRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Merchant</Th>
          <Th>Status</Th>
          <Th>Order #</Th>
          <Th>Delivery date</Th>
          <Th>Window</Th>
          <Th>AWB</Th>
          <Th>
            <span className="sr-only">Proof of delivery</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.task.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row }: { row: AdminTaskRow }) {
  // D56 Lane 5 — render the FINE courier_status (label + family colour + glyph),
  // falling back to the coarse internal_status when it is NULL (mirrors /tasks).
  const display = resolveCourierDisplay(row.task.courierStatus, row.task.internalStatus);
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-b-0">
      <Td>
        <span className="font-medium text-navy">{row.merchant.name}</span>
        <span className="ml-2 text-[color:var(--color-text-tertiary)] font-mono text-xs tabular-nums">
          {row.merchant.slug}
        </span>
      </Td>
      <Td>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${display.pillClass}`}
        >
          <StatusIcon courierStatus={row.task.courierStatus} status={row.task.internalStatus} />
          {display.label}
        </span>
      </Td>
      <Td className="font-mono text-xs tabular-nums">{row.task.customerOrderNumber}</Td>
      <Td className="tabular-nums">{row.task.deliveryDate}</Td>
      <Td className="tabular-nums">
        {row.task.deliveryStartTime.slice(0, 5)} – {row.task.deliveryEndTime.slice(0, 5)}
      </Td>
      <Td className="font-mono text-xs tabular-nums">
        {row.task.externalTrackingNumber ?? (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        )}
      </Td>
      <Td>
        <AdminPodCell task={row.task} />
      </Td>
    </tr>
  );
}

function Pagination({
  page,
  hasNext,
  merchantSlug,
  status,
  perPage,
  q,
  dateFrom,
  dateTo,
}: {
  readonly page: number;
  readonly hasNext: boolean;
  readonly merchantSlug: string | undefined;
  readonly status: string | undefined;
  readonly perPage: number;
  readonly q: string | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
}) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav
      aria-label="Pagination"
      className="mt-12 flex items-center justify-between border-t border-[color:var(--color-border-default)] pt-6"
    >
      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        Page {page}
      </p>
      <div className="flex gap-3">
        {page > 1 ? (
          <Link
            href={buildAdminTasksHref({ merchantSlug, perPage, status, page: page - 1, q, dateFrom, dateTo })}
            className="text-xs uppercase tracking-[0.2em] text-navy hover:opacity-80"
          >
            ← Previous
          </Link>
        ) : (
          <span className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-tertiary)]">
            ← Previous
          </span>
        )}
        {hasNext ? (
          <Link
            href={buildAdminTasksHref({ merchantSlug, perPage, status, page: page + 1, q, dateFrom, dateTo })}
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-4 text-left text-xs font-medium uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]">
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-4 align-middle ${className}`}>{children}</td>;
}

function EmptyState({ filtered }: { readonly filtered: boolean }) {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">
        {filtered ? "No tasks match the current filters." : "No tasks on this page."}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {filtered ? "Adjust the search, merchant, or status filter." : "Try a previous page."}
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Transcorp · Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the admin views.
        </p>
      </div>
    </main>
  );
}
