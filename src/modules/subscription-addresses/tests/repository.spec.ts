// subscription-addresses repository unit tests.
//
// Mocks tx.execute directly so SQL building, predicate shape, and
// row mapping can be exercised without a real Postgres connection.
// RLS / cross-tenant isolation is proven separately at integration
// scope; the unit tests here verify the *shape* of the queries and
// the repository's null-handling paths. Mirrors the consignees +
// merchants repo-test conventions (compile via PgDialect).

import { sql as sqlTag, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  deleteRotationEntries,
  findAddressForConsignee,
  findSubscriptionForRotation,
  selectCurrentRotation,
  upsertRotationEntries,
} from "../repository";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT_ID = "00000000-0000-0000-0000-00000000000b";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_CONSIGNEE_ID = "11111111-1111-1111-1111-1111111111ff";
const ADDRESS_ID = "22222222-2222-2222-2222-222222222222";
const SUBSCRIPTION_ID = "33333333-3333-3333-3333-333333333333";
const ROTATION_ROW_ID = "44444444-4444-4444-4444-444444444444";

const FIXED_NOW = new Date("2026-05-06T10:00:00.000Z");

const dialect = new PgDialect();

function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

function makeStubTx(executeReturns: unknown[]) {
  let call = 0;
  const execute = vi.fn(async () => {
    const value = executeReturns[call] ?? [];
    call += 1;
    return value;
  });
  return { execute } as unknown as Parameters<typeof findAddressForConsignee>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

// -----------------------------------------------------------------------------
// findAddressForConsignee — the shared cross-consignee ownership helper
// -----------------------------------------------------------------------------

describe("findAddressForConsignee", () => {
  it("issues SELECT … WHERE id = $1 AND consignee_id = $2 AND tenant_id = $3 (3-way AND)", async () => {
    const tx = makeStubTx([
      [
        {
          id: ADDRESS_ID,
          consignee_id: CONSIGNEE_ID,
          tenant_id: TENANT_ID,
          label: "home",
          is_primary: true,
        },
      ],
    ]);

    const result = await findAddressForConsignee(tx, TENANT_ID, CONSIGNEE_ID, ADDRESS_ID);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT id, consignee_id, tenant_id, label, is_primary\s+FROM addresses/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+consignee_id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    // All three params bound — defence-in-depth tenant_id present.
    expect(captured.params).toContain(ADDRESS_ID);
    expect(captured.params).toContain(CONSIGNEE_ID);
    expect(captured.params).toContain(TENANT_ID);

    expect(result).toEqual({
      id: ADDRESS_ID,
      consigneeId: CONSIGNEE_ID,
      tenantId: TENANT_ID,
      label: "home",
      isPrimary: true,
    });
  });

  it("returns null when the row is missing (happy not-found)", async () => {
    const tx = makeStubTx([[]]);
    expect(
      await findAddressForConsignee(tx, TENANT_ID, CONSIGNEE_ID, ADDRESS_ID),
    ).toBeNull();
  });

  it("returns null when consigneeId mismatches (cross-consignee same tenant)", async () => {
    // The query carries the supplied consigneeId verbatim. If the
    // address row exists but its consignee_id is different, the
    // SQL's WHERE clause filters it out — execute returns []; the
    // helper returns null. Tested via the bound-param assertion +
    // empty-result path.
    const tx = makeStubTx([[]]);
    const result = await findAddressForConsignee(
      tx,
      TENANT_ID,
      OTHER_CONSIGNEE_ID, // operator passed wrong consignee
      ADDRESS_ID,
    );
    expect(result).toBeNull();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(OTHER_CONSIGNEE_ID);
  });

  it("returns null when tenantId mismatches (cross-tenant — RLS would also catch)", async () => {
    const tx = makeStubTx([[]]);
    expect(
      await findAddressForConsignee(tx, OTHER_TENANT_ID, CONSIGNEE_ID, ADDRESS_ID),
    ).toBeNull();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(OTHER_TENANT_ID);
  });
});

// -----------------------------------------------------------------------------
// findSubscriptionForRotation
// -----------------------------------------------------------------------------

describe("findSubscriptionForRotation", () => {
  it("issues SELECT … FOR UPDATE with tenant_id predicate; returns the row", async () => {
    const tx = makeStubTx([
      [
        {
          id: SUBSCRIPTION_ID,
          tenant_id: TENANT_ID,
          consignee_id: CONSIGNEE_ID,
          status: "active",
        },
      ],
    ]);

    const result = await findSubscriptionForRotation(tx, TENANT_ID, SUBSCRIPTION_ID);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT id, tenant_id, consignee_id, status\s+FROM subscriptions/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/FOR UPDATE/i);

    expect(result).toEqual({
      id: SUBSCRIPTION_ID,
      tenantId: TENANT_ID,
      consigneeId: CONSIGNEE_ID,
      status: "active",
    });
  });

  it("returns null when the row is missing", async () => {
    const tx = makeStubTx([[]]);
    expect(
      await findSubscriptionForRotation(tx, TENANT_ID, SUBSCRIPTION_ID),
    ).toBeNull();
  });

  it("throws on unexpected status value (defensive — Postgres CHECK should prevent)", async () => {
    const tx = makeStubTx([
      [
        {
          id: SUBSCRIPTION_ID,
          tenant_id: TENANT_ID,
          consignee_id: CONSIGNEE_ID,
          status: "garbage",
        },
      ],
    ]);
    await expect(
      findSubscriptionForRotation(tx, TENANT_ID, SUBSCRIPTION_ID),
    ).rejects.toThrow(/unexpected status/);
  });
});

