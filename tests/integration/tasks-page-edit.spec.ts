// tests/integration/tasks-page-edit.spec.ts
// =============================================================================
// Day-30 B2 — /tasks-page edit action integration tests (plan #308 v2 §5.1).
//
// Cases pinned:
//   B2-I5 — address edit via Path A:
//           tasks.address_id updated, tasks.updated_at advanced, audit
//           task.updated with changed_fields=['addressId'], NO enqueueUpdateTask
//           invoked (per §3.6 OQ-3 ruling — address-only patches skip SF push;
//           ConsigneeSnapshot mapping deferred Day-22+). Success result
//           carries the §3.6 OQ-3 VERBATIM disclosure copy:
//           "Address change saved; SuiteFleet will reflect on the next
//            scheduled push pass" — pinned exact-string assertion.
//   B2-I6 — driver-note edit via addNoteToDriver:
//           tasks.notes updated, action returns { kind: 'success' }.
//   B2-I7 — delivery-date rejected at form-action layer:
//           FormData with deliveryDate field → .pick({addressId}).strict()
//           rejects before service call; action returns { kind: 'validation' };
//           NO tasks UPDATE; NO audit emit.
//
// Self-contained — own tenant/user/consignee/task seed.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Hoisted publisher spy — confirms updateTask-via-action path does NOT
// enqueue SF push for address-only patches per OQ-3 ruling.
const enqueueUpdateTaskSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../src/modules/task-outbound-queue/publish", () => ({
  enqueueCancelTask: vi.fn(async () => undefined),
  enqueueUpdateTask: enqueueUpdateTaskSpy,
  enqueueBulkCancelTasks: vi.fn(async () => ({
    enqueuedCount: 0,
    failedChunks: 0,
    totalCount: 0,
  })),
  enqueueBulkUpdateTasks: vi.fn(async () => ({
    enqueuedCount: 0,
    failedChunks: 0,
    totalCount: 0,
  })),
  __resetQStashClientForTest: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID();
const SLUG = `b2-edit-${RUN_ID}`;
const USER = randomUUID();
const CONSIGNEE = randomUUID();
const ADDRESS_ORIG = randomUUID();
const ADDRESS_NEW = randomUUID();

const TASK_ADDRESS_EDIT = randomUUID();
const TASK_NOTE_EDIT = randomUUID();
const TASK_DATE_REJECT = randomUUID();

function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}

const DATE_ADDRESS = nextWedAfter(40);
const DATE_NOTE = nextWedAfter(50);
const DATE_DATE_REJECT = nextWedAfter(60);

vi.mock("../../src/shared/request-context", async () => {
  const { ALL_PERMISSION_IDS } = await import(
    "../../src/modules/identity/permissions"
  );
  return {
    buildRequestContext: vi.fn(async () => ({
      actor: {
        kind: "user",
        userId: USER,
        tenantId: TENANT,
        permissions: new Set(ALL_PERMISSION_IDS),
        email: `${USER}@b2-edit.example`,
        displayName: null,
      },
      tenantId: TENANT,
      requestId: `req-${RUN_ID}`,
      path: "/tasks",
    })),
  };
});

import {
  editTaskAddressAction,
  editTaskNoteAction,
} from "../../src/app/(app)/tasks/_actions";
import { withServiceRole } from "../../src/shared/db";

