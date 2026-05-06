// Service B integration tests — Day-16 Block 4-C.
//
// Real Postgres (CI service container per ci.yml). Seeds tenants,
// users, role_assignments, subscriptions, addresses, tasks, then
// exercises the bounded pause + manual resume + auto-resume cron
// surface end-to-end.
//
// Coverage:
//   1. End-to-end pause: tasks in window → CANCELED, end_date extended,
//      exception inserted, audit events emit with shared correlation_id
//   2. End-to-end manual resume on/after pause_end: status flipped,
//      no end_date change (full duration honored)
//   3. End-to-end early manual resume: end_date recomputed shorter,
//      tasks restored where target_date >= today
//   4. End-to-end auto-resume cron: handler picks up pause where
//      end_date elapsed → status flipped + audit emitted with
//      is_auto_resume=true
//
// Pattern mirrors tests/integration/auth-end-to-end.spec.ts +
// tests/integration/subscription-exceptions/service.spec.ts — fresh
// CI container precedent, no afterAll cleanup.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole, withTenant } from "../../../src/shared/db";
import type { Actor, RequestContext } from "../../../src/shared/tenant-context";
import type { Uuid } from "../../../src/shared/types";

import { pauseSubscription, resumeSubscription } from "../../../src/modules/subscriptions";
import { ALL_PERMISSION_IDS } from "../../../src/modules/identity/permissions";
import { GET as autoResumeHandler } from "../../../src/app/api/cron/auto-resume/route";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_ID = randomUUID() as Uuid;
const SLUG = `svc-b-test-${RUN_ID}`;
const USER_ID = randomUUID() as Uuid;
const CONSIGNEE_ID = randomUUID() as Uuid;

const CRON_SECRET = `test-cron-secret-${RUN_ID}`;

/**
 * Pick a future Monday-Friday window so eligibility is straightforward.
 * Walk forward from today to the next Monday + cover Mon-Fri × 2 weeks.
 */
