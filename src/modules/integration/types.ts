// Integration-module domain types — plan §3.3 / §5 (SuiteFleet, ADR-007).
//
// Day 4 / S-1: every type here is internal-language. Zero leak of
// SuiteFleet vocabulary (no AWB, no `Clientid`, no 15-action enum). The
// SuiteFleet implementation lives under providers/suitefleet/ and is the
// only file that knows about SuiteFleet's wire shape; it adapts each
// internal type to/from SuiteFleet's payload.
//
// Public/internal split:
//   - This file is the contract callers depend on.
//   - providers/suitefleet/ depends on this file in one direction only.
//   - Callers (route handlers, services) MUST NOT import from
//     providers/suitefleet/ directly.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * Seven internal lifecycle states the planner recognises. The SuiteFleet
 * provider collapses ~15 raw event/state strings into this set in S-6;
 * downstream services (audit, dashboards, notifications) only ever see
 * these seven, which keeps provider churn from rippling.
 */
export type InternalTaskStatus =
  | "CREATED"
  | "ASSIGNED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELED"
  | "ON_HOLD";

/**
 * Authenticated session returned by `authenticate` and refreshed by
 * `refreshSession`. Treated as opaque by callers — pass it back to the
 * adapter on every call. The token fields are present for the cache
 * layer (S-7) and the refresh path; `readonly` discourages mutation but
 * cannot prevent logging — callers must never serialise this object.
 */
export interface AuthenticatedSession {
  readonly tenantId: Uuid;
  readonly token: string;
  readonly renewalToken: string;
  readonly tokenExpiresAt: IsoTimestamp;
  readonly renewalTokenExpiresAt: IsoTimestamp;
}

/**
 * Postal/geographic address for a delivery endpoint.
 *
 * `district` is REQUIRED on the wire per Aqib Group-1 confirmation
 * (3 May 2026), and required in the type to enforce that at typecheck.
 * Post-D8-2 the schema's NOT NULL constraint on `consignees.district`
 * means every consignee row carries it; the adapter's body-build
 * unconditionally lands it on the SF payload. Leaving the type
 * optional would permit internal callers to silently produce a
 * SF-rejected payload — wrong direction.
 *
 * Latitude/longitude are OPTIONAL per Aqib Group-1: SuiteFleet
 * resolves consignee coordinates server-side via WhatsApp post-push
 * when the create payload omits them. The shipFrom side never
 * carries lat/lng either (warehouse address is fixed in SF's
 * merchant master). Existing callers that DO supply coordinates are
 * still accepted — the lat/lng relaxation is additive.
 *
 * `addressCode` is an optional internal warehouse/zone shortcode
 * (provider-specific value lives in the adapter's mapping, not here).
 *
 * COUNTRY HANDLING — DO NOT add `countryId` to this contract under
 * any framing. Outbound payload sends `countryCode='AE'` only; SF
 * resolves the numeric `countryId` server-side from the alpha code.
 * Adding `countryId` would couple the internal contract to a
 * SuiteFleet-private numeric identifier that has no Planner-side
 * meaning. Reviewer-locked posture (D8-3 review).
 */
export interface DeliveryAddress {
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly district: string;
  readonly countryCode: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly addressCode?: string;
}

/**
 * Snapshot of a consignee at task-creation time. The adapter takes a
 * snapshot rather than a `consigneeId` so historical tasks aren't
 * retroactively rewritten when the consignee record changes (and so the
 * integration module never reaches into the consignees module).
 */
export interface ConsigneeSnapshot {
  readonly name: string;
  readonly contactPhone: string;
  readonly address: DeliveryAddress;
}

/**
 * Delivery window. Date + start/end times are kept separate (rather than
 * a single ISO timestamp) because the most prominent provider, SuiteFleet,
 * splits the wire fields the same way; treating them as one would force a
 * lossy round-trip through Date. Times are 24h `HH:MM:SS`.
 */
export interface DeliveryWindow {
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
}

/** Payment method on the delivery itself — passthrough string for now. */
export type PaymentMethod = "PrePaid" | "Cash" | "CashOnDelivery";

export type TaskKind = "DELIVERY" | "PICKUP";

/**
 * Internal-language input for `createTask`. Caller-supplied; the adapter
 * resolves the per-tenant credentials and translates this into the
 * provider's wire format. Optional fields default sensibly inside the
 * adapter — callers omit, providers translate omission to either
 * field-absent or the provider's own default.
 */
