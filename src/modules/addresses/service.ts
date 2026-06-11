// Addresses service-layer operations — Day 22 / Phase 1 forms lane;
// createAddress added Day 53 (add-a-second-address lane).
//
// Public surface:
//   - listAddresses(ctx, consigneeId) — read path used by the task-edit
//     modal AddressPicker (Sub-PR #2 per OQ-4 ruling) and by the
//     /consignees/[id]/edit page to show the current primary address.
//   - createAddress(ctx, consigneeId, input) — Day 53. Operator adds a
//     NON-PRIMARY address from the consignee detail page (the surface
//     the onboarding copy promises; Love's Day-53 EVE ruling — built
//     before production merchants onboard). Plan:
//     memory/plans/day-53-session-c-add-second-address.md.
//
// Still NOT in v1 (Phase 2 deferral stands, reviewer-ruled on the
// Day-53 plan-PR):
//   - updateAddress / setPrimaryAddress / deleteAddress — no UI surface
//     mutates an EXISTING address; primary-flips and deletes carry
//     referential weight (tasks/exceptions/rotations) that add does not.
//
// Pattern (matches consignees/service.ts):
//   1. requirePermission(ctx, perm) — throws ForbiddenError on deny.
//   2. assertTenantScoped(ctx) — throws ValidationError when tenantId
//      is null (system actor without tenant scope is a programming
//      error for tenant-owned resources).
//   3. Run business logic inside a `withTenant(tenantId, …)` block so
//      RLS scopes naturally and the work is transactional.
//
// Reads (`get`, `list`) are NOT audited per R-4. They still go through
// requirePermission + tenantId check.

import { emit } from "../audit";
import { withTenant } from "../../shared/db";
import { NotFoundError, ValidationError } from "../../shared/errors";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import {
  consigneeExistsInTenant,
  insertAddress,
  listAddressesByConsignee,
} from "./repository";
import type { Address, AddressLabel } from "./types";

const ADDRESS_LABELS: readonly AddressLabel[] = ["home", "office", "other"];

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

/**
 * Same actor → audit-id mapping as identity/service.ts. Local copy
 * because plan §3.4 forbids cross-module imports of internal helpers
 * — same rationale as the consignees/service.ts copy.
 */
function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

/** Trim and reject empty / whitespace-only required strings. */
function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  return value.trim();
}

/**
 * Input for `createAddress`. Same fields the onboarding address block
 * captures (lat/lng stays Phase 2, matching onboarding). No isPrimary —
 * this surface is non-primary by design; see createAddress.
 */
export interface AddConsigneeAddressInput {
  readonly label: AddressLabel;
  readonly line: string;
  readonly district: string;
  readonly emirate: string;
}

/**
 * List every address for a consignee, primary first. Read-only — no
 * audit emit per R-4. RLS scopes to the actor's tenant; a consignee in
 * another tenant returns an empty array (indistinguishable from
 * "consignee has no addresses" — correct default-deny posture).
 *
 * Permission: `consignee:read` — addresses are owned by consignees and
 * share their read-permission gate. No separate `address:read`
 * permission per brief §3.4 RBAC (address ops piggyback on consignee
 * ops in v1; multi-address Phase 2 may split if granular control is
 * needed).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `consignee:read`.
 *   - ValidationError   no tenant context.
 */
export async function listAddresses(
  ctx: RequestContext,
  consigneeId: Uuid,
): Promise<readonly Address[]> {
  requirePermission(ctx, "consignee:read");
  assertTenantScoped(ctx, "consignee:read");
  return withTenant(ctx.tenantId, async (tx) => {
    return listAddressesByConsignee(tx, consigneeId);
  });
}

/**
 * Add a NON-PRIMARY address to an existing consignee — Day 53, the
 * detail-page surface the onboarding copy promises ("Add more from the
 * consignee detail page after onboarding").
 *
 * `isPrimary` is hard-set false here: the partial UNIQUE on
 * (consignee_id) WHERE is_primary = true stays unreachable from this
 * surface, and the existing primary keeps routing defaults untouched.
 * The new row is immediately visible to listConsigneeAddresses (the
 * R4/R5 override pickers) and assignable to rotation — it changes no
 * routing until an operator explicitly selects it. Primary changes are
 * Phase-2 setPrimaryAddress.
 *
 * Permission: `consignee:update` — adding an address edits the
 * consignee's deliverable surface; gates identically to the Edit
 * affordance (address ops piggyback on consignee ops in v1).
 *
 * Post-commit (outside tx, same as consignee.created):
 *   - emit `consignee.address.added` with metadata
 *     `{ consignee_id, address_id, label, is_primary: false }`.
 *
 * Throws:
 *   - ForbiddenError    actor lacks `consignee:update`.
 *   - ValidationError   invalid label, empty required field, or no
 *                       tenant context.
 *   - NotFoundError     consignee missing or RLS-hidden (cross-tenant
 *                       ids land here — default-deny).
 */
export async function createAddress(
  ctx: RequestContext,
  consigneeId: Uuid,
  input: AddConsigneeAddressInput,
): Promise<Address> {
  requirePermission(ctx, "consignee:update");
  assertTenantScoped(ctx, "consignee:update");

  if (!ADDRESS_LABELS.includes(input.label)) {
    throw new ValidationError(
      `label must be home | office | other; got ${input.label}`,
    );
  }
  const line = requireNonEmpty(input.line, "line");
  const district = requireNonEmpty(input.district, "district");
  const emirate = requireNonEmpty(input.emirate, "emirate");

  const tenantId = ctx.tenantId;
  const created = await withTenant(tenantId, async (tx) => {
    // Existence probe BEFORE insert: the addresses→consignees FK is not
    // RLS-scoped, so without this check a cross-tenant consignee id
    // would attach an address row to another tenant's consignee.
    const exists = await consigneeExistsInTenant(tx, consigneeId);
    if (!exists) {
      throw new NotFoundError(`consignee not found: ${consigneeId}`);
    }
    return insertAddress(tx, tenantId, consigneeId, {
      label: input.label,
      isPrimary: false,
      line,
      district,
      emirate,
    });
  });

  await emit({
    eventType: "consignee.address.added",
    actorKind: ctx.actor.kind,
    actorId: actorIdFor(ctx.actor),
    tenantId,
    resourceType: "consignee",
    resourceId: consigneeId,
    metadata: {
      consignee_id: consigneeId,
      address_id: created.id,
      label: created.label,
      is_primary: false,
    },
    requestId: ctx.requestId,
  });

  return created;
}
