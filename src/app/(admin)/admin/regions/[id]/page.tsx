// Day 26 / T3 Sub-PR 3 — Read-only region detail page.
//
// Phase 10 · Batch B3 — adopts the shared DetailView (Gap D, B+ skin): one
// floating card with a navy structural spine, two-column fill (D3), and the
// shared FieldRow (sentence-case labels per D2, "Not set" inline empties).
// Pure presentation — every field, value, link, action, and badge preserved;
// the status badge moves to the header status slot and DEACTIVATE to actions.
//
// Server component preflight mirrors merchants/[id]/page.tsx:
//   - buildRequestContext + findRegionByIdWithUsage (gates on region:manage)
//   - UnauthorizedError → redirect /login
//   - ForbiddenError    → redirect /
//   - NoTenantConfiguredError → render SystemNotInitialised inline
//   - region === null   → notFound()
//
// auth_method is rendered as a labelled value WITHOUT any mutation
// affordance — IMMUTABLE per v1.15 amendment §2.1. The service-layer
// updateRegion Zod schema rejects auth_method input at parse time as
// defense-in-depth.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { FieldRow } from "@/components/FieldRow";
import {
  findRegionByIdWithUsage,
  type RegionWithUsage,
} from "@/modules/credentials";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { RegionDeactivateModal } from "../_components/RegionDeactivateModal";
import { authMethodBadge, regionStatusBadge } from "../_helpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RegionDetailPageProps {
  readonly params: Promise<{
    readonly id: string;
  }>;
}

export default async function RegionDetailPage({ params }: RegionDetailPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let region: RegionWithUsage | null;
  try {
    const ctx = await buildRequestContext(`/admin/regions/${id}`, requestId);
    region = await findRegionByIdWithUsage(ctx, id as Uuid);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/regions/${id}`));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  if (!region) {
    notFound();
  }

  const status = regionStatusBadge(region.status);
  const auth = authMethodBadge(region.authMethod);

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <DetailView
          header={
            <DetailHeader
              eyebrow="Transcorp · Admin"
              title={region.displayName}
              status={
                <span
                  className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${status.className}`}
                >
                  {status.label}
                </span>
              }
              actions={
                region.status === "active" ? (
                  <RegionDeactivateModal
                    regionId={region.id}
                    regionDisplayName={region.displayName}
                    inUseCount={region.inUseCount}
                    variant="detail"
                  />
                ) : undefined
              }
            />
          }
        >
          <DetailSection label="Identity">
            <FieldRow label="Client ID" value={region.clientId} mono />
            <FieldRow label="Display name" value={region.displayName} />
            <FieldRow label="Created" value={formatCreatedAt(region.createdAt)} mono />
          </DetailSection>

          <DetailSection label="Routing">
            <FieldRow
              label="Auth method"
              value={
                <>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${auth.className}`}
                  >
                    {auth.label}
                  </span>
                  <span className="mt-2 block text-xs text-[color:var(--color-text-tertiary)]">
                    Immutable. Permanently set at region creation.
                  </span>
                </>
              }
            />
            <FieldRow label="In-use count" value={String(region.inUseCount)} mono />
          </DetailSection>
        </DetailView>

        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-[color:var(--color-text-secondary)]">
          Region routing details. Authentication method is permanent — set at creation and cannot be
          changed. Deactivation prevents new merchants from selecting this region but does not affect
          existing assignments.
        </p>

        <p className="mt-8">
          <Link
            href="/admin/regions"
            className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors hover:text-navy"
          >
            ← Back to regions
          </Link>
        </p>
      </div>
    </main>
  );
}

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
