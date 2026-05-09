// Day 19 / Phase 1.5 — Transcorp-staff cross-tenant tasks list.
//
// Server component. Mirrors (admin)/admin/merchants/page.tsx shell;
// reuses operator-side status-pill helpers + POD components via
// cross-route import (precedent: PR #206 PodIcon/PodLightboxModal
// imported from (app)/tasks/_components into (app)/consignees).
//
// Filters:
//   - ?merchant=<slug>  — MerchantFilterDropdown shared with consignees + subs
//   - ?status=<TaskInternalStatus>  — operator-side filter pills, navigated
//                                     to /admin/tasks (locally re-rendered)
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

import {
  ALLOWED_PAGE_SIZES,
  PAGE_SIZE_DEFAULT,
  TASK_STATUS_FILTERS,
  parsePageParam,
  parsePerPageParam,
  parseStatusParam,
} from "@/app/(app)/tasks/status";
import { listMerchants } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  type AdminTaskRow,
  listAllTasks,
} from "@/modules/tasks/service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { MerchantFilterDropdown } from "../../_components/MerchantFilterDropdown";

import { AdminPageSizeDropdown } from "./_components/AdminPageSizeDropdown";
import { AdminPodCell } from "./_components/AdminPodCell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminTasksPageProps {
  readonly searchParams: Promise<{
    readonly merchant?: string;
    readonly status?: string;
    readonly page?: string;
    readonly perPage?: string;
  }>;
}

export default async function AdminTasksPage({ searchParams }: AdminTasksPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const merchantSlug = typeof params.merchant === "string" && params.merchant.length > 0 ? params.merchant : undefined;
  const status = parseStatusParam(params.status);
  const page = parsePageParam(params.page);
  const perPage = parsePerPageParam(params.perPage);
  const offset = (page - 1) * perPage;

  let rows: readonly AdminTaskRow[];
  let merchants: readonly Merchant[];
  try {
    const ctx = await buildRequestContext("/admin/tasks", requestId);
    [rows, merchants] = await Promise.all([
      listAllTasks(ctx, { merchantSlug, status, limit: perPage, offset }),
      listMerchants(ctx),
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
            All tasks across the platform. Filter by merchant or status.
          </p>
        </header>

        <div className="mb-8 flex flex-wrap items-end gap-6">
          <MerchantFilterDropdown
            merchants={dropdownMerchants}
            currentSlug={merchantSlug ?? null}
          />
          <AdminPageSizeDropdown value={perPage} options={ALLOWED_PAGE_SIZES} />
        </div>

        <StatusFilterBar
          activeStatus={status}
          merchantSlug={merchantSlug}
          perPage={perPage}
        />

        <section className="mb-8 flex items-baseline justify-between border-t border-b border-[color:var(--color-border-strong)] py-6">
          <p className="font-serif text-5xl font-light tabular-nums leading-none">
            {rows.length}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            {status ? `Showing ${status.toLowerCase().replace("_", " ")}` : "On this page"}
          </p>
        </section>

        {rows.length === 0 ? <EmptyState filtered={status !== undefined || merchantSlug !== undefined} /> : <AdminTasksTable rows={rows} />}

        <Pagination
          page={page}
          hasNext={hasNext}
          merchantSlug={merchantSlug}
          status={status}
          perPage={perPage}
        />
      </div>
    </main>
  );
}

function StatusFilterBar({
  activeStatus,
  merchantSlug,
  perPage,
}: {
  readonly activeStatus: string | undefined;
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
}) {
  return (
    <nav aria-label="Status filter" className="mb-8 flex flex-wrap items-center gap-2">
      <FilterPill
        href={buildAdminTasksHref({ merchantSlug, perPage, status: undefined })}
        active={activeStatus === undefined}
        label="All"
      />
      {TASK_STATUS_FILTERS.map((s) => (
        <FilterPill
          key={s.value}
          href={buildAdminTasksHref({ merchantSlug, perPage, status: s.value })}
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
    ? "border-2 border-green text-navy"
    : "border border-[color:var(--color-border-default)] text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-strong)] hover:text-navy";
  return (
    <Link href={href} className={`${base} ${variant}`} aria-current={active ? "true" : undefined}>
      {label}
    </Link>
  );
}

function buildAdminTasksHref({
  merchantSlug,
  perPage,
  status,
  page,
}: {
  readonly merchantSlug: string | undefined;
  readonly perPage: number;
  readonly status: string | undefined;
  readonly page?: number;
}): string {
  const params = new URLSearchParams();
  if (merchantSlug) params.set("merchant", merchantSlug);
  if (status) params.set("status", status);
  if (perPage !== PAGE_SIZE_DEFAULT) params.set("perPage", String(perPage));
  if (page !== undefined && page > 1) params.set("page", String(page));
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
  const filter = TASK_STATUS_FILTERS.find((f) => f.value === row.task.internalStatus);
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
          className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${filter?.pillClass ?? ""}`}
        >
          {filter?.label ?? row.task.internalStatus}
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
}: {
  readonly page: number;
  readonly hasNext: boolean;
  readonly merchantSlug: string | undefined;
  readonly status: string | undefined;
  readonly perPage: number;
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
            href={buildAdminTasksHref({ merchantSlug, perPage, status, page: page - 1 })}
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
            href={buildAdminTasksHref({ merchantSlug, perPage, status, page: page + 1 })}
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
        {filtered ? "Adjust the merchant or status filter." : "Try a previous page."}
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
