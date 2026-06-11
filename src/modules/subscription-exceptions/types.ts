// Subscription-exceptions domain types — Day-16 Block 4-B Service A.
//
// Types backing the service surface in service.ts and the row shape
// returned by repository.ts. Service A handles the user-callable
// type variants (skip + skip overrides + address overrides +
// append_without_skip); type='pause_window' is REJECTED at the
// addSubscriptionException entry point (Service B owns the pause
// surface — see merged plan §3.6 line 343).
//
// All dates are ISO YYYY-MM-DD strings — no Date objects in the
// public API. Timestamps are ISO 8601 UTC strings.
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in
// supabase/migrations/0015_subscription_exceptions_and_materialization.sql.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * Five DB-level type values per
 * supabase/migrations/0015_subscription_exceptions_and_materialization.sql:150-157.
 * `pause_window` is enforced at the schema layer; the service layer
 * REJECTS it when surfaced through `addSubscriptionException` — the
 * pause surface lives at `pauseSubscription` (Service B).
 */
export type SubscriptionExceptionType =
  | "skip"
  | "pause_window"
  | "address_override_one_off"
  | "address_override_forward"
  | "append_without_skip";

/**
 * Row shape returned by the repository (camelCase). Mirrors every
 * column on `subscription_exceptions` per the 0015 migration.
 *
 * `correlationId` and `idempotencyKey` are uuid; the schema accepts
 * any uuid (v4 or v7). This service mints v4 via `crypto.randomUUID()`
 * pending the v7 swap captured in
 * `memory/followup_correlation_id_v7_swap.md`.
 */
export interface SubscriptionException {
  readonly id: Uuid;
  readonly subscriptionId: Uuid;
  readonly tenantId: Uuid;
  readonly type: SubscriptionExceptionType;
  /** Inclusive start of the exception's effect (or the skipped date for type='skip'). */
  readonly startDate: string;
  /** Inclusive end (pause_window only); null otherwise. */
  readonly endDate: string | null;
  /** Operator-supplied target date for type='skip' overrides. */
  readonly targetDateOverride: string | null;
  /** type='skip' only — when true, end_date does NOT extend (cancel-only). */
  readonly skipWithoutAppend: boolean;
  /** Operator note. */
  readonly reason: string | null;
  /** Address FK for type='address_override_one_off' / `_forward`. */
  readonly addressOverrideId: Uuid | null;
  /**
   * The compensating tail-end date (type='skip' only when
   * skip_without_append=false AND target_date_override IS NULL).
   * Per the schema CHECK constraint, populated only by the skip flow.
   */
  readonly compensatingDate: string | null;
  readonly correlationId: Uuid;
  readonly idempotencyKey: Uuid;
  readonly createdBy: Uuid;
  readonly createdAt: IsoTimestamp;
}

/**
 * Pause-window range used by the service-layer wrapper around
 * `skip-algorithm.ts:computeCompensatingDate`. Repository's
 * `listActivePauseWindows` returns these for the wrapper to pass
 * through to the pure helper.
 */
export interface PauseWindowRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Service-layer input to `addSubscriptionException`. Type-discriminated
 * shape: type-specific fields apply only when the discriminator matches.
 * Validation is split between the service (this layer; rejects
 * type='pause_window' + cross-validates type-specific fields) and the
 * DB CHECK constraints (defense in depth).
 */
export interface AddSubscriptionExceptionInput {
  readonly type: SubscriptionExceptionType;
  /** ISO YYYY-MM-DD. For type='skip'/`address_override_one_off`/`_forward`, this is the start_date. For type='pause_window', this is pause_start (rejected anyway). */
  readonly date: string;
  /** Operator note. */
  readonly reason?: string;
  /** Client-supplied uuid v4 (the API requires it; service does NOT generate). */
  readonly idempotencyKey: Uuid;
  /** type='skip' only — operator picks a specific compensating date instead of tail-end. */
  readonly targetDateOverride?: string;
  /** type='skip' only — cancel-only (no end_date extension). */
  readonly skipWithoutAppend?: boolean;
  /** type='address_override_one_off' / `_forward` only — required for those types. */
  readonly addressOverrideId?: Uuid;
}

/**
 * Service-layer result shape. `status='inserted'` ⇒ HTTP 201;
 * `status='idempotent_replay'` ⇒ HTTP 409 with the existing exception
 * fields. Per merged plan §3.1 result shape.
 *
 * `compensatingDate` populated for type='skip' default + override paths.
 * `newEndDate` populated for type='skip' (default + target_date_override
 * extends end_date) AND for type='append_without_skip'.
 */
export interface AddSubscriptionExceptionResult {
  readonly exceptionId: Uuid;
  readonly correlationId: Uuid;
  readonly compensatingDate: string | null;
  readonly newEndDate: string | null;
  readonly status: "inserted" | "idempotent_replay";
  readonly httpStatus: 201 | 409;
}

/**
 * Service-layer input to `appendWithoutSkip`. Operator-initiated
 * goodwill addition; reason is required (every append is operator-
 * recorded per brief §3.1.6 override 3).
 */
export interface AppendWithoutSkipInput {
  readonly reason: string;
  readonly idempotencyKey: Uuid;
  readonly targetDateOverride?: string;
}

/** Result shape for `appendWithoutSkip` — same shape as the inserted-skip path. */
export interface AppendWithoutSkipResult {
  readonly exceptionId: Uuid;
  readonly correlationId: Uuid;
  readonly newEndDate: string;
  readonly status: "inserted" | "idempotent_replay";
  readonly httpStatus: 201 | 409;
}
