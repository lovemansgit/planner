// tests/integration/admin-tasks-count.spec.ts
// =============================================================================
// Day-24 PM schema-drift regression pin for countAllTasksRows
// (src/modules/tasks/repository.ts).
//
// New SQL path: SELECT COUNT(*) on the same FROM/JOIN/WHERE topology
// as listAllTasksRows. Per Day-23 §F discipline, every new repo fn
// that references real columns on real tables carries a real-Postgres
// pin (mocked tx.execute can't catch column-name drift or RLS-vs-
// service-role interaction).
//
// Cases pinned:
//   1. empty filter set returns the full unfiltered count
//   2. status filter narrows
//   3. merchantSlug narrows
//   4. dateFrom alone narrows (≥ predicate inclusive)
//   5. dateTo alone narrows (≤ predicate inclusive)
//   6. both date bounds narrow to the inclusive window
//   7. searchTerm narrows
//   8. all filters composed narrow correctly
//   9. archived tenants excluded (ten.status != 'archived')
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countAllTasksRows } from "../../src/modules/tasks/repository";
import { withServiceRole } from "../../src/shared/db";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_LIVE = randomUUID();
const TENANT_ARCHIVED = randomUUID();
const SLUG_LIVE = `atc-${RUN_ID}-live`;
const SLUG_ARCHIVED = `atc-${RUN_ID}-arch`;

const CONSIGNEE_LIVE = randomUUID();
const CONSIGNEE_ARCHIVED = randomUUID();

// Four tasks on the live tenant across three dates + one task on the
// archived tenant (proves the archive filter excludes).
const TASK_MAY01_CREATED = randomUUID();
const TASK_MAY10_DELIVERED = randomUUID();
const TASK_MAY15_FAILED_1 = randomUUID();
const TASK_MAY15_FAILED_2 = randomUUID();
const TASK_ARCHIVED = randomUUID();

const AWB_MAY01 = `ATC-AWB-${RUN_ID}-1`;
const AWB_MAY10 = `ATC-AWB-${RUN_ID}-2`;

const SARAH_NAME = `Sarah Khouri ${RUN_ID}`;

describe("Day-24 PM count pin — countAllTasksRows", () => {
  beforeAll(async () => {
    await withServiceRole("admin-tasks-count integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_LIVE}, ${SLUG_LIVE}, ${`ATC Live ${RUN_ID}`}, 'active'),
          (${TENANT_ARCHIVED}, ${SLUG_ARCHIVED}, ${`ATC Archived ${RUN_ID}`}, 'archived')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_LIVE}, ${TENANT_LIVE}, ${SARAH_NAME}, ${`atc-${RUN_ID}-l`},
           'Addr L', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_ARCHIVED}, ${TENANT_ARCHIVED}, ${`Archived Person ${RUN_ID}`}, ${`atc-${RUN_ID}-a`},
           'Addr A', 'Dubai', 'Al Quoz', 'ACTIVE')
      `);

      await tx.execute(sqlTag`
        INSERT INTO tasks
          (id, tenant_id, consignee_id, customer_order_number,
           delivery_date, delivery_start_time, delivery_end_time,
           internal_status, external_tracking_number, created_via)
        VALUES
          (${TASK_MAY01_CREATED}, ${TENANT_LIVE}, ${CONSIGNEE_LIVE}, ${`ATC-${RUN_ID}-1`},
           '2026-05-01', '08:00', '10:00', 'CREATED', ${AWB_MAY01}, 'manual_admin'),
          (${TASK_MAY10_DELIVERED}, ${TENANT_LIVE}, ${CONSIGNEE_LIVE}, ${`ATC-${RUN_ID}-2`},
           '2026-05-10', '10:00', '12:00', 'DELIVERED', ${AWB_MAY10}, 'manual_admin'),
          (${TASK_MAY15_FAILED_1}, ${TENANT_LIVE}, ${CONSIGNEE_LIVE}, ${`ATC-${RUN_ID}-3`},
           '2026-05-15', '09:00', '11:00', 'FAILED', NULL, 'manual_admin'),
          (${TASK_MAY15_FAILED_2}, ${TENANT_LIVE}, ${CONSIGNEE_LIVE}, ${`ATC-${RUN_ID}-4`},
           '2026-05-15', '14:00', '16:00', 'FAILED', NULL, 'manual_admin'),
          (${TASK_ARCHIVED}, ${TENANT_ARCHIVED}, ${CONSIGNEE_ARCHIVED}, ${`ATC-${RUN_ID}-arch`},
           '2026-05-15', '09:00', '11:00', 'CREATED', NULL, 'manual_admin')
      `);
    });
  });

  // No afterAll — random per-run UUIDs prevent cross-run collisions.

  async function count(filters: Parameters<typeof countAllTasksRows>[1] = {}): Promise<number> {
    return withServiceRole("atc test", async (tx) => countAllTasksRows(tx, filters));
  }

  it("empty filter set returns at least the 4 live-tenant seeded tasks", async () => {
    const result = await count();
    expect(result).toBeGreaterThanOrEqual(4);
  });

  it("merchantSlug narrows to the live tenant's seeded set (4 tasks)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE })).toBe(4);
  });

  it("excludes archived tenant rows (merchantSlug = archived returns 0)", async () => {
    expect(await count({ merchantSlug: SLUG_ARCHIVED })).toBe(0);
  });

  it("status filter narrows correctly (DELIVERED → 1 on live tenant)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, status: "DELIVERED" })).toBe(1);
  });

  it("status FAILED → 2 on live tenant", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, status: "FAILED" })).toBe(2);
  });

  it("dateFrom alone narrows (>= 2026-05-10 → 3 on live tenant)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, dateFrom: "2026-05-10" })).toBe(3);
  });

  it("dateTo alone narrows (<= 2026-05-10 → 2 on live tenant)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, dateTo: "2026-05-10" })).toBe(2);
  });

  it("both date bounds narrow to inclusive window (2026-05-15 → 2 on live tenant)", async () => {
    expect(
      await count({ merchantSlug: SLUG_LIVE, dateFrom: "2026-05-15", dateTo: "2026-05-15" }),
    ).toBe(2);
  });

  it("searchTerm matches AWB partial (1 row on live tenant)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: AWB_MAY01 })).toBe(1);
  });

  it("searchTerm matches consignee name (all 4 tasks point to same consignee)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: SARAH_NAME })).toBe(4);
  });

  it("all filters composed narrow correctly (live + 2026-05-15 + FAILED + Sarah → 2)", async () => {
    expect(
      await count({
        merchantSlug: SLUG_LIVE,
        dateFrom: "2026-05-15",
        dateTo: "2026-05-15",
        status: "FAILED",
        searchTerm: SARAH_NAME,
      }),
    ).toBe(2);
  });
});
