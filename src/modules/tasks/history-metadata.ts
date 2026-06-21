// Task-history metadata allow-list — the ONE source of truth.
//
// Love's Day-52 R8 metadata ruling: operator-meaningful fields only, not
// the raw payload. Day-53 PM hardening (Love-ruled UAT-blocking,
// memory/followup_r8_server_side_metadata_strip.md +
// memory/decision_d53_pm_uat_calls.md): the strip is applied SERVER-SIDE
// in getTaskHistory, so hidden fields never reach the browser payload;
// the drawer keeps filtering on the same set as belt-and-braces.
//
// This module is intentionally import-light (no db, no server-only): it
// is shared by the tasks service (server) and TaskTimelineDrawer.tsx
// (client). Set contents are verbatim from the PR #356 build — keys NOT
// in this set never leave the server, notably internal record/correlation
// UUIDs (task_id, subscription_id, exception_id, correlation_id,
// webhook_events_id, idempotency_key, task_ids, skipped_task_ids …), raw
// vendor error text (last_error), SF action codes (sf_action), and
// outbound plumbing (outbound_emission, enqueued_count, failed_chunks,
// format).
//
// Built against the REAL emit-site metadata shapes (tasks, subscriptions,
// subscription-exceptions services + the webhook appliers) — the
// per-event mapping is tabled on PR #356. Events whose fields are all
// hidden/empty fall back to the drawer's "No further detail recorded."
// line.

export const TASK_HISTORY_METADATA_ALLOW_LIST: ReadonlySet<string> = new Set([
  // what changed
  "changed_fields",
  "previous_status",
  "new_status",
  "to_internal_status",
  "bulk_operation",
  // dates & windows
  "scheduled_for",
  "start_date",
  "target_date_override",
  "compensating_date",
  "effective_from",
  "pause_start",
  "pause_end",
  "actual_resume_date",
  "previous_end_date",
  "new_end_date",
  "event_timestamp",
  // counts
  "canceled_task_count",
  "restored_task_count",
  "pushed_task_count",
  "failure_count",
  "requested_count",
  "printed_count",
  "skipped_count",
  "photo_count",
  // kind / why
  "type",
  "scope",
  "triggered_by",
  "skip_without_append",
  "is_auto_resume",
  "completed_via",
  // operator-supplied + note deltas
  "reason",
  "previous_notes_length",
  "new_notes_length",
  // operator-facing references
  "awb",
  "suitefleet_task_id",
  "customer_order_number",
  // move-to-date link (D56) — counterpart AWBs + dates rendered both
  // directions in the timeline drawer. AWBs are operator references, not PII.
  // The counterpart task_ids are deliberately NOT listed (internal UUIDs,
  // stripped); moved_to_awb is injected by getTaskHistory at read time.
  "moved_from_awb",
  "moved_from_delivery_date",
  "moved_to_awb",
  "moved_to_delivery_date",
]);

/** Drop every metadata key not on the allow-list. */
export function filterTaskHistoryMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) =>
      TASK_HISTORY_METADATA_ALLOW_LIST.has(key),
    ),
  );
}
