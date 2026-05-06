// subscription-addresses module domain types.
//
// Day 16 / Block 4-E — Service E. Greenfield module under
// src/modules/subscription-addresses/ (flat sibling per Block 4-D
// Gate 2 + Conflict-1 precedent — established Day-13 PR #139
// convention; plan §5.3 nested-path "subscriptions/addresses/" is a
// drift captured in followup_plan_path_drift_subscription_exceptions.md
// §1).
//
// This module owns ONE service fn: `changeAddressRotation`. Service E
// (2)+(3) — `changeAddressOneOff` / `changeAddressForward` — do NOT
// exist as module-level fns per Block 4-E reviewer §C C1 ruling +
// merged plan §5.3.2/§5.3.3 ("No separate implementation; the API
// route layer thunks to addSubscriptionException with a type-fixed
// input"). The Block 4-F API route handlers will call
// `addSubscriptionException` directly.
//
// The module ALSO exports `findAddressForConsignee` — the shared
// cross-consignee address ownership helper used by both:
//   - `changeAddressRotation` (this module's service.ts)
//   - `addSubscriptionException`'s address_override branches (Service
//     A; cross-module import per Block 4-E §B B1 ruling)

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * ISO weekday — Monday=1, Sunday=7. Mirrors the
 * `subscription_address_rotations.weekday` CHECK constraint
 * (BETWEEN 1 AND 7) from migration 0014.
 */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * One entry in the rotation map — one weekday, one address. Multiple
 * weekdays may map to the same address; not every weekday must be
 * mapped (unmapped weekdays fall back to the consignee's primary
 * address per brief §3.1.1 + materialization Layer 4 fallback at
 * task-materialization/service.ts).
 */
export interface RotationEntry {
  readonly weekday: IsoWeekday;
  readonly addressId: Uuid;
}

/**
 * Operator input for `changeAddressRotation` — full-replace semantic.
 *
 * The supplied `rotation` array is the COMPLETE new rotation map for
 * the subscription. Weekdays present in the current state but absent
 * from the input get DELETEd (UNIQUE-by-weekday means no duplicate
 * weekday in input; service-layer validates this). Weekdays present
 * in input but absent from current state get INSERTed. Weekdays in
 * both get UPDATEd (UPSERT). Empty array deletes all rotation rows
 * (subscription falls back to consignee's primary address every day).
 *
 * Idempotency replay tolerance: if input matches current state as a
 * SET of (weekday, addressId) pairs (order-insensitive), the service
 * returns `{ status: 'no_op' }` without writes. No audit emit either
 * way (rotation has no audit event registered per plan §10.6 default
 * + brief §3.1.2 — rotation changes are routine config).
 */
export interface ChangeAddressRotationInput {
  readonly rotation: readonly RotationEntry[];
}

export type ChangeAddressRotationResult =
  | {
      readonly status: "updated";
      readonly subscriptionId: Uuid;
      readonly rotation: readonly RotationEntry[];
    }
  | {
      readonly status: "no_op";
      readonly subscriptionId: Uuid;
      readonly rotation: readonly RotationEntry[];
    };

/**
 * Minimal address projection returned by `findAddressForConsignee`.
 * Service-layer callers don't need the full address shape (line,
 * district, emirate, lat, lng) — they only need ownership confirmation
 * (this address belongs to this consignee in this tenant). Returning
 * the minimal shape keeps the helper's surface narrow and avoids
 * re-projecting fields when other modules want a different shape.
 */
export interface AddressOwnershipRow {
  readonly id: Uuid;
  readonly consigneeId: Uuid;
  readonly tenantId: Uuid;
  readonly label: "home" | "office" | "other";
  readonly isPrimary: boolean;
}

/**
 * Subscription projection used by the rotation flow's FOR UPDATE
 * lookup. Includes consigneeId + status — the two fields the rotation
 * service needs (the shared helper validates by consignee_id; the
 * service rejects non-active subscriptions). Not the full Subscription
 * DTO from src/modules/subscriptions/types.ts because rotation
 * doesn't touch start/end/days_of_week/etc.
 */
export interface SubscriptionForRotation {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly consigneeId: Uuid;
  readonly status: "active" | "paused" | "ended";
}

/**
 * Row shape returned by `selectCurrentRotation` — passes through to
 * the no_op detection logic in `changeAddressRotation`. Includes the
 * row id so a Phase-2 selective-UPDATE flow could target rows
 * individually if needed; current MVP service uses (weekday,
 * addressId) only and ignores `id`.
 */
export interface CurrentRotationRow {
  readonly id: Uuid;
  readonly weekday: IsoWeekday;
  readonly addressId: Uuid;
  readonly createdAt: IsoTimestamp;
}
