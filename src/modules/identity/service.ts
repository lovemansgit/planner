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
// Day-24 — adds createUser + createRoleAssignment + listAllUsers for
// the /admin/users surface. Permission gate: each fn requires its
// listed `*:create` perm AND, for cross-tenant writes, the actor must
// also carry `merchant:read_all` (Transcorp-staff marker). Without
// `merchant:read_all`, tenantId arg must equal ctx.tenantId.
// Cross-tenant writes use `withServiceRole` to bypass RLS; same-tenant
// writes use `withTenant`.

import { sql as sqlTag } from "drizzle-orm";

import { emit } from "../audit";
import { withServiceRole, withTenant, type DbTx } from "../../shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import {
  AuthAdminError,
  createOrFetchAuthUser as defaultCreateOrFetchAuthUser,
} from "./auth-admin";
import { requirePermission } from "./require-permission";
import { ROLES, type BuiltInRoleSlug } from "./roles";
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

// -----------------------------------------------------------------------------
// Day-24 — createUser + createRoleAssignment + listAllUsers
// -----------------------------------------------------------------------------

/**
 * Roles allowed at the create surface. Transcorp tenant must take
 * `transcorp-sysadmin`; merchant tenants must take `tenant-admin` or
 * `ops-manager`. Validated server-side after the form submits so the
 * client-side role dropdown is a UX affordance, not a security gate.
 */
const TRANSCORP_TENANT_ROLES: readonly BuiltInRoleSlug[] = ["transcorp-sysadmin"];
const MERCHANT_TENANT_ROLES: readonly BuiltInRoleSlug[] = ["tenant-admin", "ops-manager"];

function holdsCrossTenantPermission(actor: Actor): boolean {
  if (actor.kind !== "user") return false;
  return actor.permissions.has("merchant:read_all");
}

/**
 * Assert the actor can write to `targetTenantId`. Same-tenant writes
 * always allowed; cross-tenant writes require `merchant:read_all`
 * (Transcorp-staff marker). Keeps `user:create` semantically clean
 * for the eventual tenant-admin team-management surface (Phase 1.5).
 */
function assertCanWriteToTenant(ctx: RequestContext, targetTenantId: Uuid): void {
  if (ctx.tenantId === targetTenantId) return;
  if (holdsCrossTenantPermission(ctx.actor)) return;
  throw new ForbiddenError(
    "cross-tenant identity writes require merchant:read_all",
  );
}

export interface CreateUserInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly tenantId: Uuid;
}

export interface CreateUserResult {
  readonly userId: Uuid;
  /** True when this call minted a fresh auth user; false when the email
   *  already existed and we re-attached the mirror row idempotently. */
  readonly authUserCreated: boolean;
}

/**
 * Pure-Postgres mirror INSERT for the create-user path. Exported for
 * integration-test coverage per Day-23 §F (real-Postgres pin of the
 * SQL shape). Caller wraps in a transaction.
 *
 * `display_name` defaults to null when `displayName` is empty/whitespace.
 * `tenant_id` is set explicitly; same-tenant callers pass their own
 * tenantId, cross-tenant Transcorp callers pass the target merchant's
 * tenantId.
 *
 * Idempotent on (id) — if the mirror row already exists, the email and
 * tenant_id are updated and `disabled_at` is cleared. Matches the
 * scripts/onboard-merchant.mjs upsert posture.
 */
export async function createUserInDb(
  tx: DbTx,
  params: {
    readonly authUserId: string;
    readonly tenantId: Uuid;
    readonly email: string;
    readonly displayName: string | null;
  },
): Promise<void> {
  const displayName = params.displayName?.trim();
  await tx.execute(sqlTag`
    INSERT INTO users (id, tenant_id, email, display_name)
    VALUES (
      ${params.authUserId},
      ${params.tenantId},
      ${params.email},
      ${displayName && displayName.length > 0 ? displayName : null}
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      tenant_id = EXCLUDED.tenant_id,
      display_name = COALESCE(EXCLUDED.display_name, users.display_name),
      disabled_at = NULL,
      updated_at = now()
  `);
}

/**
 * Service entry — creates a Supabase Auth user (or fetches the
 * existing one on email collision), then upserts the public.users
 * mirror row scoped to `input.tenantId`. The auth admin call is the
 * third-party boundary; the mirror INSERT is pure Postgres and lives
 * in `createUserInDb` for testability.
 *
 * Permission gate: `user:create`. Cross-tenant writes require
 * `merchant:read_all` (Transcorp-staff marker) in addition.
 *
 * `deps.createAuthUser` is injectable for unit tests; production code
 * defaults to the real Supabase admin client.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `user:create` or attempts a
 *                       cross-tenant write without `merchant:read_all`.
 *   - ValidationError   email / password / tenantId malformed.
 *   - ConflictError     auth-admin reported an error that didn't look
 *                       like an existing-user collision.
 */
