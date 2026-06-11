// tests/integration/sf-auth-throw-routes-to-w1-dlq.spec.ts
// =============================================================================
// Plan #317 §3.2 + §7.2 / F-2 spec at SHA f0ef560.
//
// Pre-fix behavior (the bug we're closing): adapter.authenticate ran ABOVE
// pushSingleTask's try block at task-push/service.ts. Any throw from auth
// (5xx after retry exhaustion, network blip on /api/auth/authenticate,
// expired refresh token) escaped pushSingleTask entirely, landed in the
// /api/queue/push-task route handler's catch, got re-thrown to QStash,
// exhausted QStash retries, and triggered the failureCallback path —
// which then wrote a W2-shape DLQ row (qstash metadata snapshot, no SF
// wire body, no task.push_failed audit event because the W2 writer
// bypassed the service layer).
//
// Post-fix: adapter.authenticate + buildTaskCreateRequest are hoisted as
// nullable `let`s and the calls live INSIDE the try block. Auth-throw is
// caught by the existing non-AWB DLQ branch, classified, and written via
// the W1 writer (recordFailedPushAttempt) — which emits the
// task.push_failed audit and uses the partial-UNIQUE-friendly upsert
// path. The pre-push stub payload (`stage: "pre_push_failure"`) marks
// the row as auth-or-build-stage so ops triage at /admin/failed-pushes
// can distinguish it from a SF-side rejection.
//
// Spec:
//   - Seed minimal tenant + task (well-future date, not past-dated to
//     avoid F-5's short-circuit).
//   - Stub the LastMileAdapter so authenticate throws CredentialError
//     (mirrors auth-client.ts's retry-exhaustion throw).
//   - Invoke pushSingleTask.
//   - Assert: returns SinglePushOutcome { kind: "failed_to_dlq", ... }
//     — NOT a thrown error (pre-fix this threw out of pushSingleTask).
//   - Assert: failed_pushes row exists via W1 with the pre-push stub
//     payload shape (task_payload.stage === "pre_push_failure"; no
//     `source` key — that's the W2 path's discriminator).
//   - Assert: task.push_failed audit event emitted (W1 emits it via
//     recordFailedPushAttempt at failed-pushes/service.ts:313-327).
//
// Teardown follows the canonical skeleton from
// memory/followup_audit_rule_cascade_conflict.md.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { pushSingleTask } from "../../src/modules/task-push";
import { CredentialError } from "../../src/shared/errors";
import type { LastMileAdapter } from "../../src/modules/integration";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID() as Uuid;
const SLUG = `d33-prb-f2-${RUN_ID}`;
const SUITEFLEET_CUSTOMER_CODE = `PR-B-F2-${RUN_ID}`;
const CONSIGNEE_ID = randomUUID() as Uuid;
const ADDRESS_ID = randomUUID() as Uuid;
const TASK_ID = randomUUID() as Uuid;

function systemCtx(): RequestContext {
  return {
    actor: {
      kind: "system",
      system: "queue:push_task",
      tenantId: TENANT_ID,
      permissions: new Set(ALL_PERMISSION_IDS),
    } satisfies Actor,
    tenantId: TENANT_ID,
    requestId: `f2-spec-${RUN_ID}`,
    path: "/api/queue/push-task",
  };
}

// Stub LastMileAdapter — `authenticate` throws CredentialError mirroring
// the retry-exhaustion shape from auth-client.ts:179-186. Every other
// method should NEVER be invoked when authenticate throws (assertion
// vehicle: throwing spies).
const AUTH_ERROR_MESSAGE =
  "SuiteFleet login returned 502 after 4 attempts: upstream Bad Gateway from SF auth endpoint";

