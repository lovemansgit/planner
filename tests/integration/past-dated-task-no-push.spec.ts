// tests/integration/past-dated-task-no-push.spec.ts
// =============================================================================
// Day-32 PR-A / F-5 — past-dated guard on push path + reconciliation filter.
// Per plan-PR #317 §3.5 + §7.5 + §6 OQ-3 ruling (a) at SHA f0ef560.
//
// Scope: pushSingleTask must short-circuit when task.delivery_date <
// CURRENT_DATE (Dubai-local via Postgres clock). On guard hit:
//   - returns SinglePushOutcome { kind: 'past_dated_no_push', deliveryDate }
//   - SF adapter authenticate() + createTask() are NOT invoked
//   - failed_pushes row written via the W1 writer (recordFailedPushAttempt)
//     with failure_reason = 'past_dated'
//   - task.push_failed audit event emitted via the existing W1 emit
//   - listReconciliationCandidatesByTenant excludes the past-dated task
//
// All DB writes are real. The SF LastMileAdapter is stubbed end-to-end
// so any unexpected invocation of authenticate/createTask fails the
// spec — the guard's load-bearing claim is "SF round-trip avoided".
//
// Teardown follows the canonical skeleton from
// memory/followup_audit_rule_cascade_conflict.md (audit_events_no_delete
// RULE blocks DELETE FROM tenants on tenants with audit rows; best-effort
// teardown, swallow the rule failure, random per-run UUIDs prevent
// CI re-run collisions).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Imports AFTER mocks (only `server-only` is mocked above).
import { withServiceRole } from "../../src/shared/db";
import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { listReconciliationCandidatesByTenant } from "../../src/modules/tasks/repository";
import { pushSingleTask } from "../../src/modules/task-push";
import type { LastMileAdapter } from "../../src/modules/integration";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID() as Uuid;
const SLUG = `d32-pra-${RUN_ID}`;
const SUITEFLEET_CUSTOMER_CODE = `PR-A-${RUN_ID}`;
const CONSIGNEE_ID = randomUUID() as Uuid;
const ADDRESS_ID = randomUUID() as Uuid;
const TASK_ID = randomUUID() as Uuid;

function systemCtx(): RequestContext {
  // Use 'queue:push_task' — the same SystemActor identity the
  // production /api/queue/push-task route handler uses when calling
  // pushSingleTask. Avoids inventing a test-only system actor name.
  return {
    actor: {
      kind: "system",
      system: "queue:push_task",
      tenantId: TENANT_ID,
      permissions: new Set(ALL_PERMISSION_IDS),
    } satisfies Actor,
    tenantId: TENANT_ID,
    requestId: `past-dated-test-${RUN_ID}`,
    path: "/api/queue/push-task",
  };
}

// Stub adapter — both authenticate + createTask should NEVER be invoked
// when the past-dated guard fires. Assertion vehicle: vi.fn() spies.
const authenticateSpy = vi.fn(async () => {
  throw new Error("LastMileAdapter.authenticate invoked unexpectedly");
});
const createTaskSpy = vi.fn(async () => {
  throw new Error("LastMileAdapter.createTask invoked unexpectedly");
});
const refreshSessionSpy = vi.fn(async () => {
  throw new Error("LastMileAdapter.refreshSession invoked unexpectedly");
});
const invalidateSessionSpy = vi.fn(() => undefined);
const getTaskByAwbSpy = vi.fn(async () => {
  throw new Error("LastMileAdapter.getTaskByAwb invoked unexpectedly");
});
const updateTaskSpy = vi.fn(async () => {
  throw new Error("LastMileAdapter.updateTask invoked unexpectedly");
});
const cancelTaskSpy = vi.fn(async () => {
  throw new Error("LastMileAdapter.cancelTask invoked unexpectedly");
});

const stubAdapter = {
  authenticate: authenticateSpy,
  createTask: createTaskSpy,
  refreshSession: refreshSessionSpy,
  invalidateSession: invalidateSessionSpy,
  getTaskByAwb: getTaskByAwbSpy,
  updateTask: updateTaskSpy,
  cancelTask: cancelTaskSpy,
} as unknown as LastMileAdapter;

