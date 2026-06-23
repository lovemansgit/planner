// Item 3 (22 Jun 2026) — read-only admin task detail.
//
// Phase 10 · Batch B3 — adopts the shared DetailView (Gap D, B+ skin) for the
// detail CHROME only: one floating card with a navy structural spine, two-column
// fill (D3), and the shared FieldRow. TASK BOUNDARY — task status derivation and
// courier_status logic are untouched: the header pill keeps the exact
// `courierStatus ?? internalStatus` expression and the Coarse/Courier status
// rows render the same `internalStatus` / `courierStatus` values; only the
// presentation shell changes.
//
// Reached by clicking a row on /admin/tasks. Cross-tenant single fetch
// (getAdminTaskById), then resolve the consignee (name) and the owning
// merchant — the merchant lookup is also Item 1's genuine-tenant gate
// (a task under a test tenant 404s). Read-only fields view.
//
// Timeline drawer (Love-ruled 22 Jun 2026): the rich SF webhook
// TaskTimelineDrawer is embedded here via AdminTaskTimeline, which
// injects the CROSS-TENANT admin actions (getAdminTask*Action — gate
// `task:read_all`, withServiceRole, resolve the task's own tenant). The
// subscription-event family read is explicitly fenced to the task's
// tenant (Floor-5) so the cross-tenant read cannot leak.

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DetailHeader, DetailSection, DetailView } from "@/components/DetailView";
import { FieldRow } from "@/components/FieldRow";
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

import { AdminTaskTimeline } from "./_components/AdminTaskTimeline";

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
        <DetailView
          header={
            <DetailHeader
              eyebrow="Transcorp · Admin · Tasks"
              title={title}
              status={
                <span className="inline-flex items-center bg-[color:var(--color-tint-navy-subtle)] px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] text-navy">
                  {task.courierStatus ?? task.internalStatus}
                </span>
              }
              actions={
                <AdminTaskTimeline
                  consigneeId={task.consigneeId}
                  taskId={task.id}
                  deliveryDate={task.deliveryDate}
                  awb={task.externalTrackingNumber}
                />
              }
            />
          }
        >
          <DetailSection label="Delivery">
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
            <FieldRow label="Delivery date" value={task.deliveryDate} mono />
            <FieldRow
              label="Window"
              value={`${task.deliveryStartTime} – ${task.deliveryEndTime}`}
              mono
            />
            <FieldRow label="Coarse status" value={task.internalStatus} />
            <FieldRow label="Courier status" value={task.courierStatus ?? null} />
          </DetailSection>

          <DetailSection label="Order">
            <FieldRow label="AWB / tracking" value={task.externalTrackingNumber} mono />
            <FieldRow label="Customer order #" value={task.customerOrderNumber} mono />
            <FieldRow label="Reference #" value={task.referenceNumber} mono />
            <FieldRow label="Created via" value={task.createdVia} />
            <FieldRow label="Address label" value={task.addressLabel ?? null} />
          </DetailSection>

          <DetailSection label="Meta">
            <FieldRow
              label="Pushed to SuiteFleet"
              value={task.pushedToExternalAt ? task.pushedToExternalAt.slice(0, 10) : null}
              mono
            />
            <FieldRow label="SuiteFleet ID" value={task.externalId} mono />
            <FieldRow label="Created" value={task.createdAt.slice(0, 10)} mono />
          </DetailSection>
        </DetailView>

        <p className="mt-8">
          <Link
            href="/admin/tasks"
            className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors hover:text-navy"
          >
            ← Back to tasks
          </Link>
        </p>
      </div>
    </main>
  );
}
