// tests/integration/bulk-resolve-failed-pushes.spec.ts
// =============================================================================
// Plan #317 PR-D — bulkResolveFailedPushes end-to-end spec at SHA pinned by
// PR-D head. Drives the service-layer function against real Postgres, asserts:
//
//   1. UPDATE applied — selected failed_pushes rows have resolved_at +
//      resolution_notes populated; non-submitted rows untouched.
//   2. Cross-tenant isolation — IDs from a different tenant are NOT resolved
//      (silently dropped via the AND tenant_id = $1 predicate).
//   3. Already-resolved rows are surfaced in notFoundIds (idempotent shape).
//   4. Audit event written — failed_push.bulk_resolved with the exact
//      metadata shape registered in event-types.ts (the load-bearing contract
//      per §A registered-metadata-wins).
//
// Spec teardown follows the canonical skeleton from
// memory/followup_audit_rule_cascade_conflict.md.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import { bulkResolveFailedPushes } from "../../src/modules/failed-pushes";
import type { Actor, RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);

// Two tenants — exercise the cross-tenant-isolation assertion.
const TENANT_A = randomUUID() as Uuid;
const TENANT_B = randomUUID() as Uuid;
const SLUG_A = `d33-prd-bulk-resolve-a-${RUN_ID}`;
const SLUG_B = `d33-prd-bulk-resolve-b-${RUN_ID}`;
const CUSTOMER_CODE_A = `PR-D-BR-A-${RUN_ID}`;
const CUSTOMER_CODE_B = `PR-D-BR-B-${RUN_ID}`;
const CONSIGNEE_A = randomUUID() as Uuid;
const CONSIGNEE_B = randomUUID() as Uuid;

// Tenant A: 3 unresolved rows + 1 already-resolved row to exercise notFoundIds.
const TASK_A1 = randomUUID() as Uuid;
const TASK_A2 = randomUUID() as Uuid;
const TASK_A3 = randomUUID() as Uuid;
const TASK_A_RESOLVED = randomUUID() as Uuid;
const FP_A1 = randomUUID() as Uuid;
const FP_A2 = randomUUID() as Uuid;
const FP_A3 = randomUUID() as Uuid;
const FP_A_RESOLVED = randomUUID() as Uuid;

// Tenant B: 1 unresolved row — must NOT be touched by tenant A's bulk-resolve.
const TASK_B = randomUUID() as Uuid;
const FP_B = randomUUID() as Uuid;

// Operator userId (used as resolved_by on the user-actor path).
const OPERATOR_USER_A = randomUUID() as Uuid;

function userCtxForTenant(tenantId: Uuid, userId: Uuid): RequestContext {
  return {
    actor: {
      kind: "user",
      userId,
      tenantId,
      // ALL_PERMISSION_IDS guarantees failed_pushes:resolve is in the set;
      // permission gating is unit-tested separately in tests/bulk-resolve.spec.ts.
      permissions: new Set(ALL_PERMISSION_IDS),
    } satisfies Actor,
    tenantId,
    requestId: `prd-spec-${RUN_ID}`,
    path: "/api/failed-pushes/bulk-resolve",
  };
}

