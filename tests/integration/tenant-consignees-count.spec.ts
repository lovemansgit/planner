// tests/integration/tenant-consignees-count.spec.ts
// =============================================================================
// Day-24 PM pin for countConsigneesByTenantRows.
//
// Cases pinned:
//   1. empty filter returns the seeded count for the tenant
//   2. searchTerm matches name
//   3. searchTerm matches phone via digit-stripping
//   4. cross-tenant isolation — second tenant's rows never surface under
//      withTenant() of the first tenant
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countConsigneesByTenantRows } from "../../src/modules/consignees/repository";
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

const CONSIGNEE_A1 = randomUUID();
const CONSIGNEE_A2 = randomUUID();
const CONSIGNEE_B1 = randomUUID();

const SEARCH_NAME = `Sarah Khouri ${RUN_ID}`;
const PHONE_DIGITS = `5${RUN_ID.replace(/[^0-9]/g, "0")}9`;

describe("Day-24 PM tenant count pin — countConsigneesByTenantRows", () => {
  beforeAll(async () => {
    await withServiceRole("tenant-consignees-count integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${`tcc-${RUN_ID}-a`}, ${`TCC A ${RUN_ID}`}, 'active'),
          (${TENANT_B}, ${`tcc-${RUN_ID}-b`}, ${`TCC B ${RUN_ID}`}, 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_A1}, ${TENANT_A}, ${SEARCH_NAME}, ${`+971 ${PHONE_DIGITS}`},
           'Addr A1', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_A2}, ${TENANT_A}, ${`Other A ${RUN_ID}`}, '+971400000000',
           'Addr A2', 'Dubai', 'Al Quoz', 'ACTIVE'),
          (${CONSIGNEE_B1}, ${TENANT_B}, ${`Sarah Khouri ${RUN_ID} BTenant`}, '+971400000001',
           'Addr B1', 'Dubai', 'Jumeirah', 'ACTIVE')
      `);
    });
  });

  it("empty filter returns 2 (tenant-A seeded set; tenant-B excluded by RLS)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countConsigneesByTenantRows(tx, TENANT_A as Uuid),
    );
    expect(result).toBe(2);
  });

  it("searchTerm matches name (1 of 2 on tenant-A)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countConsigneesByTenantRows(tx, TENANT_A as Uuid, { searchTerm: SEARCH_NAME }),
    );
    expect(result).toBe(1);
  });

  it("searchTerm matches phone via digit-stripping (1 row on tenant-A)", async () => {
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countConsigneesByTenantRows(tx, TENANT_A as Uuid, { searchTerm: PHONE_DIGITS }),
    );
    expect(result).toBe(1);
  });

  it("cross-tenant isolation — tenant-B 'Sarah Khouri' row never surfaces under withTenant(A)", async () => {
    // Both tenants have a 'Sarah Khouri' substring; tenant-B's row
    // must not appear under tenant-A's count.
    const result = await withTenant(TENANT_A as Uuid, async (tx) =>
      countConsigneesByTenantRows(tx, TENANT_A as Uuid, { searchTerm: "Sarah Khouri" }),
    );
    expect(result).toBe(1);
  });
});
