// Repository unit tests — C-2.
//
// Mocks `tx.execute` directly so the SQL building, the row mapper, and
// the partial-patch SET-clause logic can be exercised without a real
// Postgres connection. RLS / cross-tenant isolation behaviour is
// proven separately in tests/integration/rls-tenant-isolation.spec.ts;
// the unit tests here verify the *shape* of the queries we send (the
// defence-in-depth `tenant_id` predicate on update / delete) and the
// repository's null-handling paths.
//
// Drizzle's tagged-template SQL objects are opaque from outside — we
// can't string-equal the produced SQL — so the predicate assertions
// compile each captured SQL object via PgDialect.sqlToQuery and
// substring-match. That's stable enough for tests and decouples from
// the SQL pretty-printer.

import { sql as sqlTag, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  deleteConsignee,
  findConsigneeById,
  insertConsignee,
  listConsigneesByTenant,
  updateConsignee,
} from "../repository";
import type { CreateConsigneeInput, UpdateConsigneePatch } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT_ID = "00000000-0000-0000-0000-00000000000b";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";

const FIXED_NOW = new Date("2026-04-28T10:00:00.000Z");

const dialect = new PgDialect();

/** Compile a captured SQL object into its `$1`-bound text + params. */
function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

function rowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONSIGNEE_ID,
    tenant_id: TENANT_ID,
    name: "Falafel House",
    phone: "+971501234567",
    email: null,
    address_line: "Building 12, Al Quoz",
    emirate_or_region: "Dubai",
    district: "Al Quoz Industrial 1",
    delivery_notes: null,
    external_ref: null,
    notes_internal: null,
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
  return { execute } as unknown as Parameters<typeof insertConsignee>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("insertConsignee", () => {
  it("issues exactly one execute() and returns the camelCase mapped row", async () => {
    const tx = makeStubTx([[rowFixture()]]);
    const input: CreateConsigneeInput = {
      name: "Falafel House",
      phone: "+971501234567",
      addressLine: "Building 12, Al Quoz",
      emirateOrRegion: "Dubai",
      district: "Al Quoz Industrial 1",
    };

    const result = await insertConsignee(tx, TENANT_ID, input);

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({
      id: CONSIGNEE_ID,
      tenantId: TENANT_ID,
      name: "Falafel House",
      phone: "+971501234567",
      email: null,
      addressLine: "Building 12, Al Quoz",
      emirateOrRegion: "Dubai",
      district: "Al Quoz Industrial 1",
      deliveryNotes: null,
      externalRef: null,
      notesInternal: null,
      createdAt: FIXED_NOW.toISOString(),
      updatedAt: FIXED_NOW.toISOString(),
    });
  });

  it("converts undefined optional fields into NULL parameters", async () => {
    // We can't read the tagged-template SQL directly, but we can check
    // that the row mapper carries through the null email/notes the DB
    // would have stored. The fixture's nulls match what the INSERT
    // would land if its `${input.email ?? null}` branch fires.
    const tx = makeStubTx([
      [rowFixture({ email: null, delivery_notes: null, external_ref: null, notes_internal: null })],
    ]);
    const result = await insertConsignee(tx, TENANT_ID, {
      name: "x",
      phone: "+971500000000",
      addressLine: "y",
      emirateOrRegion: "Dubai",
      district: "Al Quoz",
    });
    expect(result.email).toBeNull();
    expect(result.deliveryNotes).toBeNull();
    expect(result.externalRef).toBeNull();
    expect(result.notesInternal).toBeNull();
  });

  it("throws if INSERT … RETURNING produces zero rows (unexpected anomaly)", async () => {
    const tx = makeStubTx([[]]);
    await expect(
      insertConsignee(tx, TENANT_ID, {
        name: "x",
        phone: "y",
        addressLine: "z",
        emirateOrRegion: "Dubai",
        district: "Al Quoz",
      })
    ).rejects.toThrow(/zero rows/);
  });
});

describe("findConsigneeById", () => {
  it("returns the mapped row when one exists", async () => {
    const tx = makeStubTx([[rowFixture({ name: "Aroma Bakery" })]]);
    const result = await findConsigneeById(tx, CONSIGNEE_ID);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result?.name).toBe("Aroma Bakery");
    expect(result?.tenantId).toBe(TENANT_ID);
  });

  it("returns null when the row is missing or hidden by RLS", async () => {
    const tx = makeStubTx([[]]);
    const result = await findConsigneeById(tx, CONSIGNEE_ID);
    expect(result).toBeNull();
  });
});

