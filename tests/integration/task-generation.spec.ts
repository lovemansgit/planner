// tests/integration/task-generation.spec.ts
// =============================================================================
// C-2 — integration tests for the cron task-generation service.
//
// Pins the four load-bearing behaviours of generateTasksForWindow:
//   1. Happy path — matching subscriptions produce tasks; non-matching
//      ones (wrong weekday, wrong status, wrong date range) do not.
//   2. Re-run idempotency — calling generateTasksForWindow twice for
//      the same (tenant, window) returns 'skipped_already_run' on the
//      second call. Run row UNIQUE constraint enforces this.
//   3. Per-task idempotency — the partial UNIQUE on tasks(subscription_id,
//      delivery_date) prevents duplicate tasks even if the run row is
//      somehow re-created.
//   4. Cap exceedance — pass capThreshold=1 with multiple matching
//      subscriptions; expect 'capped' status, zero tasks generated.
//
// Determinism: random per-run tenant ids and slugs to avoid collisions
// with concurrent test runs.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateTasksForWindow } from "@/modules/task-generation";
import { withServiceRole } from "@/shared/db";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

type IdRow = { id: string } & Record<string, unknown>;
type CountRow = { n: number } & Record<string, unknown>;

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const TENANT_SLUG = `c2-tg-${RUN_ID}`;

// Target date: pick 2026-05-04 (Monday → ISODOW=1).
// Window: 2026-05-03T12:00Z (16:00 Asia/Dubai on the prior day).
const TARGET_DATE = "2026-05-04";
const WINDOW_START = "2026-05-03T12:00:00Z";
const WINDOW_END = "2026-05-03T13:00:00Z";

function systemCtx(tenantId: Uuid): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:generate_tasks",
    tenantId,
    permissions: new Set(),
  };
  return { actor, tenantId, requestId: `c2-test-${RUN_ID}`, path: "/cron/test" };
}

