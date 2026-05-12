// Day 22 / Phase 1 forms lane — /consignees/[id]/edit page.
//
// Loads the consignee, gates on consignee:update, hands defaults to
// the EditConsigneeForm client component. Address editing deferred
// to Phase 2 per memory/followup_multi_address_rotation_phase_2.md.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getConsignee } from "@/modules/consignees";
import { requirePermission } from "@/modules/identity";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { EditConsigneeForm } from "./_components/EditConsigneeForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function EditConsigneePage({ params }: PageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let consignee;
  try {
    const ctx = await buildRequestContext(`/consignees/${id}/edit`, requestId);
    requirePermission(ctx, "consignee:update");
    consignee = await getConsignee(ctx, id as Uuid);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/consignees/${id}/edit`));
    }
    if (err instanceof ForbiddenError) {
      redirect(`/consignees/${id}`);
    }
    throw err;
  }

  if (!consignee) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-3xl px-12 py-16">
        <Link
          href={`/consignees/${id}`}
          className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
        >
          ← {consignee.name}
        </Link>

        <header className="mb-12 mt-6">
          <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Consignee · Edit
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
            Edit {consignee.name}
          </h1>
          <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
            Update non-address details. Delivery address editing ships in Phase 2 alongside
            multi-address rotation.
          </p>
        </header>

        <EditConsigneeForm
          consigneeId={consignee.id}
          defaults={{
            name: consignee.name,
            phone: consignee.phone,
            email: consignee.email,
            deliveryNotes: consignee.deliveryNotes,
            externalRef: consignee.externalRef,
            notesInternal: consignee.notesInternal,
          }}
        />
      </div>
    </main>
  );
}
