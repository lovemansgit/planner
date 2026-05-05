// tests/integration/cron-decoupling-happy-path.spec.ts
// =============================================================================
// §7.4 — happy-path integration test per merged plan PR #145
// memory/plans/day-14-cron-decoupling.md §7.4.
//
// Single end-to-end test exercising the full ingress → queue → egress
// pipeline against mocked QStash + mocked pushSingleTask. The 10 plan
// steps in order:
//
//   1. Pre-seed 1 tenant + 1 active subscription with rotation set up
//   2. Pre-seed 1 backlog task (pushed_to_external_at IS NULL,
//      address_id IS NOT NULL) — Phase 1 reconciliation candidate
//   3. Trigger materialization cron handler (test-invoked GET)
//   4. Assert: 1 backlog row + 14 newly-materialized rows = 15 tasks
//      now exist for the tenant (sub.days_of_week = [1..7] + 14-day
//      horizon = 14 new)
//   5. Assert: post-commit batchJSON called once (≤100 messages, all 15
//      fit in 1 batch); each message carries deduplicationId, flowControl,
//      retries, failureCallback per §1.1 + §6.3 + §5.2
//   6. Assert: subscription_materialization.materialized_through_date
//      advanced to target_date
//   7. Assert: task_generation_runs row exists with status='completed',
//      target_date set, tasks_created=14
//   8. Trigger the push handler with one of the 15 messages (test-
//      invoked POST to /api/queue/push-task)
//   9. Assert: pushSingleTask invoked; markTaskPushed via mock impl;
//      pushed_to_external_at set on that task; 200 returned
//   10. Assert: structured outcome 'success' returned
//
// Mocking strategy (matches §7.2 unit conventions, lifted to integration):
//   - server-only no-op
//   - @upstash/qstash Client constructable + capturable batchJSON
//   - @upstash/qstash/nextjs verifySignatureAppRouter passthrough
//   - listCronEligibleTenantIds restricted to the test tenant (avoids
//     cross-tenant pollution from other CI integration suites)
//   - pushSingleTask mocked to perform real markTaskPushed write +
//     return succeeded — exercises the real DB-write contract surface
//     while keeping SF adapter + credentials resolver out of scope
//
// All other dependencies (materializeTenant, listReconciliationCandidatesByTenant,
// enqueueTaskPushBatch, findTaskById, markTaskPushed, withServiceRole) run
// against real postgres-js + real DB.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const batchJSONSpy = vi.hoisted(() => vi.fn());

vi.mock("@upstash/qstash", () => ({
  Client: function MockClient(this: { batchJSON: typeof batchJSONSpy }) {
    this.batchJSON = batchJSONSpy;
  },
}));

// QStash signature gate — passthrough so the test can invoke POST
// without computing a real Upstash signature.
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

// Restrict the cron handler's tenant-eligibility scan to the test
// tenant only — prevents cross-test pollution if other integration
// suites left tenants in the CI DB.
const eligibleTenantIdsSpy = vi.hoisted(() => vi.fn());
vi.mock(
  "../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants",
  () => ({
    listCronEligibleTenantIds: eligibleTenantIdsSpy,
  }),
);

// pushSingleTask mocked to (a) be observable and (b) perform the real
// markTaskPushed write — exercising the DB contract surface that the
// real implementation exposes without pulling in SF adapter/credential
// resolver complexity.
const pushSingleTaskSpy = vi.hoisted(() => vi.fn());
vi.mock("../../src/modules/task-push", () => ({
  pushSingleTask: pushSingleTaskSpy,
}));

// Imports AFTER mocks; route modules read env vars at module-load time
// for some imports (QStash Client constructor especially).
import { GET as cronGet } from "../../src/app/api/cron/generate-tasks/route";
import { POST as pushPost } from "../../src/app/api/queue/push-task/route";
import { withServiceRole } from "../../src/shared/db";
import { markTaskPushed } from "../../src/modules/tasks/repository";
import type { SinglePushOutcome } from "../../src/modules/task-push/types";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const SLUG = `d14-e2e-${RUN_ID}`;
const SUITEFLEET_CUSTOMER_CODE = `E2E-${RUN_ID}`;

