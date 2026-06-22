// Item 3 (22 Jun 2026) — read-only admin consignee detail.
//
// Reached by clicking a row on /admin/consignees. Mirrors the merchants
// detail pattern: cross-tenant single fetch (getAdminConsigneeById), then
// resolve the owning merchant (getMerchantById) both for display AND to
// apply Item 1's "test tenants are never visible" gate — a consignee
// whose merchant isn't genuine 404s here too. Read-only; the rich
// operator-side consignee surface (tabs + calendar) stays tenant-scoped.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CrmStateBadge } from "@/app/(app)/consignees/[id]/_components/CrmStateBadge";
import { getAdminConsigneeById } from "@/modules/consignees/service";
import type { Consignee } from "@/modules/consignees/types";
import { isGenuineMerchant } from "@/modules/merchants/genuine-merchants";
import { getMerchantById } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminConsigneeDetailPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function AdminConsigneeDetailPage({
  params,
}: AdminConsigneeDetailPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let consignee: Consignee | null;
  let merchant: Merchant | null = null;
  try {
    const ctx = await buildRequestContext(`/admin/consignees/${id}`, requestId);
    consignee = await getAdminConsigneeById(ctx, id as Uuid);
    if (consignee) {
      merchant = await getMerchantById(ctx, consignee.tenantId);
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/consignees/${id}`));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      redirect("/admin/consignees");
    }
    throw err;
  }

  // Not found, or its merchant is an automated-test tenant (Item 1).
  if (
    consignee === null ||
    merchant === null ||
    !isGenuineMerchant({ slug: merchant.slug, status: merchant.status })
  ) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <header className="mb-16 flex items-start justify-between gap-12">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin · Consignees
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{consignee.name}</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              {merchant.name}{" "}
              <span className="font-mono text-xs text-[color:var(--color-text-tertiary)]">
                ({merchant.slug})
              </span>
            </p>
          </div>
          <div className="shrink-0">
            <CrmStateBadge state={consignee.crmState} />
          </div>
        </header>

        <Section title="Identity">
          <FieldRow label="Name" value={consignee.name} />
          <FieldRow label="Phone" value={consignee.phone} mono />
          <FieldRow label="Email" value={consignee.email} />
          <FieldRow label="Merchant reference" value={consignee.externalRef} mono />
        </Section>

        <Section title="Address">
          <FieldRow label="Address line" value={consignee.addressLine} />
          <FieldRow label="District" value={consignee.district} />
          <FieldRow label="Emirate / region" value={consignee.emirateOrRegion} />
        </Section>

        <Section title="Notes">
          <FieldRow label="Delivery notes" value={consignee.deliveryNotes} />
          <FieldRow label="Internal notes" value={consignee.notesInternal} />
          <FieldRow label="Created" value={consignee.createdAt.slice(0, 10)} mono />
        </Section>

        <p className="mt-12">
          <Link
            href="/admin/consignees"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            ← Back to consignees
          </Link>
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12 border-t border-[color:var(--color-border-strong)] pt-8">
      <p className="mb-6 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        {title}
      </p>
      <div className="divide-y divide-[color:var(--color-border-default)]">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly mono?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-6 py-4">
      <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
        {label}
      </p>
      {isEmpty ? (
        <p className="text-sm text-[color:var(--color-text-tertiary)]">—</p>
      ) : (
        <p className={`text-sm text-navy ${mono ? "font-mono" : ""}`}>{value}</p>
      )}
    </div>
  );
}
