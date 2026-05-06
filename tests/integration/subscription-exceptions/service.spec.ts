// Service A integration tests — Day-16 Block 4-B.
//
// Real Postgres (CI service container per ci.yml). Seeds tenants,
// users, role_assignments, subscriptions, addresses, then exercises
// the service surface end-to-end.
//
// Coverage:
//   1. Happy-path skip default — exception inserted, end_date extended,
//      task SKIPPED, audit events emitted with shared correlation_id
//   2. Happy-path address_override_one_off — exception inserted, task
//      NOT touched at this layer (cron handles via COALESCE), audit
//      events emitted
//   3. Idempotency — second call with same key returns first exception_id
//      with HTTP 409, no duplicate audit events
//   4. Cross-tenant rejection — RLS hides cross-tenant subscriptions;
//      service surfaces NotFoundError per the brief defence-in-depth
//      contract
//
// Pattern mirrors tests/integration/auth-end-to-end.spec.ts — fresh
// CI container precedent, no afterAll cleanup.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole, withTenant } from "../../../src/shared/db";
import type { RequestContext } from "../../../src/shared/tenant-context";
import type { Uuid } from "../../../src/shared/types";

import {
  addSubscriptionException,
  appendWithoutSkip,
} from "../../../src/modules/subscription-exceptions";
import { ALL_PERMISSION_IDS } from "../../../src/modules/identity/permissions";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_A = randomUUID() as Uuid;
const TENANT_B = randomUUID() as Uuid;
const SLUG_A = `svc-a-test-${RUN_ID}-a`;
const SLUG_B = `svc-a-test-${RUN_ID}-b`;

const USER_A = randomUUID() as Uuid;
const USER_B = randomUUID() as Uuid;

const CONSIGNEE_A = randomUUID() as Uuid;
const CONSIGNEE_B = randomUUID() as Uuid;

const SUBSCRIPTION_A = randomUUID() as Uuid;
const SUBSCRIPTION_B = randomUUID() as Uuid;

const ADDRESS_A = randomUUID() as Uuid;

// Pick dates that aren't past the cut-off when run in CI: skip date
// is far enough in the future that 18:00-Dubai-day-before is safely
// after `now()` regardless of CI clock.
const FUTURE = (() => {
  const now = new Date();
  const dt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
  // Walk to next Wednesday for Mon-Fri eligibility.
  const day = dt.getUTCDay(); // 0=Sun
  const wedDelta = ((3 - day + 7) % 7) || 7; // never zero — always future
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
})();

const ORIGINAL_END = (() => {
  const dt = new Date(FUTURE);
  dt.setUTCDate(dt.getUTCDate() + 30); // 30 days past skip date
  // Walk forward to a Friday so end_date sits cleanly.
  const day = dt.getUTCDay();
  const friDelta = (5 - day + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + friDelta);
  return dt.toISOString().slice(0, 10);
})();

