// tests/integration/admin-regions-list.spec.ts
// =============================================================================
// Day-26 T3 Sub-PR 3 — real-Postgres coverage for the regions read-side
// surface that powers the /admin/regions list view, /admin/regions/[id]
// detail page, and the /admin/merchants/[id]/edit region picker.
//
// Cases pinned:
//   1. listRegionsWithUsage returns every region with COUNT(tenants),
//      sorted alphabetical by display_name ASC (ratified OQ-7),
//      including regions with zero bound tenants (LEFT JOIN preserves
//      empty rows).
//   2. listRegions(onlyActive: true) returns only status='active' rows.
//   3. findRegionByIdWithUsage returns one region with its usage count;
//      returns null for unknown ids.
//   4. findRegionForMerchant returns region metadata; gates on
//      merchant:read_all rather than region:manage so it's callable
//      from merchant-facing pages without the region-admin permission.
//   5. listRegions / listRegionsWithUsage / findRegionByIdWithUsage
//      ForbiddenError when actor lacks region:manage.
//
// Canonical teardown skeleton per
// memory/followup_audit_rule_cascade_conflict.md. We don't bind any
// tenants here, so the teardown only needs to clean up region rows;
// FK RESTRICT can't fire because no tenant points at our seeded rows.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRegion,
  findRegionByIdWithUsage,
  findRegionForMerchant,
  listRegions,
  listRegionsWithUsage,
} from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG =
  (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";

// Three seeded regions named to land in a stable alphabetical order so
// we can assert the ratified sort. display_name leads with a UUID-prefix
// label so the test's seeded rows can be picked out of the migration-
// seeded set (sandbox / transcorp / transcorpuae / transcorpqatar).
const REGION_A = {
  clientId: `arl${ALPHA_TAG}a`,
  displayName: `ARL ${ALPHA_TAG} A Region`,
  authMethod: "oauth" as const,
};
const REGION_B = {
  clientId: `arl${ALPHA_TAG}b`,
  displayName: `ARL ${ALPHA_TAG} B Region`,
  authMethod: "api_key" as const,
};
const REGION_C_INACTIVE = {
  clientId: `arl${ALPHA_TAG}c`,
  displayName: `ARL ${ALPHA_TAG} C Region (inactive)`,
  authMethod: "api_key" as const,
};

const SYSADMIN_ACTOR = randomUUID();
const READ_ONLY_ACTOR = randomUUID();
const NON_PRIVILEGED_ACTOR = randomUUID();

function sysadminCtx(label: string): RequestContext {
  const perms: Permission[] = ["region:manage", "merchant:read_all"];
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/regions",
  };
}

