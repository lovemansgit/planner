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
  updateMerchantFields,
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
    suitefleet_customer_code: null,
    suitefleet_region_id: "11111111-1111-4111-a111-111111111111",
    suitefleet_credential_1_vault_id: null,
    suitefleet_credential_2_vault_id: null,
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
      suitefleetCustomerCode: "588",
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
      suitefleetCustomerCode: null,
      suitefleetRegionId: "11111111-1111-4111-a111-111111111111",
      suitefleetCredential1VaultId: null,
      suitefleetCredential2VaultId: null,
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
      suitefleetCustomerCode: "588",
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
        suitefleetCustomerCode: "588",
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

describe("updateMerchantFields", () => {
  it("issues UPDATE with COALESCE-style null-sentinel binds for every editable column", async () => {
    const tx = makeStubTx([
      [rowFixture({ name: "Updated Name" })],
    ]);

    const result = await updateMerchantFields(tx, TENANT_ID, {
      name: "Updated Name",
    });

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/UPDATE tenants/i);
    // Every editable column wrapped in COALESCE — name + 3 pickup +
    // sf code + sf region id = 6 calls. (Slug was removed from the
    // patch shape; it's creation-only. SF region id added by Day-26
    // Sub-PR 3 for the region picker on /admin/merchants/[id]/edit.)
    const coalesceMatches = captured.sql.match(/COALESCE/gi);
    expect(coalesceMatches).not.toBeNull();
    expect(coalesceMatches?.length).toBe(6);
    expect(captured.sql).toMatch(/name\s*=\s*COALESCE/i);
    expect(captured.sql).not.toMatch(/slug\s*=\s*COALESCE/i);
    expect(captured.sql).toMatch(/pickup_address_line\s*=\s*COALESCE/i);
    expect(captured.sql).toMatch(/pickup_address_district\s*=\s*COALESCE/i);
    expect(captured.sql).toMatch(/pickup_address_emirate\s*=\s*COALESCE/i);
    expect(captured.sql).toMatch(/suitefleet_customer_code\s*=\s*COALESCE/i);
    expect(captured.sql).toMatch(/suitefleet_region_id\s*=\s*COALESCE/i);
    expect(captured.sql).toMatch(/updated_at\s*=\s*now\(\)/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/RETURNING\s+\*/i);

    // The bound param for the supplied field is present; the unsupplied
    // ones are null sentinels (the COALESCE wrapper preserves the
    // existing column value when the param is null).
    expect(captured.params).toContain("Updated Name");
    // 5 unsupplied fields (3 pickup + sf code + sf region id) → 5 null sentinels.
    const nullCount = captured.params.filter((p) => p === null).length;
    expect(nullCount).toBe(5);

    expect(result?.tenantId).toBe(TENANT_ID);
    expect(result?.name).toBe("Updated Name");
  });

  it("expands nested pickupAddress to all three flat columns", async () => {
    const tx = makeStubTx([
      [
        rowFixture({
          pickup_address_line: "New Line",
          pickup_address_district: "New District",
          pickup_address_emirate: "Sharjah",
        }),
      ],
    ]);

    const result = await updateMerchantFields(tx, TENANT_ID, {
      pickupAddress: {
        line: "New Line",
        district: "New District",
        emirate: "Sharjah",
      },
    });

    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain("New Line");
    expect(captured.params).toContain("New District");
    expect(captured.params).toContain("Sharjah");
    // name + sf code + sf region id = 3 unsupplied → 3 null sentinels.
    const nullCount = captured.params.filter((p) => p === null).length;
    expect(nullCount).toBe(3);

    expect(result?.pickupAddress).toEqual({
      line: "New Line",
      district: "New District",
      emirate: "Sharjah",
    });
  });

  it("all-undefined patch issues UPDATE with six null sentinels (no-op semantic at SQL layer)", async () => {
    // The service layer is responsible for the "no fields to update"
    // gate (plan §3.2); the repo just compiles whatever the caller
    // passes. An all-null UPDATE preserves every column via COALESCE
    // and only bumps updated_at, which is harmless at the SQL layer.
    // Six COALESCE'd columns: name + 3 pickup + sf code + sf region id.
    const tx = makeStubTx([[rowFixture()]]);
    await updateMerchantFields(tx, TENANT_ID, {});
    const captured = compile(tx.execute.mock.calls[0][0]);
    const nullCount = captured.params.filter((p) => p === null).length;
    expect(nullCount).toBe(6);
  });

  it("returns null when no row matched (vanished mid-tx → service maps to NotFoundError)", async () => {
    const tx = makeStubTx([[]]);
    const result = await updateMerchantFields(tx, TENANT_ID, {
      name: "Updated Name",
    });
    expect(result).toBeNull();
  });
});

