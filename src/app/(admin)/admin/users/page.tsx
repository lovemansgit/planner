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

import { SearchBar } from "@/components/SearchBar";
import { Toast } from "@/components/Toast";
import {
  listAllUsers,
  type AdminUserRow,
} from "@/modules/identity/service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { AdminPageSizeDropdown } from "../../_components/AdminPageSizeDropdown";

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
      <div className="mx-auto max-w-6xl px-12 py-16">
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
            className="inline-flex items-center rounded-sm border border-navy bg-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90"
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

function AdminUsersTable({ rows }: { rows: readonly AdminUserRow[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-[color:var(--color-border-strong)]">
          <Th>Email</Th>
          <Th>Full name</Th>
          <Th>Tenant</Th>
          <Th>Role</Th>
          <Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Row key={row.userId} row={row} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ row }: { row: AdminUserRow }) {
  return (
    <tr className="border-b border-[color:var(--color-border-default)] last:border-b-0">
      <Td>
        <span className="text-navy">{row.email}</span>
      </Td>
      <Td>
        {row.displayName ? (
          <span className="text-navy">{row.displayName}</span>
        ) : (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        )}
      </Td>
      <Td>
        <span className="font-medium text-navy">{row.tenantName}</span>
        <span className="ml-2 font-mono text-xs tabular-nums text-[color:var(--color-text-tertiary)]">
          {row.tenantSlug}
        </span>
      </Td>
      <Td>
        {row.roleSlugs.length > 0 ? (
          <span className="text-navy">{row.roleSlugs.join(", ")}</span>
        ) : (
          <span className="text-[color:var(--color-text-tertiary)]">—</span>
        )}
      </Td>
      <Td className="tabular-nums text-[color:var(--color-text-secondary)]">
        {row.createdAt.slice(0, 10)}
      </Td>
    </tr>
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
        {filtered ? "No users match the current search." : "No users yet."}
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        {filtered
          ? "Clear the search to see all users."
          : "Use New user to provision one."}
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
