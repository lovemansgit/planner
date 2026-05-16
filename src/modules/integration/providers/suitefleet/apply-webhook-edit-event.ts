// Day 18 / A2 Layer 3 — webhook edit-event applier.
//
// Per memory/plans/day-18-a2-webhook-handler-3-layer.md §4.2 + §4.3.
//
// Consumes TASK_HAS_BEEN_UPDATED events. Writes a webhook_events row
// + UPDATEs only the tasks columns whose payload values differ from
// the current row (tx-level diff per plan §4.2). Captures the field
// delta as `changed_fields` metadata on the audit event.
//
// Address handling (plan §4.3 ruling: Option (ii)):
//   * consignee.location.* payloads are CAPTURED in changed_fields
//     metadata as a single entry with previous=null and new=<payload>.
//   * tasks.address_id is NOT mutated.
//   * No fourth audit event type — routes through the existing
//     task.edit_applied_via_webhook event.
//
// Idempotency posture matches Layer 2 (plan §3.4): UNIQUE catches
// SF retries; structured return on duplicate.
//
// Module placement: Option A (integration) per plan §3.2 ruling.

import "server-only";

import { sql as sqlTag } from "drizzle-orm";
import { z } from "zod";

import { emit as auditEmit } from "@/modules/audit";
import { withTenant } from "@/shared/db";
import { isUniqueViolation } from "@/shared/db-errors";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

import type { WebhookEvent } from "../../types";

const log = logger.with({ component: "apply_webhook_edit_event" });

// ---------------------------------------------------------------------------
// Payload schema (plan PR #294 §5.2 + §5.3 + §6.1 U2)
// ---------------------------------------------------------------------------
//
// LENIENT on unknown keys: future SF field additions must not hard-fail the
// webhook. Default Zod object behaviour (strip) silently drops unknown root
// + deliveryInformation keys; nested consignee.location uses passthrough so
// the audit-metadata capture sees the full location object SF sent.
//
// Regex constraints reject non-canonical date/time forms at the boundary —
// post-parser equality is trivial string === (NO parseISO, NO dateFns, NO
// epoch-ms compare; no date-arithmetic dependency added per locked §5.2).
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HMS_TIME_REGEX = /^\d{2}:\d{2}:\d{2}$/;

const consigneeLocationSchema = z.object({}).passthrough();

const consigneeSchema = z.object({
  location: consigneeLocationSchema.optional(),
});

const deliveryInformationSchema = z.object({
  recipientName: z.string().optional(),
  signature: z.string().optional(),
  consigneeRating: z.number().optional(),
  consigneeComment: z.string().optional(),
  driverComment: z.string().optional(),
  numberOfAttempts: z.number().optional(),
  failureReasonComment: z.string().nullable().optional(),
  completionLatitude: z.number().optional(),
  completionLongitude: z.number().optional(),
});

const webhookEditPayloadSchema = z.object({
  deliveryDate: z.string().regex(ISO_DATE_REGEX).optional(),
  deliveryStartTime: z.string().regex(HMS_TIME_REGEX).optional(),
  deliveryEndTime: z.string().regex(HMS_TIME_REGEX).optional(),
  deliveryInformation: deliveryInformationSchema.optional(),
  consignee: consigneeSchema.optional(),
});

type WebhookEditPayload = z.infer<typeof webhookEditPayloadSchema>;

export type ApplyWebhookEditEventResult =
  | {
      readonly applied: true;
      readonly taskId: Uuid;
      readonly changedFieldCount: number;
    }
  | {
      readonly applied: false;
      readonly reason:
        | "wrong_action"
        | "duplicate"
        | "task_not_found"
        | "no_diff"
        | "payload_validation_failed";
    };

interface ChangedField {
  readonly field: string;
  readonly previous: unknown;
  readonly new: unknown;
}

interface AuditMeta {
  readonly taskId: Uuid;
  readonly suitefleetTaskId: string;
  readonly webhookEventsId: string;
  readonly changedFields: readonly ChangedField[];
}

/**
 * Apply a TASK_HAS_BEEN_UPDATED webhook event to a Planner task.
 *
 * Per plan §4.2 — 12 fields tracked:
 *   * delivery_date
 *   * delivery_start_time          ← deliveryStartTime
 *   * delivery_end_time            ← deliveryEndTime
 *   * recipient_name               ← deliveryInformation.recipientName
 *   * signature                    ← deliveryInformation.signature
 *   * consignee_rating             ← deliveryInformation.consigneeRating
 *   * consignee_comment            ← deliveryInformation.consigneeComment
 *   * driver_comment               ← deliveryInformation.driverComment
 *   * number_of_attempts           ← deliveryInformation.numberOfAttempts
 *   * failure_reason_comment       ← deliveryInformation.failureReasonComment
 *   * completion_latitude          ← deliveryInformation.completionLatitude
 *   * completion_longitude         ← deliveryInformation.completionLongitude
 *
 * Plus audit-only:
 *   * consignee.location.*         → metadata entry, no column write
 *
 * Deprecated, IGNORED (plan §4.2):
 *   * deliveryInformation.bagsReturned
 *   * deliveryInformation.icePacksReturned
 */
