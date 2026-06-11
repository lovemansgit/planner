// Consignee CRM-state transition matrix — pure helper.
//
// Day 16 / Block 4-D — sibling to phone.ts under the consignees module
// (flat layout per reviewer Gate 2). Lives alongside but does not depend
// on repository.ts or service.ts: this file is pure. No DB, no I/O, no
// async. Inputs in / result out. The service layer wraps the helper for
// I/O + audit emission per the same wrapper-around-pure-helper pattern
// established by subscription-exceptions/skip-algorithm.ts.
//
// Why a pure helper:
//   - Direct unit-tested matrix correctness — every (from, to) cell
//     enumerable without a DB.
//   - Service layer trivial to reason about: assert permission, look up
//     the row, call canTransition, write or reject.
//   - Future change to the matrix (e.g., enabling a transition that
//     v1 forbade) lands in one file with focused tests.
//
// The §10.4 lock (merged plan PR #155):
//   - From any: → INACTIVE, → SUBSCRIPTION_ENDED always allowed
//     (operator-driven offboarding can fire from any operational state).
//   - ACTIVE → ON_HOLD, HIGH_RISK, CHURNED allowed.
//   - ON_HOLD → ACTIVE, HIGH_RISK, CHURNED allowed.
//   - HIGH_RISK → ACTIVE, ON_HOLD, CHURNED allowed.
//   - INACTIVE → ACTIVE allowed (routine reactivation; permission-gate
//     alone, no keyword required). Distinct from CHURNED reactivation
//     because INACTIVE is operational, not lifecycle-significant.
//   - CHURNED → ACTIVE only via explicit reactivation: case-insensitive
//     'reactivation' substring required in `reason`. CHURNED is
//     lifecycle-significant per brief framing; the keyword surfaces the
//     reactivation as a distinct operational decision.
//   - SUBSCRIPTION_ENDED is terminal: no transitions allowed.
//   - Same-state (from === to) is treated as a no-op at the service
//     layer; the matrix below does NOT short-circuit same-state because
//     callers rely on a uniform { ok: true } | { ok: false, ... } shape.
//     The service layer detects from === to before calling canTransition
//     and short-circuits to a no_op result without writes or audit.

import type { ConsigneeCrmState } from "./types";

/**
 * Frozen 2-D matrix of allowed (fromState → toState) transitions.
 *
 * Indexed by `MATRIX[fromState]` returning a frozen Set of allowed
 * to-states. Same-state is NOT included in any from-state's allowed set
 * — the service layer handles same-state as a no_op before calling
 * canTransition. SUBSCRIPTION_ENDED's allowed set is empty (terminal).
 *
 * INACTIVE and SUBSCRIPTION_ENDED are reachable from every from-state
 * per the "operator-driven offboarding can fire from any state" line
 * in the brief; SUBSCRIPTION_ENDED is reachable but not from itself.
 *
 * `Object.freeze` + `as const` jointly prevent runtime mutation and
 * surface readonly-ness to callers.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ConsigneeCrmState, ReadonlySet<ConsigneeCrmState>>
> = Object.freeze({
  ACTIVE: new Set<ConsigneeCrmState>(["ON_HOLD", "HIGH_RISK", "CHURNED", "INACTIVE", "SUBSCRIPTION_ENDED"]),
  ON_HOLD: new Set<ConsigneeCrmState>(["ACTIVE", "HIGH_RISK", "CHURNED", "INACTIVE", "SUBSCRIPTION_ENDED"]),
  HIGH_RISK: new Set<ConsigneeCrmState>(["ACTIVE", "ON_HOLD", "CHURNED", "INACTIVE", "SUBSCRIPTION_ENDED"]),
  INACTIVE: new Set<ConsigneeCrmState>(["ACTIVE", "SUBSCRIPTION_ENDED"]),
  CHURNED: new Set<ConsigneeCrmState>(["ACTIVE", "INACTIVE", "SUBSCRIPTION_ENDED"]),
  SUBSCRIPTION_ENDED: new Set<ConsigneeCrmState>(),
});

/**
 * Outcome of a transition check. The two failure variants carry
 * machine-readable codes so the service layer can map them to typed
 * AppError subclasses without parsing strings.
 */
export type TransitionCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorCode: "invalid_transition" }
  | { readonly ok: false; readonly errorCode: "reactivation_keyword_required" };

/**
 * Case-insensitive substring 'reactivation' detector.
 *
 * The keyword guard is intentionally clunky to surface CHURNED → ACTIVE
 * as a distinct operational decision. Substring (not whole-word) is
 * deliberate: 'reactivation', 'Reactivation', 'reactivating customer
 * after escalation', and 'manual reactivation by ops' all pass; an
 * unrelated reason like 'we lost the customer' fails. The check is on
 * `reason` only — no separate boolean flag, no re-typed reactivation
 * field. Keeps the operator-facing surface minimal.
 *
 * Empty / null reason fails the check. The service layer's input
 * validation requires `reason` to be a non-empty string before reaching
 * this helper; a defensive falsy check here catches programming errors
 * (e.g., a future caller passing through unvalidated input).
 */
function reasonContainsReactivationKeyword(reason: string): boolean {
  if (typeof reason !== "string" || reason.length === 0) return false;
  return /reactivation/i.test(reason);
}

/**
 * Check whether a from-state → to-state transition is allowed under
 * §10.4. CHURNED → ACTIVE has the additional reactivation-keyword
 * gate; all other allowed transitions pass with permission alone.
 *
 * Callers MUST handle from === to as a no_op before calling this
 * function — the matrix above does NOT include same-state in any
 * from-state's allowed set, so calling canTransition('ACTIVE', 'ACTIVE',
 * ...) returns { ok: false, errorCode: 'invalid_transition' }, which
 * is technically correct but semantically the wrong shape for "same
 * state → no-op success." The service layer's no-op short-circuit
 * runs before this helper.
 *
 * @param fromState - current CRM state read FOR UPDATE in the same tx
 * @param toState - target CRM state from operator input
 * @param reason - operator-supplied reason; required for CHURNED → ACTIVE
 *                 keyword guard. Other transitions ignore it.
 */
export function canTransition(
  fromState: ConsigneeCrmState,
  toState: ConsigneeCrmState,
  reason: string,
): TransitionCheckResult {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed.has(toState)) {
    return { ok: false, errorCode: "invalid_transition" };
  }

  // CHURNED → ACTIVE keyword gate. Every other allowed pair passes on
  // matrix membership alone.
  if (fromState === "CHURNED" && toState === "ACTIVE") {
    if (!reasonContainsReactivationKeyword(reason)) {
      return { ok: false, errorCode: "reactivation_keyword_required" };
    }
  }

  return { ok: true };
}
