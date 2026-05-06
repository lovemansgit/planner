// Subscription domain types — Day 6 / S-3.
//
// camelCase TypeScript at the module boundary; the repository layer maps
// to/from the snake_case columns in 0009_subscription.sql.
//
// A subscription is the pilot's central operational primitive: a recurring
// delivery rule. The Day-7+ cron walks the next-day window and turns
// matching subscriptions into tasks (one task per consignee per scheduled
// day). Editing a subscription mutates in place — historical task rows
// preserve the snapshot at task-creation time, so a subscription edit
// does not retroactively rewrite past deliveries.
//
// Mutable-in-place edit shape:
//   - `UpdateSubscriptionPatch` covers fields that the operator can edit
//     freely (consignee, schedule, delivery window, address override,
//     cosmetic fields). Every field is optional; field present = "set to
//     value (including null)"; field omitted = "do not change."
//
// Lifecycle transitions are NOT in `UpdateSubscriptionPatch`:
//   - `status` and the paired `paused_at` / `ended_at` timestamps are
//     written by dedicated transitional methods on the repository
//     (pause, resume, end). Each transition has its own audit event in
//     S-4 (subscription.paused / .resumed / .ended). Folding status
//     into the generic edit patch would lose the audit-vocabulary
//     distinction.
//
// days_of_week shape:
//   ISO 1-7 (Mon=1, Sun=7) per the migration. NOT branded — kept as a
//   plain `readonly number[]` to match the existing convention for
//   `taskKind` and `internalStatus` (also closed-domain values, not
//   branded). Validation against the ISO domain happens at the API
//   boundary in S-5 (Zod) and at the schema layer in 0009 (CHECK).

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * Three-value lifecycle FSM. Mirrors the CHECK constraint on
 * subscriptions.status (0009_subscription.sql).
 *
 *   active → paused      (pauseSubscription)
 *   paused → active      (resumeSubscription)
 *   active|paused → ended (endSubscription, terminal)
 *
 * 'ended' is terminal — the cron stops generating tasks for ended
 * subscriptions. Reactivation is not supported; create a new
 * subscription instead.
 */
export type SubscriptionStatus = "active" | "paused" | "ended";

/**
 * Address override shape. Nullable — null means "use the consignee's
 * default address." Stored as jsonb in 0009 because the override is
 * full-shape and may grow new fields (geofence, addressCode) without a
 * schema migration. Typed as `unknown` here because the wire shape
 * isn't fixed; callers that read the override know the shape they need.
 *
 * Day-7+ when the cron task-generation logic lands, this gets a
 * concrete `DeliveryAddress` type that mirrors the integration module's
 * `DeliveryAddress` shape from src/modules/integration/types.ts.
 */
export type SubscriptionAddressOverride = unknown;

/**
 * The Subscription aggregate. Read shape; what `findSubscriptionById`
 * and `listSubscriptionsByTenant` return.
 *
 * `daysOfWeek` is ISO 1-7 (Mon=1, Sun=7). Validation lives at the API
 * boundary (Zod, S-5) and the schema layer (CHECK on the column).
 *
 * `pausedAt` and `endedAt` are paired with status transitions:
 *   - status='active'  ⇒ pausedAt=null, endedAt=null
 *   - status='paused'  ⇒ pausedAt=<when paused>, endedAt=null
 *   - status='ended'   ⇒ endedAt=<when ended>, pausedAt=null
 * Resume clears `pausedAt`. End from paused clears `pausedAt` and
 * sets `endedAt`. The schema does not enforce this pairing —
 * the repository's transitional methods do.
 */
