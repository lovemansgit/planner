// Failed-pushes repository — Drizzle queries against `failed_pushes`
// (0008).
//
// Day 5 / T-7: insert path only. The cron's "first failure for a
// task" path writes here. UPDATE (retry attempts) and resolution
// paths are Day-7+ / post-MVP UI concerns; their callers don't exist
// yet, so the surface stays minimal until they do.
//
// "Repository" here is the data-access layer: every function takes a
// `tx: DbTx` (from the caller's `withServiceRole` block — there is
// no user-flow path through this table; failed-pushes is system
// only), runs one statement, and maps rows to the camelCase domain
// shape. No permission checks, no audit emits, no validation beyond
// null-vs-undefined handling — those belong in the service layer.
//
// RLS is the secondary defence; the partial UNIQUE on
// (task_id) WHERE resolved_at IS NULL and the
// failed_pushes_assert_tenant_match trigger are the schema-layer
// belts. Both fire under BYPASSRLS callers (which is how
// withServiceRole connects), so a buggy caller writing a mismatched
// tenant_id or a duplicate-unresolved row hits a hard SQL error
// rather than landing a corrupt record.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type { FailedPush, FailureReason, RecordFailedPushInput } from "./types";

// -----------------------------------------------------------------------------
// Row shape and mapper
// -----------------------------------------------------------------------------

type FailedPushRow = {
  id: string;
  tenant_id: string;
  task_id: string;
  attempt_count: number;
  task_payload: Record<string, unknown>;
  failure_reason: FailureReason;
  failure_detail: string | null;
  http_status: number | null;
  first_failed_at: Date | string;
  last_attempted_at: Date | string;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
} & Record<string, unknown>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function mapRow(row: FailedPushRow): FailedPush {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    attemptCount: row.attempt_count,
    taskPayload: row.task_payload,
    failureReason: row.failure_reason,
    failureDetail: row.failure_detail,
    httpStatus: row.http_status,
    firstFailedAt: toIso(row.first_failed_at),
    lastAttemptedAt: toIso(row.last_attempted_at),
    resolvedAt: toIsoOrNull(row.resolved_at),
    resolvedBy: row.resolved_by,
    resolutionNotes: row.resolution_notes,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

/**
 * INSERT one failed_pushes row. The caller's `withServiceRole`
 * transaction provides the BYPASSRLS path the cron / adapter need.
 *
 * Throws (raw DB errors propagate to the caller):
 *   - SQLSTATE 23505 (unique_violation) — an unresolved
 *     failed_pushes row already exists for this task_id. The cron
 *     should detect this and route to an updateFailedPushAttempt path
 *     (which lands Day 7); for T-7's first-failure-only scope, the
 *     error propagates as-is.
 *   - SQLSTATE P0001 (raise_exception) — the
 *     failed_pushes_assert_tenant_match trigger fired because
 *     tenant_id doesn't match the parent task's tenant_id. Indicates
 *     a service-layer bug.
 *   - SQLSTATE 23503 (foreign_key_violation) — task_id doesn't exist.
 *     Indicates a routing bug or a race between task delete and
 *     failed-push record.
 *
 * Returns the inserted row including DB-defaulted columns.
 */
export async function insertFailedPush(
  tx: DbTx,
  tenantId: Uuid,
  input: RecordFailedPushInput,
): Promise<FailedPush> {
  const payloadJson = JSON.stringify(input.taskPayload);
  const rows = await tx.execute<FailedPushRow>(sqlTag`
    INSERT INTO failed_pushes (
      tenant_id,
      task_id,
      task_payload,
      failure_reason,
      failure_detail,
      http_status
    ) VALUES (
      ${tenantId},
      ${input.taskId},
      ${payloadJson}::jsonb,
      ${input.failureReason},
      ${input.failureDetail ?? null},
      ${input.httpStatus ?? null}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    // INSERT … RETURNING never returns zero rows on success. Throw
    // rather than synthesising a value so the caller sees the anomaly.
    throw new Error("insertFailedPush: INSERT … RETURNING produced zero rows");
  }
  return mapRow(rows[0]);
}

/**
 * UPDATE the existing unresolved failed_pushes row for `taskId` —
 * increments attempt_count, refreshes last_attempted_at + failure
 * context (reason, detail, http_status, payload). Preserves
 * first_failed_at (the original failure timestamp).
 *
 * Day 8 / D8-4: this is the cron retry path's UPDATE side. The
 * service-layer caller (`recordFailedPushAttempt`) tries
 * `insertFailedPush` first; on SQLSTATE 23505 from the partial
 * UNIQUE on (task_id) WHERE resolved_at IS NULL, it routes here
 * to upsert-via-update on the existing unresolved row. Mirrors
 * the C-2 pattern (insert-then-update-on-conflict).
 *
 * Returns the updated row (post-increment). Throws if no
 * unresolved row exists (the caller's 23505 detection is the
 * gate; reaching here without a matching row means a race deleted
 * the row between the conflicting INSERT and this UPDATE — surface
 * as an error so the caller can log + Sentry-capture).
 */
export async function updateFailedPushAttempt(
  tx: DbTx,
  tenantId: Uuid,
  input: RecordFailedPushInput,
): Promise<FailedPush> {
  const payloadJson = JSON.stringify(input.taskPayload);
  // Defence-in-depth tenant_id predicate alongside RLS (same posture
  // as the consignees / tasks UPDATE paths). The partial UNIQUE
  // already scopes to one row per (task_id, unresolved); the
  // tenant_id filter is belt-and-braces against any future caller
  // that might construct a tenant_id mismatch.
  const rows = await tx.execute<FailedPushRow>(sqlTag`
    UPDATE failed_pushes
    SET
      attempt_count    = attempt_count + 1,
      task_payload     = ${payloadJson}::jsonb,
      failure_reason   = ${input.failureReason},
      failure_detail   = ${input.failureDetail ?? null},
      http_status      = ${input.httpStatus ?? null},
      last_attempted_at = now()
    WHERE task_id = ${input.taskId}
      AND tenant_id = ${tenantId}
      AND resolved_at IS NULL
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error(
      `updateFailedPushAttempt: no unresolved failed_pushes row for task ${input.taskId} in tenant ${tenantId} (race or programming error)`,
    );
  }
  return mapRow(rows[0]);
}
