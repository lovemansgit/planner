// Day-25 / brief v1.12 §3.3.1 — /consignees/new (server component shell).
//
// Permission preflight only requires `consignee:create`; subscription
// creation moves to its own surface (Overview-tab CTA → /subscriptions/new).
// UnauthorizedError → redirect to /login; ForbiddenError → redirect to /.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { requirePermission } from "@/modules/identity";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { CreateConsigneeForm } from "./_components/CreateConsigneeForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewConsigneePage() {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext("/consignees/new", requestId);
    requirePermission(ctx, "consignee:create");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/consignees/new"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-3xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Consignees
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
            Onboard new consignee
          </h1>
          <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
            Capture identity + primary delivery address. Create a subscription or add an ad-hoc
            delivery from the consignee detail page after onboarding.
          </p>
        </header>

        <CreateConsigneeForm />
      </div>
    </main>
  );
}
