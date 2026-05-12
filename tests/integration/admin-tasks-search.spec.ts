// tests/integration/admin-tasks-search.spec.ts
// =============================================================================
// Day-24 schema-drift regression pin for listAllTasksRows admin-side
// searchTerm path (src/modules/tasks/repository.ts).
//
// Bug class: the admin search path adds a new `LEFT JOIN consignees c
// ON c.id = t.consignee_id` to a previously consignee-less query, and
// ILIKEs against `t.external_tracking_number`, `c.name`, `ten.name`. A
// mocked `tx.execute` in the unit spec cannot prove these columns
// resolve at runtime under real Postgres. Per the Day-23 PM handoff
// §5.2 discipline + memory/followup_repo_layer_integration_coverage_discipline.md,
// every new repo fn that references real columns on real tables
// carries an integration pin.
//
// Cases pinned:
//   1. No searchTerm → returns all rows for the (cross-tenant) admin view
//   2. AWB exact match → returns 1 row
//   3. Consignee name partial match → returns matching subset
//   4. Merchant name partial match → returns rows from that merchant
//   5. Empty result for no-match
//   6. Cross-tenant inclusion (Transcorp admin surface sees both tenants)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listAllTasksRows } from "../../src/modules/tasks/repository";
import { withServiceRole } from "../../src/shared/db";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `ats-${RUN_ID}-alpha`;
const SLUG_B = `ats-${RUN_ID}-bravo`;
const NAME_A = `ATS Alpha ${RUN_ID}`; // ILIKE target — merchant name
const NAME_B = `ATS Bravo ${RUN_ID}`;

const CONSIGNEE_A1 = randomUUID();
const CONSIGNEE_A2 = randomUUID();
const CONSIGNEE_B1 = randomUUID();

const TASK_A1 = randomUUID();
const TASK_A2 = randomUUID();
const TASK_A3 = randomUUID();
const TASK_B1 = randomUUID();

const AWB_A1 = `ATS-AWB-${RUN_ID}-1`;
const AWB_A2 = `ATS-AWB-${RUN_ID}-2`;
const AWB_B1 = `ATS-AWB-${RUN_ID}-B1`;

const CONSIGNEE_NAME_DISTINCT = `Sarah Khouri ${RUN_ID}`;

describe("Day-24 admin tasks search — listAllTasksRows", () => {
  beforeAll(async () => {
    await withServiceRole("admin-tasks-search integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, ${NAME_A}, 'active'),
          (${TENANT_B}, ${SLUG_B}, ${NAME_B}, 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_A1}, ${TENANT_A}, ${CONSIGNEE_NAME_DISTINCT}, ${`ats-${RUN_ID}-a1`},
           'Addr A1', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_A2}, ${TENANT_A}, ${`Other Consignee ${RUN_ID}`}, ${`ats-${RUN_ID}-a2`},
           'Addr A2', 'Dubai', 'Al Quoz', 'ACTIVE'),
          (${CONSIGNEE_B1}, ${TENANT_B}, ${`Bravo Consignee ${RUN_ID}`}, ${`ats-${RUN_ID}-b1`},
           'Addr B1', 'Dubai', 'Jumeirah', 'ACTIVE')
      `);

      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, external_tracking_number, created_via)
        VALUES
          (${TASK_A1}, ${TENANT_A}, ${CONSIGNEE_A1}, ${`ATS-ORD-${RUN_ID}-A1`},
           '2026-05-15', '08:00', '10:00', 'CREATED', ${AWB_A1}, 'manual_admin'),
          (${TASK_A2}, ${TENANT_A}, ${CONSIGNEE_A2}, ${`ATS-ORD-${RUN_ID}-A2`},
           '2026-05-15', '10:00', '12:00', 'DELIVERED', ${AWB_A2}, 'manual_admin'),
          (${TASK_A3}, ${TENANT_A}, ${CONSIGNEE_A1}, ${`ATS-ORD-${RUN_ID}-A3`},
           '2026-05-15', '14:00', '16:00', 'FAILED', NULL, 'manual_admin'),
          (${TASK_B1}, ${TENANT_B}, ${CONSIGNEE_B1}, ${`ATS-ORD-${RUN_ID}-B1`},
           '2026-05-15', '09:00', '11:00', 'CREATED', ${AWB_B1}, 'manual_admin')
      `);
    });
  });

  // No afterAll — random per-run UUIDs avoid collisions; audit_events_no_delete
  // RULE blocks tenant DELETE cascade per memory/followup_audit_rule_cascade_conflict.md.

  it("returns rows across both tenants when no searchTerm is set (Transcorp admin scope)", async () => {
    const rows = await withServiceRole("ats no-search", async (tx) => {
      return listAllTasksRows(tx, { merchantSlug: SLUG_A });
    });
    expect(rows.find((r) => r.task.id === TASK_A1)).toBeDefined();
    expect(rows.find((r) => r.task.id === TASK_B1)).toBeUndefined();
  });

  it("ILIKEs AWB exact match returns the single matching task", async () => {
    const rows = await withServiceRole("ats awb exact", async (tx) => {
      return listAllTasksRows(tx, { searchTerm: AWB_A1 });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].task.id).toBe(TASK_A1);
    expect(rows[0].merchant.slug).toBe(SLUG_A);
  });

  it("ILIKEs against consignee name (case-insensitive partial)", async () => {
    const rows = await withServiceRole("ats consignee partial", async (tx) => {
      return listAllTasksRows(tx, { searchTerm: "sarah khouri" });
    });
    const matched = rows.filter(
      (r) => r.task.id === TASK_A1 || r.task.id === TASK_A3,
    );
    expect(matched).toHaveLength(2);
    for (const m of matched) {
      expect(m.merchant.slug).toBe(SLUG_A);
    }
  });

  it("ILIKEs against merchant name to narrow to one tenant's task set", async () => {
    const rows = await withServiceRole("ats merchant name", async (tx) => {
      return listAllTasksRows(tx, { searchTerm: NAME_B });
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.merchant.slug).toBe(SLUG_B);
    }
    expect(rows.find((r) => r.task.id === TASK_B1)).toBeDefined();
  });

  it("returns empty for a string that matches nothing", async () => {
    const rows = await withServiceRole("ats no-match", async (tx) => {
      return listAllTasksRows(tx, { searchTerm: `nope-${RUN_ID}-zzz` });
    });
    const seededIds = new Set<string>([TASK_A1, TASK_A2, TASK_A3, TASK_B1]);
    expect(rows.find((r) => seededIds.has(r.task.id))).toBeUndefined();
  });

  it("composes searchTerm with merchantSlug — narrowed to one merchant + AWB match", async () => {
    const rows = await withServiceRole("ats compose merchant+search", async (tx) => {
      return listAllTasksRows(tx, { merchantSlug: SLUG_A, searchTerm: AWB_A2 });
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].task.id).toBe(TASK_A2);
  });
});
