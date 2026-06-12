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
import { ForbiddenError, NotFoundError, ValidationError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { requirePermission } from "../identity";

import type { AssetTrackingPollSummary } from "./types";
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

// -----------------------------------------------------------------------------
// Asset Log (Day-54 P3 — plan §6.A: Allocated Asset links here)
// -----------------------------------------------------------------------------

export interface AssetLogLine {
  readonly trackingId: string;
  readonly awb: string;
  readonly state: string;
  /** SF's scan time when the wire carries it (null until the vendor ships it). */
  readonly vendorScannedAt: string | null;
  /** When Planner observed the state — the display fallback, labeled "recorded in Planner". */
  readonly receivedAt: string;
  readonly scannedByName: string | null;
  readonly source: string;
  readonly merchantName: string;
}

/**
 * Append-only scan history for an AWB set, newest observation first —
 * the admin Asset Log surface (business spec: scan date+time per
 * status, lines never overwritten; the 0032 trigger enforces the
 * never-overwritten part structurally).
 *
 * Admin-only (`asset_tracking:read_all`) per the business request —
 * the merchant Inventory report has no log surface in scope.
 */
export async function getAssetScanLog(
  ctx: RequestContext,
  opts: { readonly awbs: readonly string[] },
): Promise<readonly AssetLogLine[]> {
  requirePermission(ctx, "asset_tracking:read_all");
  if (opts.awbs.length === 0 || opts.awbs.length > 200) {
    throw new ValidationError("asset log requires 1-200 AWBs");
  }
  for (const awb of opts.awbs) {
    if (!/^[A-Z]{2,5}-\d{4,12}$/.test(awb)) {
      throw new ValidationError(`malformed awb: ${awb}`);
    }
  }

  return withServiceRole("admin_asset_scan_log", async (tx) => {
    type Row = {
      tracking_id: string;
      awb: string;
      state: string;
      vendor_scanned_at: Date | string | null;
      received_at: Date | string;
      scanned_by: unknown | null;
      source: string;
      merchant_name: string;
    } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT
        l.tracking_id,
        l.awb,
        l.state,
        l.vendor_scanned_at,
        l.received_at,
        l.scanned_by,
        l.source,
        ten.name AS merchant_name
      FROM asset_scan_log l
      JOIN tenants ten ON ten.id = l.tenant_id
      WHERE l.awb = ANY(${"{" + opts.awbs.join(",") + "}"}::text[])
      ORDER BY COALESCE(l.vendor_scanned_at, l.received_at) DESC, l.id DESC
    `);
    return rows.map((row) => ({
      trackingId: row.tracking_id,
      awb: row.awb,
      state: row.state,
      vendorScannedAt:
        row.vendor_scanned_at === null
          ? null
          : new Date(row.vendor_scanned_at).toISOString(),
      receivedAt: new Date(row.received_at).toISOString(),
      scannedByName: extractScannedByName(row.scanned_by),
      source: row.source,
      merchantName: row.merchant_name,
    }));
  });
}

/**
 * The `*_by` blocks are doc-derived jsonb (inner shape never seen on
 * the wire — sandbox has no records). Defensive name extraction; the
 * first real sample retires the guesswork.
 */
function extractScannedByName(scannedBy: unknown): string | null {
  if (typeof scannedBy !== "object" || scannedBy === null) return null;
  const candidate = (scannedBy as Record<string, unknown>).name;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

// -----------------------------------------------------------------------------
// Manual refresh (Day-54 P3 — Love's constraint 4: the operator's
// "now" override on top of the 30-minute poll)
// -----------------------------------------------------------------------------

/**
 * Tenant-scoped manual refresh: runs one bounded poll sweep for the
 * actor's own tenant. Gated on `asset_tracking:read` + the tenant's
 * dark switch (a dark tenant's operator cannot trigger SF calls).
 * Reuses the poll path wholesale — same scoping, chunking, caps, and
 * audit posture (`trigger_source: poll`; the sweep is the same
 * machine, just human-initiated).
 */
export async function refreshTenantAssetTracking(
  ctx: RequestContext,
): Promise<AssetTrackingPollSummary> {
  requirePermission(ctx, "asset_tracking:read");
  if (!ctx.tenantId) {
    throw new ValidationError("manual refresh requires a tenant context");
  }
  const { enabled } = await getTenantAssetTrackingEnabled(ctx.tenantId);
  if (!enabled) {
    throw new ForbiddenError("asset tracking is not enabled for this tenant");
  }
  return (await pollFn())(ctx.tenantId);
}

/**
 * The poll lives in service.ts, whose adapter import chain carries
 * Next's `server-only` marker. Loading it lazily AFTER the gates keeps
 * this module importable in the vitest integration environment (the
 * refusal paths never touch the adapter) while the live routes resolve
 * it normally.
 */
async function pollFn(): Promise<(tenantId: Uuid) => Promise<AssetTrackingPollSummary>> {
  const { runAssetTrackingPoll } = await import("./service");
  return runAssetTrackingPoll;
}

/**
 * Admin manual refresh: one merchant by slug. Gated on read_all; the
 * dark switch still applies (refreshing a dark merchant is refused,
 * not silently skipped).
 */
export async function refreshMerchantAssetTracking(
  ctx: RequestContext,
  merchantSlug: string,
): Promise<AssetTrackingPollSummary> {
  requirePermission(ctx, "asset_tracking:read_all");
  type Row = { id: string; enabled: boolean } & Record<string, unknown>;
  const rows = await withServiceRole("admin_asset_refresh_resolve", async (tx) =>
    tx.execute<Row>(sqlTag`
      SELECT id, task_asset_tracking_enabled AS enabled
      FROM tenants WHERE slug = ${merchantSlug} AND status != 'archived'
    `),
  );
  if (rows.length === 0) {
    throw new NotFoundError(`unknown merchant: ${merchantSlug}`);
  }
  if (!rows[0].enabled) {
    throw new ForbiddenError("asset tracking is not enabled for this merchant");
  }
  return (await pollFn())(rows[0].id as Uuid);
}
