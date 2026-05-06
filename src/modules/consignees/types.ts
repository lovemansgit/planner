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

/**
 * Consignee CRM state per brief §3.1.1 line 153 + migration 0016 CHECK.
 *
 * UPPERCASE — distinct casing from `tenants.status` (lowercase) per
 * 0016 header; the casing mismatch is brief-driven and intentional.
 */
export type ConsigneeCrmState =
  | "ACTIVE"
  | "ON_HOLD"
  | "HIGH_RISK"
  | "INACTIVE"
  | "CHURNED"
  | "SUBSCRIPTION_ENDED";

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
  /**
   * Day 16 / Block 4-D — surfaced via mapRow alongside the existing
   * 5-fn CRUD reads. NOT NULL DEFAULT 'ACTIVE' on the column, so every
   * row carries a value.
   */
  readonly crmState: ConsigneeCrmState;
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
 *
 * `crmState` is intentionally absent here — CRM transitions go through
 * the dedicated `changeConsigneeCrmState` service so the matrix gate +
 * audit emit fire on every transition. Allowing crmState through
 * `updateConsignee` would silently bypass both.
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

// -----------------------------------------------------------------------------
// CRM state transition surface (Day 16 / Block 4-D — Service C)
// -----------------------------------------------------------------------------

/**
 * Operator input for `changeConsigneeCrmState`. `reason` is required
 * and non-empty; the service trims and validates before reaching
 * canTransition. `reason` is also the surface for the
 * CHURNED → ACTIVE 'reactivation' keyword guard per §10.4.
 */
export interface ChangeConsigneeCrmStateInput {
  readonly toState: ConsigneeCrmState;
  readonly reason: string;
}

/**
 * Result discriminated by `status`. `updated` = a real transition
 * landed (consignees row updated, consignee_crm_events row inserted,
 * audit emitted). `no_op` = same-state short-circuit (no writes, no
 * audit; the operator's call still got 200 because the desired state
 * was already in place).
 */
export type ChangeConsigneeCrmStateResult =
  | {
      readonly status: "updated";
      readonly consigneeId: Uuid;
      readonly fromState: ConsigneeCrmState;
      readonly toState: ConsigneeCrmState;
      readonly eventId: Uuid;
    }
  | {
      readonly status: "no_op";
      readonly consigneeId: Uuid;
      readonly fromState: ConsigneeCrmState;
      readonly toState: ConsigneeCrmState;
    };

/**
 * Row shape for `consignee_crm_events` per migration 0016. `fromState`
 * is null on initial-create rows (the table allows it); the service
 * always writes a non-null fromState when emitting from the transition
 * path because the consignee row already exists.
 */
export interface ConsigneeCrmEvent {
  readonly id: Uuid;
  readonly consigneeId: Uuid;
  readonly tenantId: Uuid;
  readonly fromState: ConsigneeCrmState | null;
  readonly toState: ConsigneeCrmState;
  readonly reason: string | null;
  readonly actor: Uuid;
  readonly occurredAt: IsoTimestamp;
}
