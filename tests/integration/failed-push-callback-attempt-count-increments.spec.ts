// tests/integration/failed-push-callback-attempt-count-increments.spec.ts
// =============================================================================
// Plan #317 §3.4 + §7.4 / F-4 — LOAD-BEARING integration spec at SHA f0ef560.
//
// The §10 hard requirement says: "F-4's attempt_count increment spec is
// load-bearing — the §3.6 #2 body-read on PR-B will check this spec exists,
// exercises the QStash → service-layer-write path end-to-end, and asserts
// attempt_count moves 1→2 across retries. Not a unit test; a real-Postgres
// integration test per brief v1.13 §7.1."
//
// Pre-fix behavior (the bug we're closing): the failureCallback route at
// src/app/api/queue/push-task-failed/route.ts called repository.insertFailedPush
// directly, bypassing the service-layer recordFailedPushAttempt. On the second
// QStash failureCallback for the same task, the partial UNIQUE on
// (task_id) WHERE resolved_at IS NULL fired SQLSTATE 23505, the route caught
// the throw and re-threw, QStash retried the callback itself, exhausted again,
// and looped. attempt_count never advanced past 1; last_attempted_at stayed
// frozen at the first failure timestamp. Audit ledger saw 0 task.push_failed
// events for the W2-class population (the W1 emit at
// failed-pushes/service.ts:319-325 never ran for the route's writes).
//
// Post-fix: route builds a system-actor RequestContext (system:"queue:push_task")
// and calls recordFailedPushAttempt, which catches the 23505 from
// insertFailedPush and routes to updateFailedPushAttempt — attempt_count
// increments, last_attempted_at advances, task.push_failed audit emits on
// each attempt.
//
// Spec drives the route handler POST (passthrough QStash signature mock)
// twice for the same task and asserts:
//   - first POST → 200, attempt_count = 1, one failed_pushes row, one audit
//   - second POST → 200, attempt_count = 2 (NOT 23505 re-throw, NOT a
//     duplicate row), audit count = 2, last_attempted_at advanced
//   - failed_pushes row count stays at 1 throughout (no insert collision)
//   - task_payload.source === 'qstash_failure_callback' on both writes
//     (W2-shape preserved per §6 OQ-6 ruling)
//
// All DB writes are real. The QStash SDK signature gate is bypassed via the
// passthrough mock pattern used by tests/unit/queue-push-task.spec.ts; this
// spec exercises the inner handler, not the gate (gate behavior is pinned
// separately in tests/unit/queue-routes-signature-gate-behavioral.spec.ts).
//
// Teardown follows the canonical skeleton from
// memory/followup_audit_rule_cascade_conflict.md (audit_events_no_delete RULE
// blocks DELETE FROM tenants when audit rows exist; best-effort, swallow
// the rule failure, per-run UUIDs prevent CI re-run collisions).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Passthrough mock for the QStash SDK signature gate — same pattern as
// tests/unit/queue-push-task.spec.ts. The signature gate's own behavior
// is covered by tests/unit/queue-routes-signature-gate-behavioral.spec.ts;
// here we exercise the inner handler against real DB.
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

// Imports AFTER mocks.
import { withServiceRole } from "../../src/shared/db";
import { POST } from "../../src/app/api/queue/push-task-failed/route";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID() as Uuid;
const SLUG = `d33-prb-f4-${RUN_ID}`;
const SUITEFLEET_CUSTOMER_CODE = `PR-B-F4-${RUN_ID}`;
const CONSIGNEE_ID = randomUUID() as Uuid;
const ADDRESS_ID = randomUUID() as Uuid;
const TASK_ID = randomUUID() as Uuid;

/**
 * Construct a QStash failureCallback request body that base64-encodes the
 * inner PushTaskPayload. Matches the SDK's `sourceBody` contract — the
 * inner handler decodes it via Buffer.from(b64, "base64").
 */
