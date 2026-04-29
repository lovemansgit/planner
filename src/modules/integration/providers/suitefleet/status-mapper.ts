// SuiteFleet → internal status mapping — Day 4 / S-6.
//
// Pure function: takes a SuiteFleet action string and returns one of
// the seven internal lifecycle states (`InternalTaskStatus` from
// src/modules/integration/types.ts).
//
// 15 SuiteFleet actions collapse onto 7 internal states. The mapping
// is documented inline; the rationale per group:
//
//   CREATED       → task placed; no driver yet bound
//   ASSIGNED      → driver bound, not yet picked up
//   IN_TRANSIT    → driver-side movement (any of: arrived on DC,
//                   picked up, in transit, hub transfer, out for
//                   delivery). The internal model collapses these
//                   five SuiteFleet sub-states because downstream
//                   surfaces (tenant dashboards, audit) don't need
//                   the granularity and the planner's UI shows
//                   "in transit" regardless.
//   DELIVERED     → terminal success
//   FAILED        → terminal failure (delivery failed; returned to
//                   shipper after exhausted reattempts)
//   CANCELED      → terminal cancel (manual cancel from operator)
//   ON_HOLD       → paused, awaiting next attempt or return
//                   processing
//
// Edge case — `TASK_HAS_BEEN_UPDATED` is a non-lifecycle "edit"
// event (address change, note added, weight correction). It does
// not itself indicate a status change; defaulting to `CREATED`
// here is safe because (a) the interface signature requires we
// return *some* status, and (b) downstream task-state-update logic
// in S-8 will refuse to regress a task that's already past CREATED.
//
// Unknown action → warn log + default to CREATED. Same conservative
// fallback as the edit-event case; same downstream-no-regress rule
// applies.

import { logger } from "../../../../shared/logger";

import type { InternalTaskStatus } from "../../types";

const log = logger.with({ component: "suitefleet_status_mapper" });

const ACTION_TO_INTERNAL_STATUS: Readonly<Record<string, InternalTaskStatus>> = {
  // CREATED — initial-state group
  TASK_HAS_BEEN_ORDERED: "CREATED",
  TASK_HAS_BEEN_UPDATED: "CREATED",

  // ASSIGNED — driver bound
  TASK_HAS_BEEN_ASSIGNED: "ASSIGNED",

  // IN_TRANSIT — driver-side movement (5 SuiteFleet sub-states collapse here)
  TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_PICKED_UP: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_IN_TRANSIT: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_HUB_TRANSFER: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY: "IN_TRANSIT",

  // Terminal-success
  TASK_STATUS_UPDATED_TO_DELIVERED: "DELIVERED",

  // Terminal-failure (delivery failed; returned-to-shipper is also a
  // failed-delivery outcome from the consignee's perspective)
  TASK_STATUS_UPDATED_TO_FAILED: "FAILED",
  TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER: "FAILED",

  // Terminal-cancel
  TASK_STATUS_UPDATED_TO_CANCELED: "CANCELED",

  // ON_HOLD — paused, awaiting reattempt / reschedule / return-process
  TASK_STATUS_UPDATED_TO_REATTEMPT: "ON_HOLD",
  TASK_STATUS_UPDATED_TO_RESCHEDULED: "ON_HOLD",
  TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN: "ON_HOLD",
};

export function mapSuiteFleetStatusToInternal(action: string): InternalTaskStatus {
  const mapped = ACTION_TO_INTERNAL_STATUS[action];
  if (mapped !== undefined) return mapped;

  log.warn({
    operation: "map_status",
    error_code: "unknown_action_default",
    action,
  });

  return "CREATED";
}
