// Repository unit tests — T-2.
//
// Mirrors the C-2 consignees test pattern. Mocks `tx.execute` directly
// so SQL building, the row mapper, the multi-row VALUES clause for
// packages, and the partial-patch SET-clause logic can be exercised
// without a real Postgres connection. RLS / cross-tenant isolation +
// the schema-layer tenant-match trigger are proven separately in
// tests/integration/* — the unit tests here verify the *shape* of the
// queries we send (the defence-in-depth `tenant_id` predicate on
// update / delete, the json_agg packages subquery on read paths) and
// the repository's null-handling paths.

import { sql as sqlTag, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  deleteTask,
  findTaskById,
  insertTaskWithPackages,
  listTasksByTenant,
  updateTask,
} from "../repository";
import type { CreateTaskInput, UpdateTaskPatch } from "../types";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";
const OTHER_TENANT_ID = "00000000-0000-0000-0000-00000000000b";
const TASK_ID = "11111111-1111-1111-1111-111111111111";
const CONSIGNEE_ID = "22222222-2222-2222-2222-222222222222";
const PACKAGE_ID_1 = "33333333-3333-3333-3333-333333333333";
const PACKAGE_ID_2 = "44444444-4444-4444-4444-444444444444";

const FIXED_NOW = new Date("2026-04-30T10:00:00.000Z");
const FIXED_ISO = FIXED_NOW.toISOString();

const dialect = new PgDialect();

/** Compile a captured SQL object into its `$1`-bound text + params. */
function compile(query: unknown): { sql: string; params: unknown[] } {
  const compiled = dialect.sqlToQuery(query as SQL);
  return { sql: compiled.sql, params: compiled.params };
}

function taskRowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    tenant_id: TENANT_ID,
    consignee_id: CONSIGNEE_ID,
    subscription_id: null,
    created_via: "manual_admin" as const,
    customer_order_number: "ORDER-001",
    reference_number: null,
    internal_status: "CREATED" as const,
    external_id: null,
    external_tracking_number: null,
    delivery_date: "2026-05-01",
    delivery_start_time: "14:00:00",
    delivery_end_time: "16:00:00",
    delivery_type: "STANDARD",
    task_kind: "DELIVERY" as const,
    payment_method: null,
    cod_amount: null,
    declared_value: null,
    weight_kg: null,
    notes: null,
    signature_required: false,
    sms_notifications: false,
    deliver_to_customer_only: false,
    pushed_to_external_at: null,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

function taskRowWithPackagesFixture(
  packages: ReadonlyArray<Record<string, unknown>> = [],
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    ...taskRowFixture(overrides),
    packages,
  };
}

function packageRowFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PACKAGE_ID_1,
    task_id: TASK_ID,
    tenant_id: TENANT_ID,
    external_package_id: null,
    tracking_id: null,
    package_status: "ORDERED" as const,
    position: 0,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    ...overrides,
  };
}

/** JSON-aggregated package shape. Timestamps as strings (Postgres serialises
 *  timestamptz to ISO 8601 inside json_agg). */
function packageJsonFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PACKAGE_ID_1,
    task_id: TASK_ID,
    tenant_id: TENANT_ID,
    external_package_id: null,
    tracking_id: null,
    package_status: "ORDERED" as const,
    position: 0,
    created_at: FIXED_ISO,
    updated_at: FIXED_ISO,
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
  return { execute } as unknown as Parameters<typeof insertTaskWithPackages>[0] & {
    execute: ReturnType<typeof vi.fn>;
  };
}