export async function createUser(
  ctx: RequestContext,
  input: CreateUserInput,
  deps: { readonly createAuthUser?: typeof defaultCreateOrFetchAuthUser } = {},
): Promise<CreateUserResult> {
  requirePermission(ctx, "user:create");
  validateCreateUserInput(input);
  assertCanWriteToTenant(ctx, input.tenantId);

  const createAuthUser = deps.createAuthUser ?? defaultCreateOrFetchAuthUser;
  let authResult: { authUserId: string; created: boolean };
  try {
    authResult = await createAuthUser({
      email: input.email,
      password: input.password,
    });
  } catch (err) {
    if (err instanceof AuthAdminError) {
      throw new ConflictError(err.message);
    }
    throw err;
  }

  const isCrossTenant = ctx.tenantId !== input.tenantId;
  const writer = async (tx: DbTx) => {
    await createUserInDb(tx, {
      authUserId: authResult.authUserId,
      tenantId: input.tenantId,
      email: input.email,
      displayName: input.fullName,
    });
  };
  if (isCrossTenant) {
    await withServiceRole("transcorp_staff:create_user", writer);
  } else {
    await withTenant(input.tenantId, writer);
  }

  await emit({
    eventType: "user.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: input.tenantId,
    resourceType: "user",
    resourceId: authResult.authUserId,
    metadata: { email: input.email },
    requestId: ctx.requestId,
  });

  return { userId: authResult.authUserId as Uuid, authUserCreated: authResult.created };
}

function validateCreateUserInput(input: CreateUserInput): void {
  const email = input.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError("email is required and must be a valid format");
  }
  if (!input.password || input.password.length < 8) {
    throw new ValidationError("password must be at least 8 characters");
  }
  if (!input.tenantId) {
    throw new ValidationError("tenantId is required");
  }
}

export interface CreateRoleAssignmentInput {
  readonly userId: Uuid;
  readonly roleSlug: BuiltInRoleSlug;
  readonly tenantId: Uuid;
}

export interface CreateRoleAssignmentResult {
  readonly assignmentId: Uuid;
}

/**
 * Insert a role_assignment binding `userId` to `roleSlug` within
 * `tenantId`. Permission gate: `role_assignment:create`. Cross-tenant
 * writes require `merchant:read_all`.
 *
 * Validates role-tenant compatibility — Transcorp tenant only accepts
 * `transcorp-sysadmin`; merchant tenants only accept `tenant-admin`
 * or `ops-manager`. Tenant discrimination is by lookup of the
 * tenant's slug — `transcorp` slug is the home tenant for sysadmins.
 *
 * Idempotent on the (user_id, role_id, tenant_id) unique constraint
 * — re-issuing returns the existing assignment id.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `role_assignment:create` or
 *                       attempts a cross-tenant write without
 *                       `merchant:read_all`.
 *   - ValidationError   unknown role slug.
 *   - ConflictError     role/tenant combo invalid (e.g.
 *                       transcorp-sysadmin into a merchant tenant).
 *   - NotFoundError     user or tenant does not exist.
 */
export async function createRoleAssignment(
  ctx: RequestContext,
  input: CreateRoleAssignmentInput,
): Promise<CreateRoleAssignmentResult> {
  requirePermission(ctx, "role_assignment:create");
  assertCanWriteToTenant(ctx, input.tenantId);

  if (!(input.roleSlug in ROLES)) {
    throw new ValidationError(`unknown role slug: ${input.roleSlug}`);
  }

  const isCrossTenant = ctx.tenantId !== input.tenantId;
  const result = await (isCrossTenant
    ? withServiceRole("transcorp_staff:create_role_assignment", (tx) =>
        runCreateRoleAssignment(tx, input),
      )
    : withTenant(input.tenantId, (tx) => runCreateRoleAssignment(tx, input)));

  await emit({
    eventType: "role_assignment.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: input.tenantId,
    resourceType: "role_assignment",
    resourceId: result.assignmentId,
    metadata: {
      role_slug: input.roleSlug,
      target_user_id: input.userId,
    },
    requestId: ctx.requestId,
  });

  return result;
}

