// Bag-tracking report queries — Day-54 P2 (plan PR #502 §6).
//
// All aggregation is LOCAL (ingest-and-store architecture, plan §4):
// asset_tracking_cache holds current state per package; tasks supplies
// delivery_date + consignee; consignees/tenants supply display names.
// No SF calls on report render — freshness comes from the 30-minute
// poll (P1) and the "as of" stamp tells the operator how fresh.
//
// Semantics (Aqib, 2026-06-12, verbatim in tooltips):
//   Allocated Asset = number of bags allocated to the AWB
//                     → COUNT(cache rows) in scope
//   Supp. Quantity  = number of ice packs
//                     → SUM(supplementary_quantity) in scope
//
// Every aggregate row carries its AWB set (array_agg DISTINCT) so the
// report cells can drill down to the tasks pages filtered to exactly
// the AWBs behind the number (plan Q4 ruling). Pilot-scale: AWB sets
// per (merchant, date) are dozens; the page boundary re-validates
// shape before building hrefs.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { IsoTimestamp, Uuid } from "@/shared/types";

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------

/** Per-state package counts shared by every report row shape. */
export interface AssetStateCounts {
  readonly collected: number;
  readonly received: number;
  readonly sorted: number;
  readonly enRoute: number;
  readonly returned: number;
}

/**
 * Per-state AWB sets — each report VALUE drills down to exactly the
 * AWBs behind it (plan Q4 ruling), so the per-state cells need their
 * own sets, not the row's union.
 */
export interface AssetStateAwbSets {
  readonly collected: readonly string[];
  readonly received: readonly string[];
  readonly sorted: readonly string[];
  readonly enRoute: readonly string[];
  readonly returned: readonly string[];
}

/** One admin Asset Tracking report row: merchant × delivery date. */
export interface AdminAssetTrackingRow extends AssetStateCounts {
  readonly tenantId: Uuid;
  readonly merchantSlug: string;
  readonly merchantName: string;
  readonly deliveryDate: string; // YYYY-MM-DD
  readonly allocatedAssets: number;
  readonly suppQuantity: number;
  readonly awbs: readonly string[];
  readonly awbsByState: AssetStateAwbSets;
}

/** One Inventory by-date row (tenant-scoped). */
export interface InventoryByDateRow extends AssetStateCounts {
  readonly deliveryDate: string;
  readonly allocatedAssets: number;
  readonly suppQuantity: number;
  readonly awbs: readonly string[];
  readonly awbsByState: AssetStateAwbSets;
}

/** One Inventory by-consignee row: consignee × delivery date. */
export interface InventoryByConsigneeRow extends AssetStateCounts {
  readonly consigneeId: Uuid;
  readonly consigneeName: string;
  readonly deliveryDate: string;
  readonly allocatedAssets: number;
  readonly suppQuantity: number;
  readonly awbs: readonly string[];
  readonly awbsByState: AssetStateAwbSets;
}

/** Freshness + history metadata for the report headers. */
export interface AssetReportMeta {
  /** Most recent cache sync in scope — the "as of" stamp. Null = no data. */
  readonly asOf: IsoTimestamp | null;
  /** Earliest scan-log line for the tenant — the "history since" note. */
  readonly historySince: IsoTimestamp | null;
}

type CountsDbRow = {
  collected: string | number;
  received: string | number;
  sorted: string | number;
  en_route: string | number;
  returned: string | number;
  allocated_assets: string | number;
  supp_quantity: string | number | null;
  awbs: string[] | null;
  awbs_collected: string[] | null;
  awbs_received: string[] | null;
  awbs_sorted: string[] | null;
  awbs_en_route: string[] | null;
  awbs_returned: string[] | null;
} & Record<string, unknown>;

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number.parseInt(v, 10);
}

