// subscription-addresses service-layer operations.
//
// Day 16 / Block 4-E — Service E. ONE public fn:
// `changeAddressRotation`. Service E (2)+(3) thunks for
// address_override_one_off / _forward live entirely in the Block 4-F
// API route layer per merged plan §5.3.2/§5.3.3 + Block 4-E reviewer
// §C C1 ruling — no module-level wrapper fn here.
//
// Audit emit: NONE for rotation changes per merged plan §10.6 default
// + brief §3.1.2 (rotation absent from the 9-event vocabulary). The
// no-emit posture is pinned by an explicit "did NOT emit" assertion
// in tests/service.spec.ts to lock the §10.6 default — anyone adding
// rotation audit emission must update brief + register the event +
// update those tests, in that order.

import { emit } from "../audit";
import { withTenant } from "../../shared/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import {
  deleteRotationEntries,
  findAddressForConsignee,
  findSubscriptionForRotation,
  selectCurrentRotation,
  upsertRotationEntries,
} from "./repository";
import type {
  ChangeAddressRotationInput,
  ChangeAddressRotationResult,
  IsoWeekday,
  RotationEntry,
} from "./types";

// -----------------------------------------------------------------------------
// Helpers (local; cross-module imports of internal helpers forbidden)
// -----------------------------------------------------------------------------

// `emit` is imported but intentionally unreferenced — pinning it via
// explicit no-emit posture in tests. Linter would flag if this kept
// being unreferenced; the test file imports `emit` (mocked) and
// asserts it was NOT called, which keeps the symbol load-bearing
// indirectly. Keep import here so a future audit-event addition has
// the import already in place.
void emit;

/**
 * Same actor → audit-id mapping convention as
 * consignees/service.ts + merchants/service.ts (R-2 boundary rule —
 * no cross-module imports of internal helpers).
 *
 * Currently unused inside this module (no audit emit per §10.6).
 * Retained for symmetry with the other service modules + as a
 * landing point if rotation audit ever lands.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}
void actorIdFor;

/**
 * Common precondition: actor must carry the named permission AND the
 * request must be tenant-scoped.
 */
function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

/**
 * Validate input.rotation: each entry has weekday in 1-7 range +
 * unique addressId field non-empty + no duplicate weekday in the
 * input (UNIQUE on (subscription_id, weekday) means the DB would
 * reject anyway, but a clean ValidationError is friendlier than a
 * 23505 surfacing through).
 */
function validateRotationInput(
  rotation: readonly RotationEntry[],
): void {
  const seenWeekdays = new Set<number>();
  for (const entry of rotation) {
    if (
      entry.weekday !== 1 &&
      entry.weekday !== 2 &&
      entry.weekday !== 3 &&
      entry.weekday !== 4 &&
      entry.weekday !== 5 &&
      entry.weekday !== 6 &&
      entry.weekday !== 7
    ) {
      throw new ValidationError(
        `rotation.weekday must be ISO 1-7; got '${entry.weekday}'`,
      );
    }
    if (typeof entry.addressId !== "string" || entry.addressId.length === 0) {
      throw new ValidationError(`rotation.addressId is required`);
    }
    if (seenWeekdays.has(entry.weekday)) {
      throw new ValidationError(
        `rotation.weekday ${entry.weekday} appears more than once`,
      );
    }
    seenWeekdays.add(entry.weekday);
  }
}

/**
 * Compare input rotation to current rotation as a SET of (weekday,
 * addressId) pairs. Order-insensitive — the input array order does
 * NOT affect the no_op detection. Two rotations are equivalent iff
 * they have the same weekdays mapped to the same addressIds.
 */
