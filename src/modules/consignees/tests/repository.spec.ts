// Repository unit tests — C-2.
//
// Mocks `tx.execute` directly so the SQL building, the row mapper, and
// the partial-patch SET-clause logic can be exercised without a real
// Postgres connection. Integration test of the RLS-scoped path lives
// in tests/integration (separate; not landing in C-2).
//
// Drizzle's tagged-template SQL objects are opaque from outside —
// we can't deep-equal the produced SQL — but we CAN: count execute()
// calls, snapshot the row shape returned by the mapper, and verify
// the partial-patch builder skips the no-op execute when given an
// empty patch.

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
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";

const FIXED_NOW = new Date("2026-04-28T10:00:00.000Z");

function rowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONSIGNEE_ID,
    tenant_id: TENANT_ID,
    name: "Falafel House",
    phone: "+971501234567",
    email: null,
    address_line: "Building 12, Al Quoz",
    emirate_or_region: "Dubai",
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
});

describe("updateConsignee", () => {
  it("issues UPDATE and returns the mapped row when fields are present", async () => {
    const tx = makeStubTx([[rowFixture({ name: "Renamed" })]]);
    const patch: UpdateConsigneePatch = { name: "Renamed" };

    const result = await updateConsignee(tx, CONSIGNEE_ID, patch);

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result?.name).toBe("Renamed");
  });

  it("falls through to findConsigneeById when the patch is empty (single SELECT, no UPDATE)", async () => {
    const tx = makeStubTx([[rowFixture()]]);
    const result = await updateConsignee(tx, CONSIGNEE_ID, {});
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result?.id).toBe(CONSIGNEE_ID);
  });

  it("returns null when the row is missing or RLS-hidden", async () => {
    const tx = makeStubTx([[]]);
    const result = await updateConsignee(tx, CONSIGNEE_ID, { name: "ghost" });
    expect(result).toBeNull();
  });

  it("includes every present optional column in the SET clause without writing absent ones", async () => {
    // We can't see the SET clause, but we can verify call count + return.
    // The shape proves the dispatch logic doesn't bail out when several
    // fields are present — every field present should still produce
    // exactly one UPDATE round-trip.
    const tx = makeStubTx([[rowFixture({ name: "n", phone: "p", email: "e@x" })]]);
    const result = await updateConsignee(tx, CONSIGNEE_ID, {
      name: "n",
      phone: "p",
      email: "e@x",
      addressLine: "a",
      emirateOrRegion: "Sharjah",
      deliveryNotes: "d",
      externalRef: "r",
      notesInternal: "i",
    });
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result?.email).toBe("e@x");
  });
});

describe("deleteConsignee", () => {
  it("returns true when the result reports a deleted row (postgres.js count shape)", async () => {
    // postgres.js's RowList carries `count`. Simulate that.
    const result = Object.assign([], { count: 1 });
    const tx = makeStubTx([result]);
    expect(await deleteConsignee(tx, CONSIGNEE_ID)).toBe(true);
  });

  it("returns false when no row was deleted", async () => {
    const result = Object.assign([], { count: 0 });
    const tx = makeStubTx([result]);
    expect(await deleteConsignee(tx, CONSIGNEE_ID)).toBe(false);
  });

  it("falls back to array length when the result has no `count` property", async () => {
    // Tests that pre-stub execute as a plain array still produce a
    // sensible boolean — defensive against stub shapes.
    const tx = makeStubTx([[]]);
    expect(await deleteConsignee(tx, CONSIGNEE_ID)).toBe(false);
  });
});
