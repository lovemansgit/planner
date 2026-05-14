// Day 26 / T3 Sub-PR 3 — New region page (server component preflight wrapper).
//
// Pattern mirrors merchants/new/page.tsx exactly:
//   - buildRequestContext + requirePermission(region:manage) preflight
//   - UnauthorizedError      → redirect /login
//   - ForbiddenError         → redirect /
//   - NoTenantConfiguredError→ render SystemNotInitialised inline
//
// On success: render the CreateRegionForm client component.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { requirePermission } from "@/modules/identity";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { CreateRegionForm } from "./_components/CreateRegionForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewRegionPage() {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext("/admin/regions/new", requestId);
    requirePermission(ctx, "region:manage");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/regions/new"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">New SuiteFleet region</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Add a new region row. Merchants can be assigned to it from the merchant edit form.
            The authentication method is fixed at creation and governs how this region&rsquo;s merchants
            authenticate against SuiteFleet.
          </p>
        </header>

        <CreateRegionForm />
      </div>
    </main>
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