function readOnlyMerchantCtx(label: string): RequestContext {
  // No region:manage; only merchant:read_all. This is the actor shape
  // the merchant-detail page uses to render the auth_method badge —
  // findRegionForMerchant must succeed for this actor.
  const perms: Permission[] = ["merchant:read_all"];
  return {
    actor: {
      kind: "user",
      userId: READ_ONLY_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants/x",
  };
}

function nonPrivilegedCtx(label: string): RequestContext {
  // Neither region:manage nor merchant:read_all. Surfaces the gate
  // negative test for both read fn surfaces.
  const perms: Permission[] = ["subscription:skip"];
  return {
    actor: {
      kind: "user",
      userId: NON_PRIVILEGED_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/regions",
  };
}

let regionIdA: Uuid;
let regionIdB: Uuid;
let regionIdC: Uuid;

describe("admin regions list — integration (Day-26 T3 Sub-PR 3)", () => {
  beforeAll(async () => {
    const a = await createRegion(sysadminCtx("seed-a"), REGION_A);
    regionIdA = a.regionId;
    const b = await createRegion(sysadminCtx("seed-b"), REGION_B);
    regionIdB = b.regionId;
    const c = await createRegion(sysadminCtx("seed-c"), REGION_C_INACTIVE);
    regionIdC = c.regionId;
    // Flip region C inactive so we can test the onlyActive filter.
    await withServiceRole("arl test: predeactivate C", async (tx) => {
      await tx.execute(sqlTag`
        UPDATE suitefleet_regions SET status = 'inactive' WHERE id = ${regionIdC}
      `);
    });
  });

  afterAll(async () => {
    // Canonical teardown — no bound tenants, so region DELETE is safe.
    // Wrap in try/catch for the audit RULE precedent (defensive; the
    // region.created audit rows for our seeded regions WILL be left
    // behind, but the cascade conflict only fires on tenants DELETE).
    try {
      await withServiceRole("arl teardown — regions", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM suitefleet_regions
          WHERE id IN (${regionIdA}, ${regionIdB}, ${regionIdC})
        `);
      });
    } catch {
      /* audit RULE / FK RESTRICT; ignore */
    }
  });

  it("listRegionsWithUsage returns every region with in_use_count and alphabetical sort by display_name", async () => {
    const all = await listRegionsWithUsage(sysadminCtx("list-all"));
    // Filter to just our seeded rows (the migration seeds 4 production
    // regions that we don't touch in this spec).
    const seeded = all.filter((r) => r.clientId.startsWith(`arl${ALPHA_TAG}`));
    expect(seeded.map((r) => r.id)).toEqual([regionIdA, regionIdB, regionIdC]);

    // None of our seeded regions have bound tenants. The LEFT JOIN
    // preserves the rows with COUNT = 0.
    for (const r of seeded) {
      expect(r.inUseCount).toBe(0);
    }

    // Status carries through. Region C should be inactive.
    expect(seeded.find((r) => r.id === regionIdC)?.status).toBe("inactive");

    // auth_method carries through.
    expect(seeded.find((r) => r.id === regionIdA)?.authMethod).toBe("oauth");
    expect(seeded.find((r) => r.id === regionIdB)?.authMethod).toBe("api_key");

    // Global sort is by display_name ASC across ALL rows (including the
    // migration-seeded production regions).
    const allNames = all.map((r) => r.displayName);
    const sortedNames = [...allNames].sort((x, y) => x.localeCompare(y));
    expect(allNames).toEqual(sortedNames);
  });

  it("listRegions(onlyActive: true) returns only status='active' rows", async () => {
    const active = await listRegions(sysadminCtx("list-active"), { onlyActive: true });
    const seededActive = active.filter((r) => r.clientId.startsWith(`arl${ALPHA_TAG}`));
    expect(seededActive.map((r) => r.id).sort()).toEqual([regionIdA, regionIdB].sort());
    expect(seededActive.find((r) => r.id === regionIdC)).toBeUndefined();
  });

  it("findRegionByIdWithUsage returns single region or null for unknown id", async () => {
    const found = await findRegionByIdWithUsage(sysadminCtx("find-by-id"), regionIdB);
    expect(found?.id).toBe(regionIdB);
    expect(found?.inUseCount).toBe(0);
    expect(found?.authMethod).toBe("api_key");

    const ghost = await findRegionByIdWithUsage(
      sysadminCtx("find-by-id-null"),
      randomUUID() as Uuid,
    );
    expect(ghost).toBeNull();
  });

  it("findRegionForMerchant succeeds for an actor with only merchant:read_all (no region:manage required)", async () => {
    const r = await findRegionForMerchant(readOnlyMerchantCtx("find-merchant"), regionIdA);
    expect(r?.id).toBe(regionIdA);
    expect(r?.displayName).toBe(REGION_A.displayName);
    expect(r?.authMethod).toBe("oauth");
  });

  it("listRegions ForbiddenError for actor without region:manage", async () => {
    await expect(
      listRegions(nonPrivilegedCtx("forbidden-list")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("listRegionsWithUsage ForbiddenError for actor without region:manage", async () => {
    await expect(
      listRegionsWithUsage(nonPrivilegedCtx("forbidden-list-usage")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("findRegionByIdWithUsage ForbiddenError for actor without region:manage", async () => {
    await expect(
      findRegionByIdWithUsage(nonPrivilegedCtx("forbidden-find"), regionIdA),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("findRegionForMerchant ForbiddenError for actor without merchant:read_all", async () => {
    await expect(
      findRegionForMerchant(nonPrivilegedCtx("forbidden-merchant"), regionIdA),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
