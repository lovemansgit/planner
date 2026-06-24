// Item 3 (22 Jun 2026) — read-only admin subscription detail.
//
// Phase 10 · Batch B3 — adopts the shared DetailView (Gap D, B+ skin): one
// floating card with a navy structural spine, two-column fill (D3), and the
// shared FieldRow (sentence-case labels per D2, "Not set" inline empties).
// Pure presentation — every field/value/link preserved. The status pill moves
// to the header status slot; the merchant subtitle becomes a "Merchant"
// FieldRow in Recipient (mirroring the flagship admin-consignee-detail).
//
// Reached by clicking a row on /admin/subscriptions. Cross-tenant single
// fetch (getAdminSubscriptionById), then resolve the consignee (name)
// and the owning merchant. The merchant lookup doubles as Item 1's
// genuine-tenant gate — a subscription under a test tenant 404s.
// Read-only; pause/resume + lifecycle actions stay on the tenant-scoped
// operator surface.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { FieldRow } from "@/components/FieldRow";
import { getAdminConsigneeById } from "@/modules/consignees/service";
import { isGenuineMerchant } from "@/modules/merchants/genuine-merchants";
import { getMerchantById } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import { getAdminSubscriptionById } from "@/modules/subscriptions/service";
import type { Subscription } from "@/modules/subscriptions/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";
import { shellClass } from "@/components/page-shell-recipe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ISO_WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** ISO 1-7 (Mon=1 … Sun=7) → "Mon, Wed, Fri", sorted. */
function formatDays(days: readonly number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => ISO_WEEKDAYS[d] ?? String(d))
    .join(", ");
}

interface AdminSubscriptionDetailPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function AdminSubscriptionDetailPage({
  params,
}: AdminSubscriptionDetailPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let subscription: Subscription | null;
  let merchant: Merchant | null = null;
  let consigneeName: string | null = null;
  try {
    const ctx = await buildRequestContext(`/admin/subscriptions/${id}`, requestId);
    subscription = await getAdminSubscriptionById(ctx, id as Uuid);
    if (subscription) {
      merchant = await getMerchantById(ctx, subscription.tenantId);
      const consignee = await getAdminConsigneeById(ctx, subscription.consigneeId);
      consigneeName = consignee?.name ?? null;
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/subscriptions/${id}`));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      redirect("/admin/subscriptions");
    }
    throw err;
  }

  if (
    subscription === null ||
    merchant === null ||
    !isGenuineMerchant({ slug: merchant.slug, status: merchant.status })
  ) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className={shellClass("py-16")}>
        <DetailView
          header={
            <DetailHeader
              eyebrow="Transcorp · Admin · Subscriptions"
              title={subscription.mealPlanName ?? "Subscription"}
              status={
                <span className="inline-flex items-center bg-[color:var(--color-tint-navy-subtle)] px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] text-navy">
                  {subscription.status}
                </span>
              }
            />
          }
        >
          <DetailSection label="Recipient">
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
            <FieldRow label="Consignee" value={consigneeName} />
            <FieldRow label="Consignee ID" value={subscription.consigneeId} mono />
          </DetailSection>

          <DetailSection label="Schedule">
            <FieldRow label="Plan name" value={subscription.mealPlanName} />
            <FieldRow label="Start date" value={subscription.startDate} mono />
            <FieldRow label="End date" value={subscription.endDate ?? "Open-ended"} mono />
            <FieldRow label="Days of week" value={formatDays(subscription.daysOfWeek)} />
            <FieldRow
              label="Delivery window"
              value={`${subscription.deliveryWindowStart} – ${subscription.deliveryWindowEnd}`}
              mono
            />
            <FieldRow
              label="Address"
              value={
                subscription.deliveryAddressOverride === null
                  ? "Consignee default address"
                  : "Custom override"
              }
            />
          </DetailSection>

          <DetailSection label="Meta">
            <FieldRow label="External reference" value={subscription.externalRef} mono />
            <FieldRow label="Internal notes" value={subscription.notesInternal} />
            <FieldRow
              label="Paused at"
              value={subscription.pausedAt ? subscription.pausedAt.slice(0, 10) : null}
              mono
            />
            <FieldRow
              label="Ended at"
              value={subscription.endedAt ? subscription.endedAt.slice(0, 10) : null}
              mono
            />
            <FieldRow label="Created" value={subscription.createdAt.slice(0, 10)} mono />
          </DetailSection>
        </DetailView>

        <p className="mt-8">
          <Link
            href="/admin/subscriptions"
            className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors hover:text-navy"
          >
            ← Back to subscriptions
          </Link>
        </p>
      </div>
    </main>
  );
}
