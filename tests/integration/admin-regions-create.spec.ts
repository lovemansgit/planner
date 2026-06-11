// tests/integration/admin-regions-create.spec.ts
// =============================================================================
// Day-26 T3 — real-Postgres coverage for the createRegion service +
// region.created audit event registration. Spec 1 of 8 for the
// per-merchant SF credentials lane (Sub-PR 2).
//
// Cases pinned:
//   1. happy path — region row created + region.created audit emitted
//      with metadata { region_id, client_id, display_name, auth_method }
//   2. UNIQUE client_id collision → ConflictError, no audit emitted
//   3. ValidationError on malformed client_id (uppercase / underscores)
//   4. permission gate — actor without region:manage → ForbiddenError
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createRegion } from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG = (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";
const REGION_CLIENT_ID = `arc${ALPHA_TAG}`;
const REGION_DUP_CLIENT_ID = `arc${ALPHA_TAG}dup`;

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
    requestId: `test-${RUN_ID}-create`,
    path: "/admin/regions/new",
  };
}

function nonSysadminCtx(): RequestContext {
  const perms: Permission[] = ["merchant:read_all"];
  return {
    actor: {
      kind: "user",
      userId: NON_SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-create-forbidden`,
    path: "/admin/regions/new",
  };
}

async function deleteRegionsByClientIdPrefix(prefix: string) {
  await withServiceRole("admin-regions-create teardown", async (tx) => {
    await tx.execute(sqlTag`
      DELETE FROM suitefleet_regions
      WHERE client_id LIKE ${`${prefix}%`}
    `);
  });
}

type RegionRow = {
  id: string;
  client_id: string;
  display_name: string;
  status: string;
  auth_method: string;
} & Record<string, unknown>;

async function selectRegionByClientId(clientId: string) {
  return withServiceRole("test:select region", async (tx) => {
    const rows = await tx.execute<RegionRow>(sqlTag`
      SELECT id, client_id, display_name, status, auth_method
      FROM suitefleet_regions
      WHERE client_id = ${clientId}
    `);
    return (rows as unknown as ReadonlyArray<RegionRow>)[0] ?? null;
  });
}

type AuditRow = {
  event_type: string;
  resource_id: string;
  metadata: {
    region_id: string;
    client_id: string;
    display_name: string;
    auth_method: string;
  };
} & Record<string, unknown>;

async function selectRegionCreatedEvents(regionId: string) {
  return withServiceRole("test:select region.created events", async (tx) => {
    return tx.execute<AuditRow>(sqlTag`
      SELECT event_type, resource_id, metadata
      FROM audit_events
      WHERE event_type = 'region.created'
        AND resource_id = ${regionId}
      ORDER BY occurred_at ASC
    `);
  });
}

describe("admin regions create — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    // No seeding required at the suitefleet_regions level — each test
    // creates its own row(s). The migration's 4 seeded regions (sandbox
    // + 3 production) are untouched here.
    await deleteRegionsByClientIdPrefix(`arc${ALPHA_TAG}`);
  });

  afterAll(async () => {
    // Region rows have no FK dependents in this spec (no tenants point
    // at them), so DELETE succeeds without RESTRICT trip. Audit events
    // for region.created leak with the region rows themselves — out of
    // scope per memory/followup_audit_rule_cascade_conflict.md (random
    // per-run client_ids prevent collision; CI gets a fresh DB each
    // run anyway).
    try {
      await deleteRegionsByClientIdPrefix(`arc${ALPHA_TAG}`);
    } catch {
      /* audit RULE adjacent; ignore */
    }
  });

  it("happy path — createRegion returns regionId + persists row + emits region.created with full metadata", async () => {
    const result = await createRegion(sysadminCtx(), {
      clientId: REGION_CLIENT_ID,
      displayName: "ARC Test Region",
      authMethod: "api_key",
    });

    expect(result.status).toBe("created");
    expect(result.regionId).toMatch(/^[0-9a-f-]{36}$/);

    const row = await selectRegionByClientId(REGION_CLIENT_ID);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(result.regionId);
    expect(row?.display_name).toBe("ARC Test Region");
    expect(row?.status).toBe("active");
    expect(row?.auth_method).toBe("api_key");

    const events = await selectRegionCreatedEvents(result.regionId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("region.created");
    expect(events[0].resource_id).toBe(result.regionId);
    expect(events[0].metadata).toEqual({
      region_id: result.regionId,
      client_id: REGION_CLIENT_ID,
      display_name: "ARC Test Region",
      auth_method: "api_key",
    });
  });

  it("UNIQUE client_id collision — duplicate region creation throws ConflictError + no second audit row", async () => {
    // Seed the collision target via service (so the first create's audit
    // row is present and we can assert the second attempt doesn't add
    // another).
    const first = await createRegion(sysadminCtx(), {
      clientId: REGION_DUP_CLIENT_ID,
      displayName: "ARC Dup Region",
      authMethod: "oauth",
    });
    const eventsBefore = await selectRegionCreatedEvents(first.regionId);
    const baselineCount = eventsBefore.length;

    await expect(
      createRegion(sysadminCtx(), {
        clientId: REGION_DUP_CLIENT_ID,
        displayName: "Different Display",
        authMethod: "api_key",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const eventsAfter = await selectRegionCreatedEvents(first.regionId);
    expect(eventsAfter).toHaveLength(baselineCount);
  });

  it("ValidationError on malformed client_id (uppercase + underscores)", async () => {
    await expect(
      createRegion(sysadminCtx(), {
        clientId: "ARCBad",
        displayName: "X",
        authMethod: "oauth",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createRegion(sysadminCtx(), {
        clientId: "arc_bad",
        displayName: "X",
        authMethod: "oauth",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("permission gate — actor without region:manage throws ForbiddenError", async () => {
    await expect(
      createRegion(nonSysadminCtx(), {
        clientId: `arc${ALPHA_TAG}forbidden`,
        displayName: "X",
        authMethod: "oauth",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
