// Day 18 / A2 Layer 2 — webhook status-event applier.
//
// Per memory/plans/day-18-a2-webhook-handler-3-layer.md §3 (module
// placement ruled Option A: integration; no re-export to tasks).
//
// Consumes a parser output + raw SF action; writes a webhook_events
// row + UPDATEs tasks.internal_status. On DELIVERED, also writes
// tasks.pod_photos in the same UPDATE (per plan §4.6 Option (a)).
//
// Day-31 A1 structural extension (plan #306 final lane shape + §3.6 #2
// reject-back revision):
//   Real-wire evidence (MPL-80355079 + MPL-38610276) showed SF emits
//   field deltas (deliveryDate / deliveryStartTime / deliveryEndTime)
//   embedded inside TASK_STATUS_UPDATED_TO_* payloads when the edit
//   happened after the last standalone TASK_HAS_BEEN_UPDATED event.
//   The status handler reconciles those embedded TOP-LEVEL field
//   deltas alongside internal_status + pod_photos.
//
//   Named §3.6 #2 hard-stop surface (refinement §4): embedded deltas
//   are read from raw_payload TOP LEVEL ONLY (`raw_payload.deliveryDate`
//   etc.) and NEVER from `raw_payload.deliveryInformation.*` — those
//   are driver actual-completion timestamps (e.g. 16:23/16:24) and
//   reading them would write the driver clock into the scheduled window.
//
//   #305 SKIPPED-guard interaction (§3.6 #2 Finding 1): the operator-set
//   SKIPPED state is protected from a webhook ack — internal_status
//   and pod_photos remain SKIPPED-guarded. Embedded scheduled-window
//   deltas (delivery_date / delivery_start_time / delivery_end_time)
//   apply UNCONDITIONALLY — a schedule edit on a skipped task is still
//   a real schedule fact and must persist. Implemented as two UPDATEs
//   in the same tx: an unguarded embedded-delta UPDATE, then a
//   SKIPPED-guarded internal_status + pod_photos UPDATE.
//
//   Audit changed_fields (§3.6 #2 Finding 1(b)) is driven from the
//   embedded UPDATE's RETURNING clause vs the pre-SELECT row — it
//   reflects what was ACTUALLY persisted, never pre-write intent.
//   When the embedded UPDATE is skipped (effectiveChanges empty),
//   changed_fields is empty.
//
//   Address is intentionally excluded — address is consignee-level
//   (locked B1 ruling); the existing two enforcement layers in
//   apply-webhook-edit-event.ts stay untouched and the status path
//   does not introduce an address write either.
//
//   Inbound TZ: deliveryStartTime / deliveryEndTime are UTC on the
//   wire; convert to Dubai-local via utcTimeToDubaiLocal (mirror of
//   A3 #307 outbound). Post-conversion wrap-inversion (end < start)
//   excludes ONLY the inverted time pair from the embedded write set
//   (§3.6 #2 Finding 2); status, pod_photos, deliveryDate, and any
//   other valid delta proceed normally. The wrap is logged as a
//   structured warn signal. deliveryDate stays Dubai-local (A3
//   contract; no TZ shift on date).
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
import { z } from "zod";

