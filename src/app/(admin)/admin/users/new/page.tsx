// Day-24 — /admin/users/new server-rendered shell.
//
// Loads the tenant list (Transcorp tenant + every non-archived
// merchant — active AND provisioning, so freshly-onboarded merchants
// that need their first admin user appear in the dropdown without an
// activation round-trip) and hands it to the client-side
// UserCreateForm. Form's role dropdown re-renders depending on which
// tenant is selected (transcorp vs merchant) — that branching lives
// on the client; server's only job is to load the tenant options +
// permission-gate the page.
//
// Day-24 hotfix: `listMerchants` already returns the Transcorp
// tenant alongside merchants (per the registered followup at
// memory/followup_admin_merchant_list_filter_internal_tenant.md —
// there's no is_internal flag yet). The previous build also fetched
// it explicitly via a separate query, duplicating "Transcorp" in the
// dropdown. Now: single fetch via listMerchants, then classify each
// row by slug to set `kind`. Provisioning tenants are kept (Demo
// Bistro lands as `provisioning` post-onboarding before activation;
// without including it the new-user form blocks the "create merchant,
// then create their admin user" workflow).

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { listMerchants } from "@/modules/merchants/service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { UserCreateForm } from "./_components/UserCreateForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TRANSCORP_TENANT_SLUG = "transcorp";

interface TenantOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: "transcorp" | "merchant";
}

export default async function AdminUsersNewPage() {
  const requestId = randomUUID();

  let tenantOptions: readonly TenantOption[];
  try {
    const ctx = await buildRequestContext("/admin/users/new", requestId);
    if (ctx.actor.kind !== "user" || !ctx.actor.permissions.has("merchant:read_all")) {
      throw new ForbiddenError("/admin/users/new requires merchant:read_all");
    }
    const allTenants = await listMerchants(ctx);
    // Keep every non-archived tenant — listMerchants's default
    // already excludes archived. Filter only `inactive` (operators
    // shouldn't provision new users for a sunset merchant); keep
    // active + provisioning + suspended. Classification: the lone
    // 'transcorp' slug is the internal tenant, everything else is a
    // merchant.
    tenantOptions = allTenants
      .filter((t) => t.status !== "inactive")
      .map<TenantOption>((t) => ({
        id: t.tenantId,
        slug: t.slug,
        name: t.name,
        kind: t.slug === TRANSCORP_TENANT_SLUG ? "transcorp" : "merchant",
      }))
      // Transcorp first so the role dropdown defaults to a
      // transcorp-sysadmin assignment when the form loads (most
      // common operator path is Transcorp-sysadmin onboarding more
      // Transcorp staff).
      .sort((a, b) => {
        if (a.kind === "transcorp" && b.kind !== "transcorp") return -1;
        if (b.kind === "transcorp" && a.kind !== "transcorp") return 1;
        return a.name.localeCompare(b.name, "en-GB");
      });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/users/new"));
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
            Transcorp · Admin · Users
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">New user</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Provision a Planner user under a tenant. The user receives the
            temporary password you set here; share it via 1Password.
          </p>
        </header>

        <UserCreateForm tenantOptions={tenantOptions} />
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
