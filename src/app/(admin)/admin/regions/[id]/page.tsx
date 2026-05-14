// Day 26 / T3 Sub-PR 3 — Read-only region detail page.
//
// Server component preflight mirrors merchants/[id]/page.tsx:
//   - buildRequestContext + findRegionByIdWithUsage (gates on region:manage)
//   - UnauthorizedError → redirect /login
//   - ForbiddenError    → redirect /
//   - NoTenantConfiguredError → render SystemNotInitialised inline
//   - region === null   → notFound()
//
// Layout per v1.14 plan §7.3 + v1.15 plan amendment §7.3:
//   - Header: eyebrow + h1 display_name + explainer (left)
//             status badge + DEACTIVATE button (right, when active)
//   - Section 1 Identity: client_id (mono), display_name, created.
//   - Section 2 Routing: auth_method row (read-only — IMMUTABLE),
//     in_use_count.
//
// auth_method is rendered as a labelled value WITHOUT any mutation
// affordance — IMMUTABLE per v1.15 amendment §2.1. The service-layer
// updateRegion Zod schema rejects auth_method input at parse time as
// defense-in-depth.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
        <header className="mb-16 flex items-start justify-between gap-12">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{region.displayName}</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Region routing details. Authentication method is permanent — set at creation and
              cannot be changed. Deactivation prevents new merchants from selecting this region but
              does not affect existing assignments.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-3">
            <span
              className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${status.className}`}
            >
              {status.label}
            </span>
            {region.status === "active" ? (
              <RegionDeactivateModal
                regionId={region.id}
                regionDisplayName={region.displayName}
                inUseCount={region.inUseCount}
                variant="detail"
              />
            ) : null}
          </div>
        </header>

        <Section title="Identity">
          <FieldRow label="Client ID" value={region.clientId} mono />
          <FieldRow label="Display name" value={region.displayName} />
          <FieldRow label="Created" value={formatCreatedAt(region.createdAt)} />
        </Section>

        <Section title="Routing">
          <div className="grid grid-cols-[1fr_2fr] gap-6 py-4">
            <p className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
              Auth method
            </p>
            <div>
              <span
                className={`inline-flex items-center px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${auth.className}`}
              >
                {auth.label}
              </span>
              <p className="mt-2 text-xs text-[color:var(--color-text-tertiary)]">
                Immutable. Permanently set at region creation.
              </p>
            </div>
          </div>
          <FieldRow label="In-use count" value={String(region.inUseCount)} />
        </Section>

        <p className="mt-12">
          <Link
            href="/admin/regions"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            ← Back to regions
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
