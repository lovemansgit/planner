// Item 3 (22 Jun 2026) — read-only admin task detail.
//
// Reached by clicking a row on /admin/tasks. Cross-tenant single fetch
// (getAdminTaskById), then resolve the consignee (name) and the owning
// merchant — the merchant lookup is also Item 1's genuine-tenant gate
// (a task under a test tenant 404s). Read-only fields view.
//
// FOLLOW-UP (flagged in the PR, not built here): embedding the rich
// SF webhook TaskTimelineDrawer on this admin page. It is a client
// drawer whose lazy timeline/history server actions are written for the
// tenant-scoped operator context; wiring it cross-tenant needs its own
// verification + reviewer pass. The fields view below is the read-only
// detail Love asked for.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAdminConsigneeById } from "@/modules/consignees/service";
import { isGenuineMerchant } from "@/modules/merchants/genuine-merchants";
import { getMerchantById } from "@/modules/merchants/service";
import type { Merchant } from "@/modules/merchants/types";
import { getAdminTaskById } from "@/modules/tasks/service";
import type { Task } from "@/modules/tasks/types";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface AdminTaskDetailPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function AdminTaskDetailPage({ params }: AdminTaskDetailPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let task: Task | null;
  let merchant: Merchant | null = null;
  let consigneeName: string | null = null;
  try {
    const ctx = await buildRequestContext(`/admin/tasks/${id}`, requestId);
    task = await getAdminTaskById(ctx, id as Uuid);
    if (task) {
      merchant = await getMerchantById(ctx, task.tenantId);
      const consignee = await getAdminConsigneeById(ctx, task.consigneeId);
      consigneeName = consignee?.name ?? null;
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent(`/admin/tasks/${id}`));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      redirect("/admin/tasks");
    }
    throw err;
  }

  if (
    task === null ||
    merchant === null ||
    !isGenuineMerchant({ slug: merchant.slug, status: merchant.status })
  ) {
    notFound();
  }

  const title = task.externalTrackingNumber ?? task.customerOrderNumber ?? "Task";

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <header className="mb-16 flex items-start justify-between gap-12">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
              Transcorp · Admin · Tasks
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              {merchant.name}{" "}
              <span className="font-mono text-xs text-[color:var(--color-text-tertiary)]">
                ({merchant.slug})
              </span>
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center bg-[color:var(--color-tint-navy-subtle)] px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] text-navy">
            {task.courierStatus ?? task.internalStatus}
          </span>
        </header>

        <Section title="Delivery">
          <FieldRow label="Consignee" value={consigneeName} />
          <FieldRow label="Delivery date" value={task.deliveryDate} mono />
          <FieldRow
            label="Window"
            value={`${task.deliveryStartTime} – ${task.deliveryEndTime}`}
            mono
          />
          <FieldRow label="Coarse status" value={task.internalStatus} />
          <FieldRow label="Courier status" value={task.courierStatus ?? null} />
        </Section>

        <Section title="Order">
          <FieldRow label="AWB / tracking" value={task.externalTrackingNumber} mono />
          <FieldRow label="Customer order #" value={task.customerOrderNumber} mono />
          <FieldRow label="Reference #" value={task.referenceNumber} mono />
          <FieldRow label="Created via" value={task.createdVia} />
          <FieldRow label="Address label" value={task.addressLabel ?? null} />
        </Section>

        <Section title="Meta">
          <FieldRow
            label="Pushed to SuiteFleet"
            value={task.pushedToExternalAt ? task.pushedToExternalAt.slice(0, 10) : null}
            mono
          />
          <FieldRow label="SuiteFleet ID" value={task.externalId} mono />
          <FieldRow label="Created" value={task.createdAt.slice(0, 10)} mono />
        </Section>

        <p className="mt-12">
          <Link
            href="/admin/tasks"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            ← Back to tasks
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
