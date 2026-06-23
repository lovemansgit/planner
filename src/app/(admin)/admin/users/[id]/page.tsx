// Item 2 (22 Jun 2026) — /admin/users/[id] detail view.
//
// Phase 10 · Batch B3 — adopts the shared DetailView (Gap D, B+ skin): one
// floating card with a navy structural spine, two-column fill (D3), and the
// shared FieldRow (sentence-case labels per D2, "Not set" inline empties).
// Pure presentation — every field/value/link/action preserved. The login badge
// moves to the header status slot, Edit to the header actions slot, and the
// password-reset + disable/enable actions live in a "Status" FieldRow.
//
// Server component. Reached by clicking a row on /admin/users. Fetches
// the single user via getUserById (gates merchant:read_all; hides
// test-tenant users per Item 1 → notFound).

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { FieldRow } from "@/components/FieldRow";
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
      <div className="mx-auto max-w-4xl px-12 py-16">
        <DetailView
          header={
            <DetailHeader
              eyebrow="Transcorp · Admin · Users"
              title={user.displayName ?? user.email}
              status={<LoginStatusBadge disabled={disabled} />}
              actions={
                canEdit ? (
                  <Link
                    href={`/admin/users/${user.userId}/edit`}
                    className="inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
                  >
                    Edit
                  </Link>
                ) : undefined
              }
            />
          }
        >
          <DetailSection label="Identity">
            <FieldRow label="Email" value={user.email} mono />
            <FieldRow label="Full name" value={user.displayName} />
            <FieldRow label="Tenant" value={`${user.tenantName} (${user.tenantSlug})`} />
            <FieldRow
              label="Role"
              value={user.roleSlugs.length > 0 ? user.roleSlugs.map(roleLabel).join(", ") : null}
            />
            <FieldRow label="Created" value={user.createdAt.slice(0, 10)} mono />
          </DetailSection>

          <DetailSection label="Status">
            <FieldRow
              label="Manage login"
              value={
                <span className="inline-flex flex-wrap items-center gap-3">
                  <UserPasswordResetModal userId={user.userId} email={user.email} />
                  {disabled ? (
                    <UserEnableButton userId={user.userId} />
                  ) : (
                    <UserDisableModal userId={user.userId} email={user.email} />
                  )}
                </span>
              }
            />
          </DetailSection>
        </DetailView>

        <p className="mt-8">
          <Link
            href="/admin/users"
            className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors hover:text-navy"
          >
            ← All users
          </Link>
        </p>
      </div>
    </main>
  );
}

function LoginStatusBadge({ disabled }: { readonly disabled: boolean }) {
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
