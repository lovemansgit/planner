// Consignee service-layer operations.
//
// Pattern (matches src/modules/identity/service.ts):
//   1. requirePermission(ctx, perm) — throws ForbiddenError on deny.
//   2. Assert ctx.tenantId is non-null — throws ValidationError if so.
//   3. Run business logic inside a `withTenant(tenantId, …)` block so
//      RLS scopes naturally and the work is transactional.
//   4. Capture metadata before destructive ops (delete, update) so the
//      audit emit's metadata reflects the row that was actually changed
//      / removed even if the row is gone after commit.
//   5. After the withTenant block returns (post-commit), `await emit(…)`
//      so we never log a "ghost" event for an action that did not
//      actually commit. Errors before / inside withTenant propagate;
//      no audit fires on the denied or failed path.
//
// Reads (`get`, `list`) are NOT audited per R-4. They still go through
// requirePermission + tenantId check — same auth surface as writes —
// but skip the emit step.
//
// Phone normalisation (PR #20 follow-up captured in tasks/todo.md):
//   - Every `create` and `update` normalises the phone via
//     `normaliseToE164` before it reaches the repository.
//   - `update`'s changed_fields[] compares NORMALISED phone values, so
//     a paste-from-Excel re-edit that lands on the same canonical
//     phone does NOT count as a change.

import { emit } from "../audit";
import { withTenant } from "../../shared/db";
import { NotFoundError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import { normaliseToE164 } from "./phone";
import {
  deleteConsignee as deleteConsigneeRow,
  findConsigneeById,
  insertConsignee,
  listConsigneesByTenant,
  updateConsignee as updateConsigneeRow,
} from "./repository";
import type { Consignee, CreateConsigneeInput, UpdateConsigneePatch } from "./types";

/**
 * Same actor → audit-id mapping as identity/service.ts. Local copy
 * because plan §3.4 forbids cross-module imports of internal helpers
 * — the identity module exports its public surface, not actorIdFor.
 * Two identical 4-line helpers across modules is preferable to a
 * cross-module dep on an internal.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

/** Trim and reject empty / whitespace-only required strings. */
function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return trimmed;
}

