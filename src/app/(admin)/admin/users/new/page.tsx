// Day-24 — /admin/users/new server-rendered shell.
//
// Loads the tenant list (Transcorp tenant + active merchants) and
// hands it to the client-side UserCreateForm. Form's role dropdown
// re-renders depending on which tenant is selected (transcorp vs
// merchant) — that branching lives on the client; server's only job
// is to load the tenant options + permission-gate the page.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { listMerchants } from "@/modules/merchants/service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import { withServiceRole } from "@/shared/db";
import { sql as sqlTag } from "drizzle-orm";

import { UserCreateForm } from "./_components/UserCreateForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    const merchants = await listMerchants(ctx);
    const transcorpTenant = await fetchTranscorpTenant();
    tenantOptions = [
      ...(transcorpTenant ? [transcorpTenant] : []),
      ...merchants
        .filter((m) => m.status === "active" || m.status === "provisioning")
        .map((m) => ({
          id: m.tenantId,
          slug: m.slug,
          name: m.name,
          kind: "merchant" as const,
        })),
    ];
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

async function fetchTranscorpTenant(): Promise<TenantOption | null> {
  return withServiceRole("transcorp_staff:list_internal_tenant", async (tx) => {
    type Row = { id: string; slug: string; name: string } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT id, slug, name FROM tenants WHERE slug = 'transcorp' LIMIT 1
    `);
    if (rows.length === 0) return null;
    const row = rows[0];
    return { id: row.id, slug: row.slug, name: row.name, kind: "transcorp" };
  });
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
