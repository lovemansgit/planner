// tests/integration/merchant-slug-collision-conflict.spec.ts
// =============================================================================
// Day-19 T2 regression — createMerchant slug UNIQUE collision must throw
// ConflictError, not 500.
//
// Pre-fix path: insertMerchant raises 23505 → drizzle wraps into
// DrizzleQueryError → service-layer isUniqueViolation only checks err.code →
// returns false → throw err → API layer returns generic 500 instead of
// the intended 409 ConflictError.
//
// Post-fix path: shared isUniqueViolation (src/shared/db-errors.ts) walks
// err.cause → matches PG_UNIQUE_VIOLATION on the wrapped PostgresError →
// service throws ConflictError → API layer maps to 409.
//
// This spec exercises the real DB path (no mocks) so the fix is regressed
// at the integration layer, complementing the unit-level mock test at
// src/app/api/admin/merchants/tests/route.spec.ts:285 (which mocks the
// service-layer rejection and never exercised the broken code path).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ROLES } from "../../src/modules/identity";
import { createMerchant } from "../../src/modules/merchants";
import { withServiceRole } from "../../src/shared/db";
import { ConflictError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";

const RUN_ID = randomUUID().slice(0, 8);
const COLLIDING_SLUG = `msc-${RUN_ID}`;
const SEED_TENANT = randomUUID();
const STAFF_USER_ID = randomUUID();

const SYSADMIN_PERMS = ROLES["transcorp-sysadmin"].permissions;

function makeStaffCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: STAFF_USER_ID,
      tenantId: SEED_TENANT,
      permissions: SYSADMIN_PERMS,
    },
    tenantId: SEED_TENANT,
    requestId: randomUUID(),
    path: "/admin/merchants",
  };
}

describe("Day-19 T2 — createMerchant slug-collision throws ConflictError", () => {
  beforeAll(async () => {
    await withServiceRole("Day-19 T2 merchant slug-collision setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${SEED_TENANT}, ${COLLIDING_SLUG}, 'Day-19 T2 Seed', 'active')
      `);
    });
  });

  it("createMerchant with colliding slug → ConflictError (not raw 500)", async () => {
    const ctx = makeStaffCtx();

    await expect(
      createMerchant(ctx, {
        name: "Day-19 T2 Collision Probe",
        slug: COLLIDING_SLUG,
        pickupAddress: {
          line: "Test Building, Test Zone",
          district: "Test District",
          emirate: "Dubai",
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
