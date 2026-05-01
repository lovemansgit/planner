// Consignee domain types.
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in 0004_consignee.sql.
//
// `Consignee` mirrors the table 1:1. `CreateConsigneeInput` is the
// shape callers supply at insert time (no id, tenant_id, or timestamps
// — the DB defaults / service layer / RLS WITH-CHECK supply those).
// `UpdateConsigneePatch` is a partial of the user-editable fields;
// service-layer validation governs which fields a given actor may touch.
//
// Day-3 limitation, documented for the C-3/C-4 review: the patch shape
// uses `field?: T` for nullable optional columns (email, deliveryNotes,
// externalRef, notesInternal). "Field omitted" means "do not change";
// there is no way through this shape to *clear* a previously-set
// nullable column back to NULL. The Day-3 UI is read-only so the gap
// has no observable effect; when the edit UI lands, extend the patch
// shape with explicit-null support (e.g., `email?: string | null`)
// alongside the repository SET-clause builder.

import type { IsoTimestamp, Uuid } from "@/shared/types";

export interface Consignee {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly addressLine: string;
  readonly emirateOrRegion: string;
  readonly district: string;
  readonly deliveryNotes: string | null;
  readonly externalRef: string | null;
  readonly notesInternal: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Insert payload. `tenantId` is supplied by the service layer
 * (typically `ctx.tenantId`) and is asserted non-null before the call;
 * keeping it out of this type makes accidental tenant-id-from-input
 * impossible.
 */
export interface CreateConsigneeInput {
  readonly name: string;
  readonly phone: string;
  readonly email?: string;
  readonly addressLine: string;
  readonly emirateOrRegion: string;
  readonly district: string;
  readonly deliveryNotes?: string;
  readonly externalRef?: string;
  readonly notesInternal?: string;
}

/**
 * Update payload. Every field is optional — only present fields are
 * written. `tenantId`, `id`, and the timestamps are intentionally
 * absent: the repository never lets a caller change them.
 */
export interface UpdateConsigneePatch {
  readonly name?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly addressLine?: string;
  readonly emirateOrRegion?: string;
  readonly district?: string;
  readonly deliveryNotes?: string;
  readonly externalRef?: string;
  readonly notesInternal?: string;
}
