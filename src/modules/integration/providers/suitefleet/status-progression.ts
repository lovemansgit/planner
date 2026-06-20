// SuiteFleet `status` FIELD → internal status, + transition guard.
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
//   - shouldAdvanceStatus: transition guard so the master and dedicated
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

// Hard-terminal states: once here, a webhook status NEVER changes the task.
// DELIVERED is the success end-state; CANCELED is the cancel end-state. (FAILED
// is intentionally NOT hard-terminal — a re-attempt legitimately moves a Failed
// parcel back to On-hold / In-transit; see Love's ruling below.)
const HARD_TERMINAL: ReadonlySet<string> = new Set(["DELIVERED", "CANCELED"]);

// The FORWARD-LINEAR spine of the lifecycle. A stale early webhook may not drag
// a parcel back DOWN this spine (e.g. a late "Ordered" must not undo "Assigned",
// a late "Picked up" must not undo "In transit"). Branch states — ON_HOLD
// (Reschedule/Reattempt), FAILED — are deliberately NOT on this spine: they are
// real transitions that operators must see, so they are never blocked as
// "backward". Only same-rung-or-lower moves WITHIN this spine are regressions.
const LINEAR_RANK: Readonly<Partial<Record<InternalTaskStatus, number>>> = {
  CREATED: 0,
  ASSIGNED: 1,
  IN_TRANSIT: 2,
};

/**
 * Decide whether an inbound webhook status (`next`, already mapped to an
 * InternalTaskStatus) should overwrite the task's `current` status.
 *
 * Love's ruling (2026-06-19): allow Reschedule / Reattempt / Failed to MOVE the
 * status — they are real transitions operators must see; hiding them recreates
 * the silent-staleness class this fix exists to kill. BLOCK only, in order:
 *   1. SKIPPED is operator-set and Planner-local — never overwritten.
 *   2. DELIVERED / CANCELED are terminal — they don't un-happen.
 *   3. Same status — no-op (master + dedicated event for one transition, and SF
 *      sub-states that collapse to the same internal status, e.g. PICKED_UP then
 *      OUT_FOR_DELIVERY -> both IN_TRANSIT). This is the idempotency guard.
 *   4. A stale early webhook may not drag the FORWARD-LINEAR spine backward
 *      (In-transit -> Assigned/Created, Assigned -> Created).
 * Everything else — On-hold, Failed, re-attempt back to In-transit, etc. — is
 * allowed: the inbound status reflects SuiteFleet's real truth.
 *
 * `current` is typed as string because it is read from the DB column, which may
 * hold the operator-only 'SKIPPED' sentinel that is outside InternalTaskStatus.
 */
export function shouldAdvanceStatus(current: string, next: InternalTaskStatus): boolean {
  if (current === "SKIPPED") return false; // (1)
  if (HARD_TERMINAL.has(current)) return false; // (2)
  if (next === current) return false; // (3) dedup

  // (4) backward only WITHIN the forward-linear spine.
  const currentLinear = LINEAR_RANK[current as InternalTaskStatus];
  const nextLinear = LINEAR_RANK[next];
  if (currentLinear !== undefined && nextLinear !== undefined && nextLinear < currentLinear) {
    return false;
  }

  return true;
}
