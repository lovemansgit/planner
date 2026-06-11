// tests/integration/failed-pushes-resolved-list.spec.ts
// =============================================================================
// Day-53 R12 — listResolvedFailedPushes against real Postgres. Plan:
// memory/plans/day-53-session-c-r12-resolved-rows.md §6.
//
// Pins:
//   1. Resolved rows returned with the resolver's email (LEFT JOIN
//      users) + notes; unresolved rows excluded.
//   2. System-resolved row (resolved_by IS NULL) returned with NULL
//      email — LEFT JOIN survives.
//   3. resolved_at DESC ordering (newest resolution first).
//   4. Tenant isolation — tenant B sees none of tenant A's resolved rows.
//
// Seed + teardown follow the bulk-resolve-failed-pushes.spec.ts skeleton
// (auth.users → public.users FK pattern; audit-rule-tolerant teardown).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { listResolvedFailedPushes } from "../../src/modules/failed-pushes";
import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { withServiceRole } from "../../src/shared/db";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_A = randomUUID() as Uuid;
const TENANT_B = randomUUID() as Uuid;
const SLUG_A = `d53-r12-resolved-a-${RUN_ID}`;
const SLUG_B = `d53-r12-resolved-b-${RUN_ID}`;
const CONSIGNEE_A = randomUUID() as Uuid;

const TASK_OPERATOR = randomUUID() as Uuid;
const TASK_SYSTEM = randomUUID() as Uuid;
const TASK_UNRESOLVED = randomUUID() as Uuid;
const FP_OPERATOR = randomUUID() as Uuid;
const FP_SYSTEM = randomUUID() as Uuid;
const FP_UNRESOLVED = randomUUID() as Uuid;

const OPERATOR_USER = randomUUID() as Uuid;
const OPERATOR_EMAIL = `r12-op-${RUN_ID}@example.com`;

function ctxForTenant(tenantId: Uuid): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: OPERATOR_USER,
      tenantId,
      permissions: new Set(ALL_PERMISSION_IDS),
    } satisfies Actor,
    tenantId,
    requestId: `r12-spec-${RUN_ID}`,
    path: "/admin/failed-pushes/resolved",
  };
}

describe("Day-53 R12 — listResolvedFailedPushes (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("R12 spec seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name)
        VALUES (${TENANT_A}, ${SLUG_A}, 'R12 resolved A'),
               (${TENANT_B}, ${SLUG_B}, 'R12 resolved B')
      `);
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES (${OPERATOR_USER}, ${OPERATOR_EMAIL})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email, display_name)
        VALUES (${OPERATOR_USER}, ${TENANT_A}, ${OPERATOR_EMAIL}, ${`r12-op-${RUN_ID}`})
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE_A}, ${TENANT_A}, 'R12 consignee', ${`r12-${RUN_ID}`}, 'addr', 'Dubai', 'Al Quoz')
      `);
      for (const id of [TASK_OPERATOR, TASK_SYSTEM, TASK_UNRESOLVED]) {
        await tx.execute(sqlTag`
          INSERT INTO tasks (id, tenant_id, consignee_id, customer_order_number,
              internal_status, delivery_date, delivery_start_time, delivery_end_time, created_via)
          VALUES (${id}, ${TENANT_A}, ${CONSIGNEE_A}, ${`ORD-${id.slice(0, 8)}`},
              'CREATED', CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00', 'manual_admin')
        `);
      }
      // Operator-resolved 12h ago; system-resolved 1h ago (newest);
      // one row left unresolved.
      await tx.execute(sqlTag`
        INSERT INTO failed_pushes (id, tenant_id, task_id, attempt_count,
            task_payload, failure_reason, http_status, first_failed_at, last_attempted_at,
            resolved_at, resolved_by, resolution_notes)
        VALUES
          (${FP_OPERATOR}, ${TENANT_A}, ${TASK_OPERATOR}, 2, '{}'::jsonb,
            'client_4xx', 422, now() - INTERVAL '2 days', now() - INTERVAL '1 day',
            now() - INTERVAL '12 hours', ${OPERATOR_USER}, 'verified fixed upstream'),
          (${FP_SYSTEM}, ${TENANT_A}, ${TASK_SYSTEM}, 1, '{}'::jsonb,
            'network', NULL, now() - INTERVAL '2 days', now() - INTERVAL '1 day',
            now() - INTERVAL '1 hour', NULL, 'resolved_by_system: dlq_retry')
      `);
      await tx.execute(sqlTag`
        INSERT INTO failed_pushes (id, tenant_id, task_id, attempt_count,
            task_payload, failure_reason, first_failed_at, last_attempted_at)
        VALUES (${FP_UNRESOLVED}, ${TENANT_A}, ${TASK_UNRESOLVED}, 1, '{}'::jsonb,
            'server_5xx', now(), now())
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("R12 spec teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM failed_pushes WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM users WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM auth.users WHERE id = ${OPERATOR_USER}`);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`);
      });
    } catch {
      /* audit RULE blocks tenants DELETE; ignore — per-run UUIDs accepted-leak */
    }
  });

  it("returns resolved rows newest-first with resolver email; excludes unresolved; NULL email for system-resolved", async () => {
    const rows = await listResolvedFailedPushes(ctxForTenant(TENANT_A));

    expect(rows).toHaveLength(2);
    // Newest resolution first: the system-resolved row (1h ago).
    expect(rows[0].id).toBe(FP_SYSTEM);
    expect(rows[0].resolvedByEmail).toBeNull();
    expect(rows[0].resolutionNotes).toBe("resolved_by_system: dlq_retry");
    expect(rows[0].failureReason).toBe("network");
    // Operator-resolved row (12h ago) second, with the resolver's email.
    expect(rows[1].id).toBe(FP_OPERATOR);
    expect(rows[1].resolvedByEmail).toBe(OPERATOR_EMAIL);
    expect(rows[1].resolutionNotes).toBe("verified fixed upstream");
    expect(rows[1].httpStatus).toBe(422);
    // The unresolved row is not in the result.
    expect(rows.map((r) => r.id)).not.toContain(FP_UNRESOLVED);
  });

  it("tenant isolation — tenant B sees none of tenant A's resolved rows", async () => {
    const rows = await listResolvedFailedPushes(ctxForTenant(TENANT_B));
    expect(rows).toHaveLength(0);
  });
});
