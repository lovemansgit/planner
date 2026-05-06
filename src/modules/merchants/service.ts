// Merchants module service-layer operations.
//
// Day 16 / Block 4-D — Service D. Transcorp-staff cross-tenant surface
// per merged plan PR #155 §5.2 + brief §3.1.4. Four public methods:
// createMerchant, activateMerchant, deactivateMerchant, listMerchants.
//
// All four methods gate on the `merchant:*` permission family
// (systemOnly per `src/modules/identity/permissions.ts:526-560`),
// granted only to the `transcorp-sysadmin` role
// (`src/modules/identity/roles.ts:183-190` ALL set). Tenant Admins
// MUST NOT have these permissions; the
// `systemOnlyPermissionsAreNotInTenantRoles` test enforces it
// statically.
//
// Cross-tenant scope: every method runs inside `withServiceRole(reason,
// async (tx) => ...)` because:
//   - The `tenants` table has its own RLS policy keyed by
//     `id = app.current_tenant_id` (per 0001_identity.sql); no session
//     tenant_id is bound for cross-tenant create/list/state-flip ops.
//   - The audit-emit `withServiceRole` recursion-skip contract from
//     `src/modules/audit/emit.ts:14-31` requires the reason string to
//     NOT start with `audit:emit:`; we use `transcorp_staff:<verb>`
//     prefix to distinguish from the audit emit's internal scope.
//
// State-machine rulings (Block 4-D Option C ruling — plan-strict):
//   - activateMerchant: ONLY `provisioning → active`. All other
//     from-states throw ConflictError 409. Reactivation from
//     `inactive`, un-suspend from `suspended` are Phase 2 per
//     `memory/followup_merchant_lifecycle_transition_expansion.md`.
//   - deactivateMerchant: ONLY `active → inactive`. All other
//     from-states throw ConflictError 409. `suspended → inactive`
//     is Phase 2 per the same followup memo.
//   - `'suspended'` is reserved per brief §3.1.1; this PR introduces
//     no code path that exercises it.
//
// Audit body shape (Block 4-D Gate 4 Option C ruling for merchant.created
// + registered metadataNotes literals for merchant.activated +
// merchant.deactivated):
//   - merchant.created: { tenant_id, slug, name, pickup_address: {
//     line, district, emirate } } — NESTED per registered
//     metadataNotes at audit/event-types.ts:707-708.
//   - merchant.activated: { tenant_id, from_status: 'provisioning'
//     (literal), to_status: 'active' (literal) } — registered
//     metadataNotes at :716-717. Literal contract — Phase 2 expansion
//     to enum requires metadataNotes update first per §A discipline
//     rule.
//   - merchant.deactivated: { tenant_id, from_status: 'active'
//     (literal), to_status: 'inactive' (literal) } — registered
//     metadataNotes at :728-729. Same literal contract.

