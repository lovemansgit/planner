// Tenant migration-gate service methods — Day 3 / C-6.
//
// Three operations on the gate columns added in C-5
// (supabase/migrations/0005_tenant_migration_gate.sql):
//
//   gateGet(ctx)          read the tenant's gate state. Tenant actors
//                         see status + set_at; sysadmin actors
//                         additionally see set_by. Masking enforced
//                         here per PR #24 review — the column is
//                         RLS-readable to tenants, so the service
//                         layer is the only place to hide it.
//
//   gateCheck(ctx)        boolean helper for the migration import code
//                         path: returns whether the gate is currently
//                         'open'. Cheaper than gateGet for callers
//                         that only need the readiness signal.
//
//   gateSet(ctx, status,  sysadmin-only transition. Validates the
//           reason)       state-machine edge against the allowed-
//                         transitions table; updates set_at + set_by;
//                         emits tenant.migration_gate_changed. Held
//                         by the Transcorp Systems Team and Sysadmin
//                         roles via R-1's systemOnly=true permission.
//
// State machine (per the 0005 header):
//   closed   →  open       sysadmin (Transcorp Systems Team)
//   open     →  completed  sysadmin (system actor on successful import)
//   completed →  open      sysadmin override (rare)
//   open     →  closed     sysadmin override (rare; e.g. clearing was
//                          incomplete)
// All other transitions raise ConflictError.

import { sql as sqlTag } from "drizzle-orm";

import { emit } from "../audit";
import { withTenant } from "../../shared/db";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { IsoTimestamp, Uuid } from "../../shared/types";

import { requirePermission } from "./require-permission";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** The three legal values for `migration_gate_status` (matches 0005's CHECK). */
export type GateStatus = "closed" | "open" | "completed";

/**
 * Tenant-facing gate state. `setBy` is `undefined` (omitted) for
 * tenant actors and present (uuid or null) for sysadmin actors. The
 * difference between `undefined` and `null` is load-bearing here:
 *   - undefined = "the caller isn't allowed to see this field"
 *   - null      = "no one has set it yet, OR the previous setter was
 *                  deleted (FK SET NULL)"
 */
export interface TenantGateState {
  readonly status: GateStatus;
  readonly setAt: IsoTimestamp | null;
  readonly setBy?: Uuid | null;
}

const ALLOWED_TRANSITIONS: Record<GateStatus, readonly GateStatus[]> = {
  closed: ["open"],
  open: ["closed", "completed"],
  completed: ["open"],
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * "Sysadmin" actors are those carrying the `tenant:migration_gate_set`
 * permission, which is systemOnly=true (R-1) and held only by
 * Transcorp Systems Team and Transcorp Sysadmin roles. Used as the
 * proxy for "should this actor see set_by." Tenant Admins, Ops
 * Managers, and CS Agents do NOT carry this permission and so do not
 * see set_by.
 */
function isSysadminActor(actor: Actor): boolean {
  return actor.permissions.has("tenant:migration_gate_set");
}

function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

type GateRow = {
  migration_gate_status: string;
  migration_gate_set_at: Date | string | null;
  migration_gate_set_by: string | null;
} & Record<string, unknown>;

function toIso(value: Date | string | null): IsoTimestamp | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isGateStatus(value: string): value is GateStatus {
  return value === "closed" || value === "open" || value === "completed";
}

// -----------------------------------------------------------------------------
// gateGet
// -----------------------------------------------------------------------------

/**
 * Read the tenant's migration-gate state. Masks `setBy` from non-
 * sysadmin actors per PR #24 review (RLS doesn't column-mask, so the
 * service layer is the only enforcement point).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `tenant:migration_gate_get`.
 *   - ValidationError   no tenant context.
 *   - NotFoundError     tenant row missing (RLS hid it cross-tenant
 *                       or the tenant id is unknown).
 */
export async function gateGet(ctx: RequestContext): Promise<TenantGateState> {
  requirePermission(ctx, "tenant:migration_gate_get");
  assertTenantScoped(ctx, "tenant:migration_gate_get");

  const row = await withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx.execute<GateRow>(sqlTag`
      SELECT migration_gate_status, migration_gate_set_at, migration_gate_set_by
      FROM tenants WHERE id = ${ctx.tenantId}
    `);
    return rows[0] ?? null;
  });

  if (!row) {
    throw new NotFoundError(`tenant not found: ${ctx.tenantId}`);
  }
  if (!isGateStatus(row.migration_gate_status)) {
    throw new Error(`gateGet: unknown migration_gate_status '${row.migration_gate_status}'`);
  }

  const result: TenantGateState = {
    status: row.migration_gate_status,
    setAt: toIso(row.migration_gate_set_at),
  };

  if (isSysadminActor(ctx.actor)) {
    return { ...result, setBy: row.migration_gate_set_by };
  }
  return result;
}

