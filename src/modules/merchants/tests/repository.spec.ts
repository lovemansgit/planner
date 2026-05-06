// Repository unit tests — Service D.
//
// Mocks tx.execute directly so the SQL building, the row mapper, and
// the nested→flat pickup_address translation can be exercised without
// a real Postgres connection. RLS / cross-tenant isolation behaviour is
// proven separately at integration scope; these unit tests verify the
// shape of the queries we send and the repository's null-handling
// paths. Mirrors the consignees/tests/repository.spec.ts conventions
// (compile via PgDialect for predicate substring assertions).

import { sql as sqlTag, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  findMerchantById,
  findMerchantBySlug,
  findMerchantForStatusUpdate,
  insertMerchant,
  listMerchants,
  updateMerchantStatus,
} from "../repository";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT_ID = "00000000-0000-0000-0000-00000000000b";

const FIXED_NOW = new Date("2026-05-06T10:00:00.000Z");

const dialect = new PgDialect();

function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

function rowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TENANT_ID,
    slug: "demo-bistro",
    name: "Demo Bistro",
    status: "provisioning",
    pickup_address_line: "Building 1, Al Quoz",
    pickup_address_district: "Al Quoz Industrial 1",
    pickup_address_emirate: "Dubai",
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

function makeStubTx(executeReturns: unknown[]) {
  let call = 0;
  const execute = vi.fn(async () => {
    const value = executeReturns[call] ?? [];
    call += 1;
    return value;
  });
  return { execute } as unknown as Parameters<typeof insertMerchant>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("insertMerchant", () => {
  it("expands nested pickupAddress to flat columns and returns the camelCase mapped row", async () => {
    const tx = makeStubTx([[rowFixture()]]);

    const result = await insertMerchant(tx, {
      slug: "demo-bistro",
      name: "Demo Bistro",
      pickupAddress: {
        line: "Building 1, Al Quoz",
        district: "Al Quoz Industrial 1",
        emirate: "Dubai",
      },
    });

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/INSERT INTO tenants/i);
    // All three flat pickup_address_* columns must be in the
    // INSERT — verifies the nested→flat translation.
    expect(captured.sql).toMatch(/pickup_address_line/);
    expect(captured.sql).toMatch(/pickup_address_district/);
    expect(captured.sql).toMatch(/pickup_address_emirate/);
    expect(captured.params).toContain("demo-bistro");
    expect(captured.params).toContain("Demo Bistro");
    expect(captured.params).toContain("Building 1, Al Quoz");
    expect(captured.params).toContain("Al Quoz Industrial 1");
    expect(captured.params).toContain("Dubai");

    expect(result).toEqual({
      tenantId: TENANT_ID,
      slug: "demo-bistro",
      name: "Demo Bistro",
      status: "provisioning",
      pickupAddress: {
        line: "Building 1, Al Quoz",
        district: "Al Quoz Industrial 1",
        emirate: "Dubai",
      },
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });
  });

  it("does NOT supply status in the INSERT — relies on DB DEFAULT 'provisioning'", async () => {
    const tx = makeStubTx([[rowFixture()]]);

    await insertMerchant(tx, {
      slug: "x",
      name: "y",
      pickupAddress: { line: "a", district: "b", emirate: "c" },
    });

    const captured = compile(tx.execute.mock.calls[0][0]);
    // The `status` column appears in `RETURNING *` shape via the row
    // selection; what we want is to NOT see it in the INSERT INTO
    // column list. The column-list portion is between the open paren
    // after INSERT INTO tenants and the VALUES keyword.
    const insertColumnsMatch = captured.sql.match(
      /INSERT INTO tenants\s*\(([^)]+)\)\s*VALUES/i,
    );
    expect(insertColumnsMatch).not.toBeNull();
    expect(insertColumnsMatch?.[1]).not.toMatch(/\bstatus\b/);
  });

  it("throws if INSERT … RETURNING produces zero rows (anomaly)", async () => {
    const tx = makeStubTx([[]]);
    await expect(
      insertMerchant(tx, {
        slug: "x",
        name: "y",
        pickupAddress: { line: "a", district: "b", emirate: "c" },
      }),
    ).rejects.toThrow(/zero rows/);
  });
});

describe("findMerchantById", () => {
  it("returns the mapped row when present", async () => {
    const tx = makeStubTx([[rowFixture({ slug: "tabchilli" })]]);
    const result = await findMerchantById(tx, TENANT_ID);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result?.slug).toBe("tabchilli");
    expect(result?.tenantId).toBe(TENANT_ID);
  });

  it("returns null when the row is missing", async () => {
    const tx = makeStubTx([[]]);
    const result = await findMerchantById(tx, TENANT_ID);
    expect(result).toBeNull();
  });
});

