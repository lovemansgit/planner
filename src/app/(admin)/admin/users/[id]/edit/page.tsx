// Item 2 (22 Jun 2026) — /admin/users/[id]/edit shell.
//
// Server component. Preflight-loads the user (getUserById gates
// merchant:read_all + hides test-tenant users per Item 1) and requires
// user:update before rendering the form — fail closed BEFORE load rather
// than load-then-forbidden-on-submit. Role options derive from the
// user's (immutable here) tenant. Hands everything to the client
// UserEditForm.

import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";

import { getUserById, type AdminUserRow } from "@/modules/identity/service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { UserEditForm } from "./_components/UserEditForm";
import { roleOptionsForTenant } from "./_helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminUserEditPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function AdminUserEditPage({ params }: AdminUserEditPageProps) {
  const requestId = randomUUID();
  const { id } = await params;

  let user: AdminUserRow | null;
  try {
    const ctx = await buildRequestContext(`/admin/users/${id}/edit`, requestId);

    // Edit requires the write permission; fail closed before rendering.
    if (ctx.actor.kind !== "user" || !ctx.actor.permissions.has("user:update")) {
      redirect(`/admin/users/${id}`);
    }

    user = await getUserById(ctx, id as Uuid);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/users/${id}/edit`));
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

  const roleOptions = roleOptionsForTenant(user.tenantSlug);
  const currentRole = user.roleSlugs[0] ?? "";

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin · Users
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Edit user</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Update the user&apos;s name and role. Enable/disable and password
            reset live on the detail page.
          </p>
        </header>

        <UserEditForm
          userId={user.userId}
          email={user.email}
          tenantName={user.tenantName}
          tenantSlug={user.tenantSlug}
          initialDisplayName={user.displayName}
          initialRoleSlug={currentRole}
          roleOptions={roleOptions}
        />
      </div>
    </main>
  );
}
