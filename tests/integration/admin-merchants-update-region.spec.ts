// tests/integration/admin-merchants-update-region.spec.ts
// =============================================================================
// Day-26 T3 Sub-PR 3 — real-Postgres coverage for the new
// suitefleetRegionId field on updateMerchant.
//
// Cases pinned:
//   1. happy path — region change flips suitefleet_region_id +
//      merchant.updated audit body carries
//      { suitefleet_region_id: { before, after } }
//   2. no-op when supplied region matches current — ValidationError
//      ("no changes")
//   3. invalid UUID shape — ValidationError ("must be a valid UUID")
//      via the requireValidUuid client-side regex
//   4. ghost UUID (well-formed but not a real region) — FK violation
//      maps to ValidationError ("references an unknown region") rather
//      than 500
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRegion } from "../../src/modules/credentials";
import { updateMerchant } from "../../src/modules/merchants/service";
import { withServiceRole } from "../../src/shared/db";
import { ValidationError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG =
  (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";
const TENANT_ID = randomUUID();
const SLUG = `umr-${RUN_ID}`;
const REGION_FROM_CLIENT_ID = `umr${ALPHA_TAG}from`;
const REGION_TO_CLIENT_ID = `umr${ALPHA_TAG}to`;

const SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(label: string): RequestContext {
  const perms: Permission[] = ["region:manage", "merchant:update"];
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants/x/edit",
  };
}

let regionFromId: Uuid;
let regionToId: Uuid;

describe("updateMerchant — region field (Day-26 T3 Sub-PR 3)", () => {
  beforeAll(async () => {
    const f = await createRegion(sysadminCtx("seed-from"), {
      clientId: REGION_FROM_CLIENT_ID,
      displayName: "UMR From Region",
      authMethod: "oauth",
    });
    regionFromId = f.regionId;
    const t = await createRegion(sysadminCtx("seed-to"), {
      clientId: REGION_TO_CLIENT_ID,
      displayName: "UMR To Region",
      authMethod: "api_key",
    });
    regionToId = t.regionId;

    await withServiceRole("umr test: tenant seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (
          id, slug, name, status, suitefleet_region_id, suitefleet_customer_code
        ) VALUES (
          ${TENANT_ID}, ${SLUG}, 'UMR Tenant', 'active', ${regionFromId}, '588'
        )
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("umr teardown — tenants", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
    try {
      await withServiceRole("umr teardown — regions", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM suitefleet_regions WHERE id IN (${regionFromId}, ${regionToId})
        `);
      });
    } catch {
      /* FK RESTRICT; ignore */
    }
  });

  it("happy path — region change flips suitefleet_region_id + audit body carries before/after", async () => {
    const result = await updateMerchant(sysadminCtx("happy"), TENANT_ID as Uuid, {
      suitefleetRegionId: regionToId,
    });
    expect(result.status).toBe("updated");
    expect(result.changedFields).toEqual(["suitefleet_region_id"]);

    const row = await withServiceRole("test:read tenant", async (tx) => {
      const rows = await tx.execute<{ suitefleet_region_id: string } & Record<string, unknown>>(sqlTag`
        SELECT suitefleet_region_id FROM tenants WHERE id = ${TENANT_ID}
      `);
      return (rows as unknown as ReadonlyArray<{ suitefleet_region_id: string }>)[0];
    });
    expect(row?.suitefleet_region_id).toBe(regionToId);

    const events = await withServiceRole("test:read audit", async (tx) => {
      return tx.execute<{
        event_type: string;
        resource_id: string;
        metadata: { tenant_id: string; changes: Record<string, { before: unknown; after: unknown }> };
      } & Record<string, unknown>>(sqlTag`
        SELECT event_type, resource_id, metadata
        FROM audit_events
        WHERE event_type = 'merchant.updated' AND resource_id = ${TENANT_ID}
        ORDER BY occurred_at ASC
      `);
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata.changes).toEqual({
      suitefleet_region_id: { before: regionFromId, after: regionToId },
    });
    expect(events[0].metadata.tenant_id).toBe(TENANT_ID);
  });

  it("no-op — supplying the current region_id throws ValidationError('no changes')", async () => {
    // Region was already flipped to regionToId in the previous test;
    // supplying it again is a no-op diff.
    await expect(
      updateMerchant(sysadminCtx("noop"), TENANT_ID as Uuid, {
        suitefleetRegionId: regionToId,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("invalid UUID shape — ValidationError surfaces at requireValidUuid", async () => {
    await expect(
      updateMerchant(sysadminCtx("bad-uuid"), TENANT_ID as Uuid, {
        suitefleetRegionId: "not-a-uuid" as Uuid,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("FK violation on ghost region — caught at action layer + surfaced as ValidationError, not 500", async () => {
    const ghost = randomUUID();
    await expect(
      updateMerchant(sysadminCtx("ghost-region"), TENANT_ID as Uuid, {
        suitefleetRegionId: ghost as Uuid,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
