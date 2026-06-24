// Day-24 — /admin/users list page (Transcorp-staff surface).
//
// Cross-tenant view of every Planner user. Provisioning was previously
// CLI-only via scripts/onboard-merchant.mjs + onboard-transcorp-sysadmin.mjs.
// This surface keeps both scripts in place and adds a UI alternative
// for ongoing user adds without re-running CLIs.
//
// Pagination v1.5 limitation matches /admin/tasks: offset+limit only,
// no countAllUsers aggregator. "Next" is heuristic-disabled when the
// current page returns fewer rows than perPage (one-extra-click worst
// case on a perfectly-full last page, not data corruption).
//
// Permission: service-layer-only gate (`merchant:read_all`) per
// memory/followup_admin_middleware_phase2.md. ForbiddenError → / per
// the existing admin-page pattern.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { EmptyState as EmptyStateBlock } from "@/components/EmptyState";
import { SearchBar } from "@/components/SearchBar";
import { Toast } from "@/components/Toast";
import { roleLabel } from "@/modules/identity/role-label";
import {
  listAllUsers,
  type AdminUserRow,
} from "@/modules/identity/service";

import { UserDisableModal } from "./_components/UserDisableModal";
import { UserEnableButton } from "./_components/UserEnableButton";
import { UserPasswordResetModal } from "./_components/UserPasswordResetModal";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { AdminPageSizeDropdown } from "../../_components/AdminPageSizeDropdown";
import { shellClass } from "@/components/page-shell-recipe";

const ALLOWED_PAGE_SIZES: readonly number[] = [25, 50, 100];
const PAGE_SIZE_DEFAULT = 50;

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminUsersPageProps {
  readonly searchParams: Promise<{
    readonly page?: string;
    readonly perPage?: string;
    readonly q?: string;
    readonly created?: string;
  }>;
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePerPage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? String(PAGE_SIZE_DEFAULT), 10);
  return ALLOWED_PAGE_SIZES.includes(n) ? n : PAGE_SIZE_DEFAULT;
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const page = parsePage(params.page);
  const perPage = parsePerPage(params.perPage);
  const offset = (page - 1) * perPage;
  const q = typeof params.q === "string" && params.q.trim().length > 0 ? params.q.trim() : undefined;
  const showCreatedToast = params.created === "1";

  let rows: readonly AdminUserRow[];
  try {
    const ctx = await buildRequestContext("/admin/users", requestId);
    rows = await listAllUsers(ctx, { limit: perPage, offset, searchTerm: q });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/users"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const hasNext = rows.length === perPage;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className={shellClass("py-16")}>
        <header className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Users</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              All Planner users across tenants. Provisioning + role assignment
              live here.
            </p>
          </div>
          <Link
            href="/admin/users/new"
            className="inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
          >
            + New user
          </Link>
        </header>

        <SearchBar
          placeholder="Search by email"
          label="Search users by email"
        />

        <div className="mb-8 flex flex-wrap items-end gap-6">
          <AdminPageSizeDropdown value={perPage} options={ALLOWED_PAGE_SIZES} />
        </div>

        {rows.length === 0 ? (
          <EmptyState filtered={q !== undefined} />
        ) : (
          <AdminUsersTable rows={rows} />
        )}

        <Pagination page={page} hasNext={hasNext} perPage={perPage} q={q} />
      </div>

      {showCreatedToast ? (
        <Toast paramKey="created" message="User created and role assigned." />
      ) : null}
    </main>
  );
}

// Phase 10 · Batch B1 — the admin users list adopts the shared <DataTable>
// (Gap C, B+ skin): floating card, never-wrap eyebrow headers, mono figures,
// truncation, hover, mobile-overflow containment. Pure presentation — the seven
// columns + order, the whole-row detail link (Item 2 / PR #270 §9.3; Actions
// cell opts out via noRowLink), the disabled-row muted-text tone, the local
// Active/Disabled dot-badge, the password-reset / disable / enable actions, the
// SearchBar, page-size dropdown, pagination, created toast, and shared
// EmptyState are all preserved.
//
// One known delta vs the raw table: the faint full-row `bg-stone-100/40` wash
// on disabled rows is not carried — DataTable owns a single <tr> className with
// no per-row hook. The disabled state stays obvious (every text cell greys to
// the tertiary tone + the "Disabled" dot-badge). If the row wash is wanted
// back, the minimal fix is an optional `rowClassName?: (row) => string` prop on
// DataTable — proposed as a fast-follow rather than expanding this batch's
// shell-only scope into the shared primitive.
function userCellTone(row: AdminUserRow): string {
  return row.disabledAt !== null
    ? "text-[color:var(--color-text-tertiary)]"
    : "text-navy";
}

