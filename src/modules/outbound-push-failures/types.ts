// Outbound-push-failures domain types — Day 21 / Phase 1.
//
// Distinct from `failed-pushes` (createTask DLQ at 0008) — covers the
// updateTask / cancelTask / bulkCancelTasks paths landed on Day 21.
// See 0023_outbound_push_failures.sql header for the rationale on
// keeping the two surfaces split (different payload PII risk
// profiles; CONCERN B PII strip is load-bearing for this DLQ but
// not for failed_pushes).
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in 0023.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * The outbound action that failed. Closed enum; mirrors the CHECK
 * constraint on outbound_push_failures.operation.
 */
export type OutboundOperation = "update" | "cancel" | "bulk_cancel";

/**
 * Categorised failure reasons. Mirrors the CHECK constraint on
 * outbound_push_failures.failure_reason.  Adds 'bulk_partial_failure'
 * to the failed_pushes vocabulary for the bulk endpoint's
 * executedCount-vs-expectedCount divergence case.
 */
export type OutboundFailureReason =
  | "network"
  | "server_5xx"
  | "client_4xx"
  | "timeout"
  | "bulk_partial_failure"
  | "unknown";

export interface OutboundPushFailure {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly taskId: Uuid;
  readonly operation: OutboundOperation;
  readonly correlationId: Uuid;
  readonly failureReason: OutboundFailureReason;
  /** PII-stripped at write time per CONCERN B. May be null. */
  readonly failurePayload: Record<string, unknown> | null;
  readonly retryCount: number;
  readonly createdAt: IsoTimestamp;
  readonly resolvedAt: IsoTimestamp | null;
}

/**
 * Input shape for `insertOutboundPushFailure`. `failurePayload` is the
 * pre-strip caller-supplied payload (full SF response body excerpt,
 * adapter call context, etc.); the repository runs `stripPii` on it
 * BEFORE the INSERT statement runs.  Defence-in-depth in case the
 * caller forgets to pre-strip — the repo owns the strip too.
 *
 * `correlationId` propagates from QStash message body → adapter call
 * → DLQ row.  Mandatory (never optional) so every DLQ row is
 * traceable back to the originating queue message and audit log.
 */
export interface RecordOutboundPushFailureInput {
  readonly taskId: Uuid;
  readonly operation: OutboundOperation;
  readonly correlationId: Uuid;
  readonly failureReason: OutboundFailureReason;
  readonly failurePayload?: Record<string, unknown>;
  readonly retryCount?: number;
}