export async function applyWebhookEditEvent(
  tenantId: Uuid,
  event: WebhookEvent,
  sfAction: string,
): Promise<ApplyWebhookEditEventResult> {
  if (sfAction !== "TASK_HAS_BEEN_UPDATED") {
    return { applied: false, reason: "wrong_action" };
  }

  const rawPayload = event.raw;
  const rawPayloadJson = JSON.stringify(rawPayload);

  let txBundle: { outcome: ApplyWebhookEditEventResult; meta: AuditMeta | null };

  try {
    txBundle = await withTenant(tenantId, async (tx) => {
      // INSERT webhook_events (forensic preservation; UNIQUE catches retries).
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

      // Validate payload shape at the boundary (plan PR #294 §5.2 + §5.3).
      // Failure is structured-return (NOT throw) per locked §5.3 Option A —
      // tx commits so the webhook_events row above is preserved as a forensic
      // record of the malformed payload. Duplicate replays of the same
      // malformed payload subsequently return 'duplicate' via the UNIQUE
      // violation catch at line ~210.
      const parseResult = webhookEditPayloadSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        log.warn({
          operation: "apply_webhook_edit_event",
          error_code: "payload_validation_failed",
          tenant_id: tenantId,
          suitefleet_task_id: event.externalTaskId,
          webhook_events_id: webhookEventsId,
          zod_issue_count: parseResult.error.issues.length,
        });
        return {
          outcome: { applied: false, reason: "payload_validation_failed" } as const,
          meta: null,
        };
      }

      // SELECT the row's current state for the 12 tracked columns.
      const taskRows = (await tx.execute(sqlTag`
        SELECT
          id,
          delivery_date,
          delivery_start_time,
          delivery_end_time,
          recipient_name,
          signature,
          consignee_rating,
          consignee_comment,
          driver_comment,
          number_of_attempts,
          failure_reason_comment,
          completion_latitude,
          completion_longitude
        FROM tasks
        -- Layer 1.5 parser extracts AWB; production stores AWB in
        -- external_tracking_number (numeric SF id is in external_id).
        -- Lookup must use external_tracking_number to match the
        -- parser-extracted value.
        WHERE external_tracking_number = ${event.externalTaskId} AND tenant_id = ${tenantId}
        LIMIT 1
      `)) as unknown as readonly TaskRow[];

      if (taskRows.length === 0) {
        log.warn({
          operation: "apply_webhook_edit_event",
          error_code: "task_not_found",
          tenant_id: tenantId,
          suitefleet_task_id: event.externalTaskId,
        });
        return {
          outcome: { applied: false, reason: "task_not_found" } as const,
          meta: null,
        };
      }

      const row = taskRows[0];
      const taskId = row.id as Uuid;
      const parsed = parseResult.data;
      const extracted = extractEditFields(parsed);
      const allChanges = computeChangedFields(row, extracted, parsed);

      // Bug 2 fix — decouple changedFields' four overloaded responsibilities
      // (plan PR #294 §4.1 + locked §4.2 X.A + Z.A):
      //   (a) columnsToUpdate     → DB UPDATE column list
      //   (b) auditMetadataFields → audit row's metadata.changed_fields
      //   (c) hasAnyChange        → no_diff gate    (input: columnsToUpdate; Z.A)
      //   (d) wasApplied          → outcome.applied (input: columnsToUpdate; X.A)
      //
      // The address audit-only entry (computeChangedFields tail, hard-coded
      // previous:null) now flows ONLY into (b). It cannot inflate (a), and
      // cannot flip hasAnyChange or wasApplied from false to true regardless
      // of whether the address entry is present in the payload.
      //
      // outcome.applied semantic (X.A locked): "≥1 column actually moved on
      // the row." Address-only payloads return no_diff (X.A reuses existing
      // vocabulary — no new outcome reason; no new audit event).
      const columnsToUpdate = allChanges.filter((c) => c.field !== "address");
      const auditMetadataFields = allChanges;

      if (columnsToUpdate.length === 0) {
        // No column moved — return no_diff (X.A + Z.A). Webhook_events row
        // already preserves the receipt; no audit emit; no UPDATE issued.
        return {
          outcome: { applied: false, reason: "no_diff" } as const,
          meta: null,
        };
      }

      await applyConditionalUpdate(tx, tenantId, taskId, columnsToUpdate);

      const meta: AuditMeta = {
        taskId,
        suitefleetTaskId: event.externalTaskId,
        webhookEventsId,
        changedFields: auditMetadataFields,
      };

      // Past the columnsToUpdate.length === 0 gate above, wasApplied is
      // intrinsically true (X.A: outcome.applied = "≥1 column actually moved").
      return {
        outcome: {
          applied: true,
          taskId,
          changedFieldCount: auditMetadataFields.length,
        } as const,
        meta,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { applied: false, reason: "duplicate" };
    }
    throw err;
  }

  if (txBundle.outcome.applied && txBundle.meta !== null) {
    await emitEditAppliedAudit(tenantId, txBundle.meta);
  }

  return txBundle.outcome;
}

// =============================================================================
// Helpers
// =============================================================================

interface TaskRow {
  readonly id: string;
  readonly delivery_date: string | null;
  readonly delivery_start_time: string | null;
  readonly delivery_end_time: string | null;
  readonly recipient_name: string | null;
  readonly signature: string | null;
  readonly consignee_rating: number | null;
  readonly consignee_comment: string | null;
  readonly driver_comment: string | null;
  readonly number_of_attempts: number | null;
  readonly failure_reason_comment: string | null;
  readonly completion_latitude: string | number | null;
  readonly completion_longitude: string | number | null;
}

interface ExtractedFields {
  readonly delivery_date: string | undefined;
  readonly delivery_start_time: string | undefined;
  readonly delivery_end_time: string | undefined;
  readonly recipient_name: string | undefined;
  readonly signature: string | undefined;
  readonly consignee_rating: number | undefined;
  readonly consignee_comment: string | undefined;
  readonly driver_comment: string | undefined;
  readonly number_of_attempts: number | undefined;
  readonly failure_reason_comment: string | undefined;
  readonly completion_latitude: number | undefined;
  readonly completion_longitude: number | undefined;
}

function extractEditFields(parsed: WebhookEditPayload): ExtractedFields {
  // Bug 1 fix (plan PR #294 §3): line was `pickString(root.delivery_date)`
  // reading snake_case off rawPayload; SF sends camelCase deliveryDate so the
  // read resolved to undefined and the date was silently dropped from the
  // diff. Post-fix the value comes off the parsed shape (Zod-typed
  // camelCase) so a future snake_case typo would not compile.
  const di = parsed.deliveryInformation;
  return {
    delivery_date: parsed.deliveryDate,
    delivery_start_time: parsed.deliveryStartTime,
    delivery_end_time: parsed.deliveryEndTime,
    recipient_name: di?.recipientName,
    signature: di?.signature,
    consignee_rating: di?.consigneeRating,
    consignee_comment: di?.consigneeComment,
    driver_comment: di?.driverComment,
    number_of_attempts: di?.numberOfAttempts,
    // Zod schema allows null for failureReasonComment; coerce null → undefined
    // to preserve "field absent" semantics for diffField.
    failure_reason_comment: di?.failureReasonComment ?? undefined,
    completion_latitude: di?.completionLatitude,
    completion_longitude: di?.completionLongitude,
  };
}

function computeChangedFields(
  row: TaskRow,
  extracted: ExtractedFields,
  parsed: WebhookEditPayload,
): ChangedField[] {
  const changes: ChangedField[] = [];

  // Field-by-field diff. `undefined` in extracted means "field absent
  // from payload" — leave the column alone. Otherwise compare values.
  diffField(changes, "delivery_date", row.delivery_date, extracted.delivery_date);
  diffField(changes, "delivery_start_time", row.delivery_start_time, extracted.delivery_start_time);
  diffField(changes, "delivery_end_time", row.delivery_end_time, extracted.delivery_end_time);
  diffField(changes, "recipient_name", row.recipient_name, extracted.recipient_name);
  diffField(changes, "signature", row.signature, extracted.signature);
  diffField(changes, "consignee_rating", row.consignee_rating, extracted.consignee_rating);
  diffField(changes, "consignee_comment", row.consignee_comment, extracted.consignee_comment);
  diffField(changes, "driver_comment", row.driver_comment, extracted.driver_comment);
  diffField(changes, "number_of_attempts", row.number_of_attempts, extracted.number_of_attempts);
  diffField(
    changes,
    "failure_reason_comment",
    row.failure_reason_comment,
    extracted.failure_reason_comment,
  );
  diffNumeric(
    changes,
    "completion_latitude",
    row.completion_latitude,
    extracted.completion_latitude,
  );
  diffNumeric(
    changes,
    "completion_longitude",
    row.completion_longitude,
    extracted.completion_longitude,
  );

  // Address-audit-only entry (plan §4.3 ruling: Option (ii)).
  // If consignee.location.* is present in the payload, capture it as
  // a metadata entry. previous=null marks "we observed an SF-side
  // address but didn't apply it" — distinct from real edit-event diffs.
  // C3 decouples this from the no_diff gate + outcome.applied flag (see
  // computeColumnsToUpdate / wasApplied logic at the caller).
  const location = parsed.consignee?.location;
  if (location !== undefined) {
    changes.push({
      field: "address",
      previous: null,
      new: location,
    });
  }

  return changes;
}

function diffField(
  changes: ChangedField[],
  field: string,
  current: unknown,
  incoming: unknown,
): void {
  if (incoming === undefined) return;
  if (current === incoming) return;
  changes.push({ field, previous: current, new: incoming });
}

function diffNumeric(
  changes: ChangedField[],
  field: string,
  current: string | number | null,
  incoming: number | undefined,
): void {
  if (incoming === undefined) return;
  // Postgres numeric returns as string; normalise to number for diff.
  const currentAsNumber =
    current === null
      ? null
      : typeof current === "string"
      ? Number(current)
      : current;
  if (currentAsNumber === incoming) return;
  changes.push({ field, previous: current, new: incoming });
}

async function applyConditionalUpdate(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: Uuid,
  taskId: Uuid,
  changes: readonly ChangedField[],
): Promise<void> {
  // Build a column-by-column UPDATE. Only the fields that changed are
  // written. updated_at always refreshes when the UPDATE fires.
  //
  // Drizzle's sqlTag supports composing fragments; we build SET clauses
  // dynamically per the changed fields. Each column whitelisted against
  // the EXTRACTED_COLUMN_NAMES set so this fn never composes raw SQL
  // from arbitrary strings.
  const setFragments: ReturnType<typeof sqlTag>[] = [];
  for (const change of changes) {
    if (!EXTRACTED_COLUMN_NAMES.has(change.field)) continue;
    setFragments.push(buildSetFragment(change.field, change.new));
  }
  if (setFragments.length === 0) return;

  // Compose with commas. Drizzle's sql.join is the safe path.
  const setClause = setFragments.reduce(
    (acc, frag, i) => (i === 0 ? frag : sqlTag`${acc}, ${frag}`),
    setFragments[0],
  );

  await tx.execute(sqlTag`
    UPDATE tasks
    SET ${setClause}, updated_at = now()
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
  `);
}

const EXTRACTED_COLUMN_NAMES: ReadonlySet<string> = new Set([
  "delivery_date",
  "delivery_start_time",
  "delivery_end_time",
  "recipient_name",
  "signature",
  "consignee_rating",
  "consignee_comment",
  "driver_comment",
  "number_of_attempts",
  "failure_reason_comment",
  "completion_latitude",
  "completion_longitude",
]);

/**
 * Build a single `column = value` SQL fragment. Column name comes from
 * the EXTRACTED_COLUMN_NAMES whitelist (validated by caller); value
 * is parameter-bound so user payload never reaches as raw SQL.
 *
 * Per-column unquoted identifier embedding via sql.raw — safe here
 * because the column name has already been allowlist-validated above.
 */
function buildSetFragment(column: string, value: unknown): ReturnType<typeof sqlTag> {
  switch (column) {
    case "delivery_date":
      return sqlTag`delivery_date = ${value}::date`;
    case "delivery_start_time":
      return sqlTag`delivery_start_time = ${value}::time`;
    case "delivery_end_time":
      return sqlTag`delivery_end_time = ${value}::time`;
    case "recipient_name":
      return sqlTag`recipient_name = ${value}`;
    case "signature":
      return sqlTag`signature = ${value}`;
    case "consignee_rating":
      return sqlTag`consignee_rating = ${value}`;
    case "consignee_comment":
      return sqlTag`consignee_comment = ${value}`;
    case "driver_comment":
      return sqlTag`driver_comment = ${value}`;
    case "number_of_attempts":
      return sqlTag`number_of_attempts = ${value}`;
    case "failure_reason_comment":
      return sqlTag`failure_reason_comment = ${value}`;
    case "completion_latitude":
      return sqlTag`completion_latitude = ${value}`;
    case "completion_longitude":
      return sqlTag`completion_longitude = ${value}`;
    default:
      // Unreachable — caller validates against EXTRACTED_COLUMN_NAMES.
      throw new Error(`buildSetFragment: unexpected column '${column}'`);
  }
}

async function emitEditAppliedAudit(tenantId: Uuid, meta: AuditMeta): Promise<void> {
  await auditEmit({
    eventType: "task.edit_applied_via_webhook",
    actorKind: "system",
    actorId: "system:webhook_receiver",
    tenantId,
    resourceType: "task",
    resourceId: meta.taskId,
    metadata: {
      task_id: meta.taskId,
      suitefleet_task_id: meta.suitefleetTaskId,
      webhook_events_id: meta.webhookEventsId,
      changed_fields: meta.changedFields,
    },
  });
}
