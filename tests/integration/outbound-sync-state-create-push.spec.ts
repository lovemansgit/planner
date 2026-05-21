// tests/integration/outbound-sync-state-create-push.spec.ts
// =============================================================================
// Plan #317 §3.3 + §7.3 / F-3 spec at SHA f0ef560.
//
// LOAD-BEARING per OQ-2 ruling (b) hard requirement #2: exercises the
// create-push pipeline writers (markTaskPushed sets 'synced';
// recordFailedPushAttempt flips to 'failed' inside the same
// withServiceRole tx as the failed_pushes write) and asserts the
// post-0028 lifecycle:
//
//   INSERT (cron / ad-hoc / subscription) → 'pending' (DB DEFAULT)
//   pushSingleTask success                → 'synced'
//   pushSingleTask failure                → 'failed'
//   Second push attempt on a 'failed' row → still 'failed' (idempotent)
//
// Cases:
//   - Case A: success path — task at 'pending' → push succeeds → row at 'synced'.
//     Also asserts external_id + pushed_to_external_at populated in the
//     same UPDATE (per markTaskPushed §3.3 (a)).
//   - Case B: failure path — task at 'pending' → adapter.createTask throws
//     a 5xx CredentialError → recordFailedPushAttempt fires → row at
//     'failed'. Asserts failed_pushes row exists in the SAME state
//     transition (same withServiceRole tx — atomic with the column flip).
//   - Case C: idempotency — second push attempt on a 'failed' task
//     (already-failed-DLQ) does not regress state. attempt_count
//     increments to 2; outbound_sync_state stays 'failed'.
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
const SLUG = `d33-prc-f3-${RUN_ID}`;
const SUITEFLEET_CUSTOMER_CODE = `PR-C-F3-${RUN_ID}`;
const CONSIGNEE_ID = randomUUID() as Uuid;
const ADDRESS_ID = randomUUID() as Uuid;

// One task per case to keep state assertions independent.
const TASK_SUCCESS_ID = randomUUID() as Uuid;
const TASK_FAILURE_ID = randomUUID() as Uuid;
const TASK_IDEMPOTENT_ID = randomUUID() as Uuid;

function systemCtx(taskId: Uuid): RequestContext {
  return {
    actor: {
      kind: "system",
      system: "queue:push_task",
      tenantId: TENANT_ID,
      permissions: new Set(ALL_PERMISSION_IDS),
    } satisfies Actor,
    tenantId: TENANT_ID,
    requestId: `f3-spec-${RUN_ID}-${taskId.slice(0, 8)}`,
    path: "/api/queue/push-task",
  };
}

// Mock adapter — per-test override via mockImplementationOnce. The
// default no-op stubs throw to flag accidental invocations.
const authenticateMock = vi.fn(async () => ({
  tenantId: TENANT_ID,
  token: "stub-access-token",
  renewalToken: "stub-renewal-token",
  tokenExpiresAt: "2026-12-31T23:59:59.000Z",
  renewalTokenExpiresAt: "2026-12-31T23:59:59.000Z",
}));
const createTaskMock = vi.fn(
  async (): Promise<{ externalId: string; trackingNumber: string }> => {
    throw new Error("createTaskMock: no implementation set for this test case");
  },
);
const refreshSessionMock = vi.fn(async () => {
  throw new Error("refreshSessionMock invoked unexpectedly");
});
const invalidateSessionMock = vi.fn(() => undefined);
const getTaskByAwbMock = vi.fn(async () => {
  throw new Error("getTaskByAwbMock invoked unexpectedly");
});
const updateTaskMock = vi.fn(async () => {
  throw new Error("updateTaskMock invoked unexpectedly");
});
const cancelTaskMock = vi.fn(async () => {
  throw new Error("cancelTaskMock invoked unexpectedly");
});

const stubAdapter = {
  authenticate: authenticateMock,
  createTask: createTaskMock,
  refreshSession: refreshSessionMock,
  invalidateSession: invalidateSessionMock,
  getTaskByAwb: getTaskByAwbMock,
  updateTask: updateTaskMock,
  cancelTask: cancelTaskMock,
} as unknown as LastMileAdapter;

