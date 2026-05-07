// tests/integration/list-visible-task-ids.spec.ts
// =============================================================================
// Day-17 hotfix — drizzle/postgres-js array-binding regression pin for
// listVisibleTaskIds (src/modules/tasks/repository.ts:385).
//
// Bug class: sqlTag`WHERE id = ANY(${jsArr}::uuid[])` template
// substitution produces a malformed array literal (single-element,
// Postgres 22P02) or a record/tuple splat (multi-element, Postgres
// 42846). Fix: replace ANY(${arr}::uuid[]) with
// IN (SELECT unnest(${arr}::uuid[])) — the unnest() wrapper coerces
// the bound parameter to a Postgres array regardless of element count.
//
// This bug class is invisible at the unit-test layer because mocked
// repos never exercise real Postgres parameter binding. Real-Postgres
// integration coverage is the only regression-grade signal — see
// memory/followup_repo_layer_integration_coverage_discipline.md.
//
// Cases pinned:
//   1. Single ID in array → returns 1 row (the multi-element bug fires
//      identically here under the broken pattern; pinned to catch
//      either form of the bug class)
//   2. 50 IDs → returns 50 rows (bulk path)
//   3. 100 IDs (route-layer cap) → returns 100 rows
//   4. Empty array → returns [] via early-return (guard-clause path)
//   5. Cross-tenant filter — IDs from another tenant not returned
//   6. Mix of valid + non-existent IDs — only valid IDs returned
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { listVisibleTaskIds } from "../../src/modules/tasks/repository";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `lvti-${RUN_ID}-a`;
const SLUG_B = `lvti-${RUN_ID}-b`;

const TENANT_A_TASK_IDS: string[] = [];
const TENANT_B_TASK_IDS: string[] = [];

describe("Day-17 hotfix — listVisibleTaskIds drizzle array-binding", () => {
  beforeAll(async () => {
    await withServiceRole("hotfix integration setup", async (tx) => {
      // Two tenants, each with N seeded tasks. TENANT_A gets 100 tasks
      // (route-layer cap) so all the array-size cases can pull from
      // one pool.
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'LVTI Test A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'LVTI Test B', 'active')
      `);

      // Seed one consignee per tenant; tasks reference the tenant's
      // consignee.
      const consigneeA = randomUUID();
      const consigneeB = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${consigneeA}, ${TENANT_A}, 'LVTI Consignee A', ${`lvti-${RUN_ID}-a-1`}, 'Addr A', 'Dubai', 'District A'),
          (${consigneeB}, ${TENANT_B}, 'LVTI Consignee B', ${`lvti-${RUN_ID}-b-1`}, 'Addr B', 'Dubai', 'District B')
      `);

      // Seed 100 tasks for TENANT_A and 5 for TENANT_B (cross-tenant
      // filter test).
      for (let i = 0; i < 100; i++) {
        const taskId = randomUUID();
        TENANT_A_TASK_IDS.push(taskId);
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time, created_via
          ) VALUES (
            ${taskId}, ${TENANT_A}, ${consigneeA}, ${`LVTI-A-${RUN_ID}-${i}`},
            '2026-05-01', '14:00', '16:00', 'manual_admin'
          )
        `);
      }
      for (let i = 0; i < 5; i++) {
        const taskId = randomUUID();
        TENANT_B_TASK_IDS.push(taskId);
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time, created_via
          ) VALUES (
            ${taskId}, ${TENANT_B}, ${consigneeB}, ${`LVTI-B-${RUN_ID}-${i}`},
            '2026-05-01', '14:00', '16:00', 'manual_admin'
          )
        `);
      }
    });
  });

  // No afterAll teardown — `audit_events_no_delete` RULE on tenants
  // blocks DELETE cascade per memory/followup_audit_rule_cascade_conflict.md.
  // Random per-run UUIDs prevent cross-run collisions; established
  // pattern matches tests/integration/task-packages-tenant-match.spec.ts.

  it("returns 1 row for single-element array (the bug class fires here under the broken pattern)", async () => {
    const result = await withServiceRole("hotfix test single", async (tx) => {
      return await listVisibleTaskIds(tx, TENANT_A as Uuid, [TENANT_A_TASK_IDS[0]] as readonly Uuid[]);
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(TENANT_A_TASK_IDS[0]);
  });

  it("returns 50 rows for 50-element array (bulk path)", async () => {
    const requested = TENANT_A_TASK_IDS.slice(0, 50) as readonly Uuid[];
    const result = await withServiceRole("hotfix test 50", async (tx) => {
      return await listVisibleTaskIds(tx, TENANT_A as Uuid, requested);
    });
    expect(result).toHaveLength(50);
    expect(new Set(result)).toEqual(new Set(requested));
  });

  it("returns 100 rows for 100-element array (route-layer cap)", async () => {
    const requested = TENANT_A_TASK_IDS as readonly Uuid[];
    const result = await withServiceRole("hotfix test 100", async (tx) => {
      return await listVisibleTaskIds(tx, TENANT_A as Uuid, requested);
    });
    expect(result).toHaveLength(100);
    expect(new Set(result)).toEqual(new Set(requested));
  });

  it("returns [] for empty input (guard-clause early return)", async () => {
    const result = await withServiceRole("hotfix test empty", async (tx) => {
      return await listVisibleTaskIds(tx, TENANT_A as Uuid, [] as readonly Uuid[]);
    });
    expect(result).toEqual([]);
  });

  it("filters out IDs from another tenant (cross-tenant scoping preserved)", async () => {
    // Submit tenant-B task IDs while filter is tenant-A — should
    // return empty.
    const result = await withServiceRole("hotfix test cross-tenant", async (tx) => {
      return await listVisibleTaskIds(tx, TENANT_A as Uuid, TENANT_B_TASK_IDS as readonly Uuid[]);
    });
    expect(result).toEqual([]);
  });

  it("returns only valid IDs when input mixes valid and non-existent IDs", async () => {
    const nonExistent = [randomUUID(), randomUUID(), randomUUID()];
    const mixed = [...TENANT_A_TASK_IDS.slice(0, 3), ...nonExistent] as readonly Uuid[];
    const result = await withServiceRole("hotfix test mixed", async (tx) => {
      return await listVisibleTaskIds(tx, TENANT_A as Uuid, mixed);
    });
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(new Set(TENANT_A_TASK_IDS.slice(0, 3)));
  });
});
