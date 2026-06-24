// Day 25 / T2 — Read-only merchant detail page (per PR #270 plan).
//
// Phase 10 · Batch B3 — adopts the shared DetailView (Gap D, B+ skin): one
// floating card with a navy structural spine, two-column fill (D3), and the
// shared FieldRow (sentence-case labels per D2, "Not set" inline empties
// instead of bare "—"). Pure presentation — every field, value, link, action,
// and badge is preserved; the status badge moves to the header status slot and
// UPDATE MERCHANT to the header actions slot.
//
// Server component preflight pattern mirrors merchants/page.tsx:
//   - buildRequestContext + getMerchantById (gates on merchant:read_all
//     post-C-2 perm-gate relaxation)
//   - UnauthorizedError → redirect to /login
//   - ForbiddenError    → redirect to /
//   - NoTenantConfiguredError → render SystemNotInitialised inline
//   - merchant === null → notFound() (Next.js default not-found surface)
//
// EDIT MERCHANT button gated on merchant:update (renders only when the
// actor's permission set includes it). Webhook URL uses the existing
// buildWebhookUrl + resolvePublicBaseUrl helpers — zero new derivation logic.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { bButtonClass } from "@/components/button-recipe";
import { CopyableUrl } from "@/components/CopyableUrl";
import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { SECTION_LABEL } from "@/components/detail-view-recipe";
import { FieldRow } from "@/components/FieldRow";
import { findRegionForMerchant, type Region } from "@/modules/credentials";
import { getMerchantAssetTrackingEnabled, getMerchantById } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import { buildWebhookUrl, resolvePublicBaseUrl } from "@/modules/webhooks";
import { ForbiddenError, NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { authMethodBadge } from "../../regions/_helpers";
import { merchantEffectiveAuthMethod, statusBadgeSurface } from "../_helpers";
import { AssetTrackingToggle } from "./_components/AssetTrackingToggle";

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
  let region: Region | null = null;
  let canEdit: boolean;
  let canManageCredentials: boolean;
  let assetTrackingEnabled = false;
  try {
    const ctx = await buildRequestContext(`/admin/merchants/${id}`, requestId);
    merchant = await getMerchantById(ctx, id as Uuid);
    canEdit = ctx.actor.permissions.has("merchant:update");
    canManageCredentials = ctx.actor.permissions.has("merchant:update");
    if (merchant) {
      region = await findRegionForMerchant(ctx, merchant.suitefleetRegionId);
      assetTrackingEnabled = (await getMerchantAssetTrackingEnabled(ctx, id as Uuid)) ?? false;
    }
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
  const credentialsConfigured =
    merchant.suitefleetCredential1VaultId !== null &&
    merchant.suitefleetCredential2VaultId !== null;
  // Day-53: render the EFFECTIVE method (override ?? region default) —
  // the region's raw method misreports any merchant flipped via the
  // credentials page's auth-method switch.
  const effectiveAuth =
    region !== null
      ? merchantEffectiveAuthMethod(merchant.suitefleetAuthMethodOverride, region.authMethod)
      : null;
  const authBadge = effectiveAuth !== null ? authMethodBadge(effectiveAuth.method) : null;

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <DetailView
          header={
            <DetailHeader
              eyebrow="Transcorp · Admin"
              title={merchant.name}
              status={
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              }
              actions={
                canEdit ? (
                  // Server component: a styled <Link> (NOT <Button href>) keeps
                  // the B+ skin without the server-side onClick→next/link RSC
                  // serialization trap (#624).
                  <Link
                    href={`/admin/merchants/${merchant.tenantId}/edit`}
                    className={bButtonClass("secondary", "md")}
                  >
                    Edit merchant
                  </Link>
                ) : undefined
              }
            />
          }
        >
          <DetailSection label="Identity">
            <FieldRow label="Name" value={merchant.name} />
            <FieldRow label="Slug" value={merchant.slug} mono />
            <FieldRow label="Created" value={formatCreatedAt(merchant.createdAt)} mono />
          </DetailSection>

          <DetailSection label="Pickup address">
            <FieldRow label="Address line" value={merchant.pickupAddress?.line ?? null} />
            <FieldRow label="District" value={merchant.pickupAddress?.district ?? null} />
            <FieldRow label="Emirate" value={merchant.pickupAddress?.emirate ?? null} />
          </DetailSection>

          <DetailSection label="Routing">
            <FieldRow
              label="SuiteFleet customer code"
              value={merchant.suitefleetCustomerCode}
              mono
            />
            <FieldRow
              label="SuiteFleet region"
              value={
                region ? (
                  <Link
                    href={`/admin/regions/${region.id}`}
                    className="text-navy underline-offset-4 hover:underline"
                  >
                    {region.displayName}{" "}
                    <span className="font-b-mono text-xs text-[color:var(--color-text-tertiary)]">
                      ({region.clientId})
                    </span>
                  </Link>
                ) : null
              }
            />
            {authBadge ? (
              <FieldRow
                label="Auth method"
                value={
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${authBadge.className}`}
                    >
                      {authBadge.label}
                    </span>
                    {effectiveAuth?.overrideActive ? (
                      <span className="text-xs text-[color:var(--color-text-secondary)]">
                        (merchant override)
                      </span>
                    ) : null}
                  </span>
                }
              />
            ) : null}
            <FieldRow
              label="Credentials"
              value={
                <span className="inline-flex flex-wrap items-center gap-4">
                  {credentialsConfigured ? (
                    <span className="inline-flex items-center rounded-full bg-green/15 px-2.5 py-1 text-xs font-medium text-green">
                      Configured
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber/15 px-2.5 py-1 text-xs font-medium text-amber-deep">
                      Missing
                    </span>
                  )}
                  {canManageCredentials ? (
                    <Link
                      href={`/admin/merchants/${merchant.tenantId}/credentials`}
                      className="text-xs text-[color:var(--color-text-secondary)] underline-offset-4 hover:text-navy hover:underline"
                    >
                      Manage credentials →
                    </Link>
                  ) : null}
                </span>
              }
            />
          </DetailSection>

          <DetailSection label="Asset tracking">
            <FieldRow
              label="Bag / asset tracking"
              value={
                <>
                  <AssetTrackingToggle
                    tenantId={merchant.tenantId}
                    enabled={assetTrackingEnabled}
                    canEdit={canEdit}
                  />
                  <span className="mt-2 block text-xs text-[color:var(--color-text-tertiary)]">
                    Gates the Inventory + Asset Tracking reports, the tracking poll, and the related
                    nav entries for this merchant. Off by default; turning it on lights those
                    surfaces for this merchant only.
                  </span>
                </>
              }
            />
          </DetailSection>

          {/*
            Webhook URL is a full-bleed share affordance, not a label/value pair.
            It spans both detail columns (md:col-span-2) so the CopyableUrl's
            mono code box gets the full card width — the cramped ~160px value
            cell of the 140px/1fr FieldRow grid forced break-all to wrap the URL
            almost one character per line. Same SECTION_LABEL eyebrow as the
            DetailSections so it reads as a peer section, not an orphan.
          */}
          <section className="md:col-span-2">
            <p className={SECTION_LABEL}>Webhook URL</p>
            <CopyableUrl url={webhookUrl} />
            <p className="mt-3 text-xs text-[color:var(--color-text-tertiary)]">
              Share with SuiteFleet vendor to wire inbound webhooks for this merchant. URL reflects
              the current deploy environment — for Production, use the value displayed at
              planner-olive-sigma.vercel.app.
            </p>
          </section>
        </DetailView>

        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-text-secondary)]">
          Read-only details. Edit non-status fields via the Edit merchant action; activate /
          deactivate from the merchants list.
        </p>

        <p className="mt-8">
          <Link
            href="/admin/merchants"
            className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors hover:text-navy"
          >
            ← Back to merchants
          </Link>
        </p>
      </div>
    </main>
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
