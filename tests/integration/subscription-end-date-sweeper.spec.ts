// tests/integration/subscription-end-date-sweeper.spec.ts
// =============================================================================
// C-8 — integration test for the end-date sweeper service.
//
// Pins the real-DB ACTIVE → ENDED transition that the Day-12 cron
// invokes via sweepEndedSubscriptions. Three load-bearing properties:
//
//   1. Subscriptions whose end_date < asOfDate transition from
//      'active' (or 'paused') to 'ended', with ended_at set and
//      paused_at cleared if previously set.
//   2. Subscriptions whose end_date is in the future, NULL, or
//      already 'ended' do NOT transition.
//   3. The audit_events table receives one subscription.ended row per
//      transitioned subscription, with metadata.trigger_source =
//      'sweeper' (vs 'user' for operator-driven endSubscription).
//
// Determinism: random per-run UUIDs.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sweepEndedSubscriptions } from "@/modules/subscriptions";
import { withServiceRole } from "@/shared/db";
import type { Actor, RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

type IdRow = { id: string } & Record<string, unknown>;
type StatusRow = { status: string; ended_at: string | null } & Record<string, unknown>;
type AuditRow = {
  resource_id: string;
  metadata: { trigger_source?: string; previous_status?: string };
} & Record<string, unknown>;

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const TENANT_SLUG = `c8-sweep-${RUN_ID}`;

// Sweep "asOfDate" = 2026-05-15. Candidates have end_date strictly < that.
const AS_OF_DATE = "2026-05-15";

function systemCtx(tenantId: Uuid): RequestContext {
  const actor: Actor = {
    kind: "system",
    system: "cron:end_expired",
    tenantId,
    permissions: new Set(),
  };
  return { actor, tenantId, requestId: `c8-test-${RUN_ID}`, path: "/cron/end-expired" };
}

describe("C-8 — end-date sweeper service", () => {
  let consigneeId: string;
  let activeExpiredSub: string; // end_date < asOfDate, status='active' → SHOULD sweep
  let pausedExpiredSub: string; // end_date < asOfDate, status='paused' → SHOULD sweep (clears paused_at)
  let activeFutureSub: string; // end_date > asOfDate → SHOULD NOT sweep
  let activeOpenEndedSub: string; // end_date IS NULL → SHOULD NOT sweep
  let alreadyEndedSub: string; // status='ended' → SHOULD NOT sweep

  beforeAll(async () => {
    await withServiceRole("C-8 sweep test setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name) VALUES
          (${TENANT_ID}, ${TENANT_SLUG}, 'C-8 Sweep Test Tenant')
      `);

      const cR = await tx.execute<IdRow>(sqlTag`
        INSERT INTO consignees (
          tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES (
          ${TENANT_ID}, 'C-8 Consignee', ${`c8-${RUN_ID}`}, 'Test Address', 'Dubai', 'Test District'
        )
        RETURNING id
      `);
      consigneeId = cR[0].id;

      // Helper: insert a subscription with given end_date and status.
      const insertSub = async (
        endDate: string | null,
        status: "active" | "paused" | "ended",
        pausedAt: string | null = null,
        endedAt: string | null = null,
      ): Promise<string> => {
        const rows = await tx.execute<IdRow>(sqlTag`
          INSERT INTO subscriptions (
            tenant_id, consignee_id, status,
            start_date, end_date,
            days_of_week, delivery_window_start, delivery_window_end,
            paused_at, ended_at
          ) VALUES (
            ${TENANT_ID}, ${consigneeId}, ${status},
            '2026-04-01', ${endDate},
            ARRAY[1, 3, 5]::integer[], '14:00', '16:00',
            ${pausedAt}, ${endedAt}
          )
          RETURNING id
        `);
        return rows[0].id;
      };

      activeExpiredSub = await insertSub("2026-05-10", "active");                // < AS_OF_DATE → sweep
      pausedExpiredSub = await insertSub(
        "2026-05-12",
        "paused",
        "2026-05-01T00:00:00Z",
      ); // < AS_OF_DATE → sweep
      activeFutureSub = await insertSub("2026-06-01", "active");                  // > AS_OF_DATE → no sweep
      activeOpenEndedSub = await insertSub(null, "active");                       // NULL → no sweep
      alreadyEndedSub = await insertSub(
        "2026-05-01",
        "ended",
        null,
        "2026-05-02T00:00:00Z",
      );  // status='ended' → no sweep
    });
  });

  afterAll(async () => {
    // Cleanup. Same audit-RULE-vs-FK-CASCADE caveat as the C-2 tests:
    // wrap in try/catch and skip the tenants delete; random UUID
    // prevents cross-run pollution.
    try {
      await withServiceRole("C-8 sweep cleanup", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${TENANT_ID}`);
        await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${TENANT_ID}`);
      });
    } catch {
      /* cleanup failure is not test failure */
    }
  });

  it("sweeps active+expired and paused+expired; leaves future / open-ended / already-ended untouched", async () => {
    const result = await sweepEndedSubscriptions(systemCtx(TENANT_ID), AS_OF_DATE);

    expect(result.swept).toBe(2);
    expect(result.subscriptionIds).toEqual(
      expect.arrayContaining([activeExpiredSub, pausedExpiredSub]),
    );
    expect(result.subscriptionIds).not.toContain(activeFutureSub);
    expect(result.subscriptionIds).not.toContain(activeOpenEndedSub);
    expect(result.subscriptionIds).not.toContain(alreadyEndedSub);
    expect(result.skippedDueToRace).toBe(0);

    // Verify post-state in DB.
    const rows = await withServiceRole("C-8 sweep verify", async (tx) =>
      tx.execute<StatusRow & { id: string; paused_at: string | null }>(sqlTag`
        SELECT id, status, ended_at, paused_at
        FROM subscriptions
        WHERE tenant_id = ${TENANT_ID}
        ORDER BY id
      `),
    );

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[activeExpiredSub].status).toBe("ended");
    expect(byId[activeExpiredSub].ended_at).not.toBeNull();
    expect(byId[pausedExpiredSub].status).toBe("ended");
    expect(byId[pausedExpiredSub].ended_at).not.toBeNull();
    // paused_at cleared by endSubscription's UPDATE.
    expect(byId[pausedExpiredSub].paused_at).toBeNull();
    // Untouched rows.
    expect(byId[activeFutureSub].status).toBe("active");
    expect(byId[activeOpenEndedSub].status).toBe("active");
    expect(byId[alreadyEndedSub].status).toBe("ended");
  });

  it("emits subscription.ended with trigger_source: 'sweeper' for each transitioned row", async () => {
    const events = await withServiceRole("C-8 sweep audit verify", async (tx) =>
      tx.execute<AuditRow>(sqlTag`
        SELECT resource_id, metadata
        FROM audit_events
        WHERE tenant_id = ${TENANT_ID}
          AND event_type = 'subscription.ended'
        ORDER BY occurred_at ASC
      `),
    );

    expect(events.length).toBe(2);
    const sweptIds = events.map((e) => e.resource_id).sort();
    expect(sweptIds).toEqual([activeExpiredSub, pausedExpiredSub].sort());

    for (const event of events) {
      expect(event.metadata.trigger_source).toBe("sweeper");
    }

    const activeEvent = events.find((e) => e.resource_id === activeExpiredSub);
    const pausedEvent = events.find((e) => e.resource_id === pausedExpiredSub);
    expect(activeEvent?.metadata.previous_status).toBe("active");
    expect(pausedEvent?.metadata.previous_status).toBe("paused");
  });

  it("re-running the sweep with the same asOfDate is idempotent (zero swept, no new audit emits)", async () => {
    // After the first sweep (above test), the previously-active+expired
    // and paused+expired rows are now 'ended'. A second sweep with the
    // same asOfDate should find zero candidates (status='ended' is
    // excluded by the candidate query).
    const result = await sweepEndedSubscriptions(systemCtx(TENANT_ID), AS_OF_DATE);

    expect(result.swept).toBe(0);
    expect(result.subscriptionIds).toEqual([]);
    expect(result.skippedDueToRace).toBe(0);

    // Audit count unchanged.
    const events = await withServiceRole("C-8 idempotency audit verify", async (tx) =>
      tx.execute<{ n: number }>(sqlTag`
        SELECT count(*)::int AS n
        FROM audit_events
        WHERE tenant_id = ${TENANT_ID}
          AND event_type = 'subscription.ended'
      `),
    );
    expect(events[0].n).toBe(2);
  });
});