describe("insertTaskWithPackages", () => {
  const baseInput: CreateTaskInput = {
    consigneeId: CONSIGNEE_ID,
    customerOrderNumber: "ORDER-001",
    deliveryDate: "2026-05-01",
    deliveryStartTime: "14:00",
    deliveryEndTime: "16:00",
    packages: [{ position: 0 }],
  };

  it("issues two execute() calls (task INSERT then packages INSERT) and returns the mapped task with packages", async () => {
    const tx = makeStubTx([[taskRowFixture()], [packageRowFixture()]]);
    const result = await insertTaskWithPackages(tx, TENANT_ID, baseInput);

    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(TASK_ID);
    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.internalStatus).toBe("CREATED");
    expect(result.taskKind).toBe("DELIVERY");
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].id).toBe(PACKAGE_ID_1);
    expect(result.packages[0].position).toBe(0);
    expect(result.packages[0].packageStatus).toBe("ORDERED");
  });

  it("skips the packages INSERT when packages is empty (single execute call)", async () => {
    const tx = makeStubTx([[taskRowFixture()]]);
    const result = await insertTaskWithPackages(tx, TENANT_ID, {
      ...baseInput,
      packages: [],
    });
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result.packages).toEqual([]);
  });

  it("inserts packages with the same tenant_id as the parent task (feeds the schema-layer trigger consistently)", async () => {
    const tx = makeStubTx([[taskRowFixture()], [packageRowFixture()]]);
    await insertTaskWithPackages(tx, TENANT_ID, baseInput);

    // Second execute is the packages INSERT. The bound params must
    // include TENANT_ID exactly once per package (the multi-row VALUES
    // clause repeats the tenant_id literal per row). One package here
    // means one TENANT_ID occurrence in the VALUES portion.
    const captured = compile(tx.execute.mock.calls[1][0]);
    expect(captured.sql).toMatch(/INSERT INTO task_packages/i);
    expect(captured.sql).toMatch(/VALUES/i);
    expect(captured.params).toContain(TENANT_ID);
  });

  it("emits a multi-row VALUES clause when multiple packages are supplied", async () => {
    const tx = makeStubTx([
      [taskRowFixture()],
      [
        packageRowFixture({ id: PACKAGE_ID_1, position: 0 }),
        packageRowFixture({ id: PACKAGE_ID_2, position: 1 }),
      ],
    ]);
    const result = await insertTaskWithPackages(tx, TENANT_ID, {
      ...baseInput,
      packages: [{ position: 0 }, { position: 1 }],
    });

    expect(result.packages).toHaveLength(2);
    expect(result.packages[0].position).toBe(0);
    expect(result.packages[1].position).toBe(1);

    // Multi-row VALUES form: the captured SQL must contain a
    // comma-separated VALUES list, not two separate INSERT statements.
    const captured = compile(tx.execute.mock.calls[1][0]);
    expect(captured.sql).toMatch(/VALUES\s*\(/i);
    // The position params (0 and 1) both need to be bound.
    expect(captured.params).toContain(0);
    expect(captured.params).toContain(1);
  });

  it("re-orders package rows by position before mapping (DB return order is not authoritative)", async () => {
    // Postgres may return INSERT … RETURNING in any order without an
    // ORDER BY. The repository sorts by position; verify the mapped
    // packages array is sorted regardless of the row order returned.
    const tx = makeStubTx([
      [taskRowFixture()],
      [
        packageRowFixture({ id: PACKAGE_ID_2, position: 1 }),
        packageRowFixture({ id: PACKAGE_ID_1, position: 0 }),
      ],
    ]);
    const result = await insertTaskWithPackages(tx, TENANT_ID, {
      ...baseInput,
      packages: [{ position: 0 }, { position: 1 }],
    });
    expect(result.packages.map((p) => p.position)).toEqual([0, 1]);
  });

  it("converts undefined optional fields into NULL and applies SQL defaults via the omitted columns path", async () => {
    const tx = makeStubTx([[taskRowFixture()], [packageRowFixture()]]);
    const result = await insertTaskWithPackages(tx, TENANT_ID, baseInput);

    // Defaults applied via the input's `??` fallbacks: internal_status
    // -> CREATED, task_kind -> DELIVERY, delivery_type -> STANDARD,
    // boolean fields -> false. The fixture mirrors what the DB would
    // return after those defaults land.
    expect(result.internalStatus).toBe("CREATED");
    expect(result.taskKind).toBe("DELIVERY");
    expect(result.deliveryType).toBe("STANDARD");
    expect(result.signatureRequired).toBe(false);
    expect(result.smsNotifications).toBe(false);
    expect(result.deliverToCustomerOnly).toBe(false);
    expect(result.subscriptionId).toBeNull();
    expect(result.paymentMethod).toBeNull();
    expect(result.codAmount).toBeNull();
    expect(result.weightKg).toBeNull();
  });

  it("throws if the task INSERT … RETURNING produces zero rows", async () => {
    const tx = makeStubTx([[]]);
    await expect(insertTaskWithPackages(tx, TENANT_ID, baseInput)).rejects.toThrow(/zero rows/);
  });
});