import { emit as auditEmit } from "@/modules/audit";
import { withTenant } from "@/shared/db";
import { isUniqueViolation } from "@/shared/db-errors";
import { ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

import type { InternalTaskStatus, WebhookEvent } from "../../types";

import { mapSuiteFleetStatusToInternal } from "./status-mapper";
import { utcTimeToDubaiLocal } from "./tz";

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

interface EmbeddedChange {
  readonly field: string;
  readonly previous: unknown;
  readonly new: unknown;
}

interface AuditMeta {
  readonly taskId: Uuid;
  readonly suitefleetTaskId: string;
  readonly previousStatus: InternalTaskStatus;
  readonly newStatus: InternalTaskStatus;
  readonly sfAction: string;
  readonly webhookEventsId: string;
  readonly eventTimestamp: string;
  readonly podPhotoCount: number | null;
  readonly changedFields: readonly EmbeddedChange[];
}

// ---------------------------------------------------------------------------
// Top-level embedded-delta schema (Day-31 A1).
// ---------------------------------------------------------------------------
//
// Named §3.6 #2 hard-stop surface (plan #306 refinement §4): these fields
// are read from raw_payload TOP LEVEL ONLY. Reading deliveryInformation.*
// would write the driver actual-completion clock into the scheduled
// window. The schema deliberately admits ONLY top-level scheduled-window
// keys; deliveryInformation is NOT a key in this schema (the existing
// extractPodPhotos reads photos off raw_payload via its own path and is
// unrelated to scheduled-window deltas).
//
// Default Zod object behavior strips unknown root keys → SF can grow
// the payload without breaking this parse. safeParse failures (e.g.
// timestamp form on deliveryDate, ms/offset on times, type mismatch)
// trip the parse and we proceed with status-only (no embedded deltas)
// rather than blocking the status update.

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HMS_TIME_REGEX = /^\d{2}:\d{2}:\d{2}$/;

const statusEventEmbeddedSchema = z.object({
  deliveryDate: z.string().regex(ISO_DATE_REGEX).optional(),
  deliveryStartTime: z.string().regex(HMS_TIME_REGEX).optional(),
  deliveryEndTime: z.string().regex(HMS_TIME_REGEX).optional(),
});

interface ConvertedEmbedded {
  readonly deliveryDate: string | undefined;
  readonly deliveryStartTime: string | undefined; // Dubai-local post-conversion
  readonly deliveryEndTime: string | undefined; // Dubai-local post-conversion
  readonly wrapInversion: boolean;
}

/**
 * Parse top-level embedded fields off raw_payload and apply the inbound
 * UTC → Dubai-local conversion to time fields. Returns `wrapInversion`
 * true when post-conversion the window is inverted (end < start) — the
 * caller must short-circuit the entire UPDATE per OQ-10(a) ruling.
 *
 * Schema parse failure → all three fields undefined (proceed with
 * status-only update; do not block status on embedded-shape issues).
 * Helper throw on malformed time format → that specific time undefined
 * (other fields preserve).
 */
function extractAndConvertEmbedded(rawPayload: unknown): ConvertedEmbedded {
  const parseResult = statusEventEmbeddedSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    return {
      deliveryDate: undefined,
      deliveryStartTime: undefined,
      deliveryEndTime: undefined,
      wrapInversion: false,
    };
  }
  const parsed = parseResult.data;

  let convertedStart: string | undefined;
  let convertedEnd: string | undefined;

  try {
    if (parsed.deliveryStartTime !== undefined) {
      convertedStart = utcTimeToDubaiLocal(parsed.deliveryStartTime);
    }
  } catch (err) {
    // Malformed time defense-in-depth — regex already gate-kept above;
    // helper-thrown ValidationError reaches here only on hour-range
    // breach (00-23). Keep field undefined; date + other-time still apply.
    if (!(err instanceof ValidationError)) throw err;
  }
  try {
    if (parsed.deliveryEndTime !== undefined) {
      convertedEnd = utcTimeToDubaiLocal(parsed.deliveryEndTime);
    }
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
  }

  // Wrap-inversion is only meaningful when BOTH times are present after
  // conversion. Half-windows (start only or end only) cannot invert.
  const wrapInversion =
    convertedStart !== undefined &&
    convertedEnd !== undefined &&
    convertedEnd < convertedStart;

  return {
    deliveryDate: parsed.deliveryDate,
    deliveryStartTime: convertedStart,
    deliveryEndTime: convertedEnd,
    wrapInversion,
  };
}

function computeEmbeddedChanges(
  row: {
    readonly delivery_date: string | null;
    readonly delivery_start_time: string | null;
    readonly delivery_end_time: string | null;
  },
  embedded: ConvertedEmbedded,
): readonly EmbeddedChange[] {
  const changes: EmbeddedChange[] = [];
  if (
    embedded.deliveryDate !== undefined &&
    embedded.deliveryDate !== row.delivery_date
  ) {
    changes.push({
      field: "delivery_date",
      previous: row.delivery_date,
      new: embedded.deliveryDate,
    });
  }
  if (
    embedded.deliveryStartTime !== undefined &&
    embedded.deliveryStartTime !== row.delivery_start_time
  ) {
    changes.push({
      field: "delivery_start_time",
      previous: row.delivery_start_time,
      new: embedded.deliveryStartTime,
    });
  }
  if (
    embedded.deliveryEndTime !== undefined &&
    embedded.deliveryEndTime !== row.delivery_end_time
  ) {
    changes.push({
      field: "delivery_end_time",
      previous: row.delivery_end_time,
      new: embedded.deliveryEndTime,
    });
  }
  return changes;
}

