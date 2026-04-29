// Failed-pushes domain types.
//
// camelCase TypeScript at the module boundary; the repository layer
// maps to/from the snake_case columns in 0008_failed_pushes.sql.
//
// Day 5 / T-7 ships INSERT-PATH ONLY — the cron's "first failure for
// a task" path. Resolve, list, and update-attempt paths land Day 7+
// (when the cron's retry-with-audit-trail flow + the post-MVP
// operator UI need them). The repository / service surface stays
// minimal until those callers exist.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * Categorised failure reasons. Mirrors the CHECK constraint on
 * failed_pushes.failure_reason.
 *
 * Application layer maps from adapter-layer errors:
 *   - 'network'     connection refused, DNS failure, TCP reset before
 *                   any HTTP exchange
 *   - 'server_5xx'  got an HTTP response, status was 5xx
 *   - 'client_4xx'  got an HTTP response, status was 4xx (typically
 *                   only fires post-retries-exhausted; immediate 4xx
 *                   is a non-retryable application error path)
 *   - 'timeout'     request sent, no response within the adapter's
 *                   timeout budget
 *   - 'unknown'     anything that doesn't fit above (catch-all for
 *                   diagnostic resilience)
 */
export type FailureReason =
  | "network"
  | "server_5xx"
  | "client_4xx"
  | "timeout"
  | "unknown";

export interface FailedPush {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly taskId: Uuid;
  readonly attemptCount: number;
  /** The full request body sent to SuiteFleet at the moment of failure. */
  readonly taskPayload: Record<string, unknown>;
  readonly failureReason: FailureReason;
  /** Free-form debug info — stack trace excerpt, response body. No creds. */
  readonly failureDetail: string | null;
  /** Null for network / timeout failures (no HTTP response received). */
  readonly httpStatus: number | null;
  readonly firstFailedAt: IsoTimestamp;
  readonly lastAttemptedAt: IsoTimestamp;
  /** Null while active; set when the row transitions to resolved. */
  readonly resolvedAt: IsoTimestamp | null;
  /** Null for system-resolved entries OR when the resolver was deleted. */
  readonly resolvedBy: Uuid | null;
  readonly resolutionNotes: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Input shape for `insertFailedPush` / `recordFailedPush`. The cron
 * supplies these fields; tenant_id and id are repository / DB
 * concerns. attempt_count defaults to 1 (this is the "first failure"
 * path; subsequent retries land via a future updateFailedPushAttempt
 * method which doesn't exist in T-7).
 */
export interface RecordFailedPushInput {
  readonly taskId: Uuid;
  readonly taskPayload: Record<string, unknown>;
  readonly failureReason: FailureReason;
  readonly failureDetail?: string;
  readonly httpStatus?: number;
}
