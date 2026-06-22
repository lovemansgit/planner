// Item 3 (22 Jun 2026) — read-only admin subscription detail.
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
      <div className="mx-auto max-w-4xl px-12 py-16">
        <header className="mb-16 flex items-start justify-between gap-12">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin · Subscriptions
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">
              {subscription.mealPlanName ?? "Subscription"}
            </h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              {merchant.name}{" "}
              <span className="font-mono text-xs text-[color:var(--color-text-tertiary)]">
                ({merchant.slug})
              </span>
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center bg-[color:var(--color-tint-navy-subtle)] px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] text-navy">
            {subscription.status}
          </span>
        </header>

        <Section title="Recipient">
          <FieldRow label="Consignee" value={consigneeName} />
          <FieldRow label="Consignee ID" value={subscription.consigneeId} mono />
        </Section>

        <Section title="Schedule">
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
        </Section>

        <Section title="Meta">
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
        </Section>

        <p className="mt-12">
          <Link
            href="/admin/subscriptions"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            ← Back to subscriptions
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