function buildFailureCallbackRequest(opts: {
  readonly sourceMessageId: string;
  readonly status: number;
  readonly body: string;
  readonly retried: number;
  readonly dlqId: string;
}): Request {
  const innerPayload = { tenant_id: TENANT_ID, task_id: TASK_ID };
  const sourceBody = Buffer.from(JSON.stringify(innerPayload), "utf-8").toString(
    "base64",
  );
  const callbackBody = {
    sourceMessageId: opts.sourceMessageId,
    sourceUrl: "https://test.example.com/api/queue/push-task",
    sourceBody,
    status: opts.status,
    body: opts.body,
    retried: opts.retried,
    dlqId: opts.dlqId,
  };
  return new Request(
    "https://test.example.com/api/queue/push-task-failed",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(callbackBody),
    },
  );
}

describe("Plan #317 / F-4 — failureCallback routes through service layer; attempt_count increments across retries", () => {
  beforeAll(async () => {
    // Seed: minimal tenant + consignee + address + a task whose
    // delivery_date is well in the future (so any unrelated F-5
    // past-dated guard does NOT short-circuit the test scenario —
    // although this test drives the failureCallback route directly,
    // not pushSingleTask).
    await withServiceRole("F-4 spec seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
        VALUES (${TENANT_ID}, ${SLUG}, 'PR-B F-4 test', ${SUITEFLEET_CUSTOMER_CODE})
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${CONSIGNEE_ID}, ${TENANT_ID}, 'PR-B F-4 consignee',
          ${`phone-${RUN_ID}`}, 'F-4 Addr', 'Dubai', 'Al Quoz'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (
          id, tenant_id, consignee_id, label, is_primary,
          line, district, emirate
        ) VALUES (
          ${ADDRESS_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, 'home', true,
          'F-4 Addr', 'Al Quoz', 'Dubai'
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
          CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00',
          'manual_admin'
        )
      `);
    });
  });

  afterAll(async () => {
    // Canonical teardown — audit_events_no_delete RULE will block
    // DELETE FROM tenants because this spec emits task.push_failed
    // audit rows. Best-effort cleanup, accept the leak; per-run UUIDs
    // prevent CI re-run collisions.
    try {
      await withServiceRole("F-4 spec teardown", async (tx) => {
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

  it("second failureCallback for the same task increments attempt_count 1→2 without throwing 23505 or creating a duplicate row; emits task.push_failed audit each attempt", async () => {
    // ---------------------------------------------------------------
    // First callback — simulates first QStash retry-exhaustion for this task.
    // ---------------------------------------------------------------
    const firstRes = await POST(
      buildFailureCallbackRequest({
        sourceMessageId: `msg-${RUN_ID}-1`,
        status: 502,
        body: "Bad Gateway from SuiteFleet upstream",
        retried: 3,
        dlqId: `dlq-${RUN_ID}-1`,
      }),
    );

    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as {
      outcome: string;
      failed_push_id: string;
      attempt_count: number;
    };
    expect(firstBody.outcome).toBe("recorded");
    expect(firstBody.attempt_count).toBe(1);

    // Assert: exactly one failed_pushes row, attempt_count = 1, source key
    // identifies the W2 path (Plan §6 OQ-6 ruling — accept divergence;
    // operators discriminate via task_payload.source).
    const afterFirst = await withServiceRole("F-4 assert after #1", async (tx) =>
      tx.execute<{
        id: string;
        attempt_count: number;
        last_attempted_at: string;
        task_payload: { source?: string };
        failure_reason: string;
      }>(sqlTag`
        SELECT id, attempt_count, last_attempted_at, task_payload, failure_reason
        FROM failed_pushes
        WHERE tenant_id = ${TENANT_ID} AND task_id = ${TASK_ID}
      `),
    );
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].attempt_count).toBe(1);
    expect(afterFirst[0].failure_reason).toBe("server_5xx");
    expect(afterFirst[0].task_payload.source).toBe("qstash_failure_callback");
    const firstAttemptedAt = afterFirst[0].last_attempted_at;
    const failedPushIdAfterFirst = afterFirst[0].id;

    // Assert: exactly one task.push_failed audit event emitted.
    const auditAfterFirst = await withServiceRole(
      "F-4 assert audit after #1",
      async (tx) =>
        tx.execute<{ count: number }>(sqlTag`
          SELECT COUNT(*)::int AS count
          FROM audit_events
          WHERE tenant_id = ${TENANT_ID}
            AND resource_id = ${TASK_ID}::text
            AND event_type = 'task.push_failed'
        `),
    );
    expect(auditAfterFirst[0].count).toBe(1);

    // Small sleep so last_attempted_at can demonstrably advance between
    // the two callbacks. Postgres now() has microsecond resolution; a
    // 30ms gap is more than enough.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    // ---------------------------------------------------------------
    // Second callback — the load-bearing case. Pre-fix this threw 23505
    // and the route re-threw; post-fix it routes through
    // recordFailedPushAttempt → 23505 → updateFailedPushAttempt.
    // ---------------------------------------------------------------
    const secondRes = await POST(
      buildFailureCallbackRequest({
        sourceMessageId: `msg-${RUN_ID}-2`,
        status: 503,
        body: "Service Unavailable from SuiteFleet upstream",
        retried: 3,
        dlqId: `dlq-${RUN_ID}-2`,
      }),
    );

    // Pre-fix: this assertion fails because the route re-threw the 23505.
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as {
      outcome: string;
      failed_push_id: string;
      attempt_count: number;
    };
    expect(secondBody.outcome).toBe("recorded");
    // Load-bearing assertion: attempt_count moved 1 → 2.
    expect(secondBody.attempt_count).toBe(2);
    // Same row id (UPDATE path, not duplicate INSERT).
    expect(secondBody.failed_push_id).toBe(failedPushIdAfterFirst);

    // Assert: STILL exactly one failed_pushes row (no duplicate INSERT;
    // 23505 was caught by recordFailedPushAttempt and routed to UPDATE).
    const afterSecond = await withServiceRole("F-4 assert after #2", async (tx) =>
      tx.execute<{
        id: string;
        attempt_count: number;
        last_attempted_at: string;
        task_payload: { source?: string; qstash_dlq_id?: string };
        failure_reason: string;
        http_status: number | null;
      }>(sqlTag`
        SELECT id, attempt_count, last_attempted_at, task_payload, failure_reason, http_status
        FROM failed_pushes
        WHERE tenant_id = ${TENANT_ID} AND task_id = ${TASK_ID}
      `),
    );
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].attempt_count).toBe(2);
    // Failure context refreshed by the UPDATE path: now reflects the
    // second callback's status + dlqId (503, dlq-...-2).
    expect(afterSecond[0].http_status).toBe(503);
    expect(afterSecond[0].task_payload.qstash_dlq_id).toBe(`dlq-${RUN_ID}-2`);
    expect(afterSecond[0].task_payload.source).toBe("qstash_failure_callback");
    // last_attempted_at must have advanced (Postgres now() updates on
    // each UPDATE).
    expect(
      new Date(afterSecond[0].last_attempted_at).getTime(),
    ).toBeGreaterThan(new Date(firstAttemptedAt).getTime());

    // Assert: a SECOND task.push_failed audit event emitted (per
    // recordFailedPushAttempt's emit-on-every-attempt contract at
    // failed-pushes/service.ts:313-327). Pre-fix this stayed at 1 because
    // the W2 path never reached the service layer's emit.
    const auditAfterSecond = await withServiceRole(
      "F-4 assert audit after #2",
      async (tx) =>
        tx.execute<{ count: number }>(sqlTag`
          SELECT COUNT(*)::int AS count
          FROM audit_events
          WHERE tenant_id = ${TENANT_ID}
            AND resource_id = ${TASK_ID}::text
            AND event_type = 'task.push_failed'
        `),
    );
    expect(auditAfterSecond[0].count).toBe(2);
  });
});
