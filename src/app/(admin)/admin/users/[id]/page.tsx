// Item 2 (22 Jun 2026) — /admin/users/[id] detail view.
//
// Server component. Reached by clicking a row on /admin/users. Fetches
// the single user via getUserById (gates merchant:read_all; hides
// test-tenant users per Item 1 → notFound). Renders identity + status
// sections and surfaces the existing per-user actions (password reset,
// disable/enable) plus an Edit link gated on user:update.
//
// Brand-canon: bg-surface-primary, navy text, hairline section rules,
// uppercase eyebrow labels — matches /admin/merchants/[id].

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { roleLabel } from "@/modules/identity/role-label";
import { getUserById, type AdminUserRow } from "@/modules/identity/service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { UserDisableModal } from "../_components/UserDisableModal";
import { UserEnableButton } from "../_components/UserEnableButton";
import { UserPasswordResetModal } from "../_components/UserPasswordResetModal";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminUserDetailPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const requestId = randomUUID();
  const { id } = await params;

  let user: AdminUserRow | null;
  let canEdit = false;
  try {
    const ctx = await buildRequestContext(`/admin/users/${id}`, requestId);
    canEdit = ctx.actor.kind === "user" && ctx.actor.permissions.has("user:update");
    user = await getUserById(ctx, id as Uuid);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/users/${id}`));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      redirect("/admin/users");
    }
    throw err;
  }

  if (user === null) {
    notFound();
  }

  const disabled = user.disabledAt !== null;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-3xl px-12 py-16">
        <Link
          href="/admin/users"
          className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
        >
          ← All users
        </Link>

        <header className="mb-12 mt-6 flex items-end justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin · Users
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              {user.displayName ?? user.email}
            </h1>
            <p className="mt-2 text-sm text-[color:var(--color-text-secondary)]">{user.email}</p>
          </div>
          {canEdit ? (
            <Link
              href={`/admin/users/${user.userId}/edit`}
              className="inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
            >
              Edit
            </Link>
          ) : null}
        </header>

        <Section title="Identity">
          <FieldRow label="Email" value={user.email} mono />
          <FieldRow label="Full name" value={user.displayName} />
          <FieldRow label="Tenant" value={`${user.tenantName} (${user.tenantSlug})`} />
          <FieldRow
            label="Role"
            value={user.roleSlugs.length > 0 ? user.roleSlugs.map(roleLabel).join(", ") : null}
          />
          <FieldRow label="Created" value={user.createdAt.slice(0, 10)} mono />
        </Section>

        <Section title="Status">
          <div className="grid grid-cols-[1fr_2fr] gap-6 py-4">
            <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
              Login
            </p>
            <div className="flex flex-col gap-4">
              <StatusBadge disabled={disabled} />
              <div className="flex flex-wrap items-center gap-3">
                <UserPasswordResetModal userId={user.userId} email={user.email} />
                {disabled ? (
                  <UserEnableButton userId={user.userId} />
                ) : (
                  <UserDisableModal userId={user.userId} email={user.email} />
                )}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12 border-t border-[color:var(--color-border-strong)] pt-8">
      <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        {title}
      </p>
      <div className="divide-y divide-[color:var(--color-border-default)]">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-6 py-4">
      <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
        {label}
      </p>
      {value ? (
        <p className={`text-sm text-navy ${mono ? "font-mono tabular-nums" : ""}`}>{value}</p>
      ) : (
        <p className="text-sm text-[color:var(--color-text-tertiary)]">—</p>
      )}
    </div>
  );
}

function StatusBadge({ disabled }: { readonly disabled: boolean }) {
  if (disabled) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-text-tertiary)]" />
        Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-green">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green" />
      Active
    </span>
  );
}
