// tests/integration/admin-regions-auth-method-immutable.spec.ts
// =============================================================================
// Day-26 T3 — assertion of the IMMUTABLE auth_method invariant per v1.15
// amendment §2.1. Spec 7 of 8 for the per-merchant SF credentials lane
// (Sub-PR 2).
//
// Cases pinned:
//   1. createRegion requires auth_method — input missing the field
//      raises ValidationError at the Zod parse layer
//   2. updateRegion rejects auth_method mutation via Zod .strict() — any
//      `auth_method` key on the input payload is an unknown key that
//      the schema refuses, regardless of value
//   3. After successful updateRegion of a non-auth-method field, the
//      auth_method DB column is unchanged (load-bearing IMMUTABLE pin)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRegion,
  updateRegion,
  type CreateRegionInput,
  type UpdateRegionInput,
} from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import { ValidationError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG = (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";
const REGION_CLIENT_ID = `arim${ALPHA_TAG}`;

const SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(label: string): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set<Permission>(["region:manage"]),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/regions",
  };
}

let regionId: Uuid;

describe("admin regions auth_method immutable — integration (Day-26 T3)", () => {
  beforeAll(async () => {
    const created = await createRegion(sysadminCtx("seed"), {
      clientId: REGION_CLIENT_ID,
      displayName: "ARIM Initial",
      authMethod: "oauth",
    });
    regionId = created.regionId;
  });

  afterAll(async () => {
    try {
      await withServiceRole("arim teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM suitefleet_regions WHERE id = ${regionId}`);
      });
    } catch {
      /* FK RESTRICT if any tenant points at the region; ignore */
    }
  });

  it("createRegion requires auth_method — input missing the field raises ValidationError", async () => {
    // Force the missing-field shape past TS by casting through the
    // service-input type. At the runtime layer, the Zod schema
    // catches the absence and surfaces ValidationError.
    const badInput = {
      clientId: `arim${ALPHA_TAG}miss`,
      displayName: "Missing auth_method",
    } as unknown as CreateRegionInput;
    await expect(createRegion(sysadminCtx("missing-auth"), badInput)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("updateRegion rejects auth_method mutation — unknown key trips Zod .strict()", async () => {
    // Force the auth_method key past TS by casting through the
    // service-input type — the field is intentionally absent from
    // UpdateRegionInput so a clean caller can't supply it. A malicious
    // POST against the action layer in Sub-PR 3 must still be rejected
    // by the runtime Zod schema; that's what this pins.
    const badInput = {
      displayName: "ARIM updated",
      auth_method: "api_key",
    } as unknown as UpdateRegionInput;
    await expect(
      updateRegion(sysadminCtx("auth-mutation"), regionId, badInput),
    ).rejects.toBeInstanceOf(ValidationError);

    // The region's auth_method DB column is unchanged.
    const row = await withServiceRole("test:read region", async (tx) => {
      const rows = await tx.execute<{ auth_method: string } & Record<string, unknown>>(sqlTag`
        SELECT auth_method FROM suitefleet_regions WHERE id = ${regionId}
      `);
      return (rows as unknown as ReadonlyArray<{ auth_method: string }>)[0];
    });
    expect(row.auth_method).toBe("oauth");
  });

  it("legitimate updateRegion(displayName) preserves auth_method", async () => {
    const result = await updateRegion(sysadminCtx("display-update"), regionId, {
      displayName: "ARIM Renamed",
    });
    expect(result.changedFields).toContain("display_name");

    const row = await withServiceRole("test:read after update", async (tx) => {
      const rows = await tx.execute<{ display_name: string; auth_method: string } & Record<string, unknown>>(sqlTag`
        SELECT display_name, auth_method FROM suitefleet_regions WHERE id = ${regionId}
      `);
      return (rows as unknown as ReadonlyArray<{ display_name: string; auth_method: string }>)[0];
    });
    expect(row.display_name).toBe("ARIM Renamed");
    expect(row.auth_method).toBe("oauth");
  });
});