describe("Day-32 PR-A — past-dated guard short-circuits SF push", () => {
  beforeAll(async () => {
    // Seed: tenant + consignee + address + a single task with
    // delivery_date strictly past (CURRENT_DATE - INTERVAL '2 days').
    // The SQL-side date computation is clock-deterministic against
    // Postgres time per OQ-3 ruling (a) + §8 R-4 — never use JS Date
    // here.
    await withServiceRole("PR-A past-dated seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
        VALUES (${TENANT_ID}, ${SLUG}, 'PR-A past-dated test', ${SUITEFLEET_CUSTOMER_CODE})
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${CONSIGNEE_ID}, ${TENANT_ID}, 'PR-A consignee',
          ${`phone-${RUN_ID}`}, 'Past-dated Addr', 'Dubai', 'Al Quoz'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (
          id, tenant_id, consignee_id, label, is_primary,
          line, district, emirate
        ) VALUES (
          ${ADDRESS_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, 'home', true,
          'Past-dated Addr', 'Al Quoz', 'Dubai'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, address_id,
          customer_order_number, internal_status,
          delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, ${ADDRESS_ID},
          ${`ORDER-${RUN_ID}`}, 'CREATED',
          CURRENT_DATE - INTERVAL '2 days', '09:00', '11:00',
          'manual_admin'
        )
      `);
    });
  });

  afterAll(async () => {
    // Canonical teardown per memory/followup_audit_rule_cascade_conflict.md.
    // The audit_events_no_delete RULE blocks DELETE FROM tenants whenever
    // matching audit_events rows exist — and this spec's pushSingleTask
    // call writes a task.push_failed audit row, guaranteeing the rule
    // will fire. Wrap in try/catch and accept the leak; per-run UUIDs
    // prevent CI re-run collisions.
    try {
      await withServiceRole("PR-A past-dated teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM failed_pushes WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM addresses WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
      });
    } catch {
      /* audit RULE blocks tenants DELETE; ignore — per-run UUIDs accepted-leak */
    }
  });

  it("returns past_dated_no_push without invoking SF adapter; writes failed_pushes row; excludes task from reconciliation; emits task.push_failed audit", async () => {
    const ctx = systemCtx();

    // Drive: invoke pushSingleTask against the stub adapter.
    const outcome = await pushSingleTask(ctx, TASK_ID, stubAdapter);

    // Assertion 1 — outcome kind + payload.
    expect(outcome.kind).toBe("past_dated_no_push");
    if (outcome.kind === "past_dated_no_push") {
      expect(outcome.deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Assertion 2 — SF adapter was NEVER invoked. The guard's
    // load-bearing claim is that we avoid the SF round-trip entirely.
    expect(authenticateSpy).not.toHaveBeenCalled();
    expect(createTaskSpy).not.toHaveBeenCalled();
    expect(refreshSessionSpy).not.toHaveBeenCalled();
    expect(getTaskByAwbSpy).not.toHaveBeenCalled();

    // Assertion 3 — failed_pushes row exists with failure_reason='past_dated'.
    const dlqRows = await withServiceRole(
      "PR-A assert failed_pushes",
      async (tx) => {
        return tx.execute<{
          id: Uuid;
          failure_reason: string;
          failure_detail: string | null;
          attempt_count: number;
        }>(sqlTag`
          SELECT id, failure_reason, failure_detail, attempt_count
          FROM failed_pushes
          WHERE tenant_id = ${TENANT_ID} AND task_id = ${TASK_ID}
        `);
      },
    );
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].failure_reason).toBe("past_dated");
    expect(dlqRows[0].failure_detail).toMatch(/in the past at push-time/);
    expect(dlqRows[0].attempt_count).toBe(1);

    // Assertion 4 — reconciliation scan excludes the past-dated task.
    // listReconciliationCandidatesByTenant filters via the new
    // `AND delivery_date >= CURRENT_DATE` clause; the task must NOT
    // appear in the result set.
    const reconcileIds = await withServiceRole(
      "PR-A assert reconcile scan",
      async (tx) => listReconciliationCandidatesByTenant(tx, TENANT_ID),
    );
    expect(reconcileIds).not.toContain(TASK_ID);

    // Assertion 5 — task.push_failed audit event emitted via the W1
    // service-layer writer (recordFailedPushAttempt emits at
    // src/modules/failed-pushes/service.ts:319-325).
    const auditRows = await withServiceRole(
      "PR-A assert audit",
      async (tx) => {
        return tx.execute<{
          event_type: string;
          resource_id: string;
        }>(sqlTag`
          SELECT event_type, resource_id
          FROM audit_events
          WHERE tenant_id = ${TENANT_ID}
            AND resource_id = ${TASK_ID}::text
            AND event_type = 'task.push_failed'
        `);
      },
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });
});