function buildEmbeddedSetFragment(
  column: string,
  value: unknown,
): ReturnType<typeof sqlTag> {
  switch (column) {
    case "delivery_date":
      return sqlTag`delivery_date = ${value}::date`;
    case "delivery_start_time":
      return sqlTag`delivery_start_time = ${value}::time`;
    case "delivery_end_time":
      return sqlTag`delivery_end_time = ${value}::time`;
    default:
      // Unreachable — caller iterates the EmbeddedChange[] which is
      // produced only from the three known columns above.
      throw new Error(`buildEmbeddedSetFragment: unexpected column '${column}'`);
  }
}

/**
 * Apply a SuiteFleet webhook status event to a Planner task.
 *
 * Per plan §3.3:
 *   1. Resolve InternalTaskStatus | null via status-mapper.
 *   2. If null → skip (non-lifecycle or unknown action).
 *   3. Open withTenant transaction.
 *   4. INSERT into webhook_events.
 *   5. SELECT (id, internal_status) FROM tasks WHERE external_tracking_number = AWB.
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

  // Day-31 A1: extract TOP-LEVEL embedded scheduled-window deltas and
  // apply the UTC→Dubai-local conversion to time fields. Named §3.6 #2
  // hard-stop surface — top-level only; deliveryInformation.* is the
  // driver actual-completion clock and is NEVER read here.
  const embedded = extractAndConvertEmbedded(rawPayload);

  // Step 3-6 inside the withTenant transaction. We return both the
  // outcome AND the audit metadata from the closure so TypeScript
  // can flow-narrow the metadata cleanly outside.
  let txBundle: { outcome: ApplyWebhookStatusEventResult; meta: AuditMeta | null };

  try {
    txBundle = await withTenant(tenantId, async (tx) => {
      // Step 4: INSERT webhook_events. Append-only — UNIQUE 23505
      // bubbles out as a thrown error caught below.
      //
      // Forensic preservation: this INSERT runs BEFORE any short-circuit
      // path below (task_not_found). raw_payload is always captured for
      // downstream investigation even when the tasks UPDATE doesn't fire.
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

      // Day-31 A1 §3.6 #2 Finding 2: post-conversion wrap-inversion does
      // NOT short-circuit the event. Surface the wrap as a structured
      // warn signal; the inverted time PAIR is excluded from the
      // embedded write set below (`effectiveChanges`). Status,
      // pod_photos, deliveryDate, and any other valid delta proceed
      // normally — over-broad blast-radius rejection from the prior
      // implementation is gone.
      if (embedded.wrapInversion) {
        log.warn({
          operation: "apply_webhook_status_event",
          error_code: "wrap_inversion_time_pair_skipped",
          tenant_id: tenantId,
          suitefleet_task_id: event.externalTaskId,
          sf_action: sfAction,
          webhook_events_id: webhookEventsId,
          delivery_start_time: embedded.deliveryStartTime,
          delivery_end_time: embedded.deliveryEndTime,
        });
      }

      // Step 5: SELECT (id, internal_status, scheduled-window columns).
      // Single read provides the lookup result, previous_status for
      // audit, AND the current-row values needed to diff embedded
      // deltas (plan §3.3 step 5 — extended for A1 embedded-delta
      // reconciliation).
      //
      // Layer 1.5 parser extracts AWB; production stores AWB in
      // external_tracking_number (numeric SF id is in external_id).
      // Lookup must use external_tracking_number to match the
      // parser-extracted value.
      const taskRows = (await tx.execute(sqlTag`
        SELECT id,
               internal_status,
               delivery_date::text AS delivery_date,
               delivery_start_time::text AS delivery_start_time,
               delivery_end_time::text AS delivery_end_time
        FROM tasks
        WHERE external_tracking_number = ${event.externalTaskId} AND tenant_id = ${tenantId}
        LIMIT 1
      `)) as readonly {
        id: string;
        internal_status: string;
        delivery_date: string | null;
        delivery_start_time: string | null;
        delivery_end_time: string | null;
      }[];

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

      // Day-31 A1: compute embedded field deltas by diffing the SELECTed
      // row against the converted top-level payload values. Address is
      // intentionally NOT in scope — consignee-level, B1-owned (locked).
      //
      // §3.6 #2 Finding 2: when wrap-inversion is detected, drop the
      // delivery_start_time + delivery_end_time pair from the write set.
      // deliveryDate (if present) and any other valid delta survive.
      const embeddedChanges = computeEmbeddedChanges(taskRows[0], embedded);
      const effectiveChanges: readonly EmbeddedChange[] = embedded.wrapInversion
        ? embeddedChanges.filter(
            (c) => c.field !== "delivery_start_time" && c.field !== "delivery_end_time",
          )
        : embeddedChanges;

      // Step 6: two UPDATEs in the same tx (§3.6 #2 Finding 1(a)).
      //
      //   UPDATE 1 — embedded scheduled-window deltas, UNGUARDED.
      //     A schedule edit on a SKIPPED task is still a real schedule
      //     fact and must persist (the SKIPPED guard exists to protect
      //     operator-set status from a webhook status ack, not to
      //     suppress scheduled-window deltas).
      //
      //   UPDATE 2 — internal_status + pod_photos, SKIPPED-guarded.
      //     Day-29 §D(2) Phase-1 / plan-PR #302 §6.2 / §3.6 OQ-6
      //     ruling Option A: SKIPPED is operator-set and Planner-local
      //     per brief §3.1.1; the inbound SF webhook status ack must
      //     NOT overwrite it. pod_photos rides under the same guard
      //     per #305's original intent (operator-set cancel beats
      //     driver-reported DELIVERED+POD on the same task).
      //
      // §3.6 #2 Finding 1(b): audit changed_fields is driven by the
      // RETURNING-clause delta of UPDATE 1 — it reflects what was
      // ACTUALLY persisted, not pre-write intent. When UPDATE 1 is
      // skipped (effectiveChanges empty), changed_fields is empty.
      let actualChanges: readonly EmbeddedChange[] = [];

      if (effectiveChanges.length > 0) {
        const embeddedSetFragments: ReturnType<typeof sqlTag>[] = effectiveChanges.map(
          (c) => buildEmbeddedSetFragment(c.field, c.new),
        );
        embeddedSetFragments.push(sqlTag`updated_at = now()`);
        const embeddedSetClause = embeddedSetFragments.reduce(
          (acc, frag, i) => (i === 0 ? frag : sqlTag`${acc}, ${frag}`),
          embeddedSetFragments[0],
        );

        const embeddedReturning = (await tx.execute(sqlTag`
          UPDATE tasks
          SET ${embeddedSetClause}
          WHERE id = ${taskId} AND tenant_id = ${tenantId}
          RETURNING delivery_date::text AS delivery_date,
                    delivery_start_time::text AS delivery_start_time,
                    delivery_end_time::text AS delivery_end_time
        `)) as readonly {
          delivery_date: string | null;
          delivery_start_time: string | null;
          delivery_end_time: string | null;
        }[];

        const post = embeddedReturning[0];
        const pre = taskRows[0];
        const computed: EmbeddedChange[] = [];
        if (post.delivery_date !== pre.delivery_date) {
          computed.push({
            field: "delivery_date",
            previous: pre.delivery_date,
            new: post.delivery_date,
          });
        }
        if (post.delivery_start_time !== pre.delivery_start_time) {
          computed.push({
            field: "delivery_start_time",
            previous: pre.delivery_start_time,
            new: post.delivery_start_time,
          });
        }
        if (post.delivery_end_time !== pre.delivery_end_time) {
          computed.push({
            field: "delivery_end_time",
            previous: pre.delivery_end_time,
            new: post.delivery_end_time,
          });
        }
        actualChanges = computed;
      }

      const statusSetFragments: ReturnType<typeof sqlTag>[] = [
        sqlTag`internal_status = ${newStatus}`,
      ];
      if (newStatus === "DELIVERED") {
        statusSetFragments.push(sqlTag`pod_photos = ${podPhotosJson}::jsonb`);
      }
      statusSetFragments.push(sqlTag`updated_at = now()`);
      const statusSetClause = statusSetFragments.reduce(
        (acc, frag, i) => (i === 0 ? frag : sqlTag`${acc}, ${frag}`),
        statusSetFragments[0],
      );

      await tx.execute(sqlTag`
        UPDATE tasks
        SET ${statusSetClause}
        WHERE id = ${taskId} AND tenant_id = ${tenantId}
          AND internal_status NOT IN ('SKIPPED')
      `);

      const meta: AuditMeta = {
        taskId,
        suitefleetTaskId: event.externalTaskId,
        previousStatus,
        newStatus,
        sfAction,
        webhookEventsId,
        eventTimestamp: event.occurredAt,
        podPhotoCount: podPhotos === null ? null : podPhotos.length,
        changedFields: actualChanges,
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
      // Day-31 A1: embedded scheduled-window field deltas applied in
      // the same UPDATE statement. Empty array when the status event
      // carried no top-level deliveryDate / deliveryStartTime /
      // deliveryEndTime changes vs the row's current values.
      changed_fields: meta.changedFields,
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
