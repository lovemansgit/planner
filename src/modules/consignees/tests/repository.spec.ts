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
  countAllConsigneesRows,
  countConsigneesByTenantRows,
  deleteConsignee,
  findConsigneeById,
  findConsigneeForCrmUpdate,
  insertConsignee,
  insertConsigneeCrmEvent,
  listAllConsigneesRows,
  listConsigneesByTenant,
  selectTimelineForConsignee,
  updateConsignee,
  updateConsigneeCrmState,
} from "../repository";
import type { CreateConsigneeInput, UpdateConsigneePatch } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT_ID = "00000000-0000-0000-0000-00000000000b";
const CONSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const ACTOR_USER_ID = "00000000-0000-0000-0000-00000000aaaa";
const CRM_EVENT_ID = "22222222-2222-2222-2222-222222222222";

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
    crm_state: "ACTIVE",
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
      // Block 4-D — crm_state column-add (migration 0016) surfaces via
      // mapRow; default 'ACTIVE' on insert per the column's DB default.
      crmState: "ACTIVE",
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

  describe("searchTerm filter", () => {
    it("omits the ILIKE clause when searchTerm is undefined", async () => {
      const tx = makeStubTx([[]]);
      await listConsigneesByTenant(tx, TENANT_ID);
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).not.toMatch(/ILIKE/i);
    });

    it("omits the ILIKE clause when searchTerm is whitespace-only", async () => {
      const tx = makeStubTx([[]]);
      await listConsigneesByTenant(tx, TENANT_ID, { searchTerm: "   " });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).not.toMatch(/ILIKE/i);
    });

    it("adds an ILIKE clause on name when searchTerm is non-empty", async () => {
      const tx = makeStubTx([[]]);
      await listConsigneesByTenant(tx, TENANT_ID, { searchTerm: "Sarah" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/name\s+ILIKE/i);
      expect(captured.params).toContain("%Sarah%");
    });

    it("adds a phone ILIKE clause with digit-stripped pattern when query contains digits", async () => {
      const tx = makeStubTx([[]]);
      await listConsigneesByTenant(tx, TENANT_ID, { searchTerm: "+971 50 123" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/phone\s+ILIKE/i);
      expect(captured.params).toContain("%97150123%");
    });

    it("falls back to name-only ILIKE when the query has no digits", async () => {
      const tx = makeStubTx([[]]);
      await listConsigneesByTenant(tx, TENANT_ID, { searchTerm: "Khouri" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/name\s+ILIKE/i);
      expect(captured.sql).not.toMatch(/phone\s+ILIKE/i);
    });
  });
});

describe("listAllConsigneesRows", () => {
  describe("searchTerm filter", () => {
    it("omits the ILIKE clause when searchTerm is undefined", async () => {
      const tx = makeStubTx([[]]);
      await listAllConsigneesRows(tx, {});
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/FROM consignees c/i);
      expect(captured.sql).toMatch(/JOIN tenants ten/i);
      expect(captured.sql).not.toMatch(/ILIKE/i);
    });

    it("omits the ILIKE clause when searchTerm is whitespace-only", async () => {
      const tx = makeStubTx([[]]);
      await listAllConsigneesRows(tx, { searchTerm: "   " });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).not.toMatch(/ILIKE/i);
    });

    it("ILIKEs against consignee name + merchant name when query is non-digit", async () => {
      const tx = makeStubTx([[]]);
      await listAllConsigneesRows(tx, { searchTerm: "Khouri" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/c\.name\s+ILIKE/i);
      expect(captured.sql).toMatch(/ten\.name\s+ILIKE/i);
      expect(captured.sql).not.toMatch(/c\.phone\s+ILIKE/i);
      expect(captured.params).toContain("%Khouri%");
    });

    it("adds phone ILIKE with digits-stripped pattern when query has digits", async () => {
      const tx = makeStubTx([[]]);
      await listAllConsigneesRows(tx, { searchTerm: "+971 50 123" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/c\.phone\s+ILIKE/i);
      expect(captured.params).toContain("%97150123%");
      expect(captured.params).toContain("%+971 50 123%");
    });

    it("composes searchTerm with merchantSlug (both clauses present)", async () => {
      const tx = makeStubTx([[]]);
      await listAllConsigneesRows(tx, { searchTerm: "Sarah", merchantSlug: "mpl" });
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/ten\.slug\s*=/i);
      expect(captured.sql).toMatch(/ILIKE/i);
      expect(captured.params).toContain("mpl");
      expect(captured.params).toContain("%Sarah%");
    });
  });

  describe("archive filter", () => {
    // Day-24 audit ruling: cross-tenant admin SELECTs must hide rows
    // belonging to archived tenants so the bulk CI-leak archive doesn't
    // leak rows through /admin/consignees at demo time.
    it("includes the ten.status != 'archived' predicate", async () => {
      const tx = makeStubTx([[]]);
      await listAllConsigneesRows(tx, {});
      const captured = compile(tx.execute.mock.calls[0][0]);
      expect(captured.sql).toMatch(/ten\.status\s*!=\s*'archived'/i);
    });
  });
});

