// tests/integration/tasks-create-ad-hoc.spec.ts
// =============================================================================
// Day-25 / brief v1.12 §3.1.4 — integration spec for `createAdHocTask`.
//
// Pins:
//   1. Happy path with no addressId — task inserted with primary
//      address_id resolved + subscription_id NULL + created_via
//      'manual_admin' + internal_status 'CREATED'.
//   2. Explicit addressId path — non-primary address belonging to the
//      same consignee accepted.
//   3. Cross-consignee address — supplied addressId belongs to a
//      DIFFERENT consignee → ValidationError, no insert.
//   4. customer_order_number auto-generated with ADHOC- prefix.
//   5. Audit event `task.created` emitted with actor_kind='user'.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Disable the real QStash publisher for integration runs — the spec is
// asserting on DB state, not network calls. The push-batch fn is no-oped
// at the network boundary; the in-DB row is what matters.
vi.mock("../../src/modules/task-materialization/queue", () => ({
  enqueueTaskPushBatch: vi.fn().mockResolvedValue({ enqueuedCount: 1, failedChunks: 0 }),
}));

import { createAdHocTask } from "../../src/modules/tasks/service";
import { withServiceRole } from "../../src/shared/db";
import { ValidationError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const ACTOR_ID = randomUUID();
const CONSIGNEE_A = randomUUID();
const CONSIGNEE_B = randomUUID();
const PRIMARY_ADDR_A = randomUUID();
const SECONDARY_ADDR_A = randomUUID();
const ADDR_B = randomUUID();

function ctx(perms: readonly Permission[] = ["task:create"]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_ID,
      tenantId: TENANT_ID,
      permissions: new Set(perms),
    },
    tenantId: TENANT_ID,
    requestId: `ad-hoc-task-${RUN_ID}`,
    path: `/consignees/${CONSIGNEE_A}`,
  };
}

describe("Day-25 integration — createAdHocTask", () => {
  beforeAll(async () => {
    await withServiceRole("ad-hoc task integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT_ID}, ${`adhoc-${RUN_ID}`}, 'Ad-hoc Spec', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_A}, ${TENANT_ID}, 'Consignee A', ${`adhoc-${RUN_ID}-a`},
           'Addr A', 'Dubai', 'Jumeirah 1', 'ACTIVE'),
          (${CONSIGNEE_B}, ${TENANT_ID}, 'Consignee B', ${`adhoc-${RUN_ID}-b`},
           'Addr B', 'Dubai', 'Al Quoz', 'ACTIVE')
      `);

      await tx.execute(sqlTag`
        INSERT INTO addresses (id, consignee_id, tenant_id, label, is_primary, line, district, emirate)
        VALUES
          (${PRIMARY_ADDR_A}, ${CONSIGNEE_A}, ${TENANT_ID}, 'home', true, 'Primary A', 'Jumeirah 1', 'Dubai'),
          (${SECONDARY_ADDR_A}, ${CONSIGNEE_A}, ${TENANT_ID}, 'office', false, 'Secondary A', 'DIFC', 'Dubai'),
          (${ADDR_B}, ${CONSIGNEE_B}, ${TENANT_ID}, 'home', true, 'Primary B', 'Al Quoz', 'Dubai')
      `);
    });
  });

  afterAll(async () => {
    // audit_events_no_delete RULE blocks DELETE FROM tenants when matching
    // audit_events exist (see memory/followup_audit_rule_cascade_conflict.md).
    // Best-effort teardown; swallow the rule-induced failure.
    try {
      await withServiceRole("ad-hoc task integration teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id = ${TENANT_ID}`);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("default addressId → primary address; subscription_id NULL; created_via='manual_admin'", async () => {
    const result = await createAdHocTask(ctx(), CONSIGNEE_A as Uuid, {
      date: "2026-06-01",
      windowStart: "10:00",
      windowEnd: "12:00",
    });

    await withServiceRole("happy-path assertion", async (tx) => {
      const rows = await tx.execute<{
        id: string;
        subscription_id: string | null;
        address_id: string | null;
        created_via: string;
        internal_status: string;
        customer_order_number: string;
      }>(
        sqlTag`SELECT id, subscription_id, address_id, created_via, internal_status, customer_order_number FROM tasks WHERE id = ${result.task_id}`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].subscription_id).toBeNull();
      expect(rows[0].address_id).toBe(PRIMARY_ADDR_A);
      expect(rows[0].created_via).toBe("manual_admin");
      expect(rows[0].internal_status).toBe("CREATED");
      expect(rows[0].customer_order_number).toMatch(/^ADHOC-/);
    });
  });

  it("explicit addressId honoured when it belongs to the same consignee", async () => {
    const result = await createAdHocTask(ctx(), CONSIGNEE_A as Uuid, {
      date: "2026-06-02",
      windowStart: "14:00",
      windowEnd: "16:00",
      addressId: SECONDARY_ADDR_A as Uuid,
    });

    await withServiceRole("explicit-address assertion", async (tx) => {
      const rows = await tx.execute<{ address_id: string }>(
        sqlTag`SELECT address_id FROM tasks WHERE id = ${result.task_id}`,
      );
      expect(rows[0].address_id).toBe(SECONDARY_ADDR_A);
    });
  });

  it("rejects cross-consignee addressId — address belongs to a different consignee", async () => {
    await expect(
      createAdHocTask(ctx(), CONSIGNEE_A as Uuid, {
        date: "2026-06-03",
        windowStart: "10:00",
        windowEnd: "12:00",
        addressId: ADDR_B as Uuid,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("emits task.created with actor_kind='user'", async () => {
    const result = await createAdHocTask(ctx(), CONSIGNEE_A as Uuid, {
      date: "2026-06-04",
      windowStart: "11:00",
      windowEnd: "13:00",
    });

    await withServiceRole("audit assertion", async (tx) => {
      const rows = await tx.execute<{ event_type: string; actor_kind: string }>(sqlTag`
        SELECT event_type, actor_kind FROM audit_events
        WHERE resource_id = ${result.task_id} AND event_type = 'task.created'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_kind).toBe("user");
    });
  });
});
