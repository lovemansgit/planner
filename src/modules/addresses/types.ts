// Address domain types — Day 22 / Phase 1 forms lane.
//
// Net-new module. The `addresses` table was added in migration 0014
// alongside `subscription_address_rotations`, but until Day 22 the
// only callers reading from it were:
//   - subscription-addresses module (rotation lookups via
//     findAddressForConsignee in repository.ts)
//   - task-materialization (CTE address resolution)
//   - tasks/service.ts (FK consistency checks for address patches)
//
// Day 22 adds the first user-flow that creates address rows: the
// /consignees/new onboarding wizard, via the
// createConsigneeWithSubscription orchestration. This module surfaces
// the read side (listAddresses) for Sub-PR #2's task-edit modal
// AddressPicker per OQ-4 ruling.
//
// Single-address MVP scope per brief v1.11 amendment: the wizard
// captures one primary address per consignee. Multi-address +
// per-weekday rotation deferred to Phase 2 per
// followup_multi_address_rotation_phase_2.md.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * Address label per migration 0014 CHECK constraint. Operators tag
 * the address with one of these to disambiguate when a consignee
 * later acquires more than one (Phase 2).
 */
export type AddressLabel = "home" | "office" | "other";

/**
 * The Address aggregate. Read shape; what `findAddressById` and
 * `listAddressesByConsignee` return.
 *
 * `lat` and `lng` are nullable (unset on rows seeded before the geocoder
 * lands; brief §3.3.1 step 2 mentions "smart geotag" as a future
 * enhancement). When unset both are NULL together — the schema does not
 * enforce paired-or-neither but the application convention does.
 */
export interface Address {
  readonly id: Uuid;
  readonly consigneeId: Uuid;
  readonly tenantId: Uuid;
  readonly label: AddressLabel;
  readonly isPrimary: boolean;
  readonly line: string;
  readonly district: string;
  readonly emirate: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Insert payload for `insertAddress`. `tenantId` is supplied by the
 * caller's `withTenant` block; keeping it out of this type makes
 * accidental tenant-id-from-input impossible (same pattern as
 * CreateConsigneeInput).
 *
 * `isPrimary` defaults to false; the orchestration fn passes true for
 * the wizard's single primary-address path. The schema-layer partial
 * UNIQUE on (consignee_id) WHERE is_primary = true catches any drift
 * — at most one primary per consignee.
 */
export interface CreateAddressInput {
  readonly label: AddressLabel;
  readonly isPrimary?: boolean;
  readonly line: string;
  readonly district: string;
  readonly emirate: string;
  readonly lat?: number | null;
  readonly lng?: number | null;
}