// -----------------------------------------------------------------------------
// gateCheck
// -----------------------------------------------------------------------------

/**
 * Boolean readiness helper for the migration import code path.
 * Returns `{ open, status }` so callers that need the full state can
 * branch on `status` without a second round-trip.
 *
 * Throws same set as gateGet (minus the masking concern — this method
 * doesn't return setBy at all).
 */
export async function gateCheck(
  ctx: RequestContext
): Promise<{ readonly open: boolean; readonly status: GateStatus }> {
  requirePermission(ctx, "tenant:migration_gate_check");
  assertTenantScoped(ctx, "tenant:migration_gate_check");

  const status = await withTenant(ctx.tenantId, async (tx) => {
    type StatusRow = { migration_gate_status: string } & Record<string, unknown>;
    const rows = await tx.execute<StatusRow>(sqlTag`
      SELECT migration_gate_status FROM tenants WHERE id = ${ctx.tenantId}
    `);
    return rows[0]?.migration_gate_status ?? null;
  });

  if (status === null) {
    throw new NotFoundError(`tenant not found: ${ctx.tenantId}`);
  }
  if (!isGateStatus(status)) {
    throw new Error(`gateCheck: unknown migration_gate_status '${status}'`);
  }

  return { open: status === "open", status };
}

// -----------------------------------------------------------------------------
// gateSet — concurrency model (lock-and-re-validate, intentionally permissive)
// -----------------------------------------------------------------------------
// The SELECT FOR UPDATE inside gateSet serialises concurrent gateSet
// calls on the same tenant row. After the lock releases, a second
// caller re-reads the current state and re-evaluates its intended
// transition against ALLOWED_TRANSITIONS — meaning concurrent operators
// can legally compose into a longer-than-each-intended path. Concrete
// example: caller A wants closed→open; caller B (also reading closed
// initially) wants open→completed. A acquires the lock first, commits
// closed→open. B unblocks, re-reads 'open', re-evaluates the
// transition open→completed (allowed), and commits — even though B
// originally read 'closed' and never explicitly asked for the
// open→completed step.
//
// This is intentional. Tightening the contract to "B's originally-
// intended previous state must still be current at lock-acquire time"
// would force B to fail-loud and push retry logic onto callers in a
// flow that is operator-driven and inherently sequential at the
// product level (Transcorp Systems Team unblocks the gate; the import
// system advances it). Compare-and-swap-style failure here is the
// worse failure mode — the operators have no useful recovery action
// other than "read the state and try again," which is exactly what
// the lock-and-re-validate path already performs.
//
// What the lock DOES guarantee:
//   - No lost updates. Two concurrent transitions from the same
//     starting state cannot both apply; the second sees the first's
//     commit and either no-ops (if same target) or re-validates.
//   - State-graph safety. Every committed transition is in
//     ALLOWED_TRANSITIONS for the row's actual state at the moment of
//     UPDATE. Forbidden steps (e.g. closed→completed directly) raise
//     ConflictError regardless of caller ordering.
//   - Audit fidelity. Every COMMITTED transition emits exactly one
//     tenant.migration_gate_changed event with the actual previous
//     and new state at commit time, not the caller's stale view.
//
// What the lock does NOT do:
//   - Preserve caller-original-intent. If B's plan was "go from
//     closed to completed in one logical step," the lock will not
//     reject B when A's intermediate commit makes B's transition
//     legal-but-reordered. By design.
//
// Integration coverage of all three properties lives in
// tests/integration/migration-gate-concurrency.spec.ts.