import { emit } from "../audit";
import { withServiceRole } from "../../shared/db";
import { ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import {
  findMerchantForStatusUpdate,
  insertMerchant,
  listMerchants as listMerchantsRows,
  updateMerchantStatus,
} from "./repository";
import type {
  ActivateMerchantResult,
  CreateMerchantInput,
  CreateMerchantResult,
  DeactivateMerchantResult,
  ListMerchantsFilters,
  Merchant,
} from "./types";

// -----------------------------------------------------------------------------
// Helpers (local; cross-module imports of internal helpers forbidden)
// -----------------------------------------------------------------------------

/**
 * Same actor → audit-id mapping as identity/service.ts +
 * consignees/service.ts (R-2 boundary rule — no cross-module
 * imports of internal helpers).
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

/**
 * Trim and reject empty / whitespace-only required strings. Mirrors
 * the consignees/service.ts helper of the same name.
 */
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

/** lowercase-kebab `^[a-z0-9-]+$` of length 1-60 per merged plan §5.2.1. */
const SLUG_RE = /^[a-z0-9-]+$/;

function requireValidSlug(value: string): string {
  const trimmed = requireNonEmpty(value, "slug");
  if (trimmed.length > 60 || !SLUG_RE.test(trimmed)) {
    throw new ValidationError(
      `slug must be lowercase-kebab '[a-z0-9-]' of length 1-60`,
    );
  }
  return trimmed;
}

/**
 * Postgres SQLSTATE code for unique-violation. Used to discriminate
 * the slug-collision path from generic INSERT failures. Same code
 * pattern as `tests/unit/mp-13-consignee-deactivation-cancels-tasks.spec.ts`
 * comment for FK-violation 23503 — `code` is the postgres-js
 * convention for SQLSTATE.
 */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

// -----------------------------------------------------------------------------
// createMerchant
// -----------------------------------------------------------------------------

/**
 * Create a new merchant tenant row. Lands in `tenants.status =
 * 'provisioning'` (DB DEFAULT per migration 0001). Slug uniqueness
 * is enforced by the UNIQUE constraint on `tenants.slug`; a
 * duplicate raises SQLSTATE 23505 mapped to ConflictError.
 *
 * Pickup-address validation: all three sub-fields required and
 * non-empty after trim. The schema columns (per migration 0017)
 * are nullable for legacy backfill, but new merchants must have
 * complete pickup_address.
 *
 * Audit emit: `merchant.created` with NESTED `pickup_address`
 * shape per registered metadataNotes (Block 4-D Gate 4 Option C).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `merchant:create`.
 *   - ValidationError   missing/empty fields, malformed slug.
 *   - ConflictError     slug already exists (UNIQUE collision).
 */
export async function createMerchant(
  ctx: RequestContext,
  input: CreateMerchantInput,
): Promise<CreateMerchantResult> {
  requirePermission(ctx, "merchant:create");

  const normalised: CreateMerchantInput = {
    name: requireNonEmpty(input.name, "name"),
    slug: requireValidSlug(input.slug),
    pickupAddress: {
      line: requireNonEmpty(input.pickupAddress?.line, "pickup_address.line"),
      district: requireNonEmpty(
        input.pickupAddress?.district,
        "pickup_address.district",
      ),
      emirate: requireNonEmpty(
        input.pickupAddress?.emirate,
        "pickup_address.emirate",
      ),
    },
  };

  let created: Merchant;
  try {
    created = await withServiceRole(
      "transcorp_staff:create_merchant",
      async (tx) => insertMerchant(tx, normalised),
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`merchant slug already exists: ${normalised.slug}`);
    }
    throw err;
  }

  await emit({
    eventType: "merchant.created",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null, // cross-tenant operation; no current tenant scope
    resourceType: "merchant",
    resourceId: created.tenantId,
    metadata: {
      tenant_id: created.tenantId,
      slug: created.slug,
      name: created.name,
      pickup_address: {
        line: normalised.pickupAddress.line,
        district: normalised.pickupAddress.district,
        emirate: normalised.pickupAddress.emirate,
      },
    },
    requestId: ctx.requestId,
  });

  return { status: "created", tenantId: created.tenantId };
}

// -----------------------------------------------------------------------------
// activateMerchant
// -----------------------------------------------------------------------------

/**
 * Flip tenant.status `provisioning → active`. PLAN-STRICT per Block
 * 4-D Option C ruling: ONLY `provisioning → active` is allowed.
 * `inactive → active` (reactivation) and `suspended → active`
 * (un-suspend) are Phase 2 per
 * `memory/followup_merchant_lifecycle_transition_expansion.md`.
 *
 * Behavior in single transaction:
 *   1. Permission gate (`merchant:activate`).
 *   2. SELECT FOR UPDATE — row-lock the tenant.
 *   3. Reject 404 if not found.
 *   4. Reject 409 ConflictError if `status !== 'provisioning'`.
 *   5. UPDATE tenants.status = 'active'.
 *   6. Post-commit: emit merchant.activated with literal
 *      from_status='provisioning', to_status='active' per registered
 *      metadataNotes.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `merchant:activate`.
 *   - NotFoundError     tenant id not found.
 *   - ConflictError     tenant.status !== 'provisioning'.
 */
