// Day 11 / P4 — authenticated app layout (server component).
//
// Wraps every page inside the `(app)/` route group with the top nav.
// Resolves the operator's session + permissions once per request via
// buildRequestContext and passes the permission set down to TopNav.
//
// Auth contract:
//   - UnauthorizedError → redirect to /login with ?next=<current path>
//   - NoTenantConfiguredError → render the "system not initialised" panel
//   - Anything else → throw, surfaced by Next.js's error boundary
//
// /login + /logout live OUTSIDE the route group so this layout never
// runs on those paths — the auth resolution cost is paid only on
// authenticated pages.

import { randomUUID } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Permission } from "@/shared/types";

import { TopNav } from "./nav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestId = randomUUID();
  const path = await currentPath();

  let permissions: ReadonlySet<Permission>;
  try {
    const ctx = await buildRequestContext(path, requestId);
    if (ctx.actor.kind !== "user") {
      throw new UnauthorizedError("non-user actor in operator UI");
    }
    permissions = ctx.actor.permissions;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(path));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <>
      <TopNav permissions={permissions} />
      {children}
    </>
  );
}

async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-pathname") ?? "/";
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Subscription planner
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the operator views.
        </p>
      </div>
    </main>
  );
}