describe("listMerchants", () => {
  it("default (no filter) excludes archived rows via composed AND status != 'archived'", async () => {
    // Day-18 cleanup default; Day-24 composable refactor. The /admin/merchants
    // list page calls listMerchants(ctx) with no filter and depends on archived
    // rows being hidden by default (excludeArchived defaults true). Asserts
    // the SQL surface that delivers that contract.
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
    // Day-24 — composable form: WHERE 1 = 1 AND status != 'archived'.
    expect(captured.sql).toMatch(/status\s*!=\s*'archived'/i);
    // ...and must NOT have a status-equality filter (that's the
    // explicit-status branch, which this case shouldn't hit).
    expect(captured.sql).not.toMatch(/status\s*=\s*\$\d+/i);
    expect(result).toHaveLength(2);
    expect(result[0].slug).toBe("first");
  });

  it("adds AND status = $1 when explicit status filter supplied", async () => {
    const tx = makeStubTx([[rowFixture({ status: "active" })]]);
    await listMerchants(tx, { status: "active" });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/status\s*=\s*\$\d+/i);
    expect(captured.params).toContain("active");
  });

  it("returns an empty array when no rows match", async () => {
    const tx = makeStubTx([[]]);
    expect(await listMerchants(tx)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Day-18 plan §8.1 — excludeArchived precedence + forensic-archived path
  // -------------------------------------------------------------------------

  it("explicit status: 'archived' filter returns archived rows (forensic-review path)", async () => {
    const tx = makeStubTx([[rowFixture({ status: "archived" })]]);
    const result = await listMerchants(tx, { status: "archived" });
    const captured = compile(tx.execute.mock.calls[0][0]);
    // Explicit status filter wins; the SQL is the equality form,
    // NOT the inequality default-exclude form.
    expect(captured.sql).toMatch(/status\s*=\s*\$\d+/i);
    expect(captured.sql).not.toMatch(/!=\s*'archived'/i);
    expect(captured.params).toContain("archived");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("archived");
  });

  it("excludeArchived: false bypasses the default-exclude (no status predicate)", async () => {
    // Debug/forensic posture: caller wants every row including
    // archived. Composable refactor: no status SQL fragment is added.
    const tx = makeStubTx([
      [
        rowFixture({ id: "t-1", slug: "live", status: "active" }),
        rowFixture({ id: "t-2", slug: "stale", status: "archived" }),
      ],
    ]);
    const result = await listMerchants(tx, { excludeArchived: false });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT \* FROM tenants/i);
    expect(captured.sql).not.toMatch(/status\s*!=/i);
    expect(captured.sql).not.toMatch(/status\s*=\s*\$\d+/i);
    expect(result).toHaveLength(2);
  });

  it("explicit status: 'archived' overrides excludeArchived (precedence rule)", async () => {
    // Per ListMerchantsFilters precedence: explicit status wins,
    // excludeArchived is ignored regardless of value. Caller can
    // still see archived rows via ?status=archived even if some
    // upstream layer decided to set excludeArchived: true.
    const tx = makeStubTx([[rowFixture({ status: "archived" })]]);
    await listMerchants(tx, { status: "archived", excludeArchived: true });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/status\s*=\s*\$\d+/i);
    expect(captured.sql).not.toMatch(/!=\s*'archived'/i);
    expect(captured.params).toContain("archived");
  });

  it("excludeArchived: true (explicit) is equivalent to the default", async () => {
    const tx = makeStubTx([[]]);
    await listMerchants(tx, { excludeArchived: true });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/status\s*!=\s*'archived'/i);
  });

  describe("searchTerm filter", () => {
    it("omits the ILIKE clause when searchTerm is undefined", async () => {
      const tx = makeStubTx([[]]);
      await listMerchants(tx, {});
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).not.toMatch(/ILIKE/i);
    });

    it("omits the ILIKE clause when searchTerm is whitespace-only", async () => {
      const tx = makeStubTx([[]]);
      await listMerchants(tx, { searchTerm: "   " });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).not.toMatch(/ILIKE/i);
    });

    it("ILIKEs against name + slug when searchTerm is set", async () => {
      const tx = makeStubTx([[]]);
      await listMerchants(tx, { searchTerm: "demo" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/name\s+ILIKE/i);
      expect(captured.sql).toMatch(/slug\s+ILIKE/i);
      expect(captured.params).toContain("%demo%");
    });

    it("composes searchTerm with the default excludeArchived filter (both clauses present)", async () => {
      const tx = makeStubTx([[]]);
      await listMerchants(tx, { searchTerm: "demo" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/status\s*!=\s*'archived'/i);
      expect(captured.sql).toMatch(/ILIKE/i);
      expect(captured.params).toContain("%demo%");
    });
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
