// tests/integration/subscription-windowless-resume.spec.ts
// =============================================================================
// Day-53 R-B — windowless-resume conformance (auto-pause stranding fix).
// Plan: memory/plans/day-53-session-c-rb-windowless-resume.md §5 — real
// Postgres; contract memory/triage_five_races_findings.md §R-B.
//
// Cases pinned:
//   1. Auto-pause writes status='paused' with NO pause_window exception
//      row (the bifurcation), then manual resume RECOVERS it: status
//      flips to 'active', paused_at clears, subscription.resumed is
//      emitted with windowless_recovery=true + correlation_id NULL.
//   2. Idempotency — a second manual resume returns already_active and
//      emits nothing (exactly one subscription.resumed row).
//   3. Emergency-halt guard — the auto-resume path (is_auto_resume)
//      does NOT recover a windowless-paused subscription, and the
//      auto-resume cron's selection SQL (verbatim from
//      src/app/api/cron/auto-resume/route.ts) can never select it.
//   4. Bounded-pause regression — operator pause → resume still goes
//      through the windowed branch: emit carries the window's
//      correlation_id and NO windowless_recovery marker.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// R2 pause-leg publisher mock (bounded-pause regression case fans out
// SF cancels — not under test here; no seeded task carries an AWB).
vi.mock("../../src/modules/task-outbound-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/task-outbound-queue")>();
  return {
    ...actual,
    enqueueBulkCancelTasks: vi.fn(async (payloads: readonly unknown[]) => ({
      enqueuedCount: payloads.length,
      failedChunks: 0,
      totalCount: payloads.length,
    })),
  };
});

// R16 re-push publisher mock — windowless recovery must never call it.
const enqueueTaskPushBatchSpy = vi.hoisted(() =>
  vi.fn(async (input: { taskIds: readonly string[] }) => ({
    enqueuedCount: input.taskIds.length,
    failedChunks: 0,
  })),
);
vi.mock("../../src/modules/task-materialization/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/task-materialization/queue")>();
  return { ...actual, enqueueTaskPushBatch: enqueueTaskPushBatchSpy };
});

// Imports AFTER mocks.
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";
import {
  autoPauseSubscriptionForRepeatedFailure,
  pauseSubscription,
  resumeSubscription,
} from "../../src/modules/subscriptions/service";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `rb-${RUN_ID}`;
const USER = randomUUID() as Uuid;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;

const SUB_RECOVER = randomUUID() as Uuid; // cases 1+2
const SUB_GUARD = randomUUID() as Uuid; // case 3
const SUB_BOUNDED = randomUUID() as Uuid; // case 4

// Wednesday-anchored far-future dates (cut-off safe) — same shape as
// the R16 spec this file is modeled on.
function nextWedAfter(daysOffset: number): string {
  const dt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
  const day = dt.getUTCDay();
  const wedDelta = ((3 - day + 7) % 7) || 7;
  dt.setUTCDate(dt.getUTCDate() + wedDelta);
  return dt.toISOString().slice(0, 10);
}
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const WED_1 = nextWedAfter(30);
const WED_2 = nextWedAfter(37);
const SUB_END = nextWedAfter(180);
const PAUSE_START = dayBefore(WED_1);
const PAUSE_END = dayAfter(WED_2);

function ctxFor(): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: USER,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${USER}@rb.example`,
      displayName: null,
    },
    tenantId: TENANT,
    requestId: `req-${RUN_ID}`,
    path: "/api/test",
  };
}

function systemCtx(system: string): RequestContext {
  return {
    actor: {
      kind: "system",
      system,
      tenantId: TENANT,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
    } as never,
    tenantId: TENANT,
    requestId: `req-${RUN_ID}-sys`,
    path: "/api/test-system",
  };
}

async function seedSubscription(subId: Uuid): Promise<void> {
  await withServiceRole(`rb seed sub ${subId}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO subscriptions (id, tenant_id, consignee_id, status, start_date, end_date,
        days_of_week, delivery_window_start, delivery_window_end)
      VALUES (${subId}, ${TENANT}, ${CONSIGNEE}, 'active',
        ${WED_1}, ${SUB_END}, ARRAY[3]::int[], '09:00:00', '18:00:00')
    `);
  });
}

async function autoPause(subId: Uuid): Promise<void> {
  await autoPauseSubscriptionForRepeatedFailure(systemCtx("cron:failed_push_retry"), {
    subscriptionId: subId,
    taskId: randomUUID() as Uuid,
    failureCount: 3,
    lastError: `rb-${RUN_ID} synthetic repeated push failure`,
  });
}

type SubStateRow = { status: string; paused_at: string | null; end_date: string | null };

async function readSubState(subId: Uuid): Promise<SubStateRow> {
  return withTenant(TENANT, async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT status, paused_at::text AS paused_at, end_date::text AS end_date
      FROM subscriptions WHERE id = ${subId}
    `)) as readonly SubStateRow[];
    return rows[0];
  });
}

async function countPauseWindows(subId: Uuid): Promise<number> {
  return withServiceRole("rb count pause windows", async (tx) => {
    const rows = (await tx.execute(sqlTag`
      SELECT count(*)::int AS n FROM subscription_exceptions
      WHERE subscription_id = ${subId} AND type = 'pause_window'
    `)) as readonly { n: number }[];
    return rows[0].n;
  });
}

type ResumedEventRow = { metadata: Record<string, unknown> };

