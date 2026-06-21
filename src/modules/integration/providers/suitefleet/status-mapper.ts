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

import type { CourierStatus, InternalTaskStatus } from "../../types";

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

// ---------------------------------------------------------------------------
// D56 Phase 8 / Lane 2 — fine courier-status action map (render carrier).
// ---------------------------------------------------------------------------
//
// The SAME 14 lifecycle actions as ACTION_TO_INTERNAL_STATUS, but each maps
// 1:1 to a DISTINCT fine `courier_status` instead of collapsing into the 7
// coarse buckets. The 5 actions the coarse map folds into IN_TRANSIT, the 3
// it folds into FAILED, and the 2 it folds into ON_HOLD stay individually
// addressable here so the render layer can show every SF status distinctly
// (A2 "render distinctly, no collapsing" mandate).
//
// Spelling note: the action suffix is ARRIVED_ON_DC but the fine state is
// ARRIVED_AT_DC (Love's display label "Arrived in DC"; DC = Distribution
// Centre). The internal coarse map is intentionally NOT touched.
const ACTION_TO_COURIER_STATUS: Readonly<Record<string, CourierStatus>> = {
  TASK_HAS_BEEN_ORDERED: "ORDERED",
  TASK_HAS_BEEN_ASSIGNED: "ASSIGNED",
  TASK_STATUS_UPDATED_TO_PICKED_UP: "PICKED_UP",
  TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC: "ARRIVED_AT_DC", // suffix ON_DC -> AT_DC
  TASK_STATUS_UPDATED_TO_IN_TRANSIT: "IN_TRANSIT",
  TASK_STATUS_UPDATED_TO_HUB_TRANSFER: "HUB_TRANSFER",
  TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  TASK_STATUS_UPDATED_TO_DELIVERED: "DELIVERED",
  TASK_STATUS_UPDATED_TO_FAILED: "FAILED",
  TASK_STATUS_UPDATED_TO_PROCESS_FOR_RETURN: "PROCESS_FOR_RETURN",
  TASK_STATUS_UPDATED_TO_RETURNED_TO_SHIPPER: "RETURNED_TO_SHIPPER",
  TASK_STATUS_UPDATED_TO_CANCELED: "CANCELED",
  TASK_STATUS_UPDATED_TO_RESCHEDULED: "RESCHEDULED",
  TASK_STATUS_UPDATED_TO_REATTEMPT: "REATTEMPT",
};

/**
 * Map a SuiteFleet action to its DISTINCT fine `courier_status`, or `null` for
 * the non-lifecycle edit action (TASK_HAS_BEEN_UPDATED) and unknown actions.
 *
 * Deliberately SILENT on the null path: the coarse `mapSuiteFleetStatusToInternal`
 * is the single vocabulary-drift sentinel (it warns on unknowns), and the
 * status-event applier calls coarse first — so warning here too would only
 * double-log the same drift. The fine map is a render carrier, not a second
 * alerting surface.
 */
export function mapSuiteFleetActionToCourierStatus(action: string): CourierStatus | null {
  return ACTION_TO_COURIER_STATUS[action] ?? null;
}
