// SuiteFleet → internal status mapping — Day 4 / S-6.
//
// Pure function: takes a SuiteFleet action string and returns one of
// the seven internal lifecycle states (`InternalTaskStatus` from
// src/modules/integration/types.ts) — OR `null` for events that
// aren't lifecycle changes.
//
// Returning `null` for non-lifecycle events makes the no-regress
// invariant visible at every call site: the caller branches on null
// and skips the state update. The previous "default to CREATED + rely
// on a downstream FSM" approach pushed a load-bearing invariant onto
// yet-unwritten code.
//
// 14 SuiteFleet actions map to one of the 7 internal states; 1 maps
// to `null` (non-lifecycle); unknown actions also map to `null`
// (with a warn log so vocabulary drift surfaces in ops).
//
// Group rationale:
//
//   CREATED       → task placed; no driver yet bound
//   ASSIGNED      → driver bound, not yet picked up
//   IN_TRANSIT    → driver-side movement (5 SuiteFleet sub-states
//                   collapse: ARRIVED_ON_DC, PICKED_UP, IN_TRANSIT,
//                   HUB_TRANSFER, OUT_FOR_DELIVERY). Downstream
//                   surfaces don't need the granularity.
//   DELIVERED     → terminal success
//   FAILED        → delivery failed (3 SuiteFleet sub-states collapse:
//                   FAILED itself, PROCESS_FOR_RETURN, RETURNED_TO_SHIPPER).
//                   PROCESS_FOR_RETURN is mapped here rather than to
//                   ON_HOLD because from the consignee's perspective
//                   the delivery has irrevocably failed at this point;
//                   the package returning is post-delivery cleanup,
//                   not a paused state.
//   CANCELED      → terminal cancel (manual cancel from operator)
//   ON_HOLD       → paused, awaiting reattempt or reschedule
//                   (REATTEMPT, RESCHEDULED — both indicate the task
//                   is suspended awaiting a future attempt)
//
// Lossiness note: the FAILED bucket collapses "failed for this
// attempt" with "permanently returned to shipper." Merchants may
// want this distinction for cost accounting. Tracked in
// memory/followup_internal_task_status_lossiness.md.
//
// Non-lifecycle actions:
//   TASK_HAS_BEEN_UPDATED — an edit event (address change, note,
//   weight correction). Returns null; caller leaves task state alone.
//
// Unknown actions:
//   Returns null + warn log (`error_code: unknown_action_default`).
//   Every firing in production signals SuiteFleet sent an action our
//   explicit map doesn't cover.

import { logger } from "../../../../shared/logger";

import type { InternalTaskStatus } from "../../types";

const log = logger.with({ component: "suitefleet_status_mapper" });

const ACTION_TO_INTERNAL_STATUS: Readonly<Record<string, InternalTaskStatus>> = {
  // CREATED
  TASK_HAS_BEEN_ORDERED: "CREATED",

  // ASSIGNED
  TASK_HAS_BEEN_ASSIGNED: "ASSIGNED",

  // IN_TRANSIT — 5 SuiteFleet sub-states collapse here
  TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_PICKED_UP: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_IN_TRANSIT: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_HUB_TRANSFER: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY: "IN_TRANSIT",

  // Terminal-success
  TASK_STATUS_UPDATED_TO_DELIVERED: "DELIVERED",

  // FAILED — 3 SuiteFleet sub-states collapse here.
  // PROCESS_FOR_RETURN: from the consignee's perspective the delivery
  // has irrevocably failed at this point; package returning is
  // post-delivery cleanup, not a paused state.
  TASK_STATUS_UPDATED_TO_FAILED: "FAILED",
  TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN: "FAILED",
  TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER: "FAILED",

  // Terminal-cancel
  TASK_STATUS_UPDATED_TO_CANCELED: "CANCELED",

  // ON_HOLD — paused awaiting next attempt
  TASK_STATUS_UPDATED_TO_REATTEMPT: "ON_HOLD",
  TASK_STATUS_UPDATED_TO_RESCHEDULED: "ON_HOLD",
};

// Actions known but intentionally non-lifecycle. These return null
// without firing the unknown-action warn — the null is expected,
// not a sign of vocabulary drift.
const KNOWN_NON_LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set([
  "TASK_HAS_BEEN_UPDATED",
]);

export function mapSuiteFleetStatusToInternal(action: string): InternalTaskStatus | null {
  const mapped = ACTION_TO_INTERNAL_STATUS[action];
  if (mapped !== undefined) return mapped;

  if (KNOWN_NON_LIFECYCLE_ACTIONS.has(action)) return null;

  log.warn({
    operation: "map_status",
    error_code: "unknown_action_default",
    action,
  });

  return null;
}