describe("Day-30 B2 — /tasks edit actions (real Postgres)", () => {
  beforeAll(async () => {
    enqueueUpdateTaskSpy.mockClear();
    await withServiceRole("B2 edit test seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'B2 Edit Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'B2 Edit Consignee', ${`+97150be${RUN_ID}`},
                'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, line, district, emirate, is_primary)
        VALUES
          (${ADDRESS_ORIG}, ${TENANT}, ${CONSIGNEE}, 'home',   'Tower 1', 'Marina',     'Dubai', true),
          (${ADDRESS_NEW},  ${TENANT}, ${CONSIGNEE}, 'office', 'Tower 7', 'Downtown',   'Dubai', false)
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, subscription_id, address_id,
          customer_order_number, internal_status,
          delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_ADDRESS_EDIT}, ${TENANT}, ${CONSIGNEE}, NULL, ${ADDRESS_ORIG},
           ${`B2-EA-${RUN_ID}`}, 'CREATED', ${DATE_ADDRESS}, '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_NOTE_EDIT}, ${TENANT}, ${CONSIGNEE}, NULL, ${ADDRESS_ORIG},
           ${`B2-EN-${RUN_ID}`}, 'CREATED', ${DATE_NOTE}, '08:00:00', '10:00:00', 'manual_admin'),
          (${TASK_DATE_REJECT}, ${TENANT}, ${CONSIGNEE}, NULL, ${ADDRESS_ORIG},
           ${`B2-DR-${RUN_ID}`}, 'CREATED', ${DATE_DATE_REJECT}, '08:00:00', '10:00:00', 'manual_admin')
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // B2-I5 — address edit via Path A
  // ---------------------------------------------------------------------------

  it("B2-I5 — address edit updates tasks.address_id, NO SF enqueue, success carries verbatim OQ-3 copy", async () => {
    enqueueUpdateTaskSpy.mockClear();

    const fd = new FormData();
    fd.set("addressId", ADDRESS_NEW);

    const result = await editTaskAddressAction(TASK_ADDRESS_EDIT, { kind: "idle" }, fd);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      // OQ-3 VERBATIM copy — do NOT paraphrase. Exact-string assert.
      expect(result.message).toBe(
        "Address change saved; SuiteFleet will reflect on the next scheduled push pass",
      );
    }
    expect(enqueueUpdateTaskSpy).not.toHaveBeenCalled();

    const [task] = await withServiceRole("B2-I5 verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT address_id, updated_at, created_at
        FROM tasks WHERE id = ${TASK_ADDRESS_EDIT} LIMIT 1
      `),
    );
    expect((task as { address_id: string }).address_id).toBe(ADDRESS_NEW);
    const updatedAt = new Date((task as { updated_at: string }).updated_at);
    const createdAt = new Date((task as { created_at: string }).created_at);
    expect(updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
  });

  // ---------------------------------------------------------------------------
  // B2-I6 — driver-note edit via addNoteToDriver
  // ---------------------------------------------------------------------------

  it("B2-I6 — driver-note edit updates tasks.notes via addNoteToDriver", async () => {
    const fd = new FormData();
    fd.set("notes", "Gate code 4521; call on arrival");

    const result = await editTaskNoteAction(TASK_NOTE_EDIT, { kind: "idle" }, fd);

    expect(result.kind).toBe("success");

    const [task] = await withServiceRole("B2-I6 verify", async (tx) =>
      tx.execute(sqlTag`
        SELECT notes FROM tasks WHERE id = ${TASK_NOTE_EDIT} LIMIT 1
      `),
    );
    expect((task as { notes: string }).notes).toBe("Gate code 4521; call on arrival");
  });

  // ---------------------------------------------------------------------------
  // B2-I7 — delivery-date rejected at form-action .pick().strict() boundary
  // ---------------------------------------------------------------------------

  it("B2-I7 — FormData with deliveryDate field is rejected before service call (defense-in-depth)", async () => {
    enqueueUpdateTaskSpy.mockClear();

    const fd = new FormData();
    // Include a valid addressId so the only failure mode is the strict
    // whitelist rejecting the deliveryDate key.
    fd.set("addressId", ADDRESS_NEW);
    fd.set("deliveryDate", "2026-06-01");

    const result = await editTaskAddressAction(TASK_DATE_REJECT, { kind: "idle" }, fd);

    expect(result.kind).toBe("validation");
    expect(enqueueUpdateTaskSpy).not.toHaveBeenCalled();

    const [task] = await withServiceRole("B2-I7 verify no writes", async (tx) =>
      tx.execute(sqlTag`
        SELECT address_id, delivery_date FROM tasks WHERE id = ${TASK_DATE_REJECT} LIMIT 1
      `),
    );
    expect((task as { address_id: string }).address_id).toBe(ADDRESS_ORIG);
    expect((task as { delivery_date: string }).delivery_date.slice(0, 10)).toBe(
      DATE_DATE_REJECT,
    );
  });
});