function counts(row: CountsDbRow): AssetStateCounts & {
  allocatedAssets: number;
  suppQuantity: number;
  awbs: readonly string[];
  awbsByState: AssetStateAwbSets;
} {
  return {
    collected: n(row.collected),
    received: n(row.received),
    sorted: n(row.sorted),
    enRoute: n(row.en_route),
    returned: n(row.returned),
    allocatedAssets: n(row.allocated_assets),
    suppQuantity: n(row.supp_quantity),
    awbs: row.awbs ?? [],
    awbsByState: {
      collected: row.awbs_collected ?? [],
      received: row.awbs_received ?? [],
      sorted: row.awbs_sorted ?? [],
      enRoute: row.awbs_en_route ?? [],
      returned: row.awbs_returned ?? [],
    },
  };
}

// The shared aggregate SELECT list. COUNT(*) FILTER per state; the
// AWB set is DISTINCT per group for drill-down hrefs.
const AGG_COLUMNS = sqlTag`
  COUNT(*) FILTER (WHERE c.state = 'COLLECTED')::int AS collected,
  COUNT(*) FILTER (WHERE c.state = 'RECEIVED')::int  AS received,
  COUNT(*) FILTER (WHERE c.state = 'SORTED')::int    AS sorted,
  COUNT(*) FILTER (WHERE c.state = 'EN_ROUTE')::int  AS en_route,
  COUNT(*) FILTER (WHERE c.state = 'RETURNED')::int  AS returned,
  COUNT(*)::int                                      AS allocated_assets,
  COALESCE(SUM(c.supplementary_quantity), 0)::int    AS supp_quantity,
  array_agg(DISTINCT c.awb)                          AS awbs,
  array_agg(DISTINCT c.awb) FILTER (WHERE c.state = 'COLLECTED') AS awbs_collected,
  array_agg(DISTINCT c.awb) FILTER (WHERE c.state = 'RECEIVED')  AS awbs_received,
  array_agg(DISTINCT c.awb) FILTER (WHERE c.state = 'SORTED')    AS awbs_sorted,
  array_agg(DISTINCT c.awb) FILTER (WHERE c.state = 'EN_ROUTE')  AS awbs_en_route,
  array_agg(DISTINCT c.awb) FILTER (WHERE c.state = 'RETURNED')  AS awbs_returned
`;

// -----------------------------------------------------------------------------
// Admin: merchant × delivery date (cross-tenant, withServiceRole caller)
// -----------------------------------------------------------------------------

export async function aggregateAdminAssetTracking(
  tx: DbTx,
  opts: {
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly merchantSlug?: string;
  },
): Promise<readonly AdminAssetTrackingRow[]> {
  const merchantFilter =
    opts.merchantSlug !== undefined
      ? sqlTag`AND ten.slug = ${opts.merchantSlug}`
      : sqlTag``;
  type Row = CountsDbRow & {
    tenant_id: string;
    merchant_slug: string;
    merchant_name: string;
    delivery_date: Date | string;
  };
  const rows = await tx.execute<Row>(sqlTag`
    SELECT
      ten.id   AS tenant_id,
      ten.slug AS merchant_slug,
      ten.name AS merchant_name,
      tk.delivery_date,
      ${AGG_COLUMNS}
    FROM asset_tracking_cache c
    JOIN tasks tk   ON tk.id = c.task_id
    JOIN tenants ten ON ten.id = c.tenant_id
    WHERE ten.task_asset_tracking_enabled = true
      AND ten.status != 'archived'
      AND tk.delivery_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
      ${merchantFilter}
    GROUP BY ten.id, ten.slug, ten.name, tk.delivery_date
    ORDER BY tk.delivery_date DESC, ten.name ASC
  `);
  return rows.map((row) => ({
    tenantId: row.tenant_id as Uuid,
    merchantSlug: row.merchant_slug,
    merchantName: row.merchant_name,
    deliveryDate: toDateString(row.delivery_date),
    ...counts(row),
  }));
}

// -----------------------------------------------------------------------------
// Tenant: Inventory by-date + by-consignee (withTenant caller; RLS scopes)
// -----------------------------------------------------------------------------

