// QStash message payload types — Day 21 / Phase 1 SF outbound queue.
//
// Mirrors the shape pattern from
// `src/modules/task-materialization/queue.ts` (PushTaskPayload). Lives
// in its own module because the publisher is service-layer
// (Day 22+ — operator-initiated cancel / update flows) while the
// cron is the publisher for the createTask outbound path; keeping
// the two queue surfaces in distinct modules avoids accidental
// cross-coupling between cron-driven and operator-driven flows.
//
// Both payloads carry `correlation_id` end-to-end for traceability.
// SF ignores Idempotency-Key (Day-4 createTask probe) so the
// correlation lives Planner-side only — adapter call → audit log →
// outbound_push_failures DLQ row.
//
// PATCH payload shape MUST stay schema-stable across deploys.
// Changing the shape requires a coordinated update on both publisher
// (service-layer) and consumer (queue-route handler) sides; an
// in-flight QStash message with an old shape would land at the new
// handler after redeploy and crash the parser. Treat this file as
// load-bearing the same way `PushTaskPayload` is.

import type { Uuid } from "@/shared/types";
import type { TaskUpdatePatchRequest } from "@/modules/integration/types";

/**
 * `/api/queue/cancel-task` payload.
 *
 *   tenant_id       — RLS scope; used by Step 1.4 tenant-mismatch guard.
 *   task_id         — local Planner task; pre-call lookup verifies it
 *                     exists and is consistent with `awb`.
 *   awb             — SF AWB used as the path-param of the cancel call
 *                     (the adapter is keyed by AWB at the wire level).
 *   correlation_id  — shared across QStash message + audit emit + DLQ
 *                     row for cross-system traceability.
 */
export interface CancelTaskPayload {
  tenant_id: Uuid;
  task_id: Uuid;
  awb: string;
  correlation_id: Uuid;
}

/**
 * `/api/queue/update-task` payload.
 *
 * Same identity fields as CancelTaskPayload, plus the merge-patch
 * body. The patch crosses the QStash wire as JSON; serialisation
 * happens at publish time. Only fields actually present in the patch
 * land on the SF wire (RFC 7396 — see
 * `buildSuiteFleetUpdatePatchBody`).
 */
export interface UpdateTaskPayload {
  tenant_id: Uuid;
  task_id: Uuid;
  awb: string;
  patch: TaskUpdatePatchRequest;
  correlation_id: Uuid;
}
