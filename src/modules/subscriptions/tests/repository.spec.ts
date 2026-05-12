// Subscription repository unit tests — Day 6 / S-3.
//
// Same pattern as src/modules/tasks/tests/repository.spec.ts: mock
// `tx.execute` directly so SQL building, the row mapper, the SET-clause
// builder, the empty-patch short-circuit, and the before/after capture
// pattern can be exercised without a real Postgres connection.
//
// RLS, tenant isolation, and CHECK constraint behaviour are proven
// separately in tests/integration/{rls-tenant-isolation,
// subscription-check-constraints}.spec.ts — the unit tests here verify
// the *shape* of the queries we send (the defence-in-depth
// `AND tenant_id = ${tenantId}` predicate, FOR UPDATE on the pre-state
// SELECT, RETURNING * on writes) and the repository's null-handling /
// short-circuit / illegal-transition paths.

import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { ConflictError } from "../../../shared/errors";
import {
  endSubscription,
  findSubscriptionById,
  insertSubscription,
  listSubscriptionsByConsignee,
  listSubscriptionsByTenant,
  listSubscriptionsWithConsigneeByTenant,
  updateSubscription,
} from "../repository";
import type { CreateSubscriptionInput, UpdateSubscriptionPatch } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const SUB_ID = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_CONSIGNEE_ID = "33333333-3333-3333-3333-333333333333";

const FIXED_NOW = new Date("2026-05-01T10:00:00.000Z");
const FIXED_ISO = FIXED_NOW.toISOString();

const dialect = new PgDialect();

/** Compile a captured SQL object into its `$1`-bound text + params. */
function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

/**
 * Subscription row fixture matching the postgres-js wire shape from
 * 0009_subscription.sql. Override any field via the partial.
 */
function subRowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUB_ID,
    tenant_id: TENANT_ID,
    consignee_id: CONSIGNEE_ID,
    status: "active" as const,
    start_date: "2026-05-01",
    end_date: null,
    days_of_week: [1, 3, 5],
    delivery_window_start: "14:00:00",
    delivery_window_end: "16:00:00",
    delivery_address_override: null,
    meal_plan_name: null,
    external_ref: null,
    notes_internal: null,
    paused_at: null,
    ended_at: null,
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
  return { execute } as unknown as Parameters<typeof insertSubscription>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// insertSubscription
// ---------------------------------------------------------------------------

