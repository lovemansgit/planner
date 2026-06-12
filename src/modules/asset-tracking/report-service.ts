// Bag-tracking report service — Day-54 P2 (plan PR #502 §5/§6).
//
// Two report surfaces, two permission models (plan §5):
//   - Admin Asset Tracking + all-merchants Inventory:
//     `asset_tracking:read_all` (systemOnly) + withServiceRole, the
//     /admin/tasks pattern. Query-level scoping to tenants whose dark
//     switch is ON keeps disabled merchants invisible.
//   - Tenant Inventory: `asset_tracking:read` + withTenant; RLS scopes.
//     The page additionally renders the dark state when the tenant's
//     own flag is off (posture 7b — the flag gates ALL surfaces).
//
// Reads are NOT audited (R-4 — same posture as the cache reads).

import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole, withTenant } from "@/shared/db";
import { ValidationError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { requirePermission } from "../identity";

import {
  aggregateAdminAssetTracking,
  aggregateInventoryByConsignee,
  aggregateInventoryByDate,
  findGlobalReportMeta,
  findTenantReportMeta,
} from "./report-repository";
import type {
  AdminAssetTrackingRow,
  AssetReportMeta,
  InventoryByConsigneeRow,
  InventoryByDateRow,
} from "./report-repository";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertDateRange(dateFrom: string, dateTo: string): void {
  if (!DATE_PATTERN.test(dateFrom) || !DATE_PATTERN.test(dateTo)) {
    throw new ValidationError("report date bounds must be YYYY-MM-DD");
  }
  if (dateFrom > dateTo) {
    throw new ValidationError("report dateFrom must not exceed dateTo");
  }
}

export interface AdminAssetTrackingReport {
  readonly rows: readonly AdminAssetTrackingRow[];
  readonly meta: AssetReportMeta;
}

export async function getAdminAssetTrackingReport(
  ctx: RequestContext,
  opts: {
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly merchantSlug?: string;
  },
): Promise<AdminAssetTrackingReport> {
  requirePermission(ctx, "asset_tracking:read_all");
  assertDateRange(opts.dateFrom, opts.dateTo);

  return withServiceRole("admin_asset_tracking_report", async (tx) => {
    const [rows, meta] = await Promise.all([
      aggregateAdminAssetTracking(tx, opts),
      findGlobalReportMeta(tx),
    ]);
    return { rows, meta };
  });
}

export interface InventoryReport {
  readonly byDate: readonly InventoryByDateRow[];
  readonly byConsignee: readonly InventoryByConsigneeRow[];
  readonly meta: AssetReportMeta;
}

export async function getInventoryReport(
  ctx: RequestContext,
  opts: { readonly dateFrom: string; readonly dateTo: string },
): Promise<InventoryReport> {
  requirePermission(ctx, "asset_tracking:read");
  if (!ctx.tenantId) {
    throw new ValidationError("inventory report requires a tenant context");
  }
  assertDateRange(opts.dateFrom, opts.dateTo);
  const tenantId = ctx.tenantId;

  return withTenant(tenantId, async (tx) => {
    const [byDate, byConsignee, meta] = await Promise.all([
      aggregateInventoryByDate(tx, tenantId, opts),
      aggregateInventoryByConsignee(tx, tenantId, opts),
      findTenantReportMeta(tx, tenantId),
    ]);
    return { byDate, byConsignee, meta };
  });
}

/**
 * The tenant's dark-switch reading for surface gating (posture 7b).
 * Service-role read because the flag lives on `tenants`, which has no
 * tenant-session SELECT policy for operators.
 */
export async function getTenantAssetTrackingEnabled(
  tenantId: Uuid,
): Promise<{ enabled: boolean; defaultAssetType: string | null }> {
  type Row = {
    enabled: boolean;
    default_type: string | null;
  } & Record<string, unknown>;
  const rows = await withServiceRole("asset_tracking_flag_read", async (tx) =>
    tx.execute<Row>(sqlTag`
      SELECT task_asset_tracking_enabled AS enabled,
             default_task_asset_type AS default_type
      FROM tenants WHERE id = ${tenantId}
    `),
  );
  return {
    enabled: rows[0]?.enabled ?? false,
    defaultAssetType: rows[0]?.default_type ?? null,
  };
}

/**
 * Transcorp variant of the Inventory report: same two sections,
 * scoped to ONE merchant chosen by slug (plan §6.B — the admin page
 * requires a merchant selection; an unselected page renders the
 * picker prompt, not a fleet-wide blend). Service-role queries with
 * explicit tenant predicates; gate is the systemOnly read_all.
 *
 * Returns null when the slug doesn't resolve — the page renders
 * "unknown merchant" instead of 500ing on a hand-edited URL.
 */
export async function getAdminInventoryReport(
  ctx: RequestContext,
  opts: {
    readonly merchantSlug: string;
    readonly dateFrom: string;
    readonly dateTo: string;
  },
): Promise<(InventoryReport & { readonly tenantId: Uuid; readonly enabled: boolean }) | null> {
  requirePermission(ctx, "asset_tracking:read_all");
  assertDateRange(opts.dateFrom, opts.dateTo);

  return withServiceRole("admin_inventory_report", async (tx) => {
    type Row = { id: string; enabled: boolean } & Record<string, unknown>;
    const tenants = await tx.execute<Row>(sqlTag`
      SELECT id, task_asset_tracking_enabled AS enabled
      FROM tenants
      WHERE slug = ${opts.merchantSlug} AND status != 'archived'
    `);
    if (tenants.length === 0) return null;
    const tenantId = tenants[0].id as Uuid;

    const [byDate, byConsignee, meta] = await Promise.all([
      aggregateInventoryByDate(tx, tenantId, opts),
      aggregateInventoryByConsignee(tx, tenantId, opts),
      findTenantReportMeta(tx, tenantId),
    ]);
    return { byDate, byConsignee, meta, tenantId, enabled: tenants[0].enabled };
  });
}