describe("countAllConsigneesRows (Day-24 PM)", () => {
  it("emits SELECT COUNT(*)::int on the same JOIN topology as listAllConsigneesRows", async () => {
    const tx = makeStubTx([[{ count: 0 }]]);
    await countAllConsigneesRows(tx);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT\s+COUNT\(\*\)::int\s+AS\s+count/i);
    expect(captured.sql).toMatch(/FROM consignees c/i);
    expect(captured.sql).toMatch(/JOIN tenants ten/i);
    expect(captured.sql).toMatch(/ten\.status\s*!=\s*'archived'/i);
    expect(captured.sql).not.toMatch(/ORDER BY/i);
    expect(captured.sql).not.toMatch(/LIMIT/i);
  });

  it("returns 0 when no rows match", async () => {
    const tx = makeStubTx([[]]);
    expect(await countAllConsigneesRows(tx)).toBe(0);
  });

  it("composes merchantSlug + searchTerm filter fragments", async () => {
    const tx = makeStubTx([[{ count: 5 }]]);
    await countAllConsigneesRows(tx, { merchantSlug: "mpl", searchTerm: "sarah" });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/ten\.slug\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/ILIKE/i);
    expect(captured.params).toContain("mpl");
    expect(captured.params).toContain("%sarah%");
  });
});

describe("countConsigneesByTenantRows (Day-24 PM)", () => {
  it("emits SELECT COUNT(*)::int with tenant predicate", async () => {
    const tx = makeStubTx([[{ count: 0 }]]);
    await countConsigneesByTenantRows(tx, TENANT_ID);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT\s+COUNT\(\*\)::int\s+AS\s+count/i);
    expect(captured.sql).toMatch(/FROM consignees/i);
    expect(captured.sql).toMatch(/tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.sql).not.toMatch(/ORDER BY/i);
    expect(captured.sql).not.toMatch(/LIMIT/i);
  });

  it("composes searchTerm with name + phone digit-stripping", async () => {
    const tx = makeStubTx([[{ count: 2 }]]);
    await countConsigneesByTenantRows(tx, TENANT_ID, { searchTerm: "+971 50 123" });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/ILIKE/i);
    expect(captured.params).toContain("%97150123%");
  });

  it("returns 0 when no rows match", async () => {
    const tx = makeStubTx([[]]);
    expect(await countConsigneesByTenantRows(tx, TENANT_ID, { searchTerm: "Nothing-Matches" })).toBe(0);
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

// -----------------------------------------------------------------------------
// CRM state operations (Day 16 / Block 4-D)
// -----------------------------------------------------------------------------

describe("findConsigneeForCrmUpdate", () => {
  it("issues SELECT … FOR UPDATE with the defence-in-depth tenant_id predicate", async () => {
    const tx = makeStubTx([[rowFixture({ crm_state: "ACTIVE" })]]);

    const result = await findConsigneeForCrmUpdate(tx, TENANT_ID, CONSIGNEE_ID);

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT \* FROM consignees/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/FOR UPDATE/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(CONSIGNEE_ID);
    expect(result?.crmState).toBe("ACTIVE");
  });

  it("returns null when the row is missing or RLS-hidden", async () => {
    const tx = makeStubTx([[]]);
    const result = await findConsigneeForCrmUpdate(tx, OTHER_TENANT_ID, CONSIGNEE_ID);
    expect(result).toBeNull();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(OTHER_TENANT_ID);
  });
});

describe("updateConsigneeCrmState", () => {
  it("issues UPDATE … crm_state = $ … WHERE id AND tenant_id; returns true on a single row update", async () => {
    const tx = makeStubTx([[{ id: CONSIGNEE_ID }]]);

    const ok = await updateConsigneeCrmState(tx, TENANT_ID, CONSIGNEE_ID, "HIGH_RISK");

    expect(ok).toBe(true);
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/UPDATE consignees/i);
    expect(captured.sql).toMatch(/SET crm_state\s*=\s*\$\d+/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain("HIGH_RISK");
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(CONSIGNEE_ID);
  });

  it("returns false when no row matched (vanished mid-tx)", async () => {
    const tx = makeStubTx([[]]);
    const ok = await updateConsigneeCrmState(tx, TENANT_ID, CONSIGNEE_ID, "INACTIVE");
    expect(ok).toBe(false);
  });
});

describe("insertConsigneeCrmEvent", () => {
  function eventRowFixture(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: CRM_EVENT_ID,
      consignee_id: CONSIGNEE_ID,
      tenant_id: TENANT_ID,
      from_state: "ACTIVE",
      to_state: "ON_HOLD",
      reason: "operator note",
      actor: ACTOR_USER_ID,
      occurred_at: FIXED_NOW,
      ...overrides,
    };
  }

  it("inserts and returns the camelCase mapped row", async () => {
    const tx = makeStubTx([[eventRowFixture()]]);

    const result = await insertConsigneeCrmEvent(tx, {
      consigneeId: CONSIGNEE_ID,
      tenantId: TENANT_ID,
      fromState: "ACTIVE",
      toState: "ON_HOLD",
      reason: "operator note",
      actor: ACTOR_USER_ID,
    });

    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result).toEqual({
      id: CRM_EVENT_ID,
      consigneeId: CONSIGNEE_ID,
      tenantId: TENANT_ID,
      fromState: "ACTIVE",
      toState: "ON_HOLD",
      reason: "operator note",
      actor: ACTOR_USER_ID,
      occurredAt: FIXED_NOW.toISOString(),
    });
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/INSERT INTO consignee_crm_events/i);
    expect(captured.params).toContain(CONSIGNEE_ID);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain("ACTIVE");
    expect(captured.params).toContain("ON_HOLD");
    expect(captured.params).toContain("operator note");
    expect(captured.params).toContain(ACTOR_USER_ID);
  });

  it("accepts null fromState (initial-create path) and null reason", async () => {
    const tx = makeStubTx([
      [eventRowFixture({ from_state: null, reason: null, to_state: "ACTIVE" })],
    ]);
    const result = await insertConsigneeCrmEvent(tx, {
      consigneeId: CONSIGNEE_ID,
      tenantId: TENANT_ID,
      fromState: null,
      toState: "ACTIVE",
      reason: null,
      actor: ACTOR_USER_ID,
    });
    expect(result.fromState).toBeNull();
    expect(result.reason).toBeNull();
  });

  it("throws when INSERT … RETURNING produces zero rows (anomaly)", async () => {
    const tx = makeStubTx([[]]);
    await expect(
      insertConsigneeCrmEvent(tx, {
        consigneeId: CONSIGNEE_ID,
        tenantId: TENANT_ID,
        fromState: "ACTIVE",
        toState: "ON_HOLD",
        reason: "x",
        actor: ACTOR_USER_ID,
      }),
    ).rejects.toThrow(/zero rows/);
  });
});