describe("findMerchantBySlug", () => {
  it("issues SELECT … WHERE slug = $1 and returns the mapped row", async () => {
    const tx = makeStubTx([[rowFixture({ slug: "demo-bistro" })]]);
    const result = await findMerchantBySlug(tx, "demo-bistro");
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/where\s+slug\s*=\s*\$\d+/i);
    expect(captured.params).toContain("demo-bistro");
    expect(result?.slug).toBe("demo-bistro");
  });

  it("returns null when no row matches", async () => {
    const tx = makeStubTx([[]]);
    expect(await findMerchantBySlug(tx, "nonexistent")).toBeNull();
  });
});

describe("findMerchantForStatusUpdate", () => {
  it("issues SELECT … WHERE id = $1 FOR UPDATE", async () => {
    const tx = makeStubTx([[rowFixture({ status: "active" })]]);
    const result = await findMerchantForStatusUpdate(tx, TENANT_ID);
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT \* FROM tenants/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/FOR UPDATE/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(result?.status).toBe("active");
  });

  it("returns null when the row is missing", async () => {
    const tx = makeStubTx([[]]);
    expect(await findMerchantForStatusUpdate(tx, OTHER_TENANT_ID)).toBeNull();
  });
});

describe("updateMerchantStatus", () => {
  it("issues UPDATE … status = $1, updated_at = now() WHERE id = $2; returns true on success", async () => {
    const tx = makeStubTx([[{ id: TENANT_ID }]]);
    const ok = await updateMerchantStatus(tx, TENANT_ID, "active");
    expect(ok).toBe(true);
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/UPDATE tenants/i);
    expect(captured.sql).toMatch(/SET status\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/updated_at\s*=\s*now\(\)/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+/i);
    expect(captured.params).toContain("active");
    expect(captured.params).toContain(TENANT_ID);
  });

  it("returns false when no row matched (vanished mid-tx)", async () => {
    const tx = makeStubTx([[]]);
    const ok = await updateMerchantStatus(tx, TENANT_ID, "inactive");
    expect(ok).toBe(false);
  });
});

describe("listMerchants", () => {
  it("issues SELECT * FROM tenants ORDER BY created_at DESC when no filter", async () => {
    const tx = makeStubTx([
      [
        rowFixture({ id: "t-1", slug: "first" }),
        rowFixture({ id: "t-2", slug: "second" }),
      ],
    ]);

    const result = await listMerchants(tx);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT \* FROM tenants/i);
    expect(captured.sql).toMatch(/order by\s+created_at\s+desc/i);
    expect(captured.sql).not.toMatch(/where\s+status/i);
    expect(result).toHaveLength(2);
    expect(result[0].slug).toBe("first");
  });

  it("adds WHERE status = $1 when filter supplied", async () => {
    const tx = makeStubTx([[rowFixture({ status: "active" })]]);
    await listMerchants(tx, { status: "active" });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/where\s+status\s*=\s*\$\d+/i);
    expect(captured.params).toContain("active");
  });

  it("returns an empty array when no rows match", async () => {
    const tx = makeStubTx([[]]);
    expect(await listMerchants(tx)).toEqual([]);
  });
});

describe("mapRow — pickupAddress nested-vs-flat translation", () => {
  it("collapses three NULL pickup_address_* columns to pickupAddress: null", async () => {
    const tx = makeStubTx([
      [
        rowFixture({
          pickup_address_line: null,
          pickup_address_district: null,
          pickup_address_emirate: null,
        }),
      ],
    ]);
    const result = await findMerchantById(tx, TENANT_ID);
    expect(result?.pickupAddress).toBeNull();
  });

  it("collapses mixed-null pickup_address_* columns to pickupAddress: null (defensive)", async () => {
    // Mixed-null state shouldn't exist for any merchant created via
    // createMerchant (service-layer validation requires all three).
    // The DTO returns null in this case rather than expose a partial
    // shape — header comment documents this.
    const tx = makeStubTx([
      [
        rowFixture({
          pickup_address_line: "Building 1",
          pickup_address_district: null,
          pickup_address_emirate: "Dubai",
        }),
      ],
    ]);
    const result = await findMerchantById(tx, TENANT_ID);
    expect(result?.pickupAddress).toBeNull();
  });

  it("expands all-non-null pickup_address_* columns to nested DTO", async () => {
    const tx = makeStubTx([[rowFixture()]]);
    const result = await findMerchantById(tx, TENANT_ID);
    expect(result?.pickupAddress).toEqual({
      line: "Building 1, Al Quoz",
      district: "Al Quoz Industrial 1",
      emirate: "Dubai",
    });
  });
});

describe("compile() helper sanity", () => {
  it("expands a simple tagged template into bound `$N` syntax", () => {
    const q = sqlTag`SELECT * FROM tenants WHERE id = ${TENANT_ID} AND status = ${"active"}`;
    const { sql, params } = compile(q);
    expect(sql).toMatch(/id\s*=\s*\$1\s+AND\s+status\s*=\s*\$2/i);
    expect(params).toEqual([TENANT_ID, "active"]);
  });
});
