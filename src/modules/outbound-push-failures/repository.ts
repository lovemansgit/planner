// Outbound-push-failures repository — Day 21 / Phase 1.
//
// INSERT-side surface for the outbound DLQ. The QStash failureCallback
// routes (`/api/queue/cancel-task-failed`, `/api/queue/update-task-failed`)
// call `insertOutboundPushFailure` after retries exhaust. The repo
// runs the CONCERN B PII strip on `failurePayload` BEFORE the INSERT
// statement runs — defence-in-depth in case a caller forgets to
// pre-strip.
//
// READ + RESOLUTION paths land Phase 2 alongside the
// /admin/dlq/outbound-push-failures UI per brief §G.5. The current v1
// scope is INSERT only.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import { stripPiiObject } from "./pii-strip";
import type {
  OutboundFailureReason,
  OutboundOperation,
  OutboundPushFailure,
  RecordOutboundPushFailureInput,
} from "./types";

type OutboundPushFailureRow = {
  id: string;
  tenant_id: string;
  task_id: string;
  operation: OutboundOperation;
  correlation_id: string;
  failure_reason: OutboundFailureReason;
  failure_payload: Record<string, unknown> | null;
  retry_count: number;
  created_at: Date | string;
  resolved_at: Date | string | null;
} & Record<string, unknown>;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function mapRow(row: OutboundPushFailureRow): OutboundPushFailure {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskId: row.task_id,
    operation: row.operation,
    correlationId: row.correlation_id,
    failureReason: row.failure_reason,
    failurePayload: row.failure_payload,
    retryCount: row.retry_count,
    createdAt: toIso(row.created_at),
    resolvedAt: toIsoOrNull(row.resolved_at),
  };
}

/**
 * INSERT one outbound_push_failures row. The CONCERN B PII strip
 * runs HERE, before the statement, so the on-disk failure_payload is
 * always pre-redacted regardless of caller hygiene.
 *
 * Caller's `withServiceRole` transaction provides the BYPASSRLS path
 * the QStash failureCallback handler needs. Schema-level
 * `outbound_push_failures_assert_tenant_match` trigger fires under
 * BYPASSRLS too — a service-layer caller cannot insert a row whose
 * tenant_id diverges from the parent task's.
 *
 * Throws (raw DB errors propagate to the caller):
 *   - SQLSTATE P0001 (raise_exception) — tenant_id mismatch (trigger).
 *   - SQLSTATE 23503 (foreign_key_violation) — task_id doesn't exist.
 *   - SQLSTATE 23514 (check_violation) — operation or failure_reason
 *     outside the closed CHECK enum.
 *
 * Returns the inserted row (post-INSERT … RETURNING shape).
 */
export async function insertOutboundPushFailure(
  tx: DbTx,
  tenantId: Uuid,
  input: RecordOutboundPushFailureInput,
): Promise<OutboundPushFailure> {
  // CONCERN B — strip PII at write time. The strip helper is
  // idempotent (re-stripping a stripped object is a no-op modulo
  // sentinel-string preservation), so repeating in case the caller
  // already pre-stripped is safe.
  const strippedPayload = stripPiiObject(input.failurePayload);
  const payloadJson =
    strippedPayload === null ? null : JSON.stringify(strippedPayload);

  const rows = await tx.execute<OutboundPushFailureRow>(sqlTag`
    INSERT INTO outbound_push_failures (
      tenant_id,
      task_id,
      operation,
      correlation_id,
      failure_reason,
      failure_payload,
      retry_count
    ) VALUES (
      ${tenantId},
      ${input.taskId},
      ${input.operation},
      ${input.correlationId},
      ${input.failureReason},
      ${payloadJson === null ? null : sqlTag`${payloadJson}::jsonb`},
      ${input.retryCount ?? 0}
    )
    RETURNING *
  `);

  if (rows.length === 0) {
    throw new Error(
      "insertOutboundPushFailure: INSERT … RETURNING produced zero rows",
    );
  }
  return mapRow(rows[0]);
}
