// Addresses service-layer operations — Day 22 / Phase 1 forms lane.
//
// Public surface in v1:
//   - listAddresses(ctx, consigneeId) — read path used by the task-edit
//     modal AddressPicker (Sub-PR #2 per OQ-4 ruling) and by the
//     /consignees/[id]/edit page to show the current primary address.
//
// NOT in v1 (deferred per brief v1.11 amendment):
//   - createAddress(ctx, consigneeId, input) — addresses are created
//     only via the createConsigneeWithSubscription orchestration in v1.
//     Standalone create surface lands when multi-address rotation UI
//     ships in Phase 2.
//   - updateAddress / setPrimaryAddress / deleteAddress — same Phase 2
//     deferral; v1 has no UI surface that mutates an existing address.
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

import { withTenant } from "../../shared/db";
import { ValidationError } from "../../shared/errors";
import type { RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { requirePermission } from "../identity";

import { listAddressesByConsignee } from "./repository";
import type { Address } from "./types";

function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
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
