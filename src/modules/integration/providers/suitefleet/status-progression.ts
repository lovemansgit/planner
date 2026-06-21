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

import type { CourierStatus, InternalTaskStatus } from "../../types";

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

// ===========================================================================
// D56 Phase 8 / Lane 2 — fine courier-status VALUE map + fine transition guard.
// ===========================================================================
//
// Sibling of STATUS_VALUE_TO_INTERNAL: same SF `status` FIELD vocabulary, but
// each value maps 1:1 to a DISTINCT fine courier_status instead of collapsing
// into the coarse 7. The ARRIVED_IN_DC value (gotcha: value spelling, not the
// action's ARRIVED_ON_DC) folds to the single fine state ARRIVED_AT_DC.
const STATUS_VALUE_TO_COURIER: Readonly<Record<string, CourierStatus>> = {
  ORDERED: "ORDERED",
  ASSIGNED: "ASSIGNED",
  PICKED_UP: "PICKED_UP",
  ARRIVED_IN_DC: "ARRIVED_AT_DC", // GOTCHA: value IN_DC -> fine AT_DC
  IN_TRANSIT: "IN_TRANSIT",
  HUB_TRANSFER: "HUB_TRANSFER",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  PROCESS_FOR_RETURN: "PROCESS_FOR_RETURN",
  RETURNED_TO_SHIPPER: "RETURNED_TO_SHIPPER",
  CANCELED: "CANCELED",
  RESCHEDULED: "RESCHEDULED",
  REATTEMPT: "REATTEMPT",
};

/**
 * Map a SuiteFleet top-level `status` field VALUE to its DISTINCT fine
 * courier_status, or null for unknown/empty.
 *
 * Deliberately SILENT on the null path: the coarse mapSuiteFleetStatusValueToInternal
 * is the single vocabulary-drift sentinel (it warns on unknown values), and
 * the edit-event applier calls it on the same value — so warning here too
 * would only double-log. The fine map is a render carrier, not a second alert.
 */
export function mapSuiteFleetStatusValueToCourierStatus(value: string): CourierStatus | null {
  return STATUS_VALUE_TO_COURIER[value] ?? null;
}

// Hard-terminal fine states — mirror of HARD_TERMINAL for the coarse guard.
// Once the fine column is DELIVERED or CANCELED a lagging webhook never moves
// it. FAILED / returns / holds are deliberately NOT terminal (a re-attempt
// legitimately moves them on), exactly as in the coarse rules.
const HARD_TERMINAL_COURIER: ReadonlySet<string> = new Set(["DELIVERED", "CANCELED"]);

// The fine FORWARD-LINEAR spine. It mirrors the coarse LINEAR_RANK
// (CREATED<ASSIGNED<IN_TRANSIT) with the single IN_TRANSIT rung expanded into
// the five-rung in-transit ramp, so a stale early webhook may not drag a
// moving parcel back DOWN the spine — including the new intra-IN_TRANSIT
// regressions the coarse guard can't see (e.g. OUT_FOR_DELIVERY -> PICKED_UP).
// Off-spine branch states (DELIVERED, FAILED, PROCESS_FOR_RETURN,
// RETURNED_TO_SHIPPER, RESCHEDULED, REATTEMPT, CANCELED) are intentionally
// absent: they are real transitions operators must see, never blocked as
// "backward".
const COURIER_LINEAR_RANK: Readonly<Partial<Record<CourierStatus, number>>> = {
  ORDERED: 0,
  ASSIGNED: 1,
  PICKED_UP: 2,
  ARRIVED_AT_DC: 3,
  IN_TRANSIT: 4,
  HUB_TRANSFER: 5,
  OUT_FOR_DELIVERY: 6,
};

/**
 * Decide whether an inbound webhook's fine `next` courier_status should
 * overwrite the task's `current` fine column. The fine sibling of
 * shouldAdvanceStatus — each column advances by its OWN guard, so the coarse
 * column may no-op (PICKED_UP and OUT_FOR_DELIVERY are both coarse IN_TRANSIT)
 * while the fine column advances within the in-transit ramp.
 *
 * The fine column is a REFINEMENT of the coarse lifecycle and may never
 * advance past a coarse lock, so the coarse status (`currentCoarse`) is the
 * authority on terminal / operator-SKIPPED freezes. This matters for the
 * not-yet-backfilled case where courier_status is NULL but internal_status is
 * already DELIVERED / CANCELED / SKIPPED (a manual cancel, an operator skip, or
 * a pre-backfill row) — without the coarse check a NULL fine column would
 * happily backfill a non-terminal fine state onto a terminal task.
 *
 * BLOCK, in order:
 *   1. Coarse SKIPPED — operator-set, Planner-local; never refined by a webhook.
 *   2. Coarse DELIVERED / CANCELED terminal-lock — they don't un-happen, so the
 *      fine column does not move off (or onto) a coarse end-state.
 *   3. NULL current fine — no prior fine state to regress from, so once the
 *      coarse status is live the first fine value backfills (returns true).
 *   4. Fine DELIVERED / CANCELED terminal-lock — belt-and-braces for the case a
 *      fine terminal was set independently of the coarse column.
 *   5. Same fine state — no-op (master + dedicated event for one transition).
 *   6. A stale early webhook may not drag the forward-linear ramp backward.
 * Everything else — failures, returns, holds, reattempt — is allowed.
 *
 * `current` is typed string | null because it is read from the nullable DB
 * column (NULL before the first fine webhook / on Planner-only rows);
 * `currentCoarse` is the row's internal_status (may hold the SKIPPED sentinel).
 */
export function shouldAdvanceCourierStatus(
  current: string | null,
  next: CourierStatus,
  currentCoarse: string
): boolean {
  if (currentCoarse === "SKIPPED") return false; // (1) operator-set freeze
  if (HARD_TERMINAL.has(currentCoarse)) return false; // (2) coarse terminal-lock
  if (current === null) return true; // (3) first fine state backfills
  if (HARD_TERMINAL_COURIER.has(current)) return false; // (4) fine terminal-lock
  if (next === current) return false; // (5) dedup

  // (6) backward only WITHIN the forward-linear ramp.
  const currentRank = COURIER_LINEAR_RANK[current as CourierStatus];
  const nextRank = COURIER_LINEAR_RANK[next];
  if (currentRank !== undefined && nextRank !== undefined && nextRank < currentRank) {
    return false;
  }

  return true;
}