function rotationsEqual(
  input: readonly RotationEntry[],
  current: readonly { weekday: IsoWeekday; addressId: Uuid }[],
): boolean {
  if (input.length !== current.length) return false;
  const inputMap = new Map<number, string>();
  for (const e of input) inputMap.set(e.weekday, e.addressId);
  for (const c of current) {
    const v = inputMap.get(c.weekday);
    if (v === undefined || v !== c.addressId) return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// changeAddressRotation
// -----------------------------------------------------------------------------

/**
 * Replace the per-weekday address rotation map for a subscription.
 * Full-replace semantic: input is the complete new rotation;
 * weekdays in current state but absent from input get DELETEd.
 *
 * Behavior in single transaction:
 *   1. Permission gate (`subscription:change_address_rotation`).
 *   2. Tenant assert.
 *   3. Input validation: every weekday in 1-7, every addressId
 *      non-empty, no duplicate weekday in input.
 *   4. SELECT subscription FOR UPDATE → reject 404 if missing →
 *      reject 409 ConflictError if status !== 'active'.
 *   5. For every entry in input: validate addressId belongs to the
 *      subscription's consignee via findAddressForConsignee. Reject
 *      ValidationError 'address_not_found_for_consignee' on first
 *      failure (atomic — don't half-apply).
 *   6. SELECT current rotation. If input matches current as a SET of
 *      (weekday, addressId) pairs → return { status: 'no_op' }
 *      without writes.
 *   7. Compute weekdays-to-delete = current.weekdays \ input.weekdays.
 *      DELETE those rows.
 *   8. UPSERT every entry in input (handles both insert-new-weekday
 *      and update-existing-weekday via ON CONFLICT).
 *   9. NO audit emit (rotation has no registered event per §10.6).
 *  10. Return { status: 'updated', subscriptionId, rotation }.
 *
 * Throws:
 *   - ForbiddenError    actor lacks subscription:change_address_rotation.
 *   - ValidationError   no tenant context, malformed rotation input,
 *                       cross-consignee address.
 *   - NotFoundError     subscription not in tenant.
 *   - ConflictError     subscription.status !== 'active'.
 */
export async function changeAddressRotation(
  ctx: RequestContext,
  subscriptionId: Uuid,
  input: ChangeAddressRotationInput,
): Promise<ChangeAddressRotationResult> {
  requirePermission(ctx, "subscription:change_address_rotation");
  assertTenantScoped(ctx, "subscription:change_address_rotation");

  validateRotationInput(input.rotation);

  const tenantId = ctx.tenantId;
  return withTenant(tenantId, async (tx) => {
    // Step 4 — FOR UPDATE lookup with consignee_id + status.
    const subscription = await findSubscriptionForRotation(tx, tenantId, subscriptionId);
    if (subscription === null) {
      throw new NotFoundError(`subscription not found: ${subscriptionId}`);
    }
    if (subscription.status !== "active") {
      throw new ConflictError(
        `subscription must be active to change address rotation; current status is '${subscription.status}'`,
      );
    }

    // Step 5 — cross-consignee address ownership validation. Atomic:
    // first failure aborts the entire operation. RLS catches
    // cross-tenant; this catches cross-consignee within same tenant.
    for (const entry of input.rotation) {
      const owned = await findAddressForConsignee(
        tx,
        tenantId,
        subscription.consigneeId,
        entry.addressId,
      );
      if (owned === null) {
        throw new ValidationError(
          `address_not_found_for_consignee: address ${entry.addressId} does not belong to consignee ${subscription.consigneeId} (weekday ${entry.weekday})`,
        );
      }
    }

    // Step 6 — no_op short-circuit if input matches current state.
    const current = await selectCurrentRotation(tx, tenantId, subscriptionId);
    const currentPairs = current.map((r) => ({
      weekday: r.weekday,
      addressId: r.addressId,
    }));

    if (rotationsEqual(input.rotation, currentPairs)) {
      return {
        status: "no_op",
        subscriptionId,
        rotation: input.rotation,
      } as const;
    }

    // Step 7 — compute deletes (current.weekdays \ input.weekdays).
    const inputWeekdays = new Set(input.rotation.map((e) => e.weekday));
    const toDelete: IsoWeekday[] = [];
    for (const c of current) {
      if (!inputWeekdays.has(c.weekday)) {
        toDelete.push(c.weekday);
      }
    }

    if (toDelete.length > 0) {
      await deleteRotationEntries(tx, tenantId, subscriptionId, toDelete);
    }

    // Step 8 — UPSERT every input entry. Handles both insert-new and
    // update-existing-weekday via ON CONFLICT.
    if (input.rotation.length > 0) {
      await upsertRotationEntries(tx, tenantId, subscriptionId, input.rotation);
    }

    // Step 9 — NO audit emit per §10.6.
    return {
      status: "updated",
      subscriptionId,
      rotation: input.rotation,
    } as const;
  });
}