function nextMonday(now: Date): Date {
  const dt = new Date(now.getTime());
  const day = dt.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMon = ((1 - day + 7) % 7) || 7; // never zero — always future
  dt.setUTCDate(dt.getUTCDate() + offsetToMon);
  return dt;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function userCtx(): RequestContext {
  const actor: Actor = {
    kind: "user",
    userId: USER_ID,
    tenantId: TENANT_ID,
    permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
    email: `${USER_ID}@svc-b-test.example`,
    displayName: null,
  };
  return {
    actor,
    tenantId: TENANT_ID,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

describe("Service B (subscriptions pause/resume) — integration", () => {
  beforeAll(async () => {
    await withServiceRole("svc-b integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_ID}, ${SLUG}, 'Service B Test Tenant', 'active')
      `);

      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'svc-b-test seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES
          (${USER_ID}, ${"u-" + RUN_ID + "@svc-b-test.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email) VALUES
          (${USER_ID}, ${TENANT_ID}, ${"u-" + RUN_ID + "@svc-b-test.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_ID}, r.id, ${TENANT_ID} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);

      // address_line + emirate_or_region required per migration 0004
      // (NOT NULL); district added per migration 0013. Pattern matches
      // tests/integration/exception-model-rls-isolation.spec.ts:57-62.
      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district
        ) VALUES (
          ${CONSIGNEE_ID}, ${TENANT_ID}, 'Consignee',
          'c@svc-b-test.example', '+971500000099',
          'Test Address Line', 'Dubai', 'Test District'
        )
      `);
    });
  });

  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  /**
   * Per-test fixture: create a fresh subscription with an end_date 4
   * weeks past today's Monday, daily Mon-Fri eligibility. Returns
   * the subscription id + key dates.
   */
  async function seedSubscription(
    now: Date,
  ): Promise<{
    subscriptionId: Uuid;
    pauseStart: string;
    pauseEnd: string;
    originalEndDate: string;
    inWindowDates: readonly string[];
  }> {
    const subscriptionId = randomUUID() as Uuid;
    const startMon = nextMonday(now);
    // Pause window: Mon..Fri of WEEK 2 (so cut-off doesn't elapse for the start).
    const pauseStartDt = addDays(startMon, 7);
    const pauseEndDt = addDays(pauseStartDt, 4); // Mon..Fri = 5 days inclusive
    const originalEndDt = addDays(startMon, 28); // 4 weeks of Mon-Fri starting WEEK 1
    // Walk forward to a Friday for tidy end_date.
    while (originalEndDt.getUTCDay() !== 5) {
      originalEndDt.setUTCDate(originalEndDt.getUTCDate() + 1);
    }

    const pauseStart = isoDate(pauseStartDt);
    const pauseEnd = isoDate(pauseEndDt);
    const originalEndDate = isoDate(originalEndDt);

    await withServiceRole("svc-b seed sub", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status, start_date, end_date,
          days_of_week, delivery_window_start, delivery_window_end
        ) VALUES (
          ${subscriptionId}, ${TENANT_ID}, ${CONSIGNEE_ID}, 'active',
          ${isoDate(startMon)}, ${originalEndDate},
          ARRAY[1,2,3,4,5]::int[], '09:00:00', '18:00:00'
        )
      `);
    });

    // Seed tasks for each Mon-Fri date in the pause window.
    const inWindowDates: string[] = [];
    for (let i = 0; i < 5; i++) {
      inWindowDates.push(isoDate(addDays(pauseStartDt, i)));
    }
    // delivery_start_time + delivery_end_time required per migration
    // 0006 (NOT NULL). Values match this spec's subscriptions seed
    // delivery_window_start/end at line 168.
    await withTenant(TENANT_ID, async (tx) => {
      for (const d of inWindowDates) {
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id,
            customer_order_number, internal_status, delivery_date,
            delivery_start_time, delivery_end_time,
            delivery_type, task_kind
          ) VALUES (
            ${TENANT_ID}, ${CONSIGNEE_ID}, ${subscriptionId},
            ${"CO-" + RUN_ID + "-" + d}, 'CREATED', ${d},
            '09:00', '18:00',
            'STANDARD', 'DELIVERY'
          )
        `);
      }
    });

    return { subscriptionId, pauseStart, pauseEnd, originalEndDate, inWindowDates };
  }

  it("end-to-end pause: tasks → CANCELED, end_date extended, exception inserted, shared correlation_id audit", async () => {
    const now = new Date();
    const seed = await seedSubscription(now);

    const result = await pauseSubscription(
      userCtx(),
      seed.subscriptionId,
      {
        pause_start: seed.pauseStart,
        pause_end: seed.pauseEnd,
        reason: "merchant-vacation integration test",
        idempotency_key: randomUUID(),
      },
      { now },
    );

    expect(result.status).toBe("inserted");
    expect(result.canceled_task_count).toBe(5);
    expect(result.new_end_date).not.toBe(seed.originalEndDate); // extended past

    // Verify exception row.
    await withTenant(TENANT_ID, async (tx) => {
      type Row = {
        id: string;
        type: string;
        start_date: string;
        end_date: string;
        correlation_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT id, type, start_date, end_date, correlation_id
        FROM subscription_exceptions
        WHERE subscription_id = ${seed.subscriptionId}
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].type).toBe("pause_window");
      expect(rows[0].start_date).toBe(seed.pauseStart);
      expect(rows[0].end_date).toBe(seed.pauseEnd);
      expect(rows[0].correlation_id).toBe(result.correlation_id);
    });

    // Verify all 5 tasks in window flipped to CANCELED.
    await withTenant(TENANT_ID, async (tx) => {
      type Row = { internal_status: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT internal_status FROM tasks
        WHERE subscription_id = ${seed.subscriptionId}
          AND delivery_date BETWEEN ${seed.pauseStart} AND ${seed.pauseEnd}
      `);
      expect(rows.length).toBe(5);
      expect(rows.every((r) => r.internal_status === "CANCELED")).toBe(true);
    });

    // Verify subscription state.
    await withTenant(TENANT_ID, async (tx) => {
      type Row = { status: string; end_date: string; paused_at: string | null } & Record<
        string,
        unknown
      >;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT status, end_date, paused_at FROM subscriptions WHERE id = ${seed.subscriptionId}
      `);
      expect(rows[0].status).toBe("paused");
      expect(rows[0].end_date).toBe(result.new_end_date);
      expect(rows[0].paused_at).not.toBeNull();
    });

    // Verify audit-event pair with shared correlation_id.
    await withServiceRole("svc-b audit pause check", async (tx) => {
      type Row = { event_type: string; metadata: { correlation_id: string } } & Record<
        string,
        unknown
      >;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE tenant_id = ${TENANT_ID}
          AND (metadata->>'correlation_id') = ${result.correlation_id}
        ORDER BY occurred_at ASC
      `);
      const eventTypes = rows.map((r) => r.event_type);
      expect(eventTypes).toContain("subscription.paused");
      expect(eventTypes).toContain("subscription.end_date.extended");
    });
  });

  it("end-to-end manual resume on/after pause_end: status flipped, no end_date change", async () => {
    const now = new Date();
    const seed = await seedSubscription(now);

    // Pause first.
    const pauseResult = await pauseSubscription(
      userCtx(),
      seed.subscriptionId,
      {
        pause_start: seed.pauseStart,
        pause_end: seed.pauseEnd,
        idempotency_key: randomUUID(),
      },
      { now },
    );

    // Resume on pause_end Dubai-side (18:00 UTC = 22:00 Dubai, still
    // pauseEnd day in Dubai). The service computes
    // actual_resume_date = computeTodayInDubai(now); using 23:59 UTC
    // would push Dubai today to pauseEnd + 1, breaking the assertion
    // at line below. 18:00 UTC keeps Dubai today = pauseEnd.
    const resumeNow = new Date(`${seed.pauseEnd}T18:00:00.000Z`);
    addDays(new Date(seed.pauseEnd), 1); // sanity ref
    const resumeResult = await resumeSubscription(
      userCtx(),
      seed.subscriptionId,
      { idempotency_key: randomUUID() },
      { now: resumeNow },
    );

    expect(resumeResult.status).toBe("resumed");
    expect(resumeResult.actual_resume_date).toBe(seed.pauseEnd); // capped at pause_end via cron-style logic? actually for manual past pause_end, actual = today_in_dubai which is past pause_end — so actual_resume_date will be > pause_end, NO shrink applies (today >= pause_end → not early)
    // Note: for "after pause_end" manual resume, the logic is: not is_auto_resume + actual_resume_date = today >= pause_end → not early. No shrink.
    expect(resumeResult.new_end_date).toBe(pauseResult.new_end_date); // unchanged
    expect(resumeResult.restored_task_count).toBe(0);

    // Verify subscription state.
    await withTenant(TENANT_ID, async (tx) => {
      type Row = { status: string; end_date: string; paused_at: string | null } & Record<
        string,
        unknown
      >;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT status, end_date, paused_at FROM subscriptions WHERE id = ${seed.subscriptionId}
      `);
      expect(rows[0].status).toBe("active");
      expect(rows[0].paused_at).toBeNull();
      expect(rows[0].end_date).toBe(pauseResult.new_end_date); // full extension preserved
    });
  });

  it("end-to-end early manual resume: end_date recomputed shorter + tasks with target_date >= today restored", async () => {
    const now = new Date();
    const seed = await seedSubscription(now);

    const pauseResult = await pauseSubscription(
      userCtx(),
      seed.subscriptionId,
      {
        pause_start: seed.pauseStart,
        pause_end: seed.pauseEnd,
        idempotency_key: randomUUID(),
      },
      { now },
    );

    // Early manual resume: simulate `today` = pauseStart + 2 days
    // (Wed of pause week — 2 eligible days have passed).
    const earlyResumeNow = new Date(`${isoDate(addDays(new Date(seed.pauseStart), 2))}T09:00:00.000Z`);
    const resumeResult = await resumeSubscription(
      userCtx(),
      seed.subscriptionId,
      { idempotency_key: randomUUID() },
      { now: earlyResumeNow },
    );

    expect(resumeResult.status).toBe("resumed");
    // Original extension was 5 eligible days; effective is 2 (Mon, Tue).
    // shrinkBy = 5 - 2 = 3 → end_date walks backward 3 eligible days.
    expect(resumeResult.new_end_date).not.toBe(pauseResult.new_end_date);
    expect(resumeResult.restored_task_count).toBeGreaterThan(0);

    // Verify tasks at and after `today` were restored (CREATED), and
    // tasks before `today` stayed CANCELED.
    const todayIso = earlyResumeNow.toISOString().slice(0, 10);
    await withTenant(TENANT_ID, async (tx) => {
      type Row = { delivery_date: string; internal_status: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT delivery_date, internal_status FROM tasks
        WHERE subscription_id = ${seed.subscriptionId}
          AND delivery_date BETWEEN ${seed.pauseStart} AND ${seed.pauseEnd}
        ORDER BY delivery_date ASC
      `);
      for (const r of rows) {
        if (r.delivery_date >= todayIso) {
          expect(r.internal_status).toBe("CREATED");
        } else {
          expect(r.internal_status).toBe("CANCELED");
        }
      }
    });
  });

  it("end-to-end auto-resume cron: handler picks up elapsed-pause subscription → status flipped + audit with is_auto_resume=true", async () => {
    const now = new Date();
    const seed = await seedSubscription(now);

    // Pause the subscription with a window that has ALREADY ELAPSED.
    // To force this: pause with pause_end set to yesterday by injecting
    // `now` far past pause_end. We'll seed the pause window normally
    // and then manually backdate the exception's end_date so the cron
    // selection SQL picks it up.
    const pauseResult = await pauseSubscription(
      userCtx(),
      seed.subscriptionId,
      {
        pause_start: seed.pauseStart,
        pause_end: seed.pauseEnd,
        idempotency_key: randomUUID(),
      },
      { now },
    );

    // Backdate the exception's end_date to yesterday so the cron
    // picks it up. (This simulates the natural-time-passes scenario.)
    const yesterdayIso = isoDate(addDays(now, -1));
    await withServiceRole("svc-b backdate pause", async (tx) => {
      await tx.execute(sqlTag`
        UPDATE subscription_exceptions
        SET end_date = ${yesterdayIso}
        WHERE id = ${pauseResult.exception_id}
      `);
    });

    // Invoke the cron handler.
    const req = new Request("http://localhost/api/cron/auto-resume", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const response = await autoResumeHandler(req);
    const body = (await response.json()) as {
      total_due: number;
      resumed_count: number;
      already_active_count: number;
      error_count: number;
    };

    expect(response.status).toBe(200);
    expect(body.total_due).toBeGreaterThanOrEqual(1);
    expect(body.resumed_count).toBeGreaterThanOrEqual(1);

    // Verify subscription is now active.
    await withTenant(TENANT_ID, async (tx) => {
      type Row = { status: string; paused_at: string | null } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT status, paused_at FROM subscriptions WHERE id = ${seed.subscriptionId}
      `);
      expect(rows[0].status).toBe("active");
      expect(rows[0].paused_at).toBeNull();
    });

    // Verify audit event with is_auto_resume=true.
    await withServiceRole("svc-b audit auto-resume check", async (tx) => {
      type Row = {
        event_type: string;
        metadata: { is_auto_resume: boolean; correlation_id: string };
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE event_type = 'subscription.resumed'
          AND (metadata->>'correlation_id') = ${pauseResult.correlation_id}
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].metadata.is_auto_resume).toBe(true);
    });
  });
});
