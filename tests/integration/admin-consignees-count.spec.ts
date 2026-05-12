// tests/integration/admin-consignees-count.spec.ts
// =============================================================================
// Day-24 PM schema-drift regression pin for countAllConsigneesRows.
//
// Cases pinned:
//   1. empty filter returns full count (matches seeded live-tenant set)
//   2. merchantSlug narrows to that tenant's consignees
//   3. searchTerm narrows (name match + phone digit-stripping + merchant name)
//   4. archived tenant rows excluded
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countAllConsigneesRows } from "../../src/modules/consignees/repository";
import { withServiceRole } from "../../src/shared/db";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_LIVE = randomUUID();
const TENANT_ARCHIVED = randomUUID();
const SLUG_LIVE = `acc-${RUN_ID}-live`;
const SLUG_ARCHIVED = `acc-${RUN_ID}-arch`;
const NAME_LIVE = `ACC Live ${RUN_ID}`;

const CONSIGNEE_LIVE_A = randomUUID();
const CONSIGNEE_LIVE_B = randomUUID();
const CONSIGNEE_ARCHIVED = randomUUID();

const SEARCH_NAME = `Sarah Khouri ${RUN_ID}`;
const PHONE_DIGITS = `5${RUN_ID.replace(/[^0-9]/g, "0")}1`; // best-effort unique digit pattern

describe("Day-24 PM count pin — countAllConsigneesRows", () => {
  beforeAll(async () => {
    await withServiceRole("admin-consignees-count integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_LIVE}, ${SLUG_LIVE}, ${NAME_LIVE}, 'active'),
          (${TENANT_ARCHIVED}, ${SLUG_ARCHIVED}, ${`ACC Archived ${RUN_ID}`}, 'archived')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_LIVE_A}, ${TENANT_LIVE}, ${SEARCH_NAME}, ${`+971 ${PHONE_DIGITS}`},
           'Addr A', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_LIVE_B}, ${TENANT_LIVE}, ${`Other Person ${RUN_ID}`}, ${`acc-${RUN_ID}-b`},
           'Addr B', 'Dubai', 'Al Quoz', 'ACTIVE'),
          (${CONSIGNEE_ARCHIVED}, ${TENANT_ARCHIVED}, ${`Archived Person ${RUN_ID}`}, ${`acc-${RUN_ID}-arch`},
           'Addr C', 'Dubai', 'Jumeirah', 'ACTIVE')
      `);
    });
  });

  async function count(filters: Parameters<typeof countAllConsigneesRows>[1] = {}): Promise<number> {
    return withServiceRole("acc test", async (tx) => countAllConsigneesRows(tx, filters));
  }

  it("merchantSlug = live narrows to that tenant's 2 seeded consignees", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE })).toBe(2);
  });

  it("excludes archived tenant rows (merchantSlug = archived returns 0)", async () => {
    expect(await count({ merchantSlug: SLUG_ARCHIVED })).toBe(0);
  });

  it("searchTerm matches consignee name (1 of 2 on live tenant)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: SEARCH_NAME })).toBe(1);
  });

  it("searchTerm matches phone via digit-stripping", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: PHONE_DIGITS })).toBe(1);
  });

  it("searchTerm matches merchant name (ten.name ILIKE) returns both live consignees", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: NAME_LIVE })).toBe(2);
  });
});