describe("findTaskById", () => {
  it("returns the mapped task with packages when one exists", async () => {
    const tx = makeStubTx([
      [
        taskRowWithPackagesFixture([packageJsonFixture({ id: PACKAGE_ID_1, position: 0 })], {
          customer_order_number: "ORDER-X",
        }),
      ],
    ]);
    const result = await findTaskById(tx, TASK_ID);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(result?.customerOrderNumber).toBe("ORDER-X");
    expect(result?.packages).toHaveLength(1);
    expect(result?.packages[0].id).toBe(PACKAGE_ID_1);
  });

  it("returns null when the row is missing or hidden by RLS", async () => {
    const tx = makeStubTx([[]]);
    const result = await findTaskById(tx, TASK_ID);
    expect(result).toBeNull();
  });

  it("returns a task with empty packages when the json_agg subquery produced an empty array", async () => {
    const tx = makeStubTx([[taskRowWithPackagesFixture([])]]);
    const result = await findTaskById(tx, TASK_ID);
    expect(result?.packages).toEqual([]);
  });

  it("issues a single execute call carrying the json_agg packages subquery", async () => {
    const tx = makeStubTx([[]]);
    await findTaskById(tx, TASK_ID);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/SELECT/i);
    expect(captured.sql).toMatch(/json_agg/i);
    expect(captured.sql).toMatch(/FROM task_packages tp/i);
    expect(captured.sql).toMatch(/ORDER BY tp\."?position"?\s+ASC/i);
  });
});

describe("listTasksByTenant", () => {
  it("returns mapped rows in input order", async () => {
    const tx = makeStubTx([
      [
        taskRowWithPackagesFixture([], { id: "row-1", customer_order_number: "First" }),
        taskRowWithPackagesFixture([], { id: "row-2", customer_order_number: "Second" }),
      ],
    ]);
    const result = await listTasksByTenant(tx, TENANT_ID);
    expect(result).toHaveLength(2);
    expect(result[0].customerOrderNumber).toBe("First");
    expect(result[1].customerOrderNumber).toBe("Second");
  });

  it("returns an empty array when the tenant has no tasks", async () => {
    const tx = makeStubTx([[]]);
    const result = await listTasksByTenant(tx, TENANT_ID);
    expect(result).toEqual([]);
  });

  it("includes the tenant_id predicate alongside RLS (defence in depth)", async () => {
    const tx = makeStubTx([[]]);
    await listTasksByTenant(tx, TENANT_ID);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/tenant_id\s*=\s*\$/i);
    expect(captured.params).toContain(TENANT_ID);
  });
});

