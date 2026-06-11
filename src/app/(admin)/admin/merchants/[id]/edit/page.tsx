// Day 25 / T3 — Edit merchant page (server component preflight wrapper).
//
// Mirrors merchants/new/page.tsx posture:
//   - buildRequestContext + requirePermission(merchant:update) preflight
//   - UnauthorizedError      → redirect to /login
//   - ForbiddenError         → redirect to /
//   - NoTenantConfiguredError→ render SystemNotInitialised inline
//
// Then loads the merchant via getMerchantById (gated on merchant:read_all
// post PR #270 plan §9.2 perm-gate relaxation) and renders the
// EditMerchantForm client component with the current row as pre-fill.
//
// Edit-specific guard: explicit page-level requirePermission(merchant:update)
// preflight maintains gate parity with the updateMerchantAction submit
// path. Without this preflight, a future read_all-only role (not in
// catalogue today, but on the roadmap per `transcorp-readonly` question
// in PR #270 §9.1) would be able to LOAD the form but get ForbiddenError
// on submit — a UX dead-end + defense-in-depth gap.
//
// notFound() fires when the tenant id doesn't match a row — Next.js
// renders the project's default not-found surface.

import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";

import { listRegions, type Region } from "@/modules/credentials";
import { requirePermission } from "@/modules/identity";
import { getMerchantById } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { EditMerchantForm } from "./_components/EditMerchantForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface EditMerchantPageProps {
  readonly params: Promise<{
    readonly id: string;
  }>;
}

export default async function EditMerchantPage({ params }: EditMerchantPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let merchant: Merchant | null;
  let activeRegions: readonly Region[] = [];
  try {
    const ctx = await buildRequestContext(`/admin/merchants/${id}/edit`, requestId);
    requirePermission(ctx, "merchant:update");
    merchant = await getMerchantById(ctx, id as Uuid);
    // Picker source: only active regions. Operators shouldn't be able
    // to route a merchant to a deactivated region — the resolver would
    // fail closed at push time. transcorp-sysadmin (the only role with
    // merchant:update in v1) also has region:manage; listRegions's
    // permission gate is satisfied.
    activeRegions = await listRegions(ctx, { onlyActive: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(
        "/login?next=" + encodeURIComponent(`/admin/merchants/${id}/edit`),
      );
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  if (!merchant) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Edit merchant</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Update <span className="font-medium text-navy">{merchant.name}</span>{" "}
            identity, pickup address, or SuiteFleet routing. Status changes
            (activate / deactivate) happen on the merchants list.
          </p>
        </header>

        <EditMerchantForm initial={merchant} activeRegions={activeRegions} />
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