export async function activateMerchant(
  ctx: RequestContext,
  tenantId: Uuid,
): Promise<ActivateMerchantResult> {
  requirePermission(ctx, "merchant:activate");

  await withServiceRole(
    `transcorp_staff:activate_merchant ${tenantId}`,
    async (tx) => {
      const before = await findMerchantForStatusUpdate(tx, tenantId);
      if (!before) {
        throw new NotFoundError(`merchant not found: ${tenantId}`);
      }
      if (before.status !== "provisioning") {
        throw new ConflictError(
          `merchant.status must be 'provisioning' to activate; current status is '${before.status}'`,
        );
      }
      const updated = await updateMerchantStatus(tx, tenantId, "active");
      if (!updated) {
        // FOR UPDATE lock means this shouldn't happen — surface as
        // NotFound for caller-consistent semantics.
        throw new NotFoundError(`merchant not found: ${tenantId}`);
      }
    },
  );

  await emit({
    eventType: "merchant.activated",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null,
    resourceType: "merchant",
    resourceId: tenantId,
    metadata: {
      tenant_id: tenantId,
      from_status: "provisioning",
      to_status: "active",
    },
    requestId: ctx.requestId,
  });

  return {
    status: "activated",
    tenantId,
    previousStatus: "provisioning",
    newStatus: "active",
  };
}

// -----------------------------------------------------------------------------
// deactivateMerchant
// -----------------------------------------------------------------------------

/**
 * Flip tenant.status `active → inactive`. PLAN-STRICT per Block 4-D
 * Option C ruling: ONLY `active → inactive` is allowed.
 * `suspended → inactive` is Phase 2 per
 * `memory/followup_merchant_lifecycle_transition_expansion.md`.
 *
 * Behavior in single transaction:
 *   1. Permission gate (`merchant:deactivate`).
 *   2. SELECT FOR UPDATE — row-lock the tenant.
 *   3. Reject 404 if not found.
 *   4. Reject 409 ConflictError if `status !== 'active'`.
 *   5. UPDATE tenants.status = 'inactive'.
 *   6. Post-commit: emit merchant.deactivated with literal
 *      from_status='active', to_status='inactive' per registered
 *      metadataNotes.
 *
 * Side effects: NONE in MVP per brief §5.4 Q3 ("Deactivation in MVP
 * is reversible — sets tenant.status to INACTIVE, blocks new
 * operator logins, preserves all data."). Block-new-logins is
 * already enforced at `buildRequestContext` time per the
 * `tenants.status='active'` filter shipped in commit d7fd9e9.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `merchant:deactivate`.
 *   - NotFoundError     tenant id not found.
 *   - ConflictError     tenant.status !== 'active'.
 */
export async function deactivateMerchant(
  ctx: RequestContext,
  tenantId: Uuid,
): Promise<DeactivateMerchantResult> {
  requirePermission(ctx, "merchant:deactivate");

  await withServiceRole(
    `transcorp_staff:deactivate_merchant ${tenantId}`,
    async (tx) => {
      const before = await findMerchantForStatusUpdate(tx, tenantId);
      if (!before) {
        throw new NotFoundError(`merchant not found: ${tenantId}`);
      }
      if (before.status !== "active") {
        throw new ConflictError(
          `merchant.status must be 'active' to deactivate; current status is '${before.status}'`,
        );
      }
      const updated = await updateMerchantStatus(tx, tenantId, "inactive");
      if (!updated) {
        throw new NotFoundError(`merchant not found: ${tenantId}`);
      }
    },
  );

  await emit({
    eventType: "merchant.deactivated",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId: null,
    resourceType: "merchant",
    resourceId: tenantId,
    metadata: {
      tenant_id: tenantId,
      from_status: "active",
      to_status: "inactive",
    },
    requestId: ctx.requestId,
  });

  return {
    status: "deactivated",
    tenantId,
    previousStatus: "active",
    newStatus: "inactive",
  };
}

// -----------------------------------------------------------------------------
// listMerchants
// -----------------------------------------------------------------------------

/**
 * Cross-tenant SELECT of all merchants. Read-only; no audit emit
 * per the existing R-4 reads-not-audited rule (consignees/service.ts
 * `getConsignee` / `listConsignees` follow the same pattern).
 *
 * Optional `status` filter per merged plan §5.2.4. Ordered by
 * `created_at DESC` (newest first) — matches the
 * `list-cron-eligible-tenants.ts` ordering posture.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `merchant:read_all`.
 */
export async function listMerchants(
  ctx: RequestContext,
  filters: ListMerchantsFilters = {},
): Promise<readonly Merchant[]> {
  requirePermission(ctx, "merchant:read_all");

  return withServiceRole("transcorp_staff:list_merchants", async (tx) => {
    return listMerchantsRows(tx, filters);
  });
}

