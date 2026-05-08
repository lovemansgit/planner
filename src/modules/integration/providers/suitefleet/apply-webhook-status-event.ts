// Day 18 / A2 Layer 2 — webhook status-event applier.
//
// Per memory/plans/day-18-a2-webhook-handler-3-layer.md §3 (module
// placement ruled Option A: integration; no re-export to tasks).
//
// Consumes a parser output + raw SF action; writes a webhook_events
// row + UPDATEs tasks.internal_status. On DELIVERED, also writes
// tasks.pod_photos in the same UPDATE (per plan §4.6 Option (a)).
//
// Idempotency posture (plan §3.4):
//   - DB layer (load-bearing): UNIQUE index on
//     webhook_events (suitefleet_task_id, action, event_timestamp).
//     SF retries on non-2xx land the same tuple; the second attempt
//     trips 23505 and we short-circuit with reason: "duplicate".
//   - Service-fn layer (defence-in-depth): the structured return
//     gives the receiver a deterministic outcome to log even though
//     the receiver always returns 200 to SF on the wire.
//
// Audit emits happen AFTER the withTenant block commits. Emit failures
// are surfaced (await-ed) so the receiver can capture them in Sentry
// per the route.ts existing audit-failure handling pattern.

import "server-only";

import { sql as sqlTag } from "drizzle-orm";

import { emit as auditEmit } from "@/modules/audit";
import { withTenant } from "@/shared/db";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

import type { InternalTaskStatus, WebhookEvent } from "../../types";

import { mapSuiteFleetStatusToInternal } from "./status-mapper";

const log = logger.with({ component: "apply_webhook_status_event" });

export type ApplyWebhookStatusEventResult =
  | { readonly applied: true; readonly taskId: Uuid; readonly newStatus: InternalTaskStatus }
  | {
      readonly applied: false;
      readonly reason:
        | "non_lifecycle_or_unknown"
        | "duplicate"
        | "task_not_found";
    };

interface AuditMeta {
  readonly taskId: Uuid;
  readonly suitefleetTaskId: string;
  readonly previousStatus: InternalTaskStatus;
  readonly newStatus: InternalTaskStatus;
  readonly sfAction: string;
  readonly webhookEventsId: string;
  readonly eventTimestamp: string;
  readonly podPhotoCount: number | null;
}

/**
 * Apply a SuiteFleet webhook status event to a Planner task.
 *
 * Per plan §3.3:
 *   1. Resolve InternalTaskStatus | null via status-mapper.
 *   2. If null → skip (non-lifecycle or unknown action).
 *   3. Open withTenant transaction.
 *   4. INSERT into webhook_events.
 *   5. SELECT (id, internal_status) FROM tasks WHERE external_id = AWB.
 *   6. UPDATE tasks SET internal_status (+ pod_photos when DELIVERED).
 *   7. Emit audit events (after tx commits).
 *
 * The receiver wires this into processWebhookAsync per plan §3.5.
 */