describe("insertSubscription", () => {
  const baseInput: CreateSubscriptionInput = {
    consigneeId: CONSIGNEE_ID,
    startDate: "2026-05-01",
    daysOfWeek: [1, 3, 5],
    deliveryWindowStart: "14:00",
    deliveryWindowEnd: "16:00",
  };

  it("INSERTs all 12 columns and maps the returned row to camelCase", async () => {
    const tx = makeStubTx([[subRowFixture()]]);
    const result = await insertSubscription(tx, TENANT_ID, baseInput);

    expect(tx.execute).toHaveBeenCalledTimes(1);
    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/INSERT INTO subscriptions/);
    expect(sql).toMatch(/RETURNING \*/);
    // The 12 explicit columns the repository enumerates.
    expect(sql).toMatch(/tenant_id/);
    expect(sql).toMatch(/consignee_id/);
    expect(sql).toMatch(/status/);
    expect(sql).toMatch(/start_date/);
    expect(sql).toMatch(/end_date/);
    expect(sql).toMatch(/days_of_week/);
    expect(sql).toMatch(/delivery_window_start/);
    expect(sql).toMatch(/delivery_window_end/);
    expect(sql).toMatch(/delivery_address_override/);
    expect(sql).toMatch(/meal_plan_name/);
    expect(sql).toMatch(/external_ref/);
    expect(sql).toMatch(/notes_internal/);

    // Default status='active' applied by the repo when input omits it.
    expect(params).toContain("active");
    // Tenant + consignee + start_date + days_of_week + window times bound.
    expect(params).toContain(TENANT_ID);
    expect(params).toContain(CONSIGNEE_ID);
    expect(params).toContain("2026-05-01");
    expect(params).toContain("14:00");
    expect(params).toContain("16:00");

    expect(result.id).toBe(SUB_ID);
    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.consigneeId).toBe(CONSIGNEE_ID);
    expect(result.status).toBe("active");
    expect(result.startDate).toBe("2026-05-01");
    expect(result.endDate).toBeNull();
    expect(result.daysOfWeek).toEqual([1, 3, 5]);
    expect(result.deliveryWindowStart).toBe("14:00:00");
    expect(result.deliveryWindowEnd).toBe("16:00:00");
    expect(result.deliveryAddressOverride).toBeNull();
    expect(result.mealPlanName).toBeNull();
    expect(result.externalRef).toBeNull();
    expect(result.notesInternal).toBeNull();
    expect(result.pausedAt).toBeNull();
    expect(result.endedAt).toBeNull();
    expect(result.createdAt).toBe(FIXED_ISO);
    expect(result.updatedAt).toBe(FIXED_ISO);
  });

  it("forwards a caller-supplied status (e.g. seed in 'paused' state)", async () => {
    const tx = makeStubTx([[subRowFixture({ status: "paused", paused_at: FIXED_NOW })]]);
    const result = await insertSubscription(tx, TENANT_ID, { ...baseInput, status: "paused" });
    const { params } = compile(tx.execute.mock.calls[0][0]);
    expect(params).toContain("paused");
    expect(result.status).toBe("paused");
    expect(result.pausedAt).toBe(FIXED_ISO);
  });

  it("populates every optional field when given (full-shape boundary case)", async () => {
    const fullInput: CreateSubscriptionInput = {
      consigneeId: CONSIGNEE_ID,
      status: "active",
      startDate: "2026-05-01",
      endDate: "2026-08-31",
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      deliveryWindowStart: "08:00",
      deliveryWindowEnd: "20:00",
      deliveryAddressOverride: { addressLine1: "Warehouse 5", city: "Dubai" },
      mealPlanName: "Premium Daily",
      externalRef: "MERCHANT-CUSTOMER-42",
      notesInternal: "VIP — confirm with ops manager before pause",
    };
    const tx = makeStubTx([
      [
        subRowFixture({
          end_date: "2026-08-31",
          days_of_week: [1, 2, 3, 4, 5, 6, 7],
          delivery_window_start: "08:00:00",
          delivery_window_end: "20:00:00",
          delivery_address_override: { addressLine1: "Warehouse 5", city: "Dubai" },
          meal_plan_name: "Premium Daily",
          external_ref: "MERCHANT-CUSTOMER-42",
          notes_internal: "VIP — confirm with ops manager before pause",
        }),
      ],
    ]);
    const result = await insertSubscription(tx, TENANT_ID, fullInput);

    const { params } = compile(tx.execute.mock.calls[0][0]);
    expect(params).toContain("2026-08-31");
    expect(params).toContain("Premium Daily");
    expect(params).toContain("MERCHANT-CUSTOMER-42");

    expect(result.endDate).toBe("2026-08-31");
    expect(result.daysOfWeek).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.deliveryAddressOverride).toEqual({
      addressLine1: "Warehouse 5",
      city: "Dubai",
    });
    expect(result.mealPlanName).toBe("Premium Daily");
    expect(result.externalRef).toBe("MERCHANT-CUSTOMER-42");
    expect(result.notesInternal).toBe("VIP — confirm with ops manager before pause");
  });

  it("throws if INSERT … RETURNING produces zero rows (RLS WITH CHECK should raise instead, but defend explicitly)", async () => {
    const tx = makeStubTx([[]]);
    await expect(insertSubscription(tx, TENANT_ID, baseInput)).rejects.toThrow(
      /produced zero rows/
    );
  });

  // ---------------------------------------------------------------------------
  // Day-22 PM §4 FIX 1 anchor — days_of_week SQL array binding
  // ---------------------------------------------------------------------------
  //
  // Background: the original embedding `${input.daysOfWeek as number[]}`
  // expanded Drizzle's array-spread inside a single VALUES column slot,
  // producing `($6, $7, $8, $9, $10)` — Postgres parsed this as a
  // record/tuple literal, incompatible with the `integer[]` column type
  // (error 42804: column "days_of_week" is of type integer[] but
  // expression is of type record). The fix wraps the array in an
  // ARRAY[…]::integer[] constructor + cast so the rendered SQL is a
  // valid Postgres array literal regardless of element count.
  //
  // These tests assert the SHAPE of the rendered SQL (not the param
  // count, which still scales with element count under Drizzle's array
  // spread). The shape guarantee — `ARRAY[...]::integer[]` wrapping the
  // weekday placeholders — is what makes the binding type-compatible
  // with the column.

  describe("days_of_week SQL array binding (Day-22 PM regression guard)", () => {
    it("renders ARRAY[…]::integer[] around the day-of-week placeholders", async () => {
      const tx = makeStubTx([[subRowFixture()]]);
      await insertSubscription(tx, TENANT_ID, { ...baseInput, daysOfWeek: [1, 2, 3, 4, 5] });

      const { sql } = compile(tx.execute.mock.calls[0][0]);
      // ARRAY constructor wraps the comma-separated placeholders.
      expect(sql).toMatch(/ARRAY\[\s*\$\d+(\s*,\s*\$\d+)*\s*\]::integer\[\]/);
      // Defence: the SQL must NOT have the bug shape — a bare comma list
      // inside the VALUES tuple at the days_of_week slot without the
      // ARRAY wrapper.
      expect(sql).not.toMatch(/days_of_week[\s\S]*VALUES[\s\S]*\(\s*\$\d+\s*,\s*\$\d+\s*,\s*\$\d+\s*,\s*\$\d+\s*,\s*\$\d+\s*\)\s*,/);
    });

    it("binds each weekday as a separate param value (Drizzle spreads inside ARRAY constructor)", async () => {
      const tx = makeStubTx([[subRowFixture()]]);
      await insertSubscription(tx, TENANT_ID, { ...baseInput, daysOfWeek: [1, 2, 3, 4, 5] });

      const { params } = compile(tx.execute.mock.calls[0][0]);
      // Each weekday integer appears as its own param value (postgres-js
      // sees five separate scalars; Postgres assembles them via the
      // ARRAY constructor at parse time).
      for (const day of [1, 2, 3, 4, 5]) {
        expect(params).toContain(day);
      }
    });

    it("handles a 1-element weekday array (Sunday-only cadence)", async () => {
      const tx = makeStubTx([[subRowFixture({ days_of_week: [7] })]]);
      await insertSubscription(tx, TENANT_ID, { ...baseInput, daysOfWeek: [7] });

      const { sql, params } = compile(tx.execute.mock.calls[0][0]);
      // ARRAY[$N]::integer[] — 1-element form must still wrap.
      expect(sql).toMatch(/ARRAY\[\s*\$\d+\s*\]::integer\[\]/);
      expect(params).toContain(7);
    });

    it("handles all 7 weekdays (daily cadence)", async () => {
      const tx = makeStubTx([[subRowFixture({ days_of_week: [1, 2, 3, 4, 5, 6, 7] })]]);
      await insertSubscription(tx, TENANT_ID, {
        ...baseInput,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      });

      const { sql, params } = compile(tx.execute.mock.calls[0][0]);
      expect(sql).toMatch(/ARRAY\[\s*\$\d+(\s*,\s*\$\d+){6}\s*\]::integer\[\]/);
      for (const day of [1, 2, 3, 4, 5, 6, 7]) {
        expect(params).toContain(day);
      }
    });

    it("handles a non-contiguous subset (Mon/Wed/Fri)", async () => {
      const tx = makeStubTx([[subRowFixture({ days_of_week: [1, 3, 5] })]]);
      await insertSubscription(tx, TENANT_ID, { ...baseInput, daysOfWeek: [1, 3, 5] });

      const { sql, params } = compile(tx.execute.mock.calls[0][0]);
      expect(sql).toMatch(/ARRAY\[\s*\$\d+\s*,\s*\$\d+\s*,\s*\$\d+\s*\]::integer\[\]/);
      expect(params).toContain(1);
      expect(params).toContain(3);
      expect(params).toContain(5);
    });
  });
});