// -----------------------------------------------------------------------------
// selectCurrentRotation
// -----------------------------------------------------------------------------

describe("selectCurrentRotation", () => {
  it("returns mapped rows ordered by weekday ASC", async () => {
    const tx = makeStubTx([
      [
        { id: "row-1", weekday: 1, address_id: "addr-mon", created_at: FIXED_NOW },
        { id: "row-2", weekday: 3, address_id: "addr-wed", created_at: FIXED_NOW },
        { id: "row-3", weekday: 5, address_id: "addr-fri", created_at: FIXED_NOW },
      ],
    ]);

    const result = await selectCurrentRotation(tx, TENANT_ID, SUBSCRIPTION_ID);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT id, weekday, address_id, created_at\s+FROM subscription_address_rotations/i);
    expect(captured.sql).toMatch(/where\s+subscription_id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/order by\s+weekday\s+asc/i);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.weekday)).toEqual([1, 3, 5]);
    expect(result[0].addressId).toBe("addr-mon");
    expect(result[0].createdAt).toBe(FIXED_NOW.toISOString());
  });

  it("returns an empty array when the subscription has no rotation rows", async () => {
    const tx = makeStubTx([[]]);
    expect(await selectCurrentRotation(tx, TENANT_ID, SUBSCRIPTION_ID)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// upsertRotationEntries
// -----------------------------------------------------------------------------

describe("upsertRotationEntries", () => {
  it("issues INSERT … VALUES ($,$,$,$), … ON CONFLICT (subscription_id, weekday) DO UPDATE SET address_id", async () => {
    const tx = makeStubTx([[]]);

    await upsertRotationEntries(tx, TENANT_ID, SUBSCRIPTION_ID, [
      { weekday: 1, addressId: "addr-mon" },
      { weekday: 3, addressId: "addr-wed" },
    ]);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/INSERT INTO subscription_address_rotations/i);
    expect(captured.sql).toMatch(/\(subscription_id, tenant_id, weekday, address_id\)/i);
    expect(captured.sql).toMatch(/ON CONFLICT \(subscription_id, weekday\)\s+DO UPDATE SET address_id\s*=\s*EXCLUDED\.address_id/i);
    expect(captured.params).toContain(SUBSCRIPTION_ID);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(1);
    expect(captured.params).toContain(3);
    expect(captured.params).toContain("addr-mon");
    expect(captured.params).toContain("addr-wed");
  });

  it("is a no-op when entries is empty (no DB roundtrip)", async () => {
    const tx = makeStubTx([]);
    await upsertRotationEntries(tx, TENANT_ID, SUBSCRIPTION_ID, []);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// deleteRotationEntries
// -----------------------------------------------------------------------------

describe("deleteRotationEntries", () => {
  it("issues DELETE WHERE subscription_id = $ AND tenant_id = $ AND weekday IN ($, $, $)", async () => {
    const tx = makeStubTx([[]]);

    await deleteRotationEntries(tx, TENANT_ID, SUBSCRIPTION_ID, [2, 4, 6]);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/DELETE FROM subscription_address_rotations/i);
    expect(captured.sql).toMatch(/where\s+subscription_id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+\s+and\s+weekday\s+IN\s*\(\$\d+,\s*\$\d+,\s*\$\d+\)/i);
    expect(captured.params).toContain(SUBSCRIPTION_ID);
    expect(captured.params).toContain(TENANT_ID);
    // Each weekday bound as a discrete int param (NOT a single array).
    expect(captured.params).toContain(2);
    expect(captured.params).toContain(4);
    expect(captured.params).toContain(6);
  });

  it("issues DELETE with single-element IN ($) for one weekday", async () => {
    const tx = makeStubTx([[]]);
    await deleteRotationEntries(tx, TENANT_ID, SUBSCRIPTION_ID, [3]);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/weekday\s+IN\s*\(\$\d+\)/i);
    expect(captured.params).toContain(3);
  });

  it("is a no-op when weekdays is empty (no DB roundtrip)", async () => {
    const tx = makeStubTx([]);
    await deleteRotationEntries(tx, TENANT_ID, SUBSCRIPTION_ID, []);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// compile() helper sanity (drizzle PgDialect bump regression guard)
// -----------------------------------------------------------------------------

describe("compile() helper sanity", () => {
  it("expands tagged template into bound `$N` syntax", () => {
    const q = sqlTag`SELECT * FROM addresses WHERE id = ${ADDRESS_ID} AND consignee_id = ${CONSIGNEE_ID}`;
    const { sql, params } = compile(q);
    expect(sql).toMatch(/id\s*=\s*\$1\s+AND\s+consignee_id\s*=\s*\$2/i);
    expect(params).toEqual([ADDRESS_ID, CONSIGNEE_ID]);
  });
});

// Suppress unused-warning for fixtures not directly referenced by
// SQL-shape assertions (they're shape-targets for future tests).
void ROTATION_ROW_ID;