/** Trim an optional string; return undefined for empty / whitespace-only / undefined. */
function optionalTrim(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Common precondition for every method on this service: actor must
 * carry the named permission AND the request must be tenant-scoped.
 * System actors with `tenantId: null` calling consignee methods is a
 * programming error — consignees are tenant-owned.
 */
function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

// -----------------------------------------------------------------------------
// create
// -----------------------------------------------------------------------------

/**
 * Create a single consignee. Validates required fields, normalises the
 * phone to E.164, inserts inside `withTenant`, and emits
 * `consignee.created` post-commit with `source: "planner"` (this code
 * path IS the planner; the SuiteFleet ingress will land its own
 * service path with `source: "suitefleet"`).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `consignee:create`.
 *   - ValidationError   missing required fields, malformed phone, or
 *                       no tenant context.
 */
export async function createConsignee(
  ctx: RequestContext,
  input: CreateConsigneeInput
): Promise<Consignee> {
  requirePermission(ctx, "consignee:create");
  assertTenantScoped(ctx, "consignee:create");

  const normalised: CreateConsigneeInput = {
    name: requireNonEmpty(input.name, "name"),
    phone: normaliseToE164(input.phone),
    addressLine: requireNonEmpty(input.addressLine, "addressLine"),
    emirateOrRegion: requireNonEmpty(input.emirateOrRegion, "emirateOrRegion"),
    district: requireNonEmpty(input.district, "district"),
    email: optionalTrim(input.email),
    deliveryNotes: optionalTrim(input.deliveryNotes),
    externalRef: optionalTrim(input.externalRef),
    notesInternal: optionalTrim(input.notesInternal),
  };

  const tenantId = ctx.tenantId;
  const created = await withTenant(tenantId, async (tx) => {
    return insertConsignee(tx, tenantId, normalised);
  });

  await emit({
    eventType: "consignee.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "consignee",
    resourceId: created.id,
    metadata: { consignee_id: created.id, source: "planner" },
    requestId: ctx.requestId,
  });

  return created;
}

// -----------------------------------------------------------------------------
// reads — get / list (not audited per R-4)
// -----------------------------------------------------------------------------

/**
 * Fetch one consignee by id, scoped to the actor's tenant via RLS.
 * Returns null when the row is missing or hidden cross-tenant — same
 * observable state from the caller's viewpoint per R-3.
 */
export async function getConsignee(ctx: RequestContext, id: Uuid): Promise<Consignee | null> {
  requirePermission(ctx, "consignee:read");
  assertTenantScoped(ctx, "consignee:read");
  return withTenant(ctx.tenantId, async (tx) => {
    return findConsigneeById(tx, id);
  });
}

/**
 * List every consignee in the actor's tenant, newest first.
 */
export async function listConsignees(ctx: RequestContext): Promise<readonly Consignee[]> {
  requirePermission(ctx, "consignee:read");
  assertTenantScoped(ctx, "consignee:read");
  return withTenant(ctx.tenantId, async (tx) => {
    return listConsigneesByTenant(tx, ctx.tenantId!);
  });
}

// -----------------------------------------------------------------------------
// update
// -----------------------------------------------------------------------------

/**
 * Update selected fields on one consignee. Pre-fetches the current row
 * to compute changed_fields[] (compares normalised phone), normalises
 * any present phone, performs the UPDATE, emits `consignee.updated`
 * post-commit with the actually-changed field list.
 *
 * Empty effective patch (every field omitted, or every field equals
 * the current value) is a no-op — returns the current row, no audit
 * event emitted. The empty-patch path through repository.ts returns
 * the current row via a tenant-scoped SELECT.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `consignee:update`.
 *   - ValidationError   no tenant context, malformed phone.
 *   - NotFoundError     no consignee with that id in the tenant.
 */
export async function updateConsignee(
  ctx: RequestContext,
  id: Uuid,
  patch: UpdateConsigneePatch
): Promise<Consignee> {
  requirePermission(ctx, "consignee:update");
  assertTenantScoped(ctx, "consignee:update");

  // Normalise the patch — phone via normaliseToE164, optional strings
  // trimmed (empty -> undefined → "don't change"). Required-string
  // fields, if present, must be non-empty after trim.
  const normalised: UpdateConsigneePatch = {
    name: patch.name !== undefined ? requireNonEmpty(patch.name, "name") : undefined,
    phone: patch.phone !== undefined ? normaliseToE164(patch.phone) : undefined,
    email: patch.email !== undefined ? optionalTrim(patch.email) : undefined,
    addressLine:
      patch.addressLine !== undefined ? requireNonEmpty(patch.addressLine, "addressLine") : undefined,
    emirateOrRegion:
      patch.emirateOrRegion !== undefined
        ? requireNonEmpty(patch.emirateOrRegion, "emirateOrRegion")
        : undefined,
    district:
      patch.district !== undefined ? requireNonEmpty(patch.district, "district") : undefined,
    deliveryNotes: patch.deliveryNotes !== undefined ? optionalTrim(patch.deliveryNotes) : undefined,
    externalRef: patch.externalRef !== undefined ? optionalTrim(patch.externalRef) : undefined,
    notesInternal:
      patch.notesInternal !== undefined ? optionalTrim(patch.notesInternal) : undefined,
  };

  const tenantId = ctx.tenantId;
  const result = await withTenant(tenantId, async (tx) => {
    const before = await findConsigneeById(tx, id);
    if (!before) {
      throw new NotFoundError(`consignee not found: ${id}`);
    }

    // Compute actual changed_fields by comparing normalised values.
    // A field whose patched value equals the current value is NOT a
    // change — see PR #20 phone-normalisation note.
    const changedFields: string[] = [];
    if (normalised.name !== undefined && normalised.name !== before.name) changedFields.push("name");
    if (normalised.phone !== undefined && normalised.phone !== before.phone) changedFields.push("phone");
    if (normalised.email !== undefined && normalised.email !== (before.email ?? undefined))
      changedFields.push("email");
    if (normalised.addressLine !== undefined && normalised.addressLine !== before.addressLine)
      changedFields.push("addressLine");
    if (
      normalised.emirateOrRegion !== undefined &&
      normalised.emirateOrRegion !== before.emirateOrRegion
    )
      changedFields.push("emirateOrRegion");
    if (normalised.district !== undefined && normalised.district !== before.district)
      changedFields.push("district");
    if (
      normalised.deliveryNotes !== undefined &&
      normalised.deliveryNotes !== (before.deliveryNotes ?? undefined)
    )
      changedFields.push("deliveryNotes");
    if (
      normalised.externalRef !== undefined &&
      normalised.externalRef !== (before.externalRef ?? undefined)
    )
      changedFields.push("externalRef");
    if (
      normalised.notesInternal !== undefined &&
      normalised.notesInternal !== (before.notesInternal ?? undefined)
    )
      changedFields.push("notesInternal");

    if (changedFields.length === 0) {
      return { row: before, changedFields };
    }

    // Build a patch that contains ONLY the fields that actually
    // changed. The public UpdateConsigneePatch type is readonly to
    // discourage caller-side mutation; locally we use a Mutable<>
    // alias so the patch can be assembled field-by-field. This
    // doesn't weaken the public surface — the value handed to the
    // repository is still typed as UpdateConsigneePatch.
    type MutablePatch = { -readonly [K in keyof UpdateConsigneePatch]: UpdateConsigneePatch[K] };
    const toApply: MutablePatch = {};
    if (changedFields.includes("name")) toApply.name = normalised.name;
    if (changedFields.includes("phone")) toApply.phone = normalised.phone;
    if (changedFields.includes("email")) toApply.email = normalised.email;
    if (changedFields.includes("addressLine")) toApply.addressLine = normalised.addressLine;
    if (changedFields.includes("emirateOrRegion"))
      toApply.emirateOrRegion = normalised.emirateOrRegion;
    if (changedFields.includes("district")) toApply.district = normalised.district;
    if (changedFields.includes("deliveryNotes")) toApply.deliveryNotes = normalised.deliveryNotes;
    if (changedFields.includes("externalRef")) toApply.externalRef = normalised.externalRef;
    if (changedFields.includes("notesInternal")) toApply.notesInternal = normalised.notesInternal;

    const updated = await updateConsigneeRow(tx, tenantId, id, toApply);
    if (!updated) {
      // Race: row vanished between the find and the update. Surface
      // as NotFound so the caller sees consistent semantics.
      throw new NotFoundError(`consignee not found: ${id}`);
    }
    return { row: updated, changedFields };
  });

  if (result.changedFields.length > 0) {
    await emit({
      eventType: "consignee.updated",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId,
      resourceType: "consignee",
      resourceId: id,
      metadata: { changed_fields: result.changedFields },
      requestId: ctx.requestId,
    });
  }

  return result.row;
}

// -----------------------------------------------------------------------------
// delete
// -----------------------------------------------------------------------------

/**
 * Hard-delete one consignee. Captures the row's identity pre-delete so
 * the `consignee.deleted` audit event carries metadata even though the
 * row is gone post-commit. Pilot does hard delete (no soft-delete
 * column) per the 0004 header.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `consignee:delete`.
 *   - ValidationError   no tenant context.
 *   - NotFoundError     no consignee with that id in the tenant.
 */
export async function deleteConsignee(ctx: RequestContext, id: Uuid): Promise<void> {
  requirePermission(ctx, "consignee:delete");
  assertTenantScoped(ctx, "consignee:delete");

  const tenantId = ctx.tenantId;
  await withTenant(tenantId, async (tx) => {
    const before = await findConsigneeById(tx, id);
    if (!before) {
      throw new NotFoundError(`consignee not found: ${id}`);
    }

    const ok = await deleteConsigneeRow(tx, tenantId, id);
    if (!ok) {
      // Same race as update — surface as NotFound for consistent
      // caller semantics.
      throw new NotFoundError(`consignee not found: ${id}`);
    }
  });

  await emit({
    eventType: "consignee.deleted",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "consignee",
    resourceId: id,
    metadata: { consignee_id: id },
    requestId: ctx.requestId,
  });
}
