// SuiteFleet `status` FIELD → internal status, + monotonic/terminal guard.
// Day-67 P1 (2026-06-19): the master TASK_HAS_BEEN_UPDATED webhook (and the
// dedicated TASK_STATUS_UPDATED_TO_* events) carry the live driver status in a
// TOP-LEVEL `status` field. Planner previously advanced internal_status only
// from the ACTION string, so tenants whose SF portal had only the master
// webhook subscribed never left CREATED though SF was sending the status on
// every payload (see memory/followup_inbound_status_webhook_master_payload.md).
//
// This module is the pure decision layer used by BOTH appliers:
//   - mapSuiteFleetStatusValueToInternal: SF `status` VALUE -> InternalTaskStatus.
//     The VALUE vocabulary is NOT the ACTION vocabulary — load-bearing gotcha:
//     the value is `ARRIVED_IN_DC` while the action is
//     `TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC` (IN vs ON). So this is its own
//     explicit table, never derived by slicing the action string.
//   - shouldAdvanceStatus: monotonic/terminal guard so the master and dedicated
//     events compose idempotently (no double-apply / double-audit) and status
//     never regresses on an out-of-order (lagging) webhook.

import { logger } from "../../../../shared/logger";

import type { InternalTaskStatus } from "../../types";

const log = logger.with({ component: "suitefleet_status_progression" });

// SF `status` field values observed in production webhook_events (2026-06-19,
// read-only diagnostic): ORDERED, PICKED_UP, ARRIVED_IN_DC, IN_TRANSIT,
// OUT_FOR_DELIVERY, DELIVERED, FAILED, CANCELED. The remaining entries are
// inferred by symmetry with the SF action vocabulary and are NOT yet observed
// on the status field — they are best-effort; any spelling drift falls through
// to null + warn (safe: the task simply does not advance from that one event).
const STATUS_VALUE_TO_INTERNAL: Readonly<Record<string, InternalTaskStatus>> = {
  // observed on the wire
  ORDERED: "CREATED",
  PICKED_UP: "IN_TRANSIT",
  ARRIVED_IN_DC: "IN_TRANSIT", // GOTCHA: value is IN_DC, action suffix is ON_DC
  IN_TRANSIT: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
  // inferred by symmetry (unverified on the status field — see header)
  ASSIGNED: "ASSIGNED",
  HUB_TRANSFER: "IN_TRANSIT",
  PROCESS_FOR_RETURN: "FAILED",
  RETURNED_TO_SHIPPER: "FAILED",
  RESCHEDULED: "ON_HOLD",
  REATTEMPT: "ON_HOLD",
};

/**
 * Map a SuiteFleet top-level `status` field VALUE to an InternalTaskStatus, or
 * null for an unknown/empty value (caller leaves the task status alone). Unknown
 * values warn-log so vocabulary drift surfaces in ops, mirroring the action
 * mapper's posture.
 */
export function mapSuiteFleetStatusValueToInternal(value: string): InternalTaskStatus | null {
  const mapped = STATUS_VALUE_TO_INTERNAL[value];
  if (mapped !== undefined) return mapped;

  if (value.length > 0) {
    log.warn({
      operation: "map_status_value",
      error_code: "unknown_status_value",
      status_value: value,
    });
  }
  return null;
}

// Monotonic progress rank. Higher = further along the lifecycle. The guard only
// advances strictly forward, so an out-of-order (lagging) webhook cannot move a
// task backward, and a repeated status (master + dedicated event for the same
// transition) is a no-op (no double audit emit).
const PROGRESS_RANK: Readonly<Record<InternalTaskStatus, number>> = {
  CREATED: 0,
  ASSIGNED: 1,
  ON_HOLD: 2,
  IN_TRANSIT: 3,
  FAILED: 4,
  DELIVERED: 5,
  CANCELED: 6,
};

// Hard-terminal states: once here, a webhook status NEVER changes the task.
// DELIVERED is the success end-state; CANCELED is the cancel end-state. (FAILED
// is intentionally NOT hard-terminal — a reattempt can still reach DELIVERED.)
const HARD_TERMINAL: ReadonlySet<string> = new Set(["DELIVERED", "CANCELED"]);

/**
 * Decide whether an inbound webhook status (`next`, already mapped to an
 * InternalTaskStatus) should overwrite the task's `current` status.
 *
 * Rules (in order):
 *   1. SKIPPED is operator-set and Planner-local — never overwritten by a
 *      webhook status (preserves the existing SKIPPED guard).
 *   2. DELIVERED / CANCELED are hard-terminal — never changed via webhook.
 *   3. Otherwise advance only strictly forward by PROGRESS_RANK. Equal rank
 *      (same status, or two SF sub-states that collapse to the same internal
 *      status, e.g. PICKED_UP then OUT_FOR_DELIVERY -> both IN_TRANSIT) is a
 *      no-op, which is what makes the master + dedicated events idempotent.
 *
 * `current` is typed as string because it is read from the DB column, which may
 * hold the operator-only 'SKIPPED' sentinel that is outside InternalTaskStatus.
 */
export function shouldAdvanceStatus(current: string, next: InternalTaskStatus): boolean {
  if (current === "SKIPPED") return false;
  if (HARD_TERMINAL.has(current)) return false;

  const currentRank = PROGRESS_RANK[current as InternalTaskStatus];
  if (currentRank === undefined) return false; // unknown current — do not touch

  return PROGRESS_RANK[next] > currentRank;
}