async function readResumedEvents(subId: Uuid): Promise<readonly ResumedEventRow[]> {
  return withServiceRole("rb read resumed audits", async (tx) => {
    return (await tx.execute(sqlTag`
      SELECT metadata FROM audit_events
      WHERE event_type = 'subscription.resumed'
        AND tenant_id = ${TENANT}
        AND resource_id = ${subId}
      ORDER BY occurred_at ASC
    `)) as readonly ResumedEventRow[];
  });
}

describe("Day-53 R-B — windowless resume recovery (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("rb seed base", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'R-B Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'rb seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);
      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email)
        VALUES (${USER}, ${USER + "@rb.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email)
        VALUES (${USER}, ${TENANT}, ${USER + "@rb.example"})
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER}, r.id, ${TENANT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'R-B Consignee', 'cons@rb.test',
                '+971500000097', 'Test Line', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);
    });
  });

  it("case 1+2 — auto-pause strands without a window; manual resume recovers; second resume is idempotent", async () => {
    await seedSubscription(SUB_RECOVER);

    // Auto-pause: the bifurcation — paused with NO pause_window row.
    await autoPause(SUB_RECOVER);
    const paused = await readSubState(SUB_RECOVER);
    expect(paused.status).toBe("paused");
    expect(paused.paused_at).not.toBeNull();
    expect(await countPauseWindows(SUB_RECOVER)).toBe(0);

    // Manual resume — the R-B fix: windowless recovery.
    const result = await resumeSubscription(ctxFor(), SUB_RECOVER, {
      idempotency_key: randomUUID(),
    });
    expect(result.status).toBe("resumed");
    expect(result.correlation_id).toBeNull();
    expect(result.restored_task_count).toBe(0);
    expect(result.reactivated_task_count).toBe(0);

    const recovered = await readSubState(SUB_RECOVER);
    expect(recovered.status).toBe("active");
    expect(recovered.paused_at).toBeNull();
    expect(recovered.end_date).toBe(SUB_END); // untouched — no extension was granted

    // No task restore leg, no R16 re-push leg.
    expect(enqueueTaskPushBatchSpy).not.toHaveBeenCalled();

    // Audit: exactly one subscription.resumed with the windowless marker.
    const events = await readResumedEvents(SUB_RECOVER);
    expect(events.length).toBe(1);
    expect(events[0].metadata.windowless_recovery).toBe(true);
    expect(events[0].metadata.correlation_id).toBeNull();
    expect(events[0].metadata.restored_task_count).toBe(0);
    expect(events[0].metadata.paused_at_was).not.toBeNull();

    // Idempotency: second manual resume is a no-op, still one audit row.
    const second = await resumeSubscription(ctxFor(), SUB_RECOVER, {
      idempotency_key: randomUUID(),
    });
    expect(second.status).toBe("already_active");
    expect((await readResumedEvents(SUB_RECOVER)).length).toBe(1);
  });

  it("case 3 — emergency-halt guard: auto path does not recover; cron selection SQL never sees a windowless sub", async () => {
    await seedSubscription(SUB_GUARD);
    await autoPause(SUB_GUARD);

    // Auto-resume path (is_auto_resume) must NOT flip a windowless sub.
    const result = await resumeSubscription(
      systemCtx("cron:auto_resume"),
      SUB_GUARD,
      { idempotency_key: randomUUID() },
      { is_auto_resume: true },
    );
    expect(result.status).toBe("already_active");
    expect((await readSubState(SUB_GUARD)).status).toBe("paused");
    expect((await readResumedEvents(SUB_GUARD)).length).toBe(0);

    // The cron's due-window selection (verbatim shape from
    // src/app/api/cron/auto-resume/route.ts) cannot select it either:
    // selection is pause_window-driven and auto-pause wrote none.
    const today = new Date().toISOString().slice(0, 10);
    const dueForSub = await withServiceRole("rb cron exclusion pin", async (tx) => {
      return (await tx.execute(sqlTag`
        SELECT id FROM subscription_exceptions
        WHERE type = 'pause_window'
          AND end_date <= ${today}::date
          AND subscription_id = ${SUB_GUARD}
          AND NOT EXISTS (
            SELECT 1 FROM audit_events
            WHERE event_type = 'subscription.resumed'
              AND (metadata->>'correlation_id')::uuid = subscription_exceptions.correlation_id
          )
      `)) as readonly { id: string }[];
    });
    expect(dueForSub.length).toBe(0);
  });

  it("case 4 — bounded-pause regression: windowed resume still carries the window's correlation_id, no windowless marker", async () => {
    await seedSubscription(SUB_BOUNDED);

    const pause = await pauseSubscription(ctxFor(), SUB_BOUNDED, {
      pause_start: PAUSE_START,
      pause_end: PAUSE_END,
      idempotency_key: randomUUID(),
    });
    expect(pause.status).toBe("inserted");

    const result = await resumeSubscription(ctxFor(), SUB_BOUNDED, {
      idempotency_key: randomUUID(),
    });
    expect(result.status).toBe("resumed");
    expect(result.correlation_id).toBe(pause.correlation_id);

    const events = await readResumedEvents(SUB_BOUNDED);
    expect(events.length).toBe(1);
    expect(events[0].metadata.correlation_id).toBe(pause.correlation_id);
    expect(events[0].metadata.windowless_recovery).toBeUndefined();
  });
});
