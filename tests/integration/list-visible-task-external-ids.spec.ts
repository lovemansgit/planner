// tests/integration/list-visible-task-external-ids.spec.ts
// =============================================================================
// Day-17 hotfix #1B — listVisibleTaskExternalIds returns the
// (id, external_id, pushed_to_external_at) triple for tenant-visible
// rows. Powers printLabelsForTasks's Planner-UUID -> SF-external-id
// translation (per memory/followup_planner_uuid_to_sf_external_id_translation.md).
//
// Cases pinned:
//   1. Single ID with non-null external_id — returns triple
//   2. 5 IDs mix of null + non-null external_id — returns 5 triples;
//      nulls preserved per row (NOT filtered at the repo layer; the
//      service layer partitions)
//   3. Cross-tenant filtering — IDs from another tenant excluded
//   4. Empty array — returns [] (early-return guard)
//   5. All non-existent IDs — returns []
//   6. Pattern E array binding works for single + multi inputs
//      (regression pin against the bug class fixed in PR #170)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { listVisibleTaskExternalIds } from "../../src/modules/tasks/repository";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `lvtei-${RUN_ID}-a`;
const SLUG_B = `lvtei-${RUN_ID}-b`;

// 5 tasks in TENANT_A: 3 with external_id set, 2 pre-push.
const TENANT_A_PUSHED_TASK_IDS: string[] = [];
const TENANT_A_PREPUSH_TASK_IDS: string[] = [];
const TENANT_B_PUSHED_TASK_ID = randomUUID();

describe("Day-17 hotfix #1B — listVisibleTaskExternalIds", () => {
  beforeAll(async () => {
    await withServiceRole("hotfix-1B integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'LVTEI Test A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'LVTEI Test B', 'active')
      `);

      const consigneeA = randomUUID();
      const consigneeB = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${consigneeA}, ${TENANT_A}, 'LVTEI Consignee A', ${`lvtei-${RUN_ID}-a-1`}, 'Addr A', 'Dubai', 'District A'),
          (${consigneeB}, ${TENANT_B}, 'LVTEI Consignee B', ${`lvtei-${RUN_ID}-b-1`}, 'Addr B', 'Dubai', 'District B')
      `);

      // 3 PUSHED tasks (external_id set, pushed_to_external_at set).
      for (let i = 0; i < 3; i++) {
        const taskId = randomUUID();
        const externalId = `${10000 + i}`;
        TENANT_A_PUSHED_TASK_IDS.push(taskId);
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            external_id, pushed_to_external_at, created_via
          ) VALUES (
            ${taskId}, ${TENANT_A}, ${consigneeA}, ${`LVTEI-A-PUSHED-${RUN_ID}-${i}`},
            '2026-05-01', '14:00', '16:00',
            ${externalId}, ${'2026-05-05T07:55:19.321Z'}, 'manual_admin'
          )
        `);
      }

      // 2 PRE-PUSH tasks (external_id NULL, pushed_to_external_at NULL).
      for (let i = 0; i < 2; i++) {
        const taskId = randomUUID();
        TENANT_A_PREPUSH_TASK_IDS.push(taskId);
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via
          ) VALUES (
            ${taskId}, ${TENANT_A}, ${consigneeA}, ${`LVTEI-A-PREPUSH-${RUN_ID}-${i}`},
            '2026-05-01', '14:00', '16:00', 'manual_admin'
          )
        `);
      }

      // 1 TENANT_B task — pushed (cross-tenant filter target).
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          delivery_date, delivery_start_time, delivery_end_time,
          external_id, pushed_to_external_at, created_via
        ) VALUES (
          ${TENANT_B_PUSHED_TASK_ID}, ${TENANT_B}, ${consigneeB}, ${`LVTEI-B-PUSHED-${RUN_ID}`},
          '2026-05-01', '14:00', '16:00',
          '99999', ${'2026-05-05T07:55:19.321Z'}, 'manual_admin'
        )
      `);
    });
  });

  // No afterAll teardown — `audit_events_no_delete` RULE on tenants
  // blocks DELETE cascade; random per-run UUIDs prevent collisions.
  // Same pattern as PR #170 hotfix integration tests.

  it("returns 1 triple for a single pushed task ID (Pattern E single-element regression pin)", async () => {
    const result = await withServiceRole("hotfix-1B test single", async (tx) => {
      return await listVisibleTaskExternalIds(
        tx,
        TENANT_A as Uuid,
        [TENANT_A_PUSHED_TASK_IDS[0]] as readonly Uuid[],
      );
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(TENANT_A_PUSHED_TASK_IDS[0]);
    expect(result[0].externalId).toBe("10000");
    expect(result[0].pushedToExternalAt).toBe("2026-05-05T07:55:19.321Z");
  });

  it("returns 5 triples for mixed pushed + pre-push input; preserves nulls per row", async () => {
    const all = [
      ...TENANT_A_PUSHED_TASK_IDS,
      ...TENANT_A_PREPUSH_TASK_IDS,
    ] as readonly Uuid[];
    const result = await withServiceRole("hotfix-1B test mixed", async (tx) => {
      return await listVisibleTaskExternalIds(tx, TENANT_A as Uuid, all);
    });
    expect(result).toHaveLength(5);

    const pushed = result.filter((r) => r.externalId !== null);
    const prepush = result.filter((r) => r.externalId === null);
    expect(pushed).toHaveLength(3);
    expect(prepush).toHaveLength(2);

    // Pushed rows have BOTH columns non-null.
    for (const row of pushed) {
      expect(row.pushedToExternalAt).not.toBeNull();
    }
    // Pre-push rows have BOTH columns null.
    for (const row of prepush) {
      expect(row.pushedToExternalAt).toBeNull();
    }
  });

  it("filters out IDs from another tenant", async () => {
    const result = await withServiceRole("hotfix-1B test cross-tenant", async (tx) => {
      return await listVisibleTaskExternalIds(
        tx,
        TENANT_A as Uuid,
        [TENANT_B_PUSHED_TASK_ID] as readonly Uuid[],
      );
    });
    expect(result).toEqual([]);
  });

  it("returns [] for empty input (guard-clause early return)", async () => {
    const result = await withServiceRole("hotfix-1B test empty", async (tx) => {
      return await listVisibleTaskExternalIds(tx, TENANT_A as Uuid, [] as readonly Uuid[]);
    });
    expect(result).toEqual([]);
  });

  it("returns [] for input with only non-existent IDs", async () => {
    const nonExistent = [randomUUID(), randomUUID(), randomUUID()] as readonly Uuid[];
    const result = await withServiceRole("hotfix-1B test non-existent", async (tx) => {
      return await listVisibleTaskExternalIds(tx, TENANT_A as Uuid, nonExistent);
    });
    expect(result).toEqual([]);
  });
});