async function getOutboundSyncState(taskId: Uuid): Promise<string | null> {
  const rows = await withServiceRole(
    `F-3 read outbound_sync_state ${taskId}`,
    async (tx) =>
      tx.execute<{ outbound_sync_state: string }>(sqlTag`
        SELECT outbound_sync_state FROM tasks
        WHERE id = ${taskId} AND tenant_id = ${TENANT_ID}
      `),
  );
  return rows[0]?.outbound_sync_state ?? null;
}

describe("Plan #317 / F-3 — outbound_sync_state writer on the create-push pipeline", () => {
  beforeAll(async () => {
    await withServiceRole("F-3 spec seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
        VALUES (${TENANT_ID}, ${SLUG}, 'PR-C F-3 test', ${SUITEFLEET_CUSTOMER_CODE})
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${CONSIGNEE_ID}, ${TENANT_ID}, 'F-3 consignee',
          ${`phone-${RUN_ID}`}, 'F-3 Addr', 'Dubai', 'Al Quoz'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (
          id, tenant_id, consignee_id, label, is_primary,
          line, district, emirate
        ) VALUES (
          ${ADDRESS_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, 'home', true,
          'F-3 Addr', 'Al Quoz', 'Dubai'
        )
      `);

      // Three tasks — well-future delivery date so F-5's past-dated
      // guard does NOT short-circuit. Tasks INSERTed without specifying
      // outbound_sync_state to verify the post-0028 default 'pending'
      // applies at insert time (this is the load-bearing pre-push
      // truthful default per OQ-2 ruling).
      for (const id of [TASK_SUCCESS_ID, TASK_FAILURE_ID, TASK_IDEMPOTENT_ID]) {
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, address_id,
            customer_order_number, internal_status,
            delivery_date, delivery_start_time, delivery_end_time,
            created_via
          ) VALUES (
            ${id}, ${TENANT_ID}, ${CONSIGNEE_ID}, ${ADDRESS_ID},
            ${`ORDER-F3-${id.slice(0, 8)}`}, 'CREATED',
            CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00',
            'manual_admin'
          )
        `);
      }
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("F-3 spec teardown", async (tx) => {
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

  // ---------------------------------------------------------------------------
  // Pre-condition shared by all three cases — verify post-0028 default
  // ---------------------------------------------------------------------------
  it("post-0028 DEFAULT: newly-INSERTed tasks land in 'pending' (not 'synced')", async () => {
    // Sanity check that the migration 0028 DEFAULT change is in effect
    // for these freshly-seeded rows. Subsequent cases depend on this
    // being the starting state.
    for (const id of [TASK_SUCCESS_ID, TASK_FAILURE_ID, TASK_IDEMPOTENT_ID]) {
      expect(await getOutboundSyncState(id), `task ${id}`).toBe("pending");
    }
  });

  // ===========================================================================
  // §7.3 Case A — success path
  // ===========================================================================
  it("Case A — pushSingleTask success → markTaskPushed flips outbound_sync_state to 'synced' in the same UPDATE as external_id", async () => {
    const externalId = `SF-EXT-${RUN_ID}-A`;
    const trackingNumber = `AWB-${RUN_ID}-A`;

    createTaskMock.mockImplementationOnce(async () => ({
      externalId,
      trackingNumber,
    }));

    const outcome = await pushSingleTask(
      systemCtx(TASK_SUCCESS_ID),
      TASK_SUCCESS_ID,
      stubAdapter,
    );

    expect(outcome.kind).toBe("pushed");

    // F-3 (a): outbound_sync_state flipped 'pending' → 'synced'.
    expect(await getOutboundSyncState(TASK_SUCCESS_ID)).toBe("synced");

    // markTaskPushed's other fields written in the same UPDATE.
    const row = (
      await withServiceRole("F-3 Case A assert task row", async (tx) =>
        tx.execute<{
          external_id: string | null;
          external_tracking_number: string | null;
          pushed_to_external_at: string | null;
        }>(sqlTag`
          SELECT external_id, external_tracking_number, pushed_to_external_at
          FROM tasks WHERE id = ${TASK_SUCCESS_ID} AND tenant_id = ${TENANT_ID}
        `),
      )
    )[0];
    expect(row.external_id).toBe(externalId);
    expect(row.external_tracking_number).toBe(trackingNumber);
    expect(row.pushed_to_external_at).not.toBeNull();
  });

  // ===========================================================================
  // §7.3 Case B — failure path
  // ===========================================================================
  it("Case B — pushSingleTask failure → recordFailedPushAttempt flips outbound_sync_state to 'failed' atomically with the failed_pushes write", async () => {
    // Adapter.createTask throws a 5xx-shape CredentialError (mirrors
    // task-client.ts post-F-1: 5xx body excerpt in the thrown message).
    createTaskMock.mockImplementationOnce(async () => {
      throw new CredentialError(
        "SuiteFleet createTask returned 502: upstream Bad Gateway from SF createTask",
      );
    });

    const outcome = await pushSingleTask(
      systemCtx(TASK_FAILURE_ID),
      TASK_FAILURE_ID,
      stubAdapter,
    );

    expect(outcome.kind).toBe("failed_to_dlq");

    // F-3 (b): outbound_sync_state flipped 'pending' → 'failed'.
    expect(await getOutboundSyncState(TASK_FAILURE_ID)).toBe("failed");

    // Atomic with the failed_pushes write — both rows exist after the
    // same withServiceRole tx commits.
    const dlqRows = await withServiceRole(
      "F-3 Case B assert failed_pushes",
      async (tx) =>
        tx.execute<{
          id: string;
          attempt_count: number;
          failure_reason: string;
        }>(sqlTag`
          SELECT id, attempt_count, failure_reason
          FROM failed_pushes
          WHERE tenant_id = ${TENANT_ID} AND task_id = ${TASK_FAILURE_ID}
        `),
    );
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].attempt_count).toBe(1);
  });

  // ===========================================================================
  // §7.3 Case C — idempotency
  // ===========================================================================
  it("Case C — second pushSingleTask failure attempt on a 'failed' task does not regress state; attempt_count increments to 2", async () => {
    // First failure — task moves from 'pending' to 'failed' (Case B shape).
    createTaskMock.mockImplementationOnce(async () => {
      throw new CredentialError(
        "SuiteFleet createTask returned 502 attempt #1: upstream Bad Gateway",
      );
    });
    await pushSingleTask(
      systemCtx(TASK_IDEMPOTENT_ID),
      TASK_IDEMPOTENT_ID,
      stubAdapter,
    );
    expect(await getOutboundSyncState(TASK_IDEMPOTENT_ID)).toBe("failed");

    // Second failure — task already 'failed'; recordFailedPushAttempt
    // hits the 23505 path → updateFailedPushAttempt increments
    // attempt_count to 2; the F-3 (b) flip-to-'failed' UPDATE is a
    // no-op because state is already 'failed' (gate allows 'failed' as
    // a valid source state). State does NOT regress.
    createTaskMock.mockImplementationOnce(async () => {
      throw new CredentialError(
        "SuiteFleet createTask returned 502 attempt #2: upstream Bad Gateway",
      );
    });
    await pushSingleTask(
      systemCtx(TASK_IDEMPOTENT_ID),
      TASK_IDEMPOTENT_ID,
      stubAdapter,
    );

    expect(await getOutboundSyncState(TASK_IDEMPOTENT_ID)).toBe("failed");

    // Single row, attempt_count == 2 — same idempotent shape that
    // PR-B's F-4 LOAD-BEARING spec asserts for the failureCallback
    // path. Confirms the savepoint-23505-unwrap upsert is the canonical
    // post-PR-B path and the F-3 (b) column flip is correctly idempotent.
    const dlqRows = await withServiceRole(
      "F-3 Case C assert failed_pushes",
      async (tx) =>
        tx.execute<{ id: string; attempt_count: number }>(sqlTag`
          SELECT id, attempt_count
          FROM failed_pushes
          WHERE tenant_id = ${TENANT_ID} AND task_id = ${TASK_IDEMPOTENT_ID}
        `),
    );
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0].attempt_count).toBe(2);
  });
});