export async function aggregateInventoryByDate(
  tx: DbTx,
  tenantId: Uuid,
  opts: { readonly dateFrom: string; readonly dateTo: string },
): Promise<readonly InventoryByDateRow[]> {
  type Row = CountsDbRow & { delivery_date: Date | string };
  const rows = await tx.execute<Row>(sqlTag`
    SELECT
      tk.delivery_date,
      ${AGG_COLUMNS}
    FROM asset_tracking_cache c
    JOIN tasks tk ON tk.id = c.task_id AND tk.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}
      AND tk.delivery_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
    GROUP BY tk.delivery_date
    ORDER BY tk.delivery_date DESC
  `);
  return rows.map((row) => ({
    deliveryDate: toDateString(row.delivery_date),
    ...counts(row),
  }));
}

export async function aggregateInventoryByConsignee(
  tx: DbTx,
  tenantId: Uuid,
  opts: { readonly dateFrom: string; readonly dateTo: string },
): Promise<readonly InventoryByConsigneeRow[]> {
  type Row = CountsDbRow & {
    consignee_id: string;
    consignee_name: string;
    delivery_date: Date | string;
  };
  const rows = await tx.execute<Row>(sqlTag`
    SELECT
      cons.id   AS consignee_id,
      cons.name AS consignee_name,
      tk.delivery_date,
      ${AGG_COLUMNS}
    FROM asset_tracking_cache c
    JOIN tasks tk        ON tk.id = c.task_id AND tk.tenant_id = c.tenant_id
    JOIN consignees cons ON cons.id = tk.consignee_id AND cons.tenant_id = c.tenant_id
    WHERE c.tenant_id = ${tenantId}
      AND tk.delivery_date BETWEEN ${opts.dateFrom}::date AND ${opts.dateTo}::date
    GROUP BY cons.id, cons.name, tk.delivery_date
    ORDER BY cons.name ASC, tk.delivery_date DESC
  `);
  return rows.map((row) => ({
    consigneeId: row.consignee_id as Uuid,
    consigneeName: row.consignee_name,
    deliveryDate: toDateString(row.delivery_date),
    ...counts(row),
  }));
}

// -----------------------------------------------------------------------------
// Freshness metadata
// -----------------------------------------------------------------------------

/**
 * Tenant-scoped variant: "as of" from the tenant's cache, "history
 * since" from the tenant's earliest scan-log line.
 */
export async function findTenantReportMeta(
  tx: DbTx,
  tenantId: Uuid,
): Promise<AssetReportMeta> {
  type Row = {
    as_of: Date | string | null;
    history_since: Date | string | null;
  } & Record<string, unknown>;
  const rows = await tx.execute<Row>(sqlTag`
    SELECT
      (SELECT MAX(last_synced_at) FROM asset_tracking_cache WHERE tenant_id = ${tenantId}) AS as_of,
      (SELECT MIN(created_at) FROM asset_scan_log WHERE tenant_id = ${tenantId}) AS history_since
  `);
  return mapMeta(rows[0]);
}

/** Cross-tenant variant for the admin report header. */
export async function findGlobalReportMeta(tx: DbTx): Promise<AssetReportMeta> {
  type Row = {
    as_of: Date | string | null;
    history_since: Date | string | null;
  } & Record<string, unknown>;
  const rows = await tx.execute<Row>(sqlTag`
    SELECT
      (SELECT MAX(last_synced_at) FROM asset_tracking_cache) AS as_of,
      (SELECT MIN(created_at) FROM asset_scan_log) AS history_since
  `);
  return mapMeta(rows[0]);
}

function mapMeta(row?: {
  as_of: Date | string | null;
  history_since: Date | string | null;
}): AssetReportMeta {
  return {
    asOf: row?.as_of ? toIsoTs(row.as_of) : null,
    historySince: row?.history_since ? toIsoTs(row.history_since) : null,
  };
}

function toIsoTs(value: Date | string): IsoTimestamp {
  return (
    value instanceof Date ? value.toISOString() : new Date(value).toISOString()
  ) as IsoTimestamp;
}

function toDateString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