function ctxFor(tenantId: Uuid, userId: Uuid): RequestContext {
  return {
    actor: {
      kind: "user",
      userId,
      tenantId,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${userId}@svc-a-test.example`,
      displayName: null,
    },
    tenantId,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

describe("Service A (subscription-exceptions) — integration", () => {
  beforeAll(async () => {
    await withServiceRole("svc-a integration setup", async (tx) => {
      // Tenants — explicit status='active' so the §10.5 filter holds.
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'Service A Test Tenant A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'Service A Test Tenant B', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'svc-a-test seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES
          (${USER_A}, ${"a-" + RUN_ID + "@svc-a-test.example"}),
          (${USER_B}, ${"b-" + RUN_ID + "@svc-a-test.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email) VALUES
          (${USER_A}, ${TENANT_A}, ${"a-" + RUN_ID + "@svc-a-test.example"}),
          (${USER_B}, ${TENANT_B}, ${"b-" + RUN_ID + "@svc-a-test.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_A}, r.id, ${TENANT_A} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_B}, r.id, ${TENANT_B} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);

      // address_line + emirate_or_region required per migration 0004
      // (NOT NULL); district added per migration 0013. Pattern matches
      // tests/integration/exception-model-rls-isolation.spec.ts:57-62.
      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district
        ) VALUES
          (${CONSIGNEE_A}, ${TENANT_A}, 'Consignee A', 'cons-a@test', '+971500000001',
           'Test Address Line A', 'Dubai', 'Test District A'),
          (${CONSIGNEE_B}, ${TENANT_B}, 'Consignee B', 'cons-b@test', '+971500000002',
           'Test Address Line B', 'Dubai', 'Test District B')
      `);

      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUBSCRIPTION_A}, ${TENANT_A}, ${CONSIGNEE_A}, 'active',
          ${FUTURE}, ${ORIGINAL_END},
          ARRAY[1,2,3,4,5]::int[], '09:00:00', '18:00:00'
        )
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUBSCRIPTION_B}, ${TENANT_B}, ${CONSIGNEE_B}, 'active',
          ${FUTURE}, ${ORIGINAL_END},
          ARRAY[1,2,3,4,5]::int[], '09:00:00', '18:00:00'
        )
      `);

      // label required per migration 0014 (NOT NULL with CHECK
      // 'home'/'office'/'other'). Pattern matches
      // tests/integration/exception-model-rls-isolation.spec.ts:103-109.
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS_A}, ${TENANT_A}, ${CONSIGNEE_A},
                'home', false, 'Test Line', 'Test District', 'Dubai')
      `);
    });
  });

  // No afterAll cleanup — same fresh-CI-container precedent as
  // auth-end-to-end.spec.ts.

  it("happy-path skip default: exception inserted, end_date extended, audit events emitted", async () => {
    const ctx = ctxFor(TENANT_A, USER_A);
    const idempotencyKey = randomUUID() as Uuid;

    const result = await addSubscriptionException(ctx, SUBSCRIPTION_A, {
      type: "skip",
      date: FUTURE,
      idempotencyKey,
      reason: "operator-initiated skip",
    });

    expect(result.status).toBe("inserted");
    expect(result.httpStatus).toBe(201);
    expect(result.compensatingDate).not.toBeNull();
    expect(result.newEndDate).toBe(result.compensatingDate);

    // Verify the exception row exists.
    await withTenant(TENANT_A, async (tx) => {
      type Row = { id: string; type: string; correlation_id: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT id, type, correlation_id
        FROM subscription_exceptions
        WHERE id = ${result.exceptionId}
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].type).toBe("skip");
      expect(rows[0].correlation_id).toBe(result.correlationId);
    });

    // Verify subscription end_date extended.
    await withTenant(TENANT_A, async (tx) => {
      type Row = { end_date: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT end_date FROM subscriptions WHERE id = ${SUBSCRIPTION_A}
      `);
      expect(rows[0].end_date).toBe(result.newEndDate);
    });

    // Verify audit events landed with shared correlation_id.
    await withServiceRole("svc-a integration audit check", async (tx) => {
      type Row = { event_type: string; metadata: { correlation_id: string } } & Record<
        string,
        unknown
      >;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT event_type, metadata
        FROM audit_events
        WHERE tenant_id = ${TENANT_A}
          AND (metadata->>'correlation_id') = ${result.correlationId}
        ORDER BY occurred_at ASC
      `);
      expect(rows.length).toBe(2);
      const eventTypes = rows.map((r) => r.event_type);
      expect(eventTypes).toContain("subscription.exception.created");
      expect(eventTypes).toContain("subscription.end_date.extended");
    });
  });

  it("idempotent replay: second call with same key returns 409 + same exception_id, no duplicate audit", async () => {
    const ctx = ctxFor(TENANT_A, USER_A);
    const idempotencyKey = randomUUID() as Uuid;

    // First call: insert.
    const first = await addSubscriptionException(ctx, SUBSCRIPTION_A, {
      type: "skip",
      date: FUTURE,
      idempotencyKey,
      skipWithoutAppend: true,
    });
    expect(first.status).toBe("inserted");

    // Second call with same key: replay.
    const second = await addSubscriptionException(ctx, SUBSCRIPTION_A, {
      type: "skip",
      date: FUTURE,
      idempotencyKey,
      skipWithoutAppend: true,
    });
    expect(second.status).toBe("idempotent_replay");
    expect(second.httpStatus).toBe(409);
    expect(second.exceptionId).toBe(first.exceptionId);

    // Audit events should only count once (no replay emit).
    await withServiceRole("svc-a integration replay audit count", async (tx) => {
      type Row = { count: number } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT COUNT(*)::int AS count
        FROM audit_events
        WHERE event_type = 'subscription.exception.created'
          AND metadata->>'correlation_id' = ${first.correlationId}
      `);
      expect(rows[0].count).toBe(1);
    });
  });

  it("address_override_one_off: exception inserted, task UPDATE deferred to cron", async () => {
    const ctx = ctxFor(TENANT_A, USER_A);
    const idempotencyKey = randomUUID() as Uuid;

    const result = await addSubscriptionException(ctx, SUBSCRIPTION_A, {
      type: "address_override_one_off",
      date: FUTURE,
      idempotencyKey,
      addressOverrideId: ADDRESS_A,
    });

    expect(result.status).toBe("inserted");
    expect(result.compensatingDate).toBeNull();
    expect(result.newEndDate).toBeNull();

    // No subscription.end_date.extended for address overrides.
    await withServiceRole("svc-a integration override audit check", async (tx) => {
      type Row = { event_type: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT event_type
        FROM audit_events
        WHERE metadata->>'correlation_id' = ${result.correlationId}
        ORDER BY occurred_at ASC
      `);
      const eventTypes = rows.map((r) => r.event_type);
      expect(eventTypes).toContain("subscription.exception.created");
      expect(eventTypes).toContain("subscription.address_override.applied");
      expect(eventTypes).not.toContain("subscription.end_date.extended");
    });
  });

  it("cross-tenant rejection: User A cannot skip Subscription B (RLS-hidden → NotFound)", async () => {
    const ctx = ctxFor(TENANT_A, USER_A);
    await expect(
      addSubscriptionException(ctx, SUBSCRIPTION_B, {
        type: "skip",
        date: FUTURE,
        idempotencyKey: randomUUID() as Uuid,
      }),
    ).rejects.toThrow(/subscription not found/);
  });

  it("appendWithoutSkip happy path: exception inserted + end_date extended + audit pair", async () => {
    const ctx = ctxFor(TENANT_A, USER_A);
    const idempotencyKey = randomUUID() as Uuid;

    const result = await appendWithoutSkip(ctx, SUBSCRIPTION_A, {
      reason: "goodwill addition for review-test customer",
      idempotencyKey,
    });

    expect(result.status).toBe("inserted");
    expect(result.newEndDate).toBeTruthy();

    await withServiceRole("svc-a integration append audit check", async (tx) => {
      type Row = { event_type: string; metadata: { triggered_by?: string } } & Record<
        string,
        unknown
      >;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT event_type, metadata
        FROM audit_events
        WHERE metadata->>'correlation_id' = ${result.correlationId}
        ORDER BY occurred_at ASC
      `);
      expect(rows.length).toBe(2);
      const endDateRow = rows.find((r) => r.event_type === "subscription.end_date.extended");
      expect(endDateRow?.metadata.triggered_by).toBe("append_without_skip");
    });
  });
});