export interface TaskCreateRequest {
  readonly tenantId: Uuid;
  readonly customerOrderNumber: string;
  readonly referenceNumber?: string;
  readonly kind: TaskKind;
  readonly consignee: ConsigneeSnapshot;
  readonly shipFrom: DeliveryAddress;
  readonly window: DeliveryWindow;
  readonly paymentMethod: PaymentMethod;
  readonly codAmount?: number;
  readonly declaredValue?: number;
  readonly weightKg?: number;
  readonly itemQuantity: number;
  readonly notes?: string;
  readonly signatureRequired?: boolean;
  readonly smsNotifications?: boolean;
  readonly deliverToCustomerOnly?: boolean;
}

/**
 * Internal-language result of a successful `createTask`. `externalId` is
 * the provider's stable identifier (used in subsequent webhook events);
 * `trackingNumber` is the human-readable shipment label printed on the
 * package and shown to the consignee.
 */
export interface TaskCreateResult {
  readonly externalId: string;
  readonly trackingNumber: string;
  readonly status: InternalTaskStatus;
  readonly createdAt: IsoTimestamp;
}

/**
 * Minimal headers contract — matches the web `Headers` API so a real
 * request object can be passed straight in, but tests can supply a
 * trivial `{ get: (name) => ... }` mock without faking the full class.
 */
export interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Result of provider-specific webhook authentication. Reasons are a
 * closed union so the receiver can branch deterministically (and so the
 * future audit-event vocabulary for denied webhook attempts has a finite
 * set of categories).
 */
export type WebhookVerificationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_client_id"
        | "missing_client_secret"
        | "client_id_mismatch"
        | "client_secret_mismatch";
    };

/**
 * Internal-language webhook event. The provider's raw event-type
 * vocabulary is collapsed into a small internal taxonomy here; the
 * mapping table for SuiteFleet's 15 actions lives in the adapter.
 *
 * `raw` carries the original payload in its provider-native shape so
 * audit/debug paths can inspect it without re-fetching, but callers
 * should treat it as opaque. `internalStatus` is set only for events
 * whose semantics are a status change.
 */
export type WebhookEventKind =
  | "TASK_STATUS_CHANGED"
  | "TASK_ASSIGNMENT_CHANGED"
  | "TASK_LOCATION_UPDATE"
  | "TASK_NOTE_ADDED"
  | "TASK_OTHER";

export interface WebhookEvent {
  readonly kind: WebhookEventKind;
  readonly externalTaskId: string;
  readonly internalStatus?: InternalTaskStatus;
  readonly occurredAt: IsoTimestamp;
  readonly idempotencyKey: string;
  readonly raw: unknown;
}

/**
 * Asset type — the unit of cargo a tracking record describes. `BAGS`
 * is the only observed value today; `BOX`, `PALLET`, `CONTAINER` are
 * documented as future possibilities. The 0011 schema CHECK is
 * restrictive; widening waits until those types appear empirically.
 *
 * "AWB" appears below as a deliberate exception to the
 * "no SuiteFleet vocabulary in integration types" convention. AWB
 * is a generic shipping-industry term (Air Waybill — the master
 * shipment identifier across carriers, not specific to SuiteFleet);
 * adopting it at the interface level is cleaner than inventing a
 * Planner-only synonym for a concept that has cross-vendor recognition.
 */
export type AssetType = "BAGS";

/**
 * Four-state asset lifecycle.
 *
 *   COLLECTED — courier has the asset
 *   EN_ROUTE  — asset moving from origin to destination
 *   RECEIVED  — handed off at destination
 *   RETURNED  — asset came back (returned-to-sender or recovery)
 */
export type AssetTrackingState = "COLLECTED" | "EN_ROUTE" | "RECEIVED" | "RETURNED";

/**
 * One package's tracking record, returned by the adapter's
 * `fetchAssetTrackingByAwb` method. The cache row in
 * `asset_tracking_cache` mirrors this shape with internal-FK +
 * freshness-metadata fields layered on (see
 * src/modules/asset-tracking/types.ts).
 *
 * `photos` and the four `*By` actor fields are typed as `unknown`
 * because the SuiteFleet doc does not specify their inner shape and
 * empirical samples are not yet available (sandbox merchant 588 has
 * `taskAssetTrackingEnabled: true` but no records). Tightened in a
 * follow-up migration once empirical samples land.
 */
export interface AssetTrackingPackage {
  readonly externalRecordId: number;
  readonly taskIdExternal: number;
  readonly trackingId: string;
  readonly awb: string;
  readonly type: AssetType;
  readonly state: AssetTrackingState;
  readonly photos: unknown | null;
  readonly notes: string | null;
  readonly supplementaryQuantity: number | null;
  readonly containerId: number | null;
  readonly collectedBy: unknown | null;
  readonly enrouteBy: unknown | null;
  readonly receivedBy: unknown | null;
  readonly returnedBy: unknown | null;
}