describe("Plan #317 PR-D — bulkResolveFailedPushes end-to-end", () => {
  beforeAll(async () => {
    await withServiceRole("PR-D spec seed", async (tx) => {
      // Tenants.
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, suitefleet_customer_code)
        VALUES (${TENANT_A}, ${SLUG_A}, 'PR-D bulk-resolve A', ${CUSTOMER_CODE_A}),
               (${TENANT_B}, ${SLUG_B}, 'PR-D bulk-resolve B', ${CUSTOMER_CODE_B})
      `);
      // Operator user A (resolved_by FK target).
      //
      // public.users.id is FK to auth.users(id) (Supabase Auth mirror,
      // per the project's identity model). Seeding INSERT INTO public.users
      // without a matching auth.users row would FK-violate at insert time.
      // Existing integration specs (exception-model-happy-path.spec.ts:186,
      // skip-sf-outbound-and-webhook-convergence.spec.ts:126,
      // tenant-admin-invariant-array-binding.spec.ts:68, etc.) use the
      // INSERT-auth.users-then-public.users pattern verbatim.
      const operatorEmail = `op-${RUN_ID}@example.com`;
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${OPERATOR_USER_A}, ${operatorEmail})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email, display_name)
        VALUES (${OPERATOR_USER_A}, ${TENANT_A}, ${operatorEmail}, ${`op-${RUN_ID}`})
      `);
      // Consignees per tenant.
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE_A}, ${TENANT_A}, 'consignee A', ${`phoneA-${RUN_ID}`}, 'addrA', 'Dubai', 'Al Quoz'),
          (${CONSIGNEE_B}, ${TENANT_B}, 'consignee B', ${`phoneB-${RUN_ID}`}, 'addrB', 'Dubai', 'Al Quoz')
      `);
      // Tasks (one per failed_push parent).
      for (const [id, tenant, consignee] of [
        [TASK_A1, TENANT_A, CONSIGNEE_A],
        [TASK_A2, TENANT_A, CONSIGNEE_A],
        [TASK_A3, TENANT_A, CONSIGNEE_A],
        [TASK_A_RESOLVED, TENANT_A, CONSIGNEE_A],
        [TASK_B, TENANT_B, CONSIGNEE_B],
      ] as const) {
        await tx.execute(sqlTag`
          INSERT INTO tasks (id, tenant_id, consignee_id, customer_order_number,
              internal_status, delivery_date, delivery_start_time, delivery_end_time, created_via)
          VALUES (${id}, ${tenant}, ${consignee}, ${`ORD-${id.slice(0, 8)}`},
              'CREATED', CURRENT_DATE + INTERVAL '7 days', '09:00', '11:00', 'manual_admin')
        `);
      }
      // Failed_pushes rows: 4 for A (3 unresolved + 1 already-resolved), 1 for B.
      for (const [id, tenant, task] of [
        [FP_A1, TENANT_A, TASK_A1],
        [FP_A2, TENANT_A, TASK_A2],
        [FP_A3, TENANT_A, TASK_A3],
        [FP_B, TENANT_B, TASK_B],
      ] as const) {
        await tx.execute(sqlTag`
          INSERT INTO failed_pushes (id, tenant_id, task_id, attempt_count,
              task_payload, failure_reason, first_failed_at, last_attempted_at)
          VALUES (${id}, ${tenant}, ${task}, 1, '{}'::jsonb,
              'server_5xx', now(), now())
        `);
      }
      // Already-resolved row to exercise notFoundIds (row exists, but
      // partial UNIQUE doesn't apply because resolved_at IS NOT NULL).
      await tx.execute(sqlTag`
        INSERT INTO failed_pushes (id, tenant_id, task_id, attempt_count,
            task_payload, failure_reason, first_failed_at, last_attempted_at,
            resolved_at, resolution_notes)
        VALUES (${FP_A_RESOLVED}, ${TENANT_A}, ${TASK_A_RESOLVED}, 1, '{}'::jsonb,
            'server_5xx', now() - INTERVAL '1 day', now() - INTERVAL '1 day',
            now() - INTERVAL '12 hours', 'pre-existing resolution')
      `);
    });
  });

  afterAll(async () => {
    try {
      await withServiceRole("PR-D spec teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM audit_events WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM failed_pushes WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM users WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`);
        await tx.execute(sqlTag`DELETE FROM auth.users WHERE id = ${OPERATOR_USER_A}`);
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})`);
      });
    } catch {
      /* audit RULE blocks tenants DELETE; ignore — per-run UUIDs accepted-leak */
    }
  });

  it("resolves submitted unresolved rows for tenant A; ignores tenant B's rows; surfaces tenant B's id + the already-resolved id in notFoundIds; emits failed_push.bulk_resolved with the registered metadata shape", async () => {
    const ctx = userCtxForTenant(TENANT_A, OPERATOR_USER_A);

    // Submit: 2 valid tenant-A rows + tenant-A's already-resolved row +
    // tenant-B's row. Expectation: only the 2 valid tenant-A rows update;
    // the other 2 surface as notFoundIds.
    const result = await bulkResolveFailedPushes(ctx, {
      failedPushIds: [FP_A1, FP_A2, FP_A_RESOLVED, FP_B],
      resolutionNotes: "ops decision: accepting these as won't-fix",
      source: "admin_ui",
    });

    // Assertion 1 — return shape.
    const resolvedIds = new Set(result.resolved.map((r) => r.id));
    expect(resolvedIds).toEqual(new Set([FP_A1, FP_A2]));
    expect(new Set(result.notFoundIds)).toEqual(new Set([FP_A_RESOLVED, FP_B]));

    // Assertion 2 — DB state for the resolved rows.
    const resolvedRows = (await withServiceRole(
      "PR-D spec assert resolved",
      async (tx) =>
        tx.execute<{
          id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          resolution_notes: string | null;
        }>(sqlTag`
          SELECT id, resolved_at, resolved_by, resolution_notes
          FROM failed_pushes
          WHERE id IN (${FP_A1}, ${FP_A2})
        `),
    )) as unknown as readonly {
      readonly id: string;
      readonly resolved_at: string | null;
      readonly resolved_by: string | null;
      readonly resolution_notes: string | null;
    }[];
    expect(resolvedRows.length).toBe(2);
    for (const row of resolvedRows) {
      expect(row.resolved_at).not.toBeNull();
      expect(row.resolved_by).toBe(OPERATOR_USER_A);
      expect(row.resolution_notes).toBe("ops decision: accepting these as won't-fix");
    }

    // Assertion 3 — untouched rows remained unresolved.
    const untouched = (await withServiceRole(
      "PR-D spec assert untouched",
      async (tx) =>
        tx.execute<{ id: string; resolved_at: string | null }>(sqlTag`
          SELECT id, resolved_at FROM failed_pushes
          WHERE id IN (${FP_A3}, ${FP_B})
        `),
    )) as unknown as readonly { readonly id: string; readonly resolved_at: string | null }[];
    expect(untouched.length).toBe(2);
    for (const row of untouched) {
      expect(row.resolved_at, `row ${row.id} should still be unresolved`).toBeNull();
    }

    // Assertion 4 — LOAD-BEARING: failed_push.bulk_resolved audit event
    // exists with the metadata shape registered in event-types.ts.
    const auditRows = (await withServiceRole(
      "PR-D spec assert audit",
      async (tx) =>
        tx.execute<{
          event_type: string;
          actor_kind: string;
          actor_id: string;
          tenant_id: string;
          resource_type: string;
          resource_id: string | null;
          metadata: Record<string, unknown>;
        }>(sqlTag`
          SELECT event_type, actor_kind, actor_id, tenant_id, resource_type, resource_id, metadata
          FROM audit_events
          WHERE tenant_id = ${TENANT_A}
            AND event_type = 'failed_push.bulk_resolved'
        `),
    )) as unknown as readonly {
      readonly event_type: string;
      readonly actor_kind: string;
      readonly actor_id: string;
      readonly tenant_id: string;
      readonly resource_type: string;
      readonly resource_id: string | null;
      readonly metadata: Record<string, unknown>;
    }[];
    expect(auditRows.length).toBe(1);
    const audit = auditRows[0];
    expect(audit.actor_kind).toBe("user");
    expect(audit.actor_id).toBe(OPERATOR_USER_A);
    expect(audit.resource_type).toBe("failed_push");
    expect(audit.resource_id).toBeNull();
    expect(audit.metadata).toMatchObject({
      count: 2,
      resolution_notes: "ops decision: accepting these as won't-fix",
      source: "admin_ui",
      not_found_count: 2,
    });
    expect(new Set(audit.metadata.failed_push_ids as string[])).toEqual(
      new Set([FP_A1, FP_A2]),
    );
  });
});