const USER_COLUMNS: ReadonlyArray<DataTableColumn<AdminUserRow>> = [
  {
    key: "email",
    header: "Email",
    cell: (row) => <span className={userCellTone(row)}>{row.email}</span>,
    title: (row) => row.email,
  },
  {
    key: "fullName",
    header: "Full name",
    cell: (row) =>
      row.displayName ? (
        <span className={userCellTone(row)}>{row.displayName}</span>
      ) : (
        <span className="text-[color:var(--color-text-tertiary)]">—</span>
      ),
    title: (row) => row.displayName ?? undefined,
  },
  {
    key: "tenant",
    header: "Tenant",
    cell: (row) => (
      <>
        <span
          className={`font-b-display font-semibold ${row.disabledAt !== null ? "text-[color:var(--color-text-tertiary)]" : "text-navy"}`}
        >
          {row.tenantName}
        </span>
        <span className="ml-2 font-b-mono text-xs tabular-nums text-[color:var(--color-text-tertiary)]">
          {row.tenantSlug}
        </span>
      </>
    ),
    title: (row) => `${row.tenantName} · ${row.tenantSlug}`,
  },
  {
    key: "role",
    header: "Role",
    cell: (row) =>
      row.roleSlugs.length > 0 ? (
        <span className={userCellTone(row)}>{row.roleSlugs.map(roleLabel).join(", ")}</span>
      ) : (
        <span className="text-[color:var(--color-text-tertiary)]">—</span>
      ),
    title: (row) =>
      row.roleSlugs.length > 0 ? row.roleSlugs.map(roleLabel).join(", ") : undefined,
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => <StatusBadge disabled={row.disabledAt !== null} />,
  },
  {
    key: "created",
    header: "Created",
    mono: true,
    cellClassName: "text-[color:var(--color-text-secondary)]",
    cell: (row) => row.createdAt.slice(0, 10),
  },
  {
    key: "actions",
    header: "Actions",
    srHeader: true,
    align: "right",
    noRowLink: true,
    cell: (row) => (
      <div className="inline-flex items-center justify-end gap-2">
        <UserPasswordResetModal userId={row.userId} email={row.email} />
        {row.disabledAt !== null ? (
          <UserEnableButton userId={row.userId} />
        ) : (
          <UserDisableModal userId={row.userId} email={row.email} />
        )}
      </div>
    ),
  },
];

function AdminUsersTable({ rows }: { rows: readonly AdminUserRow[] }) {
  return (
    <DataTable
      columns={USER_COLUMNS}
      rows={rows}
      getRowKey={(row) => row.userId}
      rowHref={(row) => `/admin/users/${row.userId}`}
      caption="All Planner users across tenants"
    />
  );
}

function StatusBadge({ disabled }: { readonly disabled: boolean }) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-text-tertiary)]" />
        Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-green">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
      Active
    </span>
  );
}

function Pagination({
  page,
  hasNext,
  perPage,
  q,
}: {
  readonly page: number;
  readonly hasNext: boolean;
  readonly perPage: number;
  readonly q: string | undefined;
}) {
  if (page === 1 && !hasNext) return null;
  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (perPage !== PAGE_SIZE_DEFAULT) params.set("perPage", String(perPage));
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  };
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
        {hasNext ? (
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

// Phase 9 · 3.6 — adopts the shared EmptyState (Gap H); the `filtered` wrapper
// keeps the call site unchanged.
function EmptyState({ filtered }: { readonly filtered: boolean }) {
  return (
    <EmptyStateBlock
      title={filtered ? "No users match the current search." : "No users yet."}
      body={filtered ? "Clear the search to see all users." : "Use New user to provision one."}
    />
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
