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
import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { FieldRow } from "@/components/FieldRow";
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
import { formatPhone } from "@/shared/humanize";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";
import { shellClass } from "@/components/page-shell-recipe";

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
      <div className={shellClass("py-16")}>
        {/* Phase 9 · 3.5 — adopts the shared DetailView (Gap D, B+ skin): one
            floating card with a navy structural spine, two-column fill (D3), and
            the shared FieldRow (sentence-case labels per D2, "Not set" inline
            empties instead of bare "—"). Read-only: the CrmStateBadge stays as
            the header status (its consolidation onto StatusBadge is the deferred
            CRM follow-up). */}
        <DetailView
          header={
            <DetailHeader
              eyebrow="Transcorp · Admin · Consignees"
              title={consignee.name}
              status={<CrmStateBadge state={consignee.crmState} />}
            />
          }
        >
          <DetailSection label="Identity">
            <FieldRow
              label="Merchant"
              value={
                <>
                  {merchant.name}{" "}
                  <span className="font-b-mono text-xs text-[color:var(--color-text-tertiary)]">
                    ({merchant.slug})
                  </span>
                </>
              }
            />
            <FieldRow label="Name" value={consignee.name} />
            <FieldRow label="Phone" value={formatPhone(consignee.phone)} mono />
            <FieldRow label="Email" value={consignee.email} />
            <FieldRow label="Merchant reference" value={consignee.externalRef} mono />
          </DetailSection>

          <DetailSection label="Address">
            <FieldRow label="Address line" value={consignee.addressLine} />
            <FieldRow label="District" value={consignee.district} />
            <FieldRow label="City" value={consignee.emirateOrRegion} />
          </DetailSection>

          <DetailSection label="Notes">
            <FieldRow label="Delivery notes" value={consignee.deliveryNotes} />
            <FieldRow label="Internal notes" value={consignee.notesInternal} />
            <FieldRow label="Created" value={consignee.createdAt.slice(0, 10)} mono />
          </DetailSection>
        </DetailView>

        <p className="mt-8">
          <Link
            href="/admin/consignees"
            className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors hover:text-navy"
          >
            ← Back to consignees
          </Link>
        </p>
      </div>
    </main>
  );
}