describe("updateTask", () => {
  it("issues UPDATE with the defence-in-depth tenant_id predicate then re-fetches packages", async () => {
    const tx = makeStubTx([
      [taskRowFixture({ customer_order_number: "Renamed" })],
      [packageRowFixture()],
    ]);
    const patch: UpdateTaskPatch = { customerOrderNumber: "Renamed" };
    const result = await updateTask(tx, TENANT_ID, TASK_ID, patch);

    expect(tx.execute).toHaveBeenCalledTimes(2);
    const updateCaptured = compile(tx.execute.mock.calls[0][0]);
    expect(updateCaptured.sql).toMatch(/UPDATE tasks/i);
    expect(updateCaptured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(updateCaptured.params).toContain(TENANT_ID);
    expect(updateCaptured.params).toContain(TASK_ID);
    expect(result?.customerOrderNumber).toBe("Renamed");
    expect(result?.packages).toHaveLength(1);
  });

  it("falls through to a tenant-scoped SELECT-with-packages when patch is empty (no UPDATE issued)", async () => {
    const tx = makeStubTx([
      [taskRowWithPackagesFixture([packageJsonFixture()], { customer_order_number: "ORDER-001" })],
    ]);
    const result = await updateTask(tx, TENANT_ID, TASK_ID, {});

    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/^\s*SELECT/i);
    expect(captured.sql).toMatch(/where\s+t\.id\s*=\s*\$\d+\s+and\s+t\.tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(result?.id).toBe(TASK_ID);
    expect(result?.packages).toHaveLength(1);
  });

  it("empty-patch updateTask returns the same shape as findTaskById for the same id", async () => {
    // Pins the empty-patch contract: an empty patch is "return current
    // state, byte-identical to a fresh read." Prevents a future
    // optimisation from drifting one path's mapped shape from the other.
    //
    // Both functions go through the same SELECT-with-json_agg form and
    // the same mapTaskWithPackages mapper, so the asserted shape equality
    // is a structural guarantee — not coincidence. If a future commit
    // changes one mapper but not the other (e.g., adds a derived field
    // to findTaskById without updating the empty-patch path), this test
    // catches it before merge.
    const sharedRow = taskRowWithPackagesFixture(
      [
        packageJsonFixture({ id: PACKAGE_ID_1, position: 0 }),
        packageJsonFixture({ id: PACKAGE_ID_2, position: 1 }),
      ],
      {
        customer_order_number: "ORDER-CONTRACT",
        reference_number: "REF-9",
        payment_method: "PrePaid",
        cod_amount: "42.50",
        weight_kg: "1.250",
        signature_required: true,
      }
    );

    const txUpdate = makeStubTx([[sharedRow]]);
    const txFind = makeStubTx([[sharedRow]]);

    const updateResult = await updateTask(txUpdate, TENANT_ID, TASK_ID, {});
    const findResult = await findTaskById(txFind, TASK_ID);

    expect(updateResult).not.toBeNull();
    expect(findResult).not.toBeNull();
    // Deep equality across every field, including the packages array
    // (which both code paths deserialise via mapPackageFromJson).
    expect(updateResult).toEqual(findResult);
  });

  it("returns null when the row is missing, RLS-hidden, or tenant_id mismatch", async () => {
    const tx = makeStubTx([[]]);
    const result = await updateTask(tx, OTHER_TENANT_ID, TASK_ID, { customerOrderNumber: "ghost" });
    expect(result).toBeNull();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(OTHER_TENANT_ID);
  });

  it("includes every present scalar field in the SET clause", async () => {
    const tx = makeStubTx([
      [
        taskRowFixture({
          customer_order_number: "n",
          reference_number: "r",
          internal_status: "ASSIGNED" as const,
          delivery_date: "2026-05-02",
          delivery_start_time: "10:00:00",
          delivery_end_time: "12:00:00",
          delivery_type: "EXPRESS",
          task_kind: "PICKUP" as const,
          payment_method: "PrePaid",
          cod_amount: "100.00",
          declared_value: "200.00",
          weight_kg: "1.500",
          notes: "x",
          signature_required: true,
          sms_notifications: true,
          deliver_to_customer_only: true,
        }),
      ],
      [],
    ]);

    const result = await updateTask(tx, TENANT_ID, TASK_ID, {
      customerOrderNumber: "n",
      referenceNumber: "r",
      internalStatus: "ASSIGNED",
      deliveryDate: "2026-05-02",
      deliveryStartTime: "10:00",
      deliveryEndTime: "12:00",
      deliveryType: "EXPRESS",
      taskKind: "PICKUP",
      paymentMethod: "PrePaid",
      codAmount: "100.00",
      declaredValue: "200.00",
      weightKg: "1.500",
      notes: "x",
      signatureRequired: true,
      smsNotifications: true,
      deliverToCustomerOnly: true,
    });

    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(result?.customerOrderNumber).toBe("n");
    expect(result?.referenceNumber).toBe("r");
    expect(result?.internalStatus).toBe("ASSIGNED");
    expect(result?.taskKind).toBe("PICKUP");
    expect(result?.signatureRequired).toBe(true);
  });
});

describe("deleteTask", () => {
  it("issues DELETE with the defence-in-depth tenant_id predicate and returns true on a deleted row", async () => {
    const result = Object.assign([], { count: 1 });
    const tx = makeStubTx([result]);
    const ok = await deleteTask(tx, TENANT_ID, TASK_ID);

    expect(ok).toBe(true);
    expect(tx.execute).toHaveBeenCalledOnce();
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.sql).toMatch(/DELETE FROM tasks/i);
    expect(captured.sql).toMatch(/where\s+id\s*=\s*\$\d+\s+and\s+tenant_id\s*=\s*\$\d+/i);
    expect(captured.params).toContain(TENANT_ID);
    expect(captured.params).toContain(TASK_ID);
  });

  it("returns false when no row was deleted (unknown id, cross-tenant id, or RLS hides)", async () => {
    const result = Object.assign([], { count: 0 });
    const tx = makeStubTx([result]);
    expect(await deleteTask(tx, OTHER_TENANT_ID, TASK_ID)).toBe(false);
    const captured = compile(tx.execute.mock.calls[0][0]);
    expect(captured.params).toContain(OTHER_TENANT_ID);
  });

  it("falls back to array length when the result has no `count` property", async () => {
    const tx = makeStubTx([[]]);
    expect(await deleteTask(tx, TENANT_ID, TASK_ID)).toBe(false);
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
    const q = sqlTag`SELECT * FROM tasks WHERE id = ${TASK_ID} AND tenant_id = ${TENANT_ID}`;
    const { sql, params } = compile(q);
    expect(sql).toMatch(/id\s*=\s*\$1\s+AND\s+tenant_id\s*=\s*\$2/i);
    expect(params).toEqual([TASK_ID, TENANT_ID]);
  });
});
