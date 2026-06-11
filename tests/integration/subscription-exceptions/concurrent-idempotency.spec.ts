// Service A concurrent idempotency replay — Day-16 Block 4-G.
//
// Closes plan §9.3 row 12 + plan §7.4 (concurrent-tx idempotency-key
// race recovery).
//
// Two concurrent addSubscriptionException calls with the SAME
// idempotency_key MUST resolve to one inserted + one idempotent_replay,
// with both calls returning the SAME exception_id, correlation_id, and
// compensating_date. Either path is valid:
//
//   (a) SELECT-hit-first — second call's pre-INSERT idempotency
//       lookup sees the first call's COMMITted row and returns
//       existing. The FOR UPDATE on the subscription row at the top of
//       the addSubscriptionException tx serializes concurrent calls on
//       the same subscription, so this is the dominant path in
//       practice.
//   (b) INSERT-23505-race — both calls SELECT zero rows (race window
//       between the FOR UPDATE acquisitions), both attempt INSERT,
//       one wins, the other hits the unique-violation on
//       subscription_exceptions_idempotency_idx and the service
//       catches → re-routes to replay. Plan §7.4 sketches this path.
//
// Both paths produce the same observable contract: one inserted, one
// replayed, same row in DB, single audit pair (replay emits no audit
// per plan §2.3). The test asserts the OBSERVABLE OUTCOME — it does
// not pin which path was taken.
//
// Pattern mirrors tests/integration/subscription-exceptions/service.spec.ts
// (no cron, no QStash mocks, no time travel; real-DB integration with
// fresh CI container precedent — no afterAll cleanup).

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole, withTenant } from "../../../src/shared/db";
import type { RequestContext } from "../../../src/shared/tenant-context";
import type { Uuid } from "../../../src/shared/types";

import { addSubscriptionException } from "../../../src/modules/subscription-exceptions";
import { ALL_PERMISSION_IDS } from "../../../src/modules/identity/permissions";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_ID = randomUUID() as Uuid;
const SLUG = `svc-a-concurrent-${RUN_ID}`;
const USER_ID = randomUUID() as Uuid;
const CONSIGNEE_ID = randomUUID() as Uuid;
const SUBSCRIPTION_ID = randomUUID() as Uuid;

// Pick a future Wednesday far enough out that the 18:00-Dubai-day-before
// cut-off can never elapse during a normal CI run, regardless of when
// the suite executes.
const FUTURE_SKIP = (() => {
  const dt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
  const day = dt.getUTCDay(); // 0=Sun
  const wedDelta = ((3 - day + 7) % 7) || 7; // never zero — always future
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
})();

const ORIGINAL_END = (() => {
  const dt = new Date(FUTURE_SKIP);
  dt.setUTCDate(dt.getUTCDate() + 30); // 30 days past skip date
  const day = dt.getUTCDay();
  const friDelta = (5 - day + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + friDelta); // walk to next Friday
  return dt.toISOString().slice(0, 10);
})();

function userCtx(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER_ID,
      tenantId: TENANT_ID,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER_ID}@svc-a-concurrent.example`,
      displayName: null,
    },
    tenantId: TENANT_ID,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

describe("Service A concurrent idempotency replay (plan §7.4 + §9.3 row 12)", () => {
  beforeAll(async () => {
    await withServiceRole("svc-a concurrent setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_ID}, ${SLUG}, 'Service A Concurrent Test', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'svc-a-concurrent seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES
          (${USER_ID}, ${"u-" + RUN_ID + "@svc-a-concurrent.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email) VALUES
          (${USER_ID}, ${TENANT_ID}, ${"u-" + RUN_ID + "@svc-a-concurrent.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_ID}, r.id, ${TENANT_ID} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${CONSIGNEE_ID}, ${TENANT_ID}, 'Concurrent Consignee',
          ${`phone-${RUN_ID}`}, 'Test Addr', 'Dubai', 'Test District'
        )
      `);

      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUBSCRIPTION_ID}, ${TENANT_ID}, ${CONSIGNEE_ID}, 'active',
          ${FUTURE_SKIP}, ${ORIGINAL_END},
          ARRAY[1,2,3,4,5]::int[], '09:00:00', '18:00:00'
        )
      `);
    });
  });

  // No afterAll cleanup — fresh-CI-container precedent matches sibling
  // service.spec.ts and exception-model-rls-isolation.spec.ts.

  it(
    "two parallel addSubscriptionException calls with the same idempotency_key " +
      "→ exactly one inserted + one idempotent_replay; same exception_id; one audit pair only",
    async () => {
      const sharedKey = randomUUID() as Uuid;

      const [a, b] = await Promise.all([
        addSubscriptionException(userCtx(), SUBSCRIPTION_ID, {
          type: "skip",
          date: FUTURE_SKIP,
          idempotencyKey: sharedKey,
          reason: "concurrent-call A",
        }),
        addSubscriptionException(userCtx(), SUBSCRIPTION_ID, {
          type: "skip",
          date: FUTURE_SKIP,
          idempotencyKey: sharedKey,
          reason: "concurrent-call B",
        }),
      ]);

      // Exactly one inserted + one idempotent_replay. We don't care which
      // call won; we only care the combined outcome holds.
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual(["idempotent_replay", "inserted"]);

      const inserted = a.status === "inserted" ? a : b;
      const replayed = a.status === "idempotent_replay" ? a : b;

      expect(inserted.httpStatus).toBe(201);
      expect(replayed.httpStatus).toBe(409);

      // Both calls return the SAME exception_id, correlation_id,
      // compensating_date — the §3.1 result-shape contract for
      // idempotent_replay.
      expect(replayed.exceptionId).toBe(inserted.exceptionId);
      expect(replayed.correlationId).toBe(inserted.correlationId);
      expect(replayed.compensatingDate).toBe(inserted.compensatingDate);
      expect(replayed.newEndDate).toBe(inserted.newEndDate);

      // Exactly one row in subscription_exceptions for this
      // (subscription_id, idempotency_key). The pre-INSERT SELECT path
      // OR the (theoretical) 23505-race path BOTH end up with one row.
      await withTenant(TENANT_ID, async (tx) => {
        type Row = { count: number } & Record<string, unknown>;
        const rows = await tx.execute<Row>(sqlTag`
          SELECT COUNT(*)::int AS count
          FROM subscription_exceptions
          WHERE subscription_id = ${SUBSCRIPTION_ID}
            AND idempotency_key = ${sharedKey}
        `);
        expect(rows[0].count).toBe(1);
      });

      // Exactly one subscription.exception.created + one
      // subscription.end_date.extended audit row for this correlation_id.
      // Replay path emits NO new audit per plan §2.3 — the replayed
      // call must NOT emit duplicates.
      await withServiceRole(
        "svc-a concurrent audit count check",
        async (tx) => {
          type Row = { event_type: string; n: number } & Record<string, unknown>;
          const rows = await tx.execute<Row>(sqlTag`
            SELECT event_type, COUNT(*)::int AS n
            FROM audit_events
            WHERE metadata->>'correlation_id' = ${inserted.correlationId}
            GROUP BY event_type
          `);
          const counts = new Map(rows.map((r) => [r.event_type, r.n]));
          expect(counts.get("subscription.exception.created")).toBe(1);
          expect(counts.get("subscription.end_date.extended")).toBe(1);
        },
      );
    },
  );
});