/**
 * Transition the tenant's migration gate to `newStatus`. Sysadmin-
 * only via the systemOnly `tenant:migration_gate_set` permission.
 * Validates the transition against ALLOWED_TRANSITIONS; updates
 * set_at + set_by; emits `tenant.migration_gate_changed` post-commit.
 *
 * `reason` is required and lands in the audit-event metadata. Service-
 * layer policy: every gate transition produces an audit trail entry
 * with operator-supplied context, so an auditor can always answer
 * "why did this tenant move from closed to open."
 *
 * Throws:
 *   - ForbiddenError    actor lacks `tenant:migration_gate_set`.
 *   - ValidationError   no tenant context, empty reason, unknown
 *                       newStatus.
 *   - NotFoundError     tenant row missing.
 *   - ConflictError     transition is not in ALLOWED_TRANSITIONS for
 *                       the current state.
 *
 * No-op transition (newStatus === current) returns the current state
 * without an audit emit — same idempotency posture as the consignee
 * update path's "no real change" branch.
 */
export async function gateSet(
  ctx: RequestContext,
  newStatus: GateStatus,
  reason: string
): Promise<TenantGateState> {
  requirePermission(ctx, "tenant:migration_gate_set");
  assertTenantScoped(ctx, "tenant:migration_gate_set");

  if (!isGateStatus(newStatus)) {
    throw new ValidationError(
      `gateSet: unknown newStatus '${newStatus}' — must be closed | open | completed`
    );
  }
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (trimmedReason.length === 0) {
    throw new ValidationError("gateSet: reason is required (non-empty string)");
  }

  // For user actors, set_by is the user's uuid. For system actors
  // (e.g. cron:end_expired triggering open->completed after import),
  // set_by is NULL — system actors aren't users in the FK sense. The
  // audit event captures the system-actor name; the column-level
  // setter is only meaningful for human transitions.
  const setterId: Uuid | null = ctx.actor.kind === "user" ? ctx.actor.userId : null;

  const captured = await withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx.execute<GateRow>(sqlTag`
      SELECT migration_gate_status, migration_gate_set_at, migration_gate_set_by
      FROM tenants WHERE id = ${ctx.tenantId}
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw new NotFoundError(`tenant not found: ${ctx.tenantId}`);
    }
    const previousStatus = rows[0].migration_gate_status;
    if (!isGateStatus(previousStatus)) {
      throw new Error(`gateSet: stored migration_gate_status '${previousStatus}' is invalid`);
    }

    if (previousStatus === newStatus) {
      // No-op — return current state, signal "no audit emit" via
      // null previousStatus marker.
      return { previousStatus: null, current: rows[0] };
    }

    const allowed = ALLOWED_TRANSITIONS[previousStatus];
    if (!allowed.includes(newStatus)) {
      throw new ConflictError(
        `invalid migration-gate transition: ${previousStatus} → ${newStatus} (allowed: ${allowed.join(", ") || "none"})`
      );
    }

    const updated = await tx.execute<GateRow>(sqlTag`
      UPDATE tenants
      SET migration_gate_status = ${newStatus},
          migration_gate_set_at = now(),
          migration_gate_set_by = ${setterId}
      WHERE id = ${ctx.tenantId}
      RETURNING migration_gate_status, migration_gate_set_at, migration_gate_set_by
    `);
    if (!updated[0]) {
      // Race: row vanished between the SELECT FOR UPDATE and the
      // UPDATE. Surface as NotFound for consistent caller semantics.
      throw new NotFoundError(`tenant not found: ${ctx.tenantId}`);
    }

    return { previousStatus, current: updated[0] };
  });

  // Build the response shape (with sysadmin-aware masking).
  const responseBase: TenantGateState = {
    status: captured.current.migration_gate_status as GateStatus,
    setAt: toIso(captured.current.migration_gate_set_at),
  };
  const response: TenantGateState = isSysadminActor(ctx.actor)
    ? { ...responseBase, setBy: captured.current.migration_gate_set_by }
    : responseBase;

  // No-op short-circuit: skip emit, return current state.
  if (captured.previousStatus === null) {
    return response;
  }

  await emit({
    eventType: "tenant.migration_gate_changed",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: ctx.tenantId,
    resourceType: "tenant",
    resourceId: ctx.tenantId,
    metadata: {
      previous_status: captured.previousStatus,
      new_status: newStatus,
      reason: trimmedReason,
    },
    requestId: ctx.requestId,
  });

  return response;
}
