// Day 25 / T2 — Read-only merchant detail page (per PR #270 plan).
//
// Server component preflight pattern mirrors merchants/page.tsx:
//   - buildRequestContext + getMerchantById (gates on merchant:read_all
//     post-C-2 perm-gate relaxation)
//   - UnauthorizedError → redirect to /login
//   - ForbiddenError    → redirect to /
//   - NoTenantConfiguredError → render SystemNotInitialised inline
//   - merchant === null → notFound() (Next.js default not-found surface)
//
// Layout per plan §3 + §9.5 ruling:
//   - Header: eyebrow + h1 name + explainer (left)
//             status badge + EDIT MERCHANT button (right, top-aligned)
//   - Section 1 Identity: Name, Slug, Created (status pulled to header
//     right zone per §9.5 vertical-alignment ruling)
//   - Section 2 Pickup address: Line / District / Emirate
//   - Section 3 Routing: SF customer code + Webhook URL (CopyableUrl)
//
// EDIT MERCHANT button gated on merchant:update (renders only when the
// actor's permission set includes it). Webhook URL uses the existing
// buildWebhookUrl + resolvePublicBaseUrl helpers per plan §4 — zero
// new derivation logic.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CopyableUrl } from "@/components/CopyableUrl";
import { getMerchantById } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import { buildWebhookUrl, resolvePublicBaseUrl } from "@/modules/webhooks";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { statusBadgeSurface } from "../_helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface MerchantDetailPageProps {
  readonly params: Promise<{
    readonly id: string;
  }>;
}

export default async function MerchantDetailPage({ params }: MerchantDetailPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let merchant: Merchant | null;
  let canEdit: boolean;
  try {
    const ctx = await buildRequestContext(`/admin/merchants/${id}`, requestId);
    merchant = await getMerchantById(ctx, id as Uuid);
    canEdit = ctx.actor.permissions.has("merchant:update");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/merchants/${id}`));
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

  const baseUrl = resolvePublicBaseUrl();
  const webhookUrl = buildWebhookUrl(merchant.tenantId, baseUrl);
  const badge = statusBadgeSurface(merchant.status);

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <header className="mb-16 flex items-start justify-between gap-12">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{merchant.name}</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Read-only details. Edit non-status fields via UPDATE MERCHANT; activate / deactivate
              from the merchants list.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${badge.className}`}
            >
              {badge.label}
            </span>
            {canEdit ? (
              <Link
                href={`/admin/merchants/${merchant.tenantId}/edit`}
                className="inline-flex items-center rounded-sm border border-navy bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
              >
                UPDATE MERCHANT
              </Link>
            ) : null}
          </div>
        </header>

        <Section title="Identity">
          <FieldRow label="Name" value={merchant.name} />
          <FieldRow label="Slug" value={merchant.slug} mono />
          <FieldRow label="Created" value={formatCreatedAt(merchant.createdAt)} />
        </Section>

        <Section title="Pickup address">
          <FieldRow label="Address line" value={merchant.pickupAddress?.line ?? null} />
          <FieldRow label="District" value={merchant.pickupAddress?.district ?? null} />
          <FieldRow label="Emirate" value={merchant.pickupAddress?.emirate ?? null} />
        </Section>

        <Section title="Routing">
          <FieldRow
            label="SuiteFleet customer code"
            value={merchant.suitefleetCustomerCode}
            mono
          />
          <div className="py-4">
            <p className="mb-2 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
              Webhook URL
            </p>
            <CopyableUrl url={webhookUrl} />
            <p className="mt-3 text-xs text-[color:var(--color-text-tertiary)]">
              Share with SuiteFleet vendor to wire inbound webhooks for this merchant. URL reflects
              the current deploy environment — for Production, use the value displayed at
              planner-olive-sigma.vercel.app.
            </p>
          </div>
        </Section>

        <p className="mt-12">
          <Link
            href="/admin/merchants"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            ← Back to merchants
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

interface FieldRowProps {
  readonly label: string;
  readonly value: string | null;
  readonly mono?: boolean;
}

function FieldRow({ label, value, mono = false }: FieldRowProps) {
  const isEmpty = value === null || value === undefined || value === "";
  const valueClass = mono ? "font-mono text-sm" : "text-sm";
  return (
    <div className="grid grid-cols-[1fr_2fr] gap-6 py-4">
      <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
        {label}
      </p>
      {isEmpty ? (
        <p className="text-sm text-[color:var(--color-text-tertiary)]">—</p>
      ) : (
        <p className={`${valueClass} text-navy`}>{value}</p>
      )}
    </div>
  );
}

/**
 * Render a UTC ISO timestamp as `YYYY-MM-DD`. Mirrors the list page
 * `formatCreatedAt` at merchants/page.tsx:179-181 — operator-facing
 * date granularity is enough; time-of-day not load-bearing here.
 */
function formatCreatedAt(iso: string): string {
  return iso.slice(0, 10);
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
