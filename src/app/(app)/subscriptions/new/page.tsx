// Day 22 / Phase 1 forms lane — /subscriptions/new server shell.
//
// Permission preflight: both subscription:create AND task:create
// (ops-manager only per Day-19 §J-5 SPLIT PERMS). The single-task
// mode dispatches createTask, which gates on task:create; the
// subscription mode dispatches createSubscription. Either denial
// would surface inline at submit, but we redirect at preflight for
// UX symmetry with merchants/new.
//
// Reads the consignee list for the form's picker. Pre-selects via
// `?consigneeId=` query param when arriving from a consignee detail
// page.

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { listConsignees } from "@/modules/consignees";
import { requirePermission } from "@/modules/identity";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { SubscriptionWithModeForm } from "./_components/SubscriptionWithModeForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  readonly searchParams: Promise<{ readonly consigneeId?: string }>;
}

export default async function NewSubscriptionPage({ searchParams }: PageProps) {
  const requestId = randomUUID();
  const { consigneeId: preselectedRaw } = await searchParams;

  let consignees;
  try {
    const ctx = await buildRequestContext("/subscriptions/new", requestId);
    requirePermission(ctx, "subscription:create");
    requirePermission(ctx, "task:create");
    consignees = await listConsignees(ctx);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/subscriptions/new"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    throw err;
  }

  const consigneeOptions = consignees.map((c) => ({ id: c.id, name: c.name }));
  const preselectedConsigneeId =
    preselectedRaw && consigneeOptions.some((c) => c.id === preselectedRaw)
      ? preselectedRaw
      : null;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-3xl px-12 py-16">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Subscriptions
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
            New subscription
          </h1>
          <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
            Recurring delivery rule, or one-off ad-hoc tasks for an existing consignee.
          </p>
        </header>

        {consigneeOptions.length === 0 ? (
          <div className="rounded-sm border border-stone-200 bg-paper p-6">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              No consignees yet. Onboard one first via the new-consignee wizard.
            </p>
          </div>
        ) : (
          <SubscriptionWithModeForm
            consignees={consigneeOptions}
            preselectedConsigneeId={preselectedConsigneeId}
          />
        )}
      </div>
    </main>
  );
}