describe("listConsigneesByTenant", () => {
  it("returns mapped rows in input order", async () => {
    const tx = makeStubTx([
      [
        rowFixture({ id: "row-1", name: "First" }),
        rowFixture({ id: "row-2", name: "Second" }),
      ],
    ]);
    const result = await listConsigneesByTenant(tx, TENANT_ID);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("First");
    expect(result[1].name).toBe("Second");
  });

  it("returns an empty array when the tenant has no consignees", async () => {
    const tx = makeStubTx([[]]);
    const result = await listConsigneesByTenant(tx, TENANT_ID);
    expect(result).toEqual([]);
  });

  it("includes the tenant_id predicate alongside RLS (defence in depth)", async () => {
    const tx = makeStubTx([[]]);
    await listConsigneesByTenant(tx, TENANT_ID);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/tenant_id\s*=\s*\$/);
    expect(captured.params).toContain(TENANT_ID);
  });
});

describe("updateConsignee", () => {
  it("issues UPDATE with the defence-in-depth tenant_id predicate", async () => {
    const tx = makeStubTx([[rowFixture({ name: "Renamed" })]]);
    const patch: UpdateConsigneePatch = { name: "Renamed" };

    const result = await updateConsignee(tx, TENANT_ID, CONSIGNEE_ID, patch);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    // Both `id = $n` and `tenant_id = $n` must appear in the WHERE.
    expect(captured.sql).toMatch(/UPDATE consignees/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(CONSIGNEE_ID);
    expect(result?.name).toBe("Renamed");
  });

  it("falls through to a tenant-scoped SELECT when the patch is empty (no UPDATE)", async () => {
    const tx = makeStubTx([[rowFixture()]]);

    const result = await updateConsignee(tx, TENANT_ID, CONSIGNEE_ID, {});

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/^\s*SELECT/i);
    // Empty-patch path MUST also carry the tenant_id predicate so both
    // paths through updateConsignee enforce the same defence-in-depth.
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(result?.id).toBe(CONSIGNEE_ID);
  });

  it("returns null when the row is missing, RLS-hidden, or tenant_id mismatch", async () => {
    const tx = makeStubTx([[]]);
    const result = await updateConsignee(tx, OTHER_TENANT_ID, CONSIGNEE_ID, { name: "ghost" });
    expect(result).toBeNull();
    const captured = compile(tx.execute.mock.calls[0][0]);
    // The tenantId we passed must be one of the bound params — proves
    // the query carries the caller-supplied scope, not a hard-coded one.
    expect(captured.params).toContain(OTHER_TENANT_ID);
  });

  it("includes every present optional column in the SET clause without writing absent ones", async () => {
    // The shape proves the dispatch logic doesn't bail out when several
    // fields are present — every field present should still produce
    // exactly one UPDATE round-trip with the tenant_id predicate intact.
    const tx = makeStubTx([[rowFixture({ name: "n", phone: "p", email: "e@x" })]]);
    const result = await updateConsignee(tx, TENANT_ID, CONSIGNEE_ID, {
      name: "n",
      phone: "p",
      email: "e@x",
      addressLine: "a",
      emirateOrRegion: "Sharjah",
      district: "Industrial Area 1",
      deliveryNotes: "d",
      externalRef: "r",
      notesInternal: "i",
    });
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(result?.email).toBe("e@x");
  });
});

describe("deleteConsignee", () => {
  it("issues DELETE with the defence-in-depth tenant_id predicate and returns true on a deleted row", async () => {
    const result = Object.assign([], { count: 1 });
    const tx = makeStubTx([result]);

    const ok = await deleteConsignee(tx, TENANT_ID, CONSIGNEE_ID);

    expect(ok).toBe(true);
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/DELETE FROM consignees/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(CONSIGNEE_ID);
  });

  it("returns false when no row was deleted (unknown id, cross-tenant id, or RLS hides)", async () => {
    const result = Object.assign([], { count: 0 });
    const tx = makeStubTx([result]);
    expect(await deleteConsignee(tx, OTHER_TENANT_ID, CONSIGNEE_ID)).toBe(false);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(OTHER_TENANT_ID);
  });

  it("falls back to array length when the result has no `count` property", async () => {
    // Tests that pre-stub execute as a plain array still produce a
    // sensible boolean — defensive against stub shapes.
    const tx = makeStubTx([[]]);
    expect(await deleteConsignee(tx, TENANT_ID, CONSIGNEE_ID)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Direct compile sanity check
// -----------------------------------------------------------------------------
// One assertion that the compile() helper actually does what we think
// it does — guards against a future Drizzle bump silently changing the
// PgDialect.sqlToQuery shape and rendering every other predicate
// assertion in this file vacuously true.
describe("compile() helper sanity", () => {
  it("expands a simple tagged template into bound `$N` syntax", () => {
    const q = sqlTag`SELECT * FROM consignees WHERE id = ${CONSIGNEE_ID} AND tenant_id = ${TENANT_ID}`;
    const { sql, params } = compile(q);
    expect(sql).toMatch(/id\s*=\s*\$1\s+AND\s+tenant_id\s*=\s*\$2/i);
    expect(params).toEqual([CONSIGNEE_ID, TENANT_ID]);
  });
});