const authenticateSpy = vi.fn(async () => {
  throw new CredentialError(AUTH_ERROR_MESSAGE);
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

describe("Plan #317 / F-2 — auth-throw is caught by pushSingleTask and routed to W1 DLQ", () => {
  beforeAll(async () => {
    await withServiceRole("F-2 spec seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
        VALUES (${TENANT_ID}, ${SLUG}, 'PR-B F-2 test', ${SUITEFLEET_CUSTOMER_CODE})
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${CONSIGNEE_ID}, ${TENANT_ID}, 'F-2 consignee',
          ${`phone-${RUN_ID}`}, 'F-2 Addr', 'Dubai', 'Al Quoz'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (
          id, tenant_id, consignee_id, label, is_primary,
          line, district, emirate
        ) VALUES (
          ${ADDRESS_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, 'home', true,
          'F-2 Addr', 'Al Quoz', 'Dubai'
        )
      `);

      // Well-future delivery date so F-5's past-dated guard does NOT
      // fire — F-2 is about auth-stage throws being caught inside the
      // try block, separate surface from F-5's pre-flight short-circuit.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, address_id,
          customer_order_number, internal_status,
          delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES (
          ${TASK_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, ${ADDRESS_ID},
          ${`ORDER-F2-${RUN_ID}`}, 'CREATED',
          CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00',
          'manual_admin'
        )
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("F-2 spec teardown", async (tx) => {
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

  it("auth-throw is caught inside pushSingleTask's try block, returns failed_to_dlq, writes a W1 DLQ row with pre-push stub payload, emits task.push_failed audit", async () => {
    const ctx = systemCtx();

    // Drive: invoke pushSingleTask against the stub adapter. authenticate
    // throws → pushSingleTask must NOT re-throw (pre-fix it would have).
    const outcome = await pushSingleTask(ctx, TASK_ID, stubAdapter);

    // Assertion 1 — outcome.kind is failed_to_dlq, NOT a thrown error.
    // failureDetail carries the auth-error message via classifyAdapterError.
    expect(outcome.kind).toBe("failed_to_dlq");
    if (outcome.kind === "failed_to_dlq") {
      expect(outcome.failureDetail).toContain("Bad Gateway from SF auth endpoint");
    }

    // Assertion 2 — authenticate was called once; createTask + reconcile
    // siblings were never invoked (auth threw before they could run).
    expect(authenticateSpy).toHaveBeenCalledTimes(1);
    expect(createTaskSpy).not.toHaveBeenCalled();
    expect(getTaskByAwbSpy).not.toHaveBeenCalled();
    expect(updateTaskSpy).not.toHaveBeenCalled();
    expect(cancelTaskSpy).not.toHaveBeenCalled();

    // Assertion 3 — exactly one failed_pushes row written via the W1
    // writer. task_payload carries the pre-push stub shape (NOT the W2
    // qstash_failure_callback shape) because authenticate threw before
    // buildTaskCreateRequest could materialise the SF wire request.
    const dlqRows = await withServiceRole(
      "F-2 assert failed_pushes",
      async (tx) => {
        return tx.execute<{
          id: string;
          failure_reason: string;
          failure_detail: string | null;
          attempt_count: number;
          task_payload: {
            stage?: string;
            reason_class?: string;
            source?: string;
          };
        }>(sqlTag`
          SELECT id, failure_reason, failure_detail, attempt_count, task_payload
          FROM failed_pushes
          WHERE tenant_id = ${TENANT_ID} AND task_id = ${TASK_ID}
        `);
      },
    );
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].failure_detail).toContain(
      "Bad Gateway from SF auth endpoint",
    );
    expect(dlqRows[0].attempt_count).toBe(1);
    // Pre-push stub markers — discriminates from the W1 SF-wire-shape
    // row that a createTask 5xx would produce.
    expect(dlqRows[0].task_payload.stage).toBe("pre_push_failure");
    expect(dlqRows[0].task_payload.reason_class).toBeDefined();
    // No W2 qstash discriminator on this row — that key only lands on
    // failureCallback writes (per §6 OQ-6 ruling at SHA f0ef560).
    expect(dlqRows[0].task_payload.source).toBeUndefined();

    // Assertion 4 — task.push_failed audit emitted via the W1
    // service-layer emit at failed-pushes/service.ts:313-327. Pre-fix
    // the auth-throw escaped to the route handler, the failureCallback
    // wrote a W2 row, and this audit event was never emitted.
    const auditRows = await withServiceRole(
      "F-2 assert audit",
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