export async function applyWebhookStatusEvent(
  tenantId: Uuid,
  event: WebhookEvent,
  sfAction: string,
): Promise<ApplyWebhookStatusEventResult> {
  // Step 1+2: resolve status; skip if null (non-lifecycle or unknown).
  const newStatus = mapSuiteFleetStatusToInternal(sfAction);
  if (newStatus === null) {
    return { applied: false, reason: "non_lifecycle_or_unknown" };
  }

  // Extract POD photos from raw payload if this is a DELIVERED event.
  // Plan §4.4 (deferred to code-PR open): proposing Option (A) plain
  // string array. If the payload's `photos` shape is richer than
  // strings, we store the full array verbatim — jsonb tolerates either
  // shape and the read-side renders accept both.
  const rawPayload = event.raw;
  const podPhotos = newStatus === "DELIVERED" ? extractPodPhotos(rawPayload) : null;
  const rawPayloadJson = JSON.stringify(rawPayload);
  const podPhotosJson = podPhotos === null ? null : JSON.stringify(podPhotos);

  // Step 3-6 inside the withTenant transaction. We return both the
  // outcome AND the audit metadata from the closure so TypeScript
  // can flow-narrow the metadata cleanly outside.
  let txBundle: { outcome: ApplyWebhookStatusEventResult; meta: AuditMeta | null };

  try {
    txBundle = await withTenant(tenantId, async (tx) => {
      // Step 4: INSERT webhook_events. Append-only — UNIQUE 23505
      // bubbles out as a thrown error caught below.
      const insertResult = await tx.execute(sqlTag`
        INSERT INTO webhook_events (tenant_id, suitefleet_task_id, action, event_timestamp, raw_payload)
        VALUES (
          ${tenantId},
          ${event.externalTaskId},
          ${sfAction},
          ${event.occurredAt},
          ${rawPayloadJson}::jsonb
        )
        RETURNING id
      `);
      const webhookEventsId = (insertResult[0] as { id: string }).id;

      // Step 5: SELECT (id, internal_status) — single read provides
      // both the lookup result AND previous_status for the audit emit
      // (no second read; plan §3.3 step 5).
      const taskRows = (await tx.execute(sqlTag`
        SELECT id, internal_status
        FROM tasks
        WHERE external_id = ${event.externalTaskId} AND tenant_id = ${tenantId}
        LIMIT 1
      `)) as readonly { id: string; internal_status: string }[];

      if (taskRows.length === 0) {
        // Forensic surface: webhook_events row was written (preserved
        // for downstream investigation) but no Planner task matches
        // this AWB. Warn-log + structured return; receiver still 200s.
        log.warn({
          operation: "apply_webhook_status_event",
          error_code: "task_not_found",
          tenant_id: tenantId,
          suitefleet_task_id: event.externalTaskId,
          sf_action: sfAction,
        });
        return {
          outcome: { applied: false, reason: "task_not_found" } as const,
          meta: null,
        };
      }

      const taskId = taskRows[0].id as Uuid;
      const previousStatus = taskRows[0].internal_status as InternalTaskStatus;

      // Step 6: UPDATE tasks. When DELIVERED, fold pod_photos into
      // the same statement (plan §4.6 Option (a) atomicity).
      if (newStatus === "DELIVERED") {
        await tx.execute(sqlTag`
          UPDATE tasks
          SET
            internal_status = ${newStatus},
            pod_photos = ${podPhotosJson}::jsonb,
            updated_at = now()
          WHERE id = ${taskId} AND tenant_id = ${tenantId}
        `);
      } else {
        await tx.execute(sqlTag`
          UPDATE tasks
          SET internal_status = ${newStatus}, updated_at = now()
          WHERE id = ${taskId} AND tenant_id = ${tenantId}
        `);
      }

      const meta: AuditMeta = {
        taskId,
        suitefleetTaskId: event.externalTaskId,
        previousStatus,
        newStatus,
        sfAction,
        webhookEventsId,
        eventTimestamp: event.occurredAt,
        podPhotoCount: podPhotos === null ? null : podPhotos.length,
      };

      return {
        outcome: { applied: true, taskId, newStatus } as const,
        meta,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { applied: false, reason: "duplicate" };
    }
    throw err;
  }

  // Step 7: audit emits AFTER the tx commits.
  if (txBundle.outcome.applied && txBundle.meta !== null) {
    await emitStatusChangedAudit(tenantId, txBundle.meta);
    if (txBundle.meta.podPhotoCount !== null && txBundle.meta.podPhotoCount > 0) {
      await emitPodReceivedAudit(tenantId, txBundle.meta);
    }
  }

  return txBundle.outcome;
}

/**
 * Extract POD photos from a raw SF webhook payload's
 * `deliveryInformation.photos` field.
 *
 * Plan §4.4 (deferred ruling): Option (A) plain string array. If the
 * wire shape is richer than strings, we still store it verbatim —
 * jsonb tolerates the richer shape and the column-name carries no
 * commitment to "always a string array."
 *
 * Returns null if photos field is absent / not an array / empty array.
 * NULL on tasks.pod_photos is the read-side signal for "no POD" so
 * empty-array → null normalisation keeps the UI surface simple.
 */
function extractPodPhotos(rawPayload: unknown): unknown[] | null {
  if (typeof rawPayload !== "object" || rawPayload === null) return null;
  const deliveryInfo = (rawPayload as Record<string, unknown>).deliveryInformation;
  if (typeof deliveryInfo !== "object" || deliveryInfo === null) return null;
  const photos = (deliveryInfo as Record<string, unknown>).photos;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return photos;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

async function emitStatusChangedAudit(tenantId: Uuid, meta: AuditMeta): Promise<void> {
  await auditEmit({
    eventType: "task.status_changed_via_webhook",
    actorKind: "system",
    actorId: "system:webhook_receiver",
    tenantId,
    resourceType: "task",
    resourceId: meta.taskId,
    metadata: {
      task_id: meta.taskId,
      suitefleet_task_id: meta.suitefleetTaskId,
      previous_status: meta.previousStatus,
      new_status: meta.newStatus,
      sf_action: meta.sfAction,
      webhook_events_id: meta.webhookEventsId,
      event_timestamp: meta.eventTimestamp,
    },
  });
}

async function emitPodReceivedAudit(tenantId: Uuid, meta: AuditMeta): Promise<void> {
  await auditEmit({
    eventType: "task.pod_received_via_webhook",
    actorKind: "system",
    actorId: "system:webhook_receiver",
    tenantId,
    resourceType: "task",
    resourceId: meta.taskId,
    metadata: {
      task_id: meta.taskId,
      suitefleet_task_id: meta.suitefleetTaskId,
      photo_count: meta.podPhotoCount,
      webhook_events_id: meta.webhookEventsId,
    },
  });
}
