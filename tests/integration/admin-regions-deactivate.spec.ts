// tests/integration/admin-regions-deactivate.spec.ts
// =============================================================================
// Day-26 T3 — real-Postgres coverage for the deactivateRegion service +
// region.deactivated audit event registration. Spec 2 of 8 for the
// per-merchant SF credentials lane (Sub-PR 2).
//
// Cases pinned:
//   1. happy path — status flips active → inactive + region.deactivated
//      audit emitted; bound tenants' rows are NOT cascaded
//   2. NotFoundError when region id is unknown
//   3. ConflictError when region is already inactive (PLAN-STRICT only
//      active → inactive)
//   4. permission gate — actor without region:manage → ForbiddenError
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRegion, deactivateRegion } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG = (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";
const REGION_CLIENT_ID = `arde${ALPHA_TAG}`;
const REGION_PREDEACTIVATED_CLIENT_ID = `arde${ALPHA_TAG}pre`;
const TENANT_BOUND = randomUUID();
const TENANT_SLUG = `arde-${RUN_ID}-bound`;

const SYSADMIN_ACTOR = randomUUID();
const NON_SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(): RequestContext {
  const perms: Permission[] = ["region:manage"];
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-deactivate`,
    path: "/admin/regions",
  };
}

function nonSysadminCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: NON_SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set<Permission>(["merchant:read_all"]),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-deactivate-forbidden`,
    path: "/admin/regions",
  };
}

let regionIdActive: Uuid;
let regionIdPredeactivated: Uuid;

describe("admin regions deactivate — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    // Seed a region we will deactivate + bind a tenant to it so we can
    // assert non-cascading behaviour on tenant rows.
    const a = await createRegion(sysadminCtx(), {
      clientId: REGION_CLIENT_ID,
      displayName: "ARDE Active Region",
      authMethod: "api_key",
    });
    regionIdActive = a.regionId;

    const b = await createRegion(sysadminCtx(), {
      clientId: REGION_PREDEACTIVATED_CLIENT_ID,
      displayName: "ARDE Predeactivated",
      authMethod: "api_key",
    });
    regionIdPredeactivated = b.regionId;
    // Flip the second region inactive directly so we can hit the
    // PLAN-STRICT not-active path.
    await withServiceRole("arde test: predeactivate seed", async (tx) => {
      await tx.execute(sqlTag`
        UPDATE suitefleet_regions SET status = 'inactive' WHERE id = ${regionIdPredeactivated}
      `);
    });

    // Bind a tenant to the soon-to-be-deactivated region so we can
    // assert that the tenant row survives the deactivation.
    await withServiceRole("arde test: tenant seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_region_id)
        VALUES (${TENANT_BOUND}, ${TENANT_SLUG}, 'ARDE Bound Tenant', 'active', ${regionIdActive})
      `);
    });
  });

  afterAll(async () => {
    // Canonical teardown skeleton (memory/followup_audit_rule_cascade_conflict.md).
    // Delete tenant first (audit RULE may block — swallow). Then attempt
    // to delete regions; ON DELETE RESTRICT means a still-existing bound
    // tenant blocks the region delete (swallowed). Both leak with random
    // per-run UUIDs.
    try {
      await withServiceRole("arde teardown — tenants", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_BOUND}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
    try {
      await withServiceRole("arde teardown — regions", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM suitefleet_regions WHERE id IN (${regionIdActive}, ${regionIdPredeactivated})
        `);
      });
    } catch {
      /* FK RESTRICT; ignore */
    }
  });

  it("happy path — active → inactive + emits region.deactivated + bound tenants NOT cascaded", async () => {
    const result = await deactivateRegion(sysadminCtx(), regionIdActive);
    expect(result).toEqual({
      status: "deactivated",
      regionId: regionIdActive,
      previousStatus: "active",
      newStatus: "inactive",
    });

    // Region row is now inactive.
    const regionRow = await withServiceRole("test:select region", async (tx) => {
      const rows = await tx.execute<{ status: string } & Record<string, unknown>>(sqlTag`
        SELECT status FROM suitefleet_regions WHERE id = ${regionIdActive}
      `);
      return (rows as unknown as ReadonlyArray<{ status: string }>)[0] ?? null;
    });
    expect(regionRow?.status).toBe("inactive");

    // The bound tenant survives — no cascade. Its suitefleet_region_id
    // still references the now-inactive region (the resolver fails
    // closed downstream; that is the operational kill-switch per brief
    // §3.7, not a schema-level cascade).
    const tenantRow = await withServiceRole("test:select bound tenant", async (tx) => {
      const rows = await tx.execute<{ id: string; suitefleet_region_id: string } & Record<string, unknown>>(sqlTag`
        SELECT id, suitefleet_region_id FROM tenants WHERE id = ${TENANT_BOUND}
      `);
      return (rows as unknown as ReadonlyArray<{ id: string; suitefleet_region_id: string }>)[0] ?? null;
    });
    expect(tenantRow).not.toBeNull();
    expect(tenantRow?.suitefleet_region_id).toBe(regionIdActive);

    // region.deactivated audit row emitted.
    const events = await withServiceRole("test:select audit", async (tx) => {
      return tx.execute<{ event_type: string; resource_id: string; metadata: { region_id: string } } & Record<string, unknown>>(sqlTag`
        SELECT event_type, resource_id, metadata
        FROM audit_events
        WHERE event_type = 'region.deactivated' AND resource_id = ${regionIdActive}
      `);
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({ region_id: regionIdActive });
  });

  it("NotFoundError when region id is unknown", async () => {
    const ghost = randomUUID();
    await expect(
      deactivateRegion(sysadminCtx(), ghost as Uuid),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ConflictError when region is already inactive (PLAN-STRICT)", async () => {
    await expect(
      deactivateRegion(sysadminCtx(), regionIdPredeactivated),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("permission gate — actor without region:manage throws ForbiddenError", async () => {
    await expect(
      deactivateRegion(nonSysadminCtx(), regionIdActive),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