// ---------------------------------------------------------------------------
// findSubscriptionById
// ---------------------------------------------------------------------------

describe("findSubscriptionById", () => {
  it("returns the mapped subscription when one row matches", async () => {
    const tx = makeStubTx([[subRowFixture()]]);
    const result = await findSubscriptionById(tx, SUB_ID);
    expect(result?.id).toBe(SUB_ID);
    expect(result?.status).toBe("active");
  });

  it("returns null when zero rows match (not found OR RLS-hidden)", async () => {
    const tx = makeStubTx([[]]);
    const result = await findSubscriptionById(tx, SUB_ID);
    expect(result).toBeNull();
  });

  it("does NOT include an explicit tenant_id predicate (read-by-id has no blast radius beyond what RLS hides)", async () => {
    const tx = makeStubTx([[subRowFixture()]]);
    await findSubscriptionById(tx, SUB_ID);
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/SELECT \* FROM subscriptions/);
    expect(sql).toMatch(/WHERE id =/);
    expect(sql).not.toMatch(/tenant_id/);
  });
});

// ---------------------------------------------------------------------------
// listSubscriptionsByTenant
// ---------------------------------------------------------------------------

describe("listSubscriptionsByTenant", () => {
  it("returns mapped rows ordered by created_at DESC, scoped to tenantId in WHERE", async () => {
    const tx = makeStubTx([[subRowFixture({ id: "row-1" }), subRowFixture({ id: "row-2" })]]);
    const result = await listSubscriptionsByTenant(tx, TENANT_ID);

    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/WHERE tenant_id =/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toContain(TENANT_ID);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("row-1");
    expect(result[1].id).toBe("row-2");
  });

  it("returns an empty array when no rows match (tenant has no subscriptions yet)", async () => {
    const tx = makeStubTx([[]]);
    const result = await listSubscriptionsByTenant(tx, TENANT_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Day-23 §3.3.2 — listSubscriptionsByConsignee
// ---------------------------------------------------------------------------

describe("listSubscriptionsByConsignee", () => {
  it("scopes the SELECT to tenant_id AND consignee_id, newest first", async () => {
    const tx = makeStubTx([
      [
        subRowFixture({ id: "row-1", consignee_id: CONSIGNEE_ID }),
        subRowFixture({ id: "row-2", consignee_id: CONSIGNEE_ID }),
      ],
    ]);
    const result = await listSubscriptionsByConsignee(tx, TENANT_ID, CONSIGNEE_ID);

    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/WHERE tenant_id =/);
    expect(sql).toMatch(/AND consignee_id =/);
    expect(sql).toMatch(/ORDER BY created_at DESC/);
    expect(params).toContain(TENANT_ID);
    expect(params).toContain(CONSIGNEE_ID);

    expect(result.length).toBe(2);
    expect(result[0].id).toBe("row-1");
    expect(result[1].id).toBe("row-2");
  });

  it("returns an empty array when the consignee has no subscriptions yet", async () => {
    const tx = makeStubTx([[]]);
    const result = await listSubscriptionsByConsignee(tx, TENANT_ID, CONSIGNEE_ID);
    expect(result).toEqual([]);
  });

  it("does not surface rows belonging to a different consignee (predicate carries)", async () => {
    // The repository binds the consigneeId param into the WHERE; the
    // SQL string assertion above verifies the predicate is present, and
    // the mock returns only what would survive the filter. This test
    // double-checks that the bound consigneeId — not a hardcoded one —
    // is what actually goes to the driver.
    const tx = makeStubTx([[]]);
    await listSubscriptionsByConsignee(tx, TENANT_ID, OTHER_CONSIGNEE_ID);
    const { params } = compile(tx.execute.mock.calls[0][0]);
    expect(params).toContain(OTHER_CONSIGNEE_ID);
    expect(params).not.toContain(CONSIGNEE_ID);
  });
});

// ---------------------------------------------------------------------------
// Day-22 §3.22 Fix 1 — listSubscriptionsWithConsigneeByTenant
// ---------------------------------------------------------------------------

describe("listSubscriptionsWithConsigneeByTenant", () => {
  it("JOINs consignees + returns mapped { subscription, consigneeName } pairs newest-first", async () => {
    const tx = makeStubTx([
      [
        { ...subRowFixture({ id: "row-1" }), consignee_name: "Sarah Khouri" },
        { ...subRowFixture({ id: "row-2" }), consignee_name: "Love Mansukhani" },
      ],
    ]);

    const result = await listSubscriptionsWithConsigneeByTenant(tx, TENANT_ID);

    const { sql, params } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/FROM subscriptions s/);
    expect(sql).toMatch(/JOIN consignees c/);
    expect(sql).toMatch(/c\.tenant_id = s\.tenant_id/);
    expect(sql).toMatch(/WHERE s\.tenant_id =/);
    expect(sql).toMatch(/ORDER BY s\.created_at DESC/);
    expect(params).toContain(TENANT_ID);

    expect(result.length).toBe(2);
    expect(result[0].subscription.id).toBe("row-1");
    expect(result[0].consigneeName).toBe("Sarah Khouri");
    expect(result[1].subscription.id).toBe("row-2");
    expect(result[1].consigneeName).toBe("Love Mansukhani");
  });

  it("returns an empty array when the tenant has no subscriptions yet", async () => {
    const tx = makeStubTx([[]]);
    const result = await listSubscriptionsWithConsigneeByTenant(tx, TENANT_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateSubscription — empty patch + happy path + before/after capture
// ---------------------------------------------------------------------------

describe("updateSubscription", () => {
  it("empty patch short-circuits to a re-read (no UPDATE issued); before === after by reference", async () => {
    // Only one tx.execute call (the re-read). No UPDATE.
    const tx = makeStubTx([[subRowFixture()]]);
    const result = await updateSubscription(tx, TENANT_ID, SUB_ID, {});

    expect(tx.execute).toHaveBeenCalledTimes(1);
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/SELECT \* FROM subscriptions/);
    expect(sql).not.toMatch(/UPDATE subscriptions/);
    expect(sql).not.toMatch(/FOR UPDATE/);

    expect(result).not.toBeNull();
    expect(result!.before).toBe(result!.after); // referentially identical
  });

  it("returns null when the row does not exist (FOR UPDATE captured zero rows)", async () => {
    // First (FOR UPDATE) returns empty.
    const tx = makeStubTx([[]]);
    const result = await updateSubscription(tx, TENANT_ID, SUB_ID, {
      mealPlanName: "Anything",
    });

    expect(tx.execute).toHaveBeenCalledTimes(1);
    const { sql } = compile(tx.execute.mock.calls[0][0]);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(result).toBeNull();
  });

  it("single-field patch issues SELECT FOR UPDATE then UPDATE … RETURNING; returns before+after", async () => {
    const before = subRowFixture({ meal_plan_name: null });
    const after = subRowFixture({ meal_plan_name: "Daily Meals" });
    const tx = makeStubTx([[before], [after]]);

    const result = await updateSubscription(tx, TENANT_ID, SUB_ID, {
      mealPlanName: "Daily Meals",
    });

    expect(tx.execute).toHaveBeenCalledTimes(2);
    const select = compile(tx.execute.mock.calls[0][0]);
    expect(select.sql).toMatch(/SELECT \* FROM subscriptions/);
    expect(select.sql).toMatch(/AND tenant_id =/);
    expect(select.sql).toMatch(/FOR UPDATE/);
    expect(select.params).toContain(TENANT_ID);

    const update = compile(tx.execute.mock.calls[1][0]);
    expect(update.sql).toMatch(/UPDATE subscriptions SET/);
    expect(update.sql).toMatch(/meal_plan_name =/);
    expect(update.sql).toMatch(/AND tenant_id =/);
    expect(update.sql).toMatch(/RETURNING \*/);
    expect(update.params).toContain("Daily Meals");

    expect(result?.before.mealPlanName).toBeNull();
    expect(result?.after.mealPlanName).toBe("Daily Meals");
  });

  it("multi-field patch enumerates each column in SET, all in one UPDATE", async () => {
    const before = subRowFixture();
    const after = subRowFixture({
      consignee_id: OTHER_CONSIGNEE_ID,
      end_date: "2026-12-31",
      days_of_week: [2, 4],
      delivery_window_end: "18:00:00",
      meal_plan_name: "Updated Plan",
    });
    const tx = makeStubTx([[before], [after]]);

    const patch: UpdateSubscriptionPatch = {
      consigneeId: OTHER_CONSIGNEE_ID,
      endDate: "2026-12-31",
      daysOfWeek: [2, 4],
      deliveryWindowEnd: "18:00",
      mealPlanName: "Updated Plan",
    };
    const result = await updateSubscription(tx, TENANT_ID, SUB_ID, patch);

    const update = compile(tx.execute.mock.calls[1][0]);
    expect(update.sql).toMatch(/consignee_id =/);
    expect(update.sql).toMatch(/end_date =/);
    expect(update.sql).toMatch(/days_of_week =/);
    expect(update.sql).toMatch(/delivery_window_end =/);
    expect(update.sql).toMatch(/meal_plan_name =/);
    // Day-22 PM §4 FIX 1 regression guard — the days_of_week column
    // must be bound via ARRAY[…]::integer[], same as the INSERT path.
    expect(update.sql).toMatch(/days_of_week = ARRAY\[\s*\$\d+\s*,\s*\$\d+\s*\]::integer\[\]/);

    expect(result?.after.consigneeId).toBe(OTHER_CONSIGNEE_ID);
    expect(result?.after.endDate).toBe("2026-12-31");
    expect(result?.after.daysOfWeek).toEqual([2, 4]);
    expect(result?.after.deliveryWindowEnd).toBe("18:00:00");
    expect(result?.after.mealPlanName).toBe("Updated Plan");
  });

  it("passes explicit-null through SET to clear a previously-set nullable column", async () => {
    const before = subRowFixture({ meal_plan_name: "Daily Meals" });
    const after = subRowFixture({ meal_plan_name: null });
    const tx = makeStubTx([[before], [after]]);

    const result = await updateSubscription(tx, TENANT_ID, SUB_ID, {
      mealPlanName: null,
    });

    const update = compile(tx.execute.mock.calls[1][0]);
    expect(update.sql).toMatch(/meal_plan_name =/);
    expect(update.params).toContain(null);

    expect(result?.before.mealPlanName).toBe("Daily Meals");
    expect(result?.after.mealPlanName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// pauseSubscription / resumeSubscription / endSubscription
// ---------------------------------------------------------------------------

// pauseSubscription + resumeSubscription repository helpers DELETED at
// Day-16 Block 4-C — the new bounded-pause service in service.ts does
// the multi-table tx inline. These describe blocks were deleted with
// the helpers; service-layer tests for pause/resume now live at
// `service-lifecycle.spec.ts`.

describe("endSubscription", () => {
  it("transitions active → ended, sets ended_at, clears paused_at, returns before+after", async () => {
    const before = subRowFixture({ status: "active" });
    const after = subRowFixture({ status: "ended", ended_at: FIXED_NOW });
    const tx = makeStubTx([[before], [after]]);

    const result = await endSubscription(tx, TENANT_ID, SUB_ID);

    const update = compile(tx.execute.mock.calls[1][0]);
    expect(update.sql).toMatch(/status = 'ended'/);
    expect(update.sql).toMatch(/ended_at = now\(\)/);
    expect(update.sql).toMatch(/paused_at = NULL/);

    expect(result?.before.status).toBe("active");
    expect(result?.after.status).toBe("ended");
    expect(result?.after.endedAt).toBe(FIXED_ISO);
  });

  it("transitions paused → ended (clears paused_at on the way)", async () => {
    const before = subRowFixture({ status: "paused", paused_at: FIXED_NOW });
    const after = subRowFixture({
      status: "ended",
      paused_at: null,
      ended_at: FIXED_NOW,
    });
    const tx = makeStubTx([[before], [after]]);

    const result = await endSubscription(tx, TENANT_ID, SUB_ID);

    expect(result?.before.status).toBe("paused");
    expect(result?.before.pausedAt).toBe(FIXED_ISO);
    expect(result?.after.status).toBe("ended");
    expect(result?.after.pausedAt).toBeNull();
    expect(result?.after.endedAt).toBe(FIXED_ISO);
  });

  it("throws ConflictError when row is already ended (terminal)", async () => {
    const tx = makeStubTx([[subRowFixture({ status: "ended", ended_at: FIXED_NOW })]]);
    await expect(endSubscription(tx, TENANT_ID, SUB_ID)).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns null when row does not exist", async () => {
    const tx = makeStubTx([[]]);
    const result = await endSubscription(tx, TENANT_ID, SUB_ID);
    expect(result).toBeNull();
  });
});
