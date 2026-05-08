// Day 18 / C1 — Transcorp-staff admin layout (server component).
//
// Parallel shell to (app)/layout.tsx. Resolves the actor's session +
// permissions once per request and renders the admin-specific
// AdminTopNav with the visibleAdminNavItems set.
//
// Auth contract mirrors (app)/layout.tsx exactly:
//   - UnauthorizedError      → redirect to /login with ?next=<current path>
//   - NoTenantConfiguredError→ render the "system not initialised" panel
//   - Anything else          → throw, surfaced by Next.js's error boundary
//
// Permission gate is INTENTIONALLY NOT in this layout — per the
// Phase-2 deferral filed at memory/followup_admin_middleware_phase2.md,
// merchant:* permission enforcement is service-layer-only. Each
// (admin)/ page calls a service fn whose `requirePermission` check
// throws ForbiddenError when an actor lacks the relevant
// merchant:* permission; the page handler catches and redirects
// accordingly. Three compensating defenses (transcorp-sysadmin role
// exclusivity, merchant:* systemOnly flag, API_KEY_FORBIDDEN_PERMISSIONS)
// keep the surface secure even without layout-level gating.

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";

import type { UserIdentity } from "../(app)/layout";
import { visibleAdminNavItems } from "../(app)/nav-config";

import { AdminTopNav } from "./_components/AdminTopNav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestId = randomUUID();
  const path = await currentPath();

  let permissions: ReadonlySet<Permission>;
  let userIdentity: UserIdentity | null = null;
  try {
    const ctx = await buildRequestContext(path, requestId);
    if (ctx.actor.kind !== "user") {
      throw new UnauthorizedError("non-user actor in admin UI");
    }
    permissions = ctx.actor.permissions;
    userIdentity = {
      displayName: ctx.actor.displayName ?? null,
      email: ctx.actor.email ?? "",
      tenantName: ctx.actor.tenantName ?? "",
      tenantSlug: ctx.actor.tenantSlug ?? "",
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(path));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const items = visibleAdminNavItems(permissions);

  return (
    <>
      <AdminTopNav items={items} userIdentity={userIdentity} />
      {children}
    </>
  );
}

async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/admin";
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Subscription planner · Admin
        </p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">
          System not yet initialised
        </h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the admin views.
        </p>
      </div>
    </main>
  );
}
