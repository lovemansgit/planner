// Addresses repository — Drizzle queries against `addresses` (0014).
//
// "Repository" here is the data-access layer per the project's
// types + repository + service split. Every function takes a
// `tx: DbTx` from the caller's `withTenant` / `withServiceRole` block,
// runs one statement, and maps rows to the camelCase domain shape. No
// permission checks, no audit emits, no validation beyond null-vs-
// undefined handling — those belong in the service layer.
//
// RLS is the primary defence. Every callsite runs inside
// `withTenant(tenantId, …)`, so the addresses_tenant_isolation policy
// (0014) filters reads, blocks cross-tenant updates/deletes, and rejects
// inserts whose tenant_id doesn't match the session value via WITH CHECK.
//
// Defence in depth: explicit tenantId WHERE alongside RLS for write
// paths and tenant-scoped lists; same pattern as consignees/repository.ts.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type { Address, AddressLabel, CreateAddressInput } from "./types";

type AddressRow = {
  id: string;
  consignee_id: string;
  tenant_id: string;
  label: string;
  is_primary: boolean;
  line: string;
  district: string;
  emirate: string;
  lat: string | number | null;
  lng: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numericOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  // postgres-js returns numeric(p,s) as string by default to preserve
  // precision. Coerce to number for the domain shape; lat/lng fits in
  // double safely at the brief-mandated 6 decimal places.
  return Number(value);
}

function mapRow(row: AddressRow): Address {
  return {
    id: row.id,
    consigneeId: row.consignee_id,
    tenantId: row.tenant_id,
    label: row.label as AddressLabel,
    isPrimary: row.is_primary,
    line: row.line,
    district: row.district,
    emirate: row.emirate,
    lat: numericOrNull(row.lat),
    lng: numericOrNull(row.lng),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * INSERT one address. Mirrors the insertConsignee / insertSubscription
 * shape — tenantId explicit for defence-in-depth, RETURNING * mapped
 * to the domain shape.
 *
 * Throws via Postgres on partial-UNIQUE violation
 * (addresses_one_primary_per_consignee_idx) if a second address with
 * is_primary=true is inserted for a consignee that already has one;
 * the orchestration callers are single-primary so this should not fire
 * in v1, but the schema-layer guarantee remains.
 */
export async function insertAddress(
  tx: DbTx,
  tenantId: Uuid,
  consigneeId: Uuid,
  input: CreateAddressInput,
): Promise<Address> {
  const rows = await tx.execute<AddressRow>(sqlTag`
    INSERT INTO addresses (
      consignee_id,
      tenant_id,
      label,
      is_primary,
      line,
      district,
      emirate,
      lat,
      lng
    ) VALUES (
      ${consigneeId},
      ${tenantId},
      ${input.label},
      ${input.isPrimary ?? false},
      ${input.line},
      ${input.district},
      ${input.emirate},
      ${input.lat ?? null},
      ${input.lng ?? null}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error("insertAddress: INSERT … RETURNING produced zero rows");
  }
  return mapRow(rows[0]);
}

/**
 * SELECT every address for one consignee, primary first then by
 * created_at ASC. RLS scopes by tenant; cross-tenant lookup returns
 * empty per the default-deny posture.
 *
 * Single-address MVP: returns 0 or 1 row in v1. Multi-address Phase 2
 * may return up to 2-3 rows (home / office / other).
 */
export async function listAddressesByConsignee(
  tx: DbTx,
  consigneeId: Uuid,
): Promise<readonly Address[]> {
  const rows = await tx.execute<AddressRow>(sqlTag`
    SELECT * FROM addresses
    WHERE consignee_id = ${consigneeId}
    ORDER BY is_primary DESC, created_at ASC
  `);
  return rows.map(mapRow);
}

/**
 * SELECT one address by id. Returns null if missing or RLS-hidden.
 * Mirrors findConsigneeById posture.
 */
export async function findAddressById(tx: DbTx, id: Uuid): Promise<Address | null> {
  const rows = await tx.execute<AddressRow>(sqlTag`
    SELECT * FROM addresses WHERE id = ${id}
  `);
  return rows[0] ? mapRow(rows[0]) : null;
}