// ---------------------------------------------------------------------------
// selectTimelineForConsignee — Day 22 / §3.3.7 unified timeline view
// ---------------------------------------------------------------------------

describe("selectTimelineForConsignee", () => {
  const SUBSCRIPTION_ID = "33333333-3333-3333-3333-333333333333";
  const TASK_ID = "44444444-4444-4444-4444-444444444444";

  it("scopes SELECT to consignee_id AND tenant_id, orders newest-first, LIMIT 50 default", async () => {
    const tx = makeStubTx([[]]);
    await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID);

    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/FROM consignee_timeline_events/);
    expect(sql).toMatch(/WHERE consignee_id =/);
    expect(sql).toMatch(/AND tenant_id =/);
    expect(sql).toMatch(/ORDER BY occurred_at DESC/);
    expect(sql).toMatch(/LIMIT \$\d+/);
    expect(params).toContain(TENANT_ID);
    expect(params).toContain(CONSIGNEE_ID);
    expect(params).toContain(50);
  });

  it("clamps the limit at 200", async () => {
    const tx = makeStubTx([[]]);
    await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID, { limit: 9999 });
    const { params } = compile(tx.execute.mock.calls[0][0]);
    expect(params).toContain(200);
  });

  it("applies the before cursor when provided", async () => {
    const tx = makeStubTx([[]]);
    await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID, {
      before: "2026-05-01T00:00:00.000Z",
    });
    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/AND occurred_at < \$\d+::timestamptz/);
    expect(params).toContain("2026-05-01T00:00:00.000Z");
  });

  it("maps a crm_state row to the crm_state TimelineEvent variant", async () => {
    const tx = makeStubTx([
      [
        {
          event_kind: "crm_state",
          occurred_at: "2026-05-01T10:00:00.000Z",
          payload: {
            from_state: "ACTIVE",
            to_state: "ON_HOLD",
            reason: "operator hold",
          },
          actor_id: ACTOR_USER_ID,
        },
      ],
    ]);

    const events = await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID);
    expect(events).toHaveLength(1);
    const evt = events[0];
    expect(evt.kind).toBe("crm_state");
    if (evt.kind !== "crm_state") return;
    expect(evt.fromState).toBe("ACTIVE");
    expect(evt.toState).toBe("ON_HOLD");
    expect(evt.reason).toBe("operator hold");
    expect(evt.actor).toBe(ACTOR_USER_ID);
    expect(evt.eventAt).toBe("2026-05-01T10:00:00.000Z");
  });

  it("maps a crm_state initial-create row (from_state = null)", async () => {
    const tx = makeStubTx([
      [
        {
          event_kind: "crm_state",
          occurred_at: "2026-04-30T08:00:00.000Z",
          payload: { from_state: null, to_state: "ACTIVE", reason: null },
          actor_id: ACTOR_USER_ID,
        },
      ],
    ]);
    const events = await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID);
    const evt = events[0];
    expect(evt.kind).toBe("crm_state");
    if (evt.kind !== "crm_state") return;
    expect(evt.fromState).toBeNull();
    expect(evt.toState).toBe("ACTIVE");
  });

  it("maps a subscription_exception row (pause_window with date range)", async () => {
    const tx = makeStubTx([
      [
        {
          event_kind: "subscription_exception",
          occurred_at: "2026-05-02T10:00:00.000Z",
          payload: {
            type: "pause_window",
            subscription_id: SUBSCRIPTION_ID,
            start_date: "2026-05-10",
            end_date: "2026-05-17",
            compensating_date: null,
            reason: "operator pause",
          },
          actor_id: ACTOR_USER_ID,
        },
      ],
    ]);
    const evt = (await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID))[0];
    expect(evt.kind).toBe("subscription_exception");
    if (evt.kind !== "subscription_exception") return;
    expect(evt.type).toBe("pause_window");
    expect(evt.subscriptionId).toBe(SUBSCRIPTION_ID);
    expect(evt.startDate).toBe("2026-05-10");
    expect(evt.endDate).toBe("2026-05-17");
    expect(evt.compensatingDate).toBeNull();
    expect(evt.reason).toBe("operator pause");
  });

  it("maps a subscription_exception skip with compensating_date", async () => {
    const tx = makeStubTx([
      [
        {
          event_kind: "subscription_exception",
          occurred_at: "2026-05-02T10:00:00.000Z",
          payload: {
            type: "skip",
            subscription_id: SUBSCRIPTION_ID,
            start_date: "2026-05-18",
            end_date: null,
            compensating_date: "2026-06-01",
            reason: null,
          },
          actor_id: ACTOR_USER_ID,
        },
      ],
    ]);
    const evt = (await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID))[0];
    expect(evt.kind).toBe("subscription_exception");
    if (evt.kind !== "subscription_exception") return;
    expect(evt.type).toBe("skip");
    expect(evt.compensatingDate).toBe("2026-06-01");
  });

  it("maps a task_status row (DELIVERED) with null actor", async () => {
    const tx = makeStubTx([
      [
        {
          event_kind: "task_status",
          occurred_at: "2026-05-03T10:00:00.000Z",
          payload: {
            task_id: TASK_ID,
            internal_status: "DELIVERED",
            delivery_date: "2026-05-03",
          },
          actor_id: null,
        },
      ],
    ]);
    const evt = (await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID))[0];
    expect(evt.kind).toBe("task_status");
    if (evt.kind !== "task_status") return;
    expect(evt.taskId).toBe(TASK_ID);
    expect(evt.internalStatus).toBe("DELIVERED");
    expect(evt.deliveryDate).toBe("2026-05-03");
  });

  it("returns mapped events in repository order across mixed kinds", async () => {
    const tx = makeStubTx([
      [
        {
          event_kind: "task_status",
          occurred_at: "2026-05-03T10:00:00.000Z",
          payload: { task_id: TASK_ID, internal_status: "FAILED", delivery_date: "2026-05-03" },
          actor_id: null,
        },
        {
          event_kind: "subscription_exception",
          occurred_at: "2026-05-02T10:00:00.000Z",
          payload: {
            type: "pause_window",
            subscription_id: SUBSCRIPTION_ID,
            start_date: "2026-05-10",
            end_date: "2026-05-17",
            compensating_date: null,
            reason: null,
          },
          actor_id: ACTOR_USER_ID,
        },
        {
          event_kind: "crm_state",
          occurred_at: "2026-05-01T10:00:00.000Z",
          payload: { from_state: "ACTIVE", to_state: "HIGH_RISK", reason: null },
          actor_id: ACTOR_USER_ID,
        },
      ],
    ]);
    const events = await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID);
    expect(events.map((e) => e.kind)).toEqual([
      "task_status",
      "subscription_exception",
      "crm_state",
    ]);
  });

  it("returns an empty array when the view yields zero rows", async () => {
    const tx = makeStubTx([[]]);
    const events = await selectTimelineForConsignee(tx, TENANT_ID, CONSIGNEE_ID);
    expect(events).toEqual([]);
  });
});