// Compute target_date deterministically at test time using the same
// dubai-date logic the handler uses. Avoids fake-timer interaction with
// the postgres-js driver (the driver uses real setTimeout for connection
// timeouts; mocking timers globally would freeze those).
//
// expectedTargetDate = today_in_dubai + 14
// matThrough         = expectedTargetDate - 14 (so 14 net-new tasks
//                      materialize when days_of_week=[1..7])
function isoDubaiDate(now: Date): string {
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      dubai.getUTCFullYear(),
      dubai.getUTCMonth(),
      dubai.getUTCDate(),
    ),
  )
    .toISOString()
    .slice(0, 10);
}
function isoDubaiDatePlus(now: Date, daysOffset: number): string {
  const dubai = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      dubai.getUTCFullYear(),
      dubai.getUTCMonth(),
      dubai.getUTCDate() + daysOffset,
    ),
  )
    .toISOString()
    .slice(0, 10);
}
const NOW_AT_SETUP = new Date();
const EXPECTED_TARGET_DATE = isoDubaiDatePlus(NOW_AT_SETUP, 14);
const MAT_THROUGH = isoDubaiDate(NOW_AT_SETUP);
// SUB_START must be ≤ MAT_THROUGH+1 so generate_series picks up the day
// after MAT_THROUGH (otherwise GREATEST(mat+1, start_date) = start_date
// and the first day or two of the horizon are dropped).
const SUB_START = isoDubaiDatePlus(NOW_AT_SETUP, -7);
const SUB_END = isoDubaiDatePlus(NOW_AT_SETUP, 60);