async function runCreateRoleAssignment(
  tx: DbTx,
  input: CreateRoleAssignmentInput,
): Promise<CreateRoleAssignmentResult> {
  type TenantSlugRow = { slug: string } & Record<string, unknown>;
  const tenantRows = await tx.execute<TenantSlugRow>(sqlTag`
    SELECT slug FROM tenants WHERE id = ${input.tenantId}
  `);
  if (tenantRows.length === 0) {
    throw new NotFoundError(`tenant not found: ${input.tenantId}`);
  }
  const tenantSlug = tenantRows[0].slug;
  const allowedRoles =
    tenantSlug === "transcorp" ? TRANSCORP_TENANT_ROLES : MERCHANT_TENANT_ROLES;
  if (!allowedRoles.includes(input.roleSlug)) {
    throw new ConflictError(
      `role '${input.roleSlug}' is not assignable to tenant '${tenantSlug}'`,
    );
  }

  type RoleIdRow = { id: string } & Record<string, unknown>;
  const roleRows = await tx.execute<RoleIdRow>(sqlTag`
    SELECT id FROM roles
    WHERE slug = ${input.roleSlug} AND tenant_id IS NULL
    LIMIT 1
  `);
  if (roleRows.length === 0) {
    throw new ValidationError(
      `role slug '${input.roleSlug}' has no global role row — onboarding script must seed it`,
    );
  }
  const roleId = roleRows[0].id;

  type AssignmentIdRow = { id: string } & Record<string, unknown>;
  const rows = await tx.execute<AssignmentIdRow>(sqlTag`
    INSERT INTO role_assignments (user_id, role_id, tenant_id)
    VALUES (${input.userId}, ${roleId}, ${input.tenantId})
    ON CONFLICT (user_id, role_id, tenant_id) DO UPDATE
      SET created_at = role_assignments.created_at
    RETURNING id
  `);
  return { assignmentId: rows[0].id as Uuid };
}

export interface AdminUserRow {
  readonly userId: Uuid;
  readonly email: string;
  readonly displayName: string | null;
  readonly tenantId: Uuid;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly roleSlugs: readonly string[];
  readonly createdAt: string;
}

export interface ListAllUsersOpts {
  readonly limit?: number;
  readonly offset?: number;
  readonly searchTerm?: string;
}

/**
 * Cross-tenant list of users for the /admin/users surface. Filters
 * out archived tenants in line with the Day-24 admin-list archive
 * filter. ILIKE on email when `searchTerm` is non-empty. Joined with
 * roles via a LATERAL aggregate so each row carries every role slug
 * the user holds across their tenant (always 1 in v1.5, but the
 * shape generalises).
 *
 * Permission gate: `merchant:read_all` (Transcorp-only surface).
 * Cross-tenant by definition.
 */
export async function listAllUsers(
  ctx: RequestContext,
  opts: ListAllUsersOpts = {},
): Promise<readonly AdminUserRow[]> {
  requirePermission(ctx, "merchant:read_all");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const trimmed = opts.searchTerm?.trim() ?? "";
  const searchFilter =
    trimmed.length > 0
      ? sqlTag`AND u.email ILIKE ${`%${trimmed}%`}`
      : sqlTag``;
  return withServiceRole("transcorp_staff:list_all_users", async (tx) => {
    type Row = {
      user_id: string;
      email: string;
      display_name: string | null;
      tenant_id: string;
      tenant_slug: string;
      tenant_name: string;
      role_slugs: string[] | null;
      created_at: Date | string;
    } & Record<string, unknown>;
    const rows = await tx.execute<Row>(sqlTag`
      SELECT
        u.id           AS user_id,
        u.email        AS email,
        u.display_name AS display_name,
        u.tenant_id    AS tenant_id,
        t.slug         AS tenant_slug,
        t.name         AS tenant_name,
        u.created_at   AS created_at,
        COALESCE(
          (
            SELECT array_agg(r.slug ORDER BY r.slug ASC)
            FROM role_assignments ra
            JOIN roles r ON r.id = ra.role_id
            WHERE ra.user_id = u.id AND ra.tenant_id = u.tenant_id
          ),
          ARRAY[]::text[]
        ) AS role_slugs
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
      WHERE t.status != 'archived'
        ${searchFilter}
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return rows.map((r) => ({
      userId: r.user_id as Uuid,
      email: r.email,
      displayName: r.display_name,
      tenantId: r.tenant_id as Uuid,
      tenantSlug: r.tenant_slug,
      tenantName: r.tenant_name,
      roleSlugs: r.role_slugs ?? [],
      createdAt:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
    }));
  });
}
