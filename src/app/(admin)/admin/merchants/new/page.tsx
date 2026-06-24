// Day 18 / C1 — New merchant page (server component preflight wrapper).
//
// Fixup for Day-18 reviewer Finding 1A: a tenant operator without
// merchant:create was previously able to navigate to /admin/merchants/new
// directly, see the form, and only get an inline forbidden error on
// submit. The list page (/admin/merchants) redirects on Forbidden;
// the new-form page now mirrors that posture for UX symmetry +
// defense-in-depth at the page boundary.
//
// Pattern mirrors merchants/page.tsx exactly:
//   - buildRequestContext + requirePermission(merchant:create) preflight
//   - UnauthorizedError      → redirect to /login
//   - ForbiddenError         → redirect to /
//   - NoTenantConfiguredError→ render SystemNotInitialised inline
//
// On success: render the CreateMerchantForm client component (existing
// useActionState behavior, unchanged from previous implementation —
// just relocated to _components/).

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { shellClass } from "@/components/page-shell-recipe";
import { requirePermission } from "@/modules/identity";
import { ForbiddenError, NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { CreateMerchantForm } from "./_components/CreateMerchantForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewMerchantPage() {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext("/admin/merchants/new", requestId);
    requirePermission(ctx, "merchant:create");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/merchants/new"));
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
      {/* shellClass so the header + form share the nav's left edge (Batch A
          content-width contract); the form itself stays a readable, left-aligned
          column rather than stretching the full content width (Phase 12.1). */}
      <div className={shellClass("py-16")}>
        <header className="mb-12">
          <p className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-2 font-b-display text-3xl font-bold tracking-[-0.01em] text-navy">
            New merchant
          </h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Provision a new merchant tenant. The merchant lands in <em>provisioning</em> status —
            activate from the list once configuration is complete.
          </p>
        </header>

        <div className="max-w-2xl">
          <CreateMerchantForm />
        </div>
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
