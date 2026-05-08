// tests/integration/webhooks-suitefleet-receiver-route.spec.ts
// =============================================================================
// Day-18 / A2 — receiver-route POST end-to-end integration test.
//
// Per plan §9.6: catches wiring bugs in processWebhookAsync that
// the direct-fn invocation in webhook-status-event-applied.spec.ts
// cannot. The receiver-route path includes verification + parsing +
// dispatch + audit-emit composition, none of which §9.2 exercises
// end-to-end.
//
// Posture: NO module mocks (in contrast to tests/integration/webhook-receiver.spec.ts
// which mocks getSuiteFleetAdapter / tenantAcceptsWebhooks / audit.emit
// for the verification-chain unit tests). This file exercises the
// actual code path against real Postgres so we catch parser↔Layer-2
// integration drift.
//
// Tier-1 auth path (no credentials configured for the test tenant) —
// the receiver short-circuits cred verification and proceeds to
// processWebhookAsync.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

import { POST } from "../../src/app/api/webhooks/suitefleet/[tenantId]/route";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `wrr-${RUN_ID}`;
const CONSIGNEE = randomUUID();

const AWB_HAPPY = `WRR-${RUN_ID}-HAPPY`;
const AWB_ISOLATED = `WRR-${RUN_ID}-ISOLATED`;

const TASK_HAPPY = randomUUID() as Uuid;
const TASK_ISOLATED = randomUUID() as Uuid;

function makeRequest(tenantId: string, bodyJson: unknown): Request {
  return new Request(`http://localhost/api/webhooks/suitefleet/${tenantId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyJson),
  });
}

function makeContext(tenantId: string): { params: Promise<{ tenantId: string }> } {
  return { params: Promise.resolve({ tenantId }) };
}

describe("Day-18 / A2 — receiver-route POST end-to-end (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-18 A2 receiver-route integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT}, ${SLUG}, 'WRR A2 Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE}, ${TENANT}, 'WRR Test Consignee', ${`+97150r${RUN_ID}`},
           'Test Building', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number, external_id,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_HAPPY}, ${TENANT}, ${CONSIGNEE}, ${`WRR-H-${RUN_ID}`},
           ${AWB_HAPPY}, 'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin'),
          (${TASK_ISOLATED}, ${TENANT}, ${CONSIGNEE}, ${`WRR-I-${RUN_ID}`},
           ${AWB_ISOLATED}, 'CREATED', '2026-05-09', '08:00', '10:00', 'manual_admin')
      `);
    });
  });

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("happy path — POST with one valid PICKED_UP event lands webhook_events + flips task.internal_status + emits audit", async () => {
    const occurredAt = "2026-05-10T08:00:00.000Z";
    const body = [
      {
        action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
        awb: AWB_HAPPY,
        eventTimestamp: occurredAt,
      },
    ];

    const response = await POST(makeRequest(TENANT, body), makeContext(TENANT));
    expect(response.status).toBe(200);

    // webhook_events row landed.
    const [whEvent] = (await withServiceRole("verify webhook_events row", async (tx) =>
      tx.execute(sqlTag`
        SELECT suitefleet_task_id, action FROM webhook_events
        WHERE suitefleet_task_id = ${AWB_HAPPY}
        ORDER BY received_at DESC LIMIT 1
      `),
    )) as readonly { suitefleet_task_id: string; action: string }[];
    expect(whEvent).toBeDefined();
    expect(whEvent.action).toBe("TASK_STATUS_UPDATED_TO_PICKED_UP");

    // tasks.internal_status flipped.
    const [task] = (await withServiceRole("verify task status flip", async (tx) =>
      tx.execute(sqlTag`SELECT internal_status FROM tasks WHERE id = ${TASK_HAPPY} LIMIT 1`),
    )) as readonly { internal_status: string }[];
    expect(task.internal_status).toBe("IN_TRANSIT");

    // audit_events row written.
    const audits = await withServiceRole("verify audit emit", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'task.status_changed_via_webhook'
          AND tenant_id = ${TENANT}
          AND resource_id = ${TASK_HAPPY}
      `),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("per-event isolation — batch with one malformed entry + one valid entry returns 200 and lands the valid event", async () => {
    const occurredAt = "2026-05-10T09:00:00.000Z";
    const body = [
      // Malformed entry — missing awb. Parser skips silently.
      {
        action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
        eventTimestamp: occurredAt,
      },
      // Valid entry — different AWB so the test can verify lands.
      {
        action: "TASK_STATUS_UPDATED_TO_PICKED_UP",
        awb: AWB_ISOLATED,
        eventTimestamp: occurredAt,
      },
    ];

    const response = await POST(makeRequest(TENANT, body), makeContext(TENANT));
    expect(response.status).toBe(200);

    // Valid event landed — task flipped.
    const [task] = (await withServiceRole("verify isolated task", async (tx) =>
      tx.execute(sqlTag`SELECT internal_status FROM tasks WHERE id = ${TASK_ISOLATED} LIMIT 1`),
    )) as readonly { internal_status: string }[];
    expect(task.internal_status).toBe("IN_TRANSIT");

    // webhook_events row for AWB_ISOLATED exists.
    const [whEvent] = (await withServiceRole("verify isolated webhook_events", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM webhook_events
        WHERE suitefleet_task_id = ${AWB_ISOLATED}
        ORDER BY received_at DESC LIMIT 1
      `),
    )) as readonly { id: string }[];
    expect(whEvent).toBeDefined();
  });
});
