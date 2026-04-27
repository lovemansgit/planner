// Identity service-layer operations.
//
// Service methods take a RequestContext, perform the permission check
// via requirePermission (per plan §11.3), run the business operation
// inside a `withTenant` transaction so RLS scopes naturally, and then
// emit an audit event after a successful commit.
//
// The C-21 invariant ("at least one Tenant Admin per tenant") fires
// inside the same withTenant transaction as the mutation — the check
// and the change are atomic with respect to other writers. The audit
// emit happens AFTER the withTenant block returns (after commit), so
// we never log a "ghost" event for an action that did not actually
// commit. ConflictError from the invariant check propagates to the
// caller; no audit event is emitted on the denied path (the typed
// error is the visible signal — a future PR can add a denied-event
// to the audit vocabulary if forensic visibility is wanted there).
//
// Day-2 scope: deleteRoleAssignment + deleteUser, the two operations
// that can violate C-21. Other identity operations (createUser,
// createRoleAssignment, etc.) land when their endpoints land — same
// pattern, different invariants (or none).

import { sql as sqlTag } from "drizzle-orm";

import { emit } from "../audit";
import { withTenant } from "../../shared/db";
import { NotFoundError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "./require-permission";
import { assertCanRemoveAssignments } from "./tenant-admin-invariant";

/**
 * The audit-table actor_id field accepts strings — for user actors we
 * record the user's uuid, for system actors the SystemActor enum value
 * (e.g. `cron:generate_tasks`). One helper so this mapping lives in
 * one place.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

/**
 * Delete a role_assignment by id. Enforces C-21: refuses if the
 * removal would leave the tenant with zero Tenant Admin assignments.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `role_assignment:delete`.
 *   - ValidationError   the request has no tenant context (system
 *                       actor with tenantId null calling this method
 *                       is a programming error — system cron does
 *                       not delete assignments).
 *   - NotFoundError     the assignment id does not exist (or is
 *                       hidden by RLS, which is the same observable
 *                       state from the caller's viewpoint).
 *   - ConflictError     C-21 violated.
 */
export async function deleteRoleAssignment(ctx: RequestContext, assignmentId: Uuid): Promise<void> {
  requirePermission(ctx, "role_assignment:delete");

  if (!ctx.tenantId) {
    throw new ValidationError("role_assignment:delete requires a tenant context");
  }
  const tenantId = ctx.tenantId;

  const captured = await withTenant(tenantId, async (tx) => {
    type AssignmentRow = {
      role_slug: string;
      user_id: string;
    } & Record<string, unknown>;
    const rows = await tx.execute<AssignmentRow>(sqlTag`
      SELECT r.slug AS role_slug, ra.user_id::text AS user_id
      FROM role_assignments ra
      JOIN roles r ON r.id = ra.role_id
      WHERE ra.id = ${assignmentId}
    `);
    if (rows.length === 0) {
      throw new NotFoundError(`role assignment not found: ${assignmentId}`);
    }

    await assertCanRemoveAssignments(tx, tenantId, [assignmentId]);

    await tx.execute(sqlTag`
      DELETE FROM role_assignments WHERE id = ${assignmentId}
    `);

    return { roleSlug: rows[0].role_slug, targetUserId: rows[0].user_id };
  });

  await emit({
    eventType: "role_assignment.deleted",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "role_assignment",
    resourceId: assignmentId,
    metadata: {
      role_slug: captured.roleSlug,
      target_user_id: captured.targetUserId,
    },
    requestId: ctx.requestId,
  });
}

/**
 * Delete a user. Cascade-deletes the user's role_assignments via the
 * FK constraint in 0001_identity.sql. Enforces C-21 BEFORE the
 * delete: refuses if the user holds a Tenant Admin assignment AND
 * removing it would leave the tenant with zero Tenant Admin
 * assignments.
 *
 * Throws same set as deleteRoleAssignment.
 */
export async function deleteUser(ctx: RequestContext, userId: Uuid): Promise<void> {
  requirePermission(ctx, "user:delete");

  if (!ctx.tenantId) {
    throw new ValidationError("user:delete requires a tenant context");
  }
  const tenantId = ctx.tenantId;

  const captured = await withTenant(tenantId, async (tx) => {
    type UserEmailRow = { email: string } & Record<string, unknown>;
    const userRows = await tx.execute<UserEmailRow>(sqlTag`
      SELECT email FROM users WHERE id = ${userId}
    `);
    if (userRows.length === 0) {
      throw new NotFoundError(`user not found: ${userId}`);
    }
    const email = userRows[0].email;

    // The user's existing role_assignments — these will all be cascade-
    // deleted when the user row goes away. Pass them to the invariant
    // check so it can decide whether the cascade would violate C-21.
    type AssignmentIdRow = { id: string } & Record<string, unknown>;
    const assignmentRows = await tx.execute<AssignmentIdRow>(sqlTag`
      SELECT id FROM role_assignments WHERE user_id = ${userId}
    `);
    const assignmentIds = assignmentRows.map((r) => r.id);

    await assertCanRemoveAssignments(tx, tenantId, assignmentIds);

    await tx.execute(sqlTag`DELETE FROM users WHERE id = ${userId}`);

    return { email };
  });

  await emit({
    eventType: "user.deleted",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "user",
    resourceId: userId,
    metadata: { email: captured.email },
    requestId: ctx.requestId,
  });
}