describe("§7.4 — cron decoupling happy-path E2E", () => {
  let consigneeId: Uuid;
  let primaryAddressId: Uuid;
  let subscriptionId: Uuid;
  let backlogTaskId: Uuid;

  beforeAll(async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.PUBLIC_BASE_URL = "https://test.example.com";
    process.env.QSTASH_TOKEN = "test-qstash-token";
    process.env.QSTASH_FLOW_CONTROL_KEY = "sf-push-test-e2e";

    eligibleTenantIdsSpy.mockResolvedValue([TENANT_ID]);
    batchJSONSpy.mockResolvedValue(undefined);

    // pushSingleTask mock: writes markTaskPushed via real DB then returns succeeded.
    pushSingleTaskSpy.mockImplementation(
      async (
        ctx: { tenantId: Uuid },
        taskId: Uuid,
      ): Promise<SinglePushOutcome> => {
        await withServiceRole("§7.4 mock pushSingleTask mark", (tx) =>
          markTaskPushed(
            tx,
            ctx.tenantId,
            taskId,
            "ext-e2e-mock-id",
            "TRACK-E2E-MOCK",
          ),
        );
        return {
          kind: "succeeded",
          externalId: "ext-e2e-mock-id",
          trackingNumber: "TRACK-E2E-MOCK",
        };
      },
    );

    // Seed tenant with suitefleet_customer_code (the eligibility-filter
    // intent is preserved even though the spy bypasses the filter — the
    // tenant must still have a customer_code for pushSingleTask's
    // tenant-config check to pass on the real-DB side).
    await withServiceRole("§7.4 seed tenant", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
        VALUES (
          ${TENANT_ID}, ${SLUG}, '§7.4 e2e tenant',
          ${SUITEFLEET_CUSTOMER_CODE}
        )
      `);
    });

    await withServiceRole("§7.4 seed sub + materialization + backlog", async (tx) => {
      const c = await tx.execute<{ id: Uuid }>(sqlTag`
        INSERT INTO consignees (
          tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${TENANT_ID}, 'E2E Consignee',
          ${`phone-${RUN_ID}`}, 'Addr', 'Dubai', 'District'
        ) RETURNING id
      `);
      consigneeId = c[0].id;

      const a = await tx.execute<{ id: Uuid }>(sqlTag`
        INSERT INTO addresses (
          tenant_id, consignee_id, label, is_primary, line, district, emirate
        ) VALUES (
          ${TENANT_ID}, ${consigneeId}, 'home', true,
          'Primary Addr', 'District', 'Dubai'
        ) RETURNING id
      `);
      primaryAddressId = a[0].id;

      // days_of_week = [1..7] (every day) → 14 new tasks over the
      // 14-day horizon.
      const s = await tx.execute<{ id: Uuid }>(sqlTag`
        INSERT INTO subscriptions (
          tenant_id, consignee_id, status,
          start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${TENANT_ID}, ${consigneeId}, 'active',
          ${SUB_START}::date, ${SUB_END}::date,
          ARRAY[1,2,3,4,5,6,7]::integer[], '09:00', '11:00'
        ) RETURNING id
      `);
      subscriptionId = s[0].id;

      await tx.execute(sqlTag`
        INSERT INTO subscription_materialization
          (subscription_id, tenant_id, materialized_through_date)
        VALUES
          (${subscriptionId}, ${TENANT_ID}, ${MAT_THROUGH}::date)
      `);

      // Step 2: 1 cutover-backlog task — pushed_to_external_at IS NULL,
      // address_id IS NOT NULL — the exact shape Phase 1 reconciliation
      // selects. subscription_id NULL with created_via='manual_admin'
      // satisfies the tasks_creation_source_invariant CHECK; the partial
      // UNIQUE on (subscription_id, delivery_date) doesn't apply for
      // subscription_id IS NULL.
      const backlogDate = isoDubaiDatePlus(NOW_AT_SETUP, -30);
      const t = await tx.execute<{ id: Uuid }>(sqlTag`
        INSERT INTO tasks (
          tenant_id, consignee_id, subscription_id, customer_order_number,
          created_via,
          delivery_date, delivery_start_time, delivery_end_time,
          address_id
        ) VALUES (
          ${TENANT_ID}, ${consigneeId}, NULL,
          ${`E2E-BACKLOG-${RUN_ID}`},
          'manual_admin',
          ${backlogDate}::date, '09:00', '11:00',
          ${primaryAddressId}
        ) RETURNING id
      `);
      backlogTaskId = t[0].id;
    });

  });

  afterAll(async () => {
    delete process.env.CRON_SECRET;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_FLOW_CONTROL_KEY;
    try {
      await withServiceRole("§7.4 teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`
          DELETE FROM subscription_materialization WHERE tenant_id = ${TENANT_ID}
        `);
        await tx.execute(sqlTag`
          DELETE FROM subscriptions WHERE tenant_id = ${TENANT_ID}
        `);
        await tx.execute(sqlTag`DELETE FROM addresses WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`
          DELETE FROM task_generation_runs WHERE tenant_id = ${TENANT_ID}
        `);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("step 3-7: cron handler materializes + enqueues 1 backlog + 14 new tasks", async () => {
    const cronReq = new Request(
      "https://test.example.com/api/cron/generate-tasks",
      { headers: { authorization: "Bearer test-cron-secret" } },
    );
    const cronRes = await cronGet(cronReq);
    expect(cronRes.status).toBe(200);
    const body = (await cronRes.json()) as Record<string, unknown>;
    expect(body.target_date).toBe(EXPECTED_TARGET_DATE);

    // Step 4 — 1 backlog + 14 newly-materialized = 15 total in tasks.
    const taskCount = await withServiceRole("§7.4 count tasks", (tx) =>
      tx.execute<{ n: number }>(sqlTag`
        SELECT COUNT(*)::int AS n FROM tasks WHERE tenant_id = ${TENANT_ID}
      `),
    );
    expect(taskCount[0].n).toBe(15);

    // Step 5 — batchJSON called once (15 messages fit in 1 chunk of 100).
    expect(batchJSONSpy).toHaveBeenCalledTimes(1);
    const messages = batchJSONSpy.mock.calls[0][0] as Array<{
      url: string;
      body: { tenant_id: string; task_id: string };
      deduplicationId: string;
      flowControl: { key: string; rate: number; period: string };
      retries: number;
      failureCallback: string;
    }>;
    expect(messages).toHaveLength(15);

    // Backlog task ID present in the enqueue (Phase 1 reconciliation contract).
    const enqueuedTaskIds = messages.map((m) => m.body.task_id);
    expect(enqueuedTaskIds).toContain(backlogTaskId);

    // Each message has the correct shape per §1.1 + §6.3 + §5.2.
    for (const message of messages) {
      expect(message.url).toBe(
        "https://test.example.com/api/queue/push-task",
      );
      expect(message.failureCallback).toBe(
        "https://test.example.com/api/queue/push-task-failed",
      );
      expect(message.deduplicationId).toBe(message.body.task_id);
      expect(message.body.tenant_id).toBe(TENANT_ID);
      expect(message.flowControl).toEqual({
        key: "sf-push-test-e2e",
        rate: 5,
        period: "1s",
      });
      expect(message.retries).toBe(3);
    }

    // Step 6 — materialized_through_date advanced.
    const matRow = await withServiceRole("§7.4 read mat", (tx) =>
      tx.execute<{ d: string }>(sqlTag`
        SELECT materialized_through_date::text AS d
        FROM subscription_materialization
        WHERE subscription_id = ${subscriptionId}
      `),
    );
    expect(matRow[0].d).toBe(EXPECTED_TARGET_DATE);

    // Step 7 — run row at status='completed' with tasks_created=14.
    const runRow = await withServiceRole("§7.4 read run", (tx) =>
      tx.execute<{
        status: string;
        target_date: string;
        tasks_created: number;
      }>(sqlTag`
        SELECT status, target_date::text AS target_date, tasks_created
        FROM task_generation_runs
        WHERE tenant_id = ${TENANT_ID}
        ORDER BY started_at DESC
        LIMIT 1
      `),
    );
    expect(runRow[0].status).toBe("completed");
    expect(runRow[0].target_date).toBe(EXPECTED_TARGET_DATE);
    expect(runRow[0].tasks_created).toBe(14);
  });

  it("step 8-10: push handler invokes pushSingleTask + sets pushed_to_external_at", async () => {
    // Use the backlog task — known-existing pre-test, easier to assert
    // pushed_to_external_at transitions NULL → set.
    const pushReq = new Request(
      "https://test.example.com/api/queue/push-task",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Signature gate is passthrough-mocked at module level.
        },
        body: JSON.stringify({
          tenant_id: TENANT_ID,
          task_id: backlogTaskId,
        }),
      },
    );
    const pushRes = await pushPost(pushReq);
    expect(pushRes.status).toBe(200);
    const pushBody = (await pushRes.json()) as { outcome: string };
    expect(pushBody.outcome).toBe("success");

    // pushSingleTask invoked once with the right args.
    expect(pushSingleTaskSpy).toHaveBeenCalledTimes(1);
    const callArgs = pushSingleTaskSpy.mock.calls[0];
    expect(callArgs[0].tenantId).toBe(TENANT_ID);
    expect(callArgs[1]).toBe(backlogTaskId);

    // markTaskPushed effect — pushed_to_external_at is now set.
    const taskRow = await withServiceRole("§7.4 read task", (tx) =>
      tx.execute<{
        pushed_to_external_at: string | null;
        external_id: string | null;
        external_tracking_number: string | null;
      }>(sqlTag`
        SELECT pushed_to_external_at::text AS pushed_to_external_at,
               external_id, external_tracking_number
        FROM tasks
        WHERE id = ${backlogTaskId}
      `),
    );
    expect(taskRow[0].pushed_to_external_at).not.toBeNull();
    expect(taskRow[0].external_id).toBe("ext-e2e-mock-id");
    expect(taskRow[0].external_tracking_number).toBe("TRACK-E2E-MOCK");
  });
});