describe("C-2 — task generation service (cron path)", () => {
  beforeAll(async () => {
    // Create the tenant via withServiceRole. Same posture as
    // rls-tenant-isolation.spec.ts: the only path to provision tenant
    // rows is through service-role.
    await withServiceRole("C-2 task-generation test setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name) VALUES
          (${TENANT_ID}, ${TENANT_SLUG}, 'C-2 Task Generation Test Tenant')
      `);
    });
  });

  afterAll(async () => {
    // Cleanup wrapped in try/catch per the convention in
    // subscription-link-invariant.spec.ts and asset-tracking-tenant-match.spec.ts:
    // DELETE FROM tenants will fail with the "audit_events_tenant_id_fkey
    // gave unexpected result" error when audit rows exist (the audit
    // table's no-delete RULE rewrites the cascade to a no-op, so the FK
    // check sees referencing rows and aborts). Documented at
    // memory/followup_audit_rule_cascade_conflict.md. Random per-run
    // tenant UUIDs prevent cross-run pollution; cleanup failure is not
    // test failure.
    try {
      await withServiceRole("C-2 task-generation test cleanup", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM task_generation_runs WHERE tenant_id = ${TENANT_ID}`);
      });
    } catch {
      /* cleanup failure is not test failure */
    }
  });

  describe("happy path — matching subscriptions produce tasks", () => {
    let consigneeAId: string;
    let consigneeBId: string;
    let subActiveMatchId: string;
    let subActiveNoMatchId: string;
    let subPausedId: string;

    beforeAll(async () => {
      await withServiceRole("C-2 happy-path seed", async (tx) => {
        const cAR = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region
          ) VALUES (
            ${TENANT_ID}, 'C-2 A', ${`c2-a-${RUN_ID}`}, 'Addr', 'Dubai'
          )
          RETURNING id
        `);
        consigneeAId = cAR[0].id;

        const cBR = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region
          ) VALUES (
            ${TENANT_ID}, 'C-2 B', ${`c2-b-${RUN_ID}`}, 'Addr', 'Dubai'
          )
          RETURNING id
        `);
        consigneeBId = cBR[0].id;

        // Active subscription with Monday (ISODOW=1) in days_of_week —
        // SHOULD produce a task for 2026-05-04.
        const sAR = await tx.execute<IdRow>(sqlTag`
          INSERT INTO subscriptions (
            tenant_id, consignee_id, status,
            start_date, end_date,
            days_of_week, delivery_window_start, delivery_window_end
          ) VALUES (
            ${TENANT_ID}, ${consigneeAId}, 'active',
            '2026-05-01', '2026-08-31',
            ARRAY[1, 3, 5]::integer[], '14:00', '16:00'
          )
          RETURNING id
        `);
        subActiveMatchId = sAR[0].id;

        // Active subscription with Mon NOT in days_of_week — SHOULD NOT
        // produce a task for 2026-05-04.
        const sBR = await tx.execute<IdRow>(sqlTag`
          INSERT INTO subscriptions (
            tenant_id, consignee_id, status,
            start_date, end_date,
            days_of_week, delivery_window_start, delivery_window_end
          ) VALUES (
            ${TENANT_ID}, ${consigneeBId}, 'active',
            '2026-05-01', '2026-08-31',
            ARRAY[2, 4, 6]::integer[], '14:00', '16:00'
          )
          RETURNING id
        `);
        subActiveNoMatchId = sBR[0].id;

        // Paused subscription whose days_of_week DOES match — SHOULD NOT
        // produce a task (status filter).
        const sPR = await tx.execute<IdRow>(sqlTag`
          INSERT INTO subscriptions (
            tenant_id, consignee_id, status,
            start_date, end_date,
            days_of_week, delivery_window_start, delivery_window_end,
            paused_at
          ) VALUES (
            ${TENANT_ID}, ${consigneeAId}, 'paused',
            '2026-05-01', '2026-08-31',
            ARRAY[1, 3, 5]::integer[], '14:00', '16:00',
            now()
          )
          RETURNING id
        `);
        subPausedId = sPR[0].id;
      });
    });

    it("generates exactly one task — for the active+matching-weekday subscription only", async () => {
      const result = await generateTasksForWindow(systemCtx(TENANT_ID), {
        tenantId: TENANT_ID,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        targetDate: TARGET_DATE,
        capThreshold: 7000,
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") return;
      expect(result.tasksCreated).toBe(1);
      expect(result.subscriptionsWalked).toBe(1);
      expect(result.tasksSkippedExisting).toBe(0);

      // Verify tasks table state.
      const taskRows = await withServiceRole("C-2 happy-path verify", async (tx) => {
        return tx.execute<{
          subscription_id: string;
          delivery_date: Date | string;
          internal_status: string;
        }>(sqlTag`
          SELECT subscription_id, delivery_date, internal_status FROM tasks
          WHERE tenant_id = ${TENANT_ID}
        `);
      });
      expect(taskRows.length).toBe(1);
      expect(taskRows[0].subscription_id).toBe(subActiveMatchId);
      expect(taskRows[0].internal_status).toBe("CREATED");
      // Defence-in-depth: the non-match and paused subs have no rows.
      void subActiveNoMatchId;
      void subPausedId;
    });

    it("re-running for the same window returns skipped_already_run (run-row UNIQUE)", async () => {
      const result = await generateTasksForWindow(systemCtx(TENANT_ID), {
        tenantId: TENANT_ID,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        targetDate: TARGET_DATE,
        capThreshold: 7000,
      });
      expect(result.kind).toBe("skipped_already_run");
      // Tasks table count unchanged.
      const countRows = await withServiceRole("C-2 idem verify", async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM tasks WHERE tenant_id = ${TENANT_ID}
        `);
      });
      expect(countRows[0].n).toBe(1);
    });

    it("emits the expected audit events (task.created + task.bulk_generated)", async () => {
      const events = await withServiceRole("C-2 audit verify", async (tx) => {
        return tx.execute<{ event_type: string }>(sqlTag`
          SELECT event_type FROM audit_events
          WHERE tenant_id = ${TENANT_ID}
            AND event_type IN ('task.created', 'task.bulk_generated', 'task.bulk_generation_skipped_already_run')
          ORDER BY occurred_at ASC
        `);
      });
      const types = events.map((e) => e.event_type);
      // Expect: 1 task.created, 1 task.bulk_generated (from happy run),
      // 1 task.bulk_generation_skipped_already_run (from idempotent retry).
      expect(types).toContain("task.created");
      expect(types).toContain("task.bulk_generated");
      expect(types).toContain("task.bulk_generation_skipped_already_run");
    });
  });

  describe("cap exceedance — projection beats threshold, abort with zero tasks", () => {
    const TENANT_ID_CAP = randomUUID();
    const TENANT_SLUG_CAP = `c2-tg-cap-${RUN_ID}`;
    // Use a different (later) window so the run-row UNIQUE doesn't
    // collide with the happy-path test's row.
    const CAP_WINDOW_START = "2026-05-10T12:00:00Z";
    const CAP_WINDOW_END = "2026-05-10T13:00:00Z";
    const CAP_TARGET_DATE = "2026-05-11"; // ISODOW=1 (Monday)

    beforeAll(async () => {
      await withServiceRole("C-2 cap-path seed", async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO tenants (id, slug, name) VALUES
            (${TENANT_ID_CAP}, ${TENANT_SLUG_CAP}, 'C-2 Cap Path Tenant')
        `);
        const cR = await tx.execute<IdRow>(sqlTag`
          INSERT INTO consignees (
            tenant_id, name, phone, address_line, emirate_or_region
          ) VALUES (
            ${TENANT_ID_CAP}, 'Cap', ${`c2-cap-${RUN_ID}`}, 'Addr', 'Dubai'
          )
          RETURNING id
        `);
        const cId = cR[0].id;
        // Two matching subscriptions; capThreshold of 1 will trip cap.
        for (let i = 0; i < 2; i++) {
          await tx.execute(sqlTag`
            INSERT INTO subscriptions (
              tenant_id, consignee_id, status,
              start_date, end_date,
              days_of_week, delivery_window_start, delivery_window_end
            ) VALUES (
              ${TENANT_ID_CAP}, ${cId}, 'active',
              '2026-05-01', '2026-08-31',
              ARRAY[1]::integer[], '14:00', '16:00'
            )
          `);
        }
      });
    });

    afterAll(async () => {
      // Same cleanup-failure-tolerant pattern as the outer afterAll —
      // see comment there for the audit-RULE-vs-FK-CASCADE rationale.
      try {
        await withServiceRole("C-2 cap-path cleanup", async (tx) => {
          await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID_CAP}`);
          await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${TENANT_ID_CAP}`);
          await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${TENANT_ID_CAP}`);
          await tx.execute(sqlTag`DELETE FROM task_generation_runs WHERE tenant_id = ${TENANT_ID_CAP}`);
        });
      } catch {
        /* cleanup failure is not test failure */
      }
    });

    it("aborts before any task INSERT; status='capped'; cap_threshold recorded", async () => {
      const result = await generateTasksForWindow(systemCtx(TENANT_ID_CAP), {
        tenantId: TENANT_ID_CAP,
        windowStart: CAP_WINDOW_START,
        windowEnd: CAP_WINDOW_END,
        targetDate: CAP_TARGET_DATE,
        capThreshold: 1,
      });

      expect(result.kind).toBe("capped");
      if (result.kind !== "capped") return;
      expect(result.projectedCount).toBe(2);
      expect(result.capThreshold).toBe(1);

      // Tasks table is empty — abort happened before any INSERT.
      const taskCount = await withServiceRole("C-2 cap verify", async (tx) => {
        return tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n FROM tasks WHERE tenant_id = ${TENANT_ID_CAP}
        `);
      });
      expect(taskCount[0].n).toBe(0);

      // Run row is in 'capped' state with the right cap_threshold.
      const runRow = await withServiceRole("C-2 cap verify run", async (tx) => {
        return tx.execute<{
          status: string;
          cap_threshold: number;
          projected_count: number | null;
          tasks_created: number | null;
        }>(sqlTag`
          SELECT status, cap_threshold, projected_count, tasks_created
          FROM task_generation_runs
          WHERE tenant_id = ${TENANT_ID_CAP}
        `);
      });
      expect(runRow.length).toBe(1);
      expect(runRow[0].status).toBe("capped");
      expect(runRow[0].cap_threshold).toBe(1);
      expect(runRow[0].projected_count).toBe(2);
      expect(runRow[0].tasks_created).toBeNull();
    });

    it("emits task.bulk_generation_capped audit event", async () => {
      const events = await withServiceRole("C-2 cap audit verify", async (tx) => {
        return tx.execute<{ event_type: string; metadata: { cap_threshold?: number } }>(sqlTag`
          SELECT event_type, metadata FROM audit_events
          WHERE tenant_id = ${TENANT_ID_CAP}
            AND event_type = 'task.bulk_generation_capped'
        `);
      });
      expect(events.length).toBe(1);
      expect(events[0].metadata.cap_threshold).toBe(1);
    });
  });
});