export interface Subscription {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly consigneeId: Uuid;
  readonly status: SubscriptionStatus;
  /** ISO date (YYYY-MM-DD). Inclusive lower bound of the recurrence window. */
  readonly startDate: string;
  /** ISO date (YYYY-MM-DD) or null. Null = open-ended. Inclusive upper bound. */
  readonly endDate: string | null;
  /** ISO 1-7 weekday numbers. Mon=1, Sun=7. Non-empty per CHECK constraint. */
  readonly daysOfWeek: readonly number[];
  /** HH:MM:SS, Asia/Dubai per cutoff convention. */
  readonly deliveryWindowStart: string;
  /** HH:MM:SS, Asia/Dubai. Strictly later than deliveryWindowStart per CHECK. */
  readonly deliveryWindowEnd: string;
  /** jsonb. null = use the consignee's default address. */
  readonly deliveryAddressOverride: SubscriptionAddressOverride | null;
  readonly mealPlanName: string | null;
  readonly externalRef: string | null;
  readonly notesInternal: string | null;
  /** ISO 8601 timestamp of the most recent pause. Null when not paused. */
  readonly pausedAt: IsoTimestamp | null;
  /** ISO 8601 timestamp of the end transition. Null until ended (terminal). */
  readonly endedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Insert payload. `tenantId` is supplied by the service layer
 * (typically `ctx.tenantId`); keeping it out of this type makes
 * accidental tenant-id-from-input impossible.
 *
 * `status` is optional — the SQL DEFAULT covers it ('active'). Callers
 * that want to seed in a paused/ended state pass it explicitly.
 *
 * `endDate`, `deliveryAddressOverride`, `mealPlanName`, `externalRef`,
 * `notesInternal` are optional — passed as null to clear, omitted to
 * use the SQL default (NULL).
 */
export interface CreateSubscriptionInput {
  readonly consigneeId: Uuid;
  readonly status?: SubscriptionStatus;
  readonly startDate: string;
  readonly endDate?: string | null;
  readonly daysOfWeek: readonly number[];
  readonly deliveryWindowStart: string;
  readonly deliveryWindowEnd: string;
  readonly deliveryAddressOverride?: SubscriptionAddressOverride | null;
  readonly mealPlanName?: string | null;
  readonly externalRef?: string | null;
  readonly notesInternal?: string | null;
}

/**
 * Update payload. Mutable-in-place edit shape — every field optional.
 *
 * Excluded by design:
 *   - `id`, `tenantId`, `consigneeId` MAY change in this patch — the
 *     consignee can be reassigned (rare, but valid). `id` and
 *     `tenantId` are excluded as identity columns.
 *   - `status`, `pausedAt`, `endedAt` — lifecycle transitions go
 *     through dedicated repo methods, not this patch.
 *   - `createdAt`, `updatedAt` — repository-managed.
 *
 * `field?: T | null` is the explicit-null shape: omitting clears
 * nothing; passing `null` clears the column. Same convention as the
 * tasks module's UpdateTaskPatch.
 */
export interface UpdateSubscriptionPatch {
  readonly consigneeId?: Uuid;
  readonly startDate?: string;
  readonly endDate?: string | null;
  readonly daysOfWeek?: readonly number[];
  readonly deliveryWindowStart?: string;
  readonly deliveryWindowEnd?: string;
  readonly deliveryAddressOverride?: SubscriptionAddressOverride | null;
  readonly mealPlanName?: string | null;
  readonly externalRef?: string | null;
  readonly notesInternal?: string | null;
}

/**
 * Before/after pair returned by `updateSubscription` and the
 * transitional methods (`pauseSubscription`, `resumeSubscription`,
 * `endSubscription`).
 *
 * S-4's audit emit pipes this through to produce before/after diffs
 * for forensics. The pre-state row is captured under `SELECT ... FOR
 * UPDATE` inside the same transaction as the UPDATE, so the pair
 * is consistent (no other transaction can race the row in between).
 *
 * Empty patches (UpdateSubscriptionPatch with no fields) short-circuit
 * to `{ before, after: before }` — identical references, no UPDATE
 * issued. The service layer can detect "no change" by comparing
 * `before === after` (referential equality).
 */
export interface SubscriptionUpdate {
  readonly before: Subscription;
  readonly after: Subscription;
}

// -----------------------------------------------------------------------------
// Day-16 / Block 4-C — bounded pause + auto-resume
// -----------------------------------------------------------------------------

/**
 * Service input for `pauseSubscription` per brief §3.1.7. All fields
 * required at the API boundary; reason is optional.
 */
export interface PauseSubscriptionInput {
  /** ISO YYYY-MM-DD; must be after the cut-off (18:00 Dubai day-before per §3.1.8). */
  readonly pause_start: string;
  /** ISO YYYY-MM-DD; must be strictly after pause_start. */
  readonly pause_end: string;
  /** Operator note. */
  readonly reason?: string;
  /** Client-supplied uuid; UNIQUE per subscription via the schema constraint. */
  readonly idempotency_key: string;
}

/**
 * Service result for `pauseSubscription`.
 */
export interface PauseSubscriptionResult {
  readonly exception_id: string;
  readonly correlation_id: string;
  /** Resolved end_date after extension (eligible-day walk per §3.1.7). */
  readonly new_end_date: string;
  /** Tasks in window flipped to CANCELED. Forensic field. */
  readonly canceled_task_count: number;
  readonly status: "inserted" | "idempotent_replay";
  readonly http_status: 201 | 409;
}

/**
 * Service input for `resumeSubscription`. Manual resume from API
 * route OR auto-resume from cron handler — the latter passes
 * `is_auto_resume: true` via the options bag (NOT via the body).
 */
export interface ResumeSubscriptionInput {
  readonly idempotency_key: string;
}

/**
 * Service result for `resumeSubscription`. The `'already_active'`
 * status occurs on a paused→active idempotent replay (subscription
 * was already resumed before this call).
 */
export interface ResumeSubscriptionResult {
  readonly correlation_id: string | null;
  /** today's date in tenant tz (manual) OR pause_end (auto). null on already_active. */
  readonly actual_resume_date: string | null;
  /** Recomputed end_date if early manual resume shrinks the pause; null on already_active. */
  readonly new_end_date: string | null;
  /** Tasks restored to 'CREATED' (early manual resume only; 0 on auto). */
  readonly restored_task_count: number;
  readonly status: "resumed" | "already_active";
  readonly http_status: 200;
}
