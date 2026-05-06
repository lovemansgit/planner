// Block 4-G integration test — §9.4 happy-path E2E + §9.3 rows 10/11.
//
// Three it() blocks closing the cron-handoff coverage gaps left open
// after Service A-E unit + Service A integration:
//
//   1. §9.4 happy-path E2E — skip flow + cron-handoff materialization
//      with locked dates per merged plan §9.4 (Mon-Fri ending Fri
//      2026-05-29, skip Wed 2026-05-13, new_end_date Mon 2026-06-01).
//   2. §9.3 row 10 — address-rotation cron re-materialization at
//      Layer 3 of the materialization service's COALESCE.
//   3. §9.3 row 11 — address-override one-off cron re-materialization
//      at Layer 1 of the materialization service's COALESCE.
//
// -----------------------------------------------------------------------------
// Time-travel pattern (Block 4-G reviewer ruling, Path A)
// -----------------------------------------------------------------------------
// Plan §9.4 dates are LOCKED verbatim. Real "today" per system context
// is 2026-05-06; the cron's 14-day horizon = today + 14 = 2026-05-20.
// The plan §9.4 expected new_end_date 2026-06-01 = today + 26 cannot
// be materialized without time-traveling the cron's "today" to
// 2026-05-18 or later (target_date then = 2026-06-01).
//
// Approach: vi.useFakeTimers({ toFake: ['Date'] }) — fakes ONLY Date,
// leaves setTimeout/setInterval real so the postgres-js driver's
// connection-timeout setTimeouts aren't frozen. This addresses the
// pitfall flagged in tests/integration/cron-decoupling-happy-path.spec.ts
// line 105 comment ("mocking timers globally would freeze those").
// Pair with vi.setSystemTime() to step "today" between cron ticks.
//
// This is the first integration spec in the repo to use fake timers;
// the precedent is documented here per the Block 4-G reviewer ruling
// header-comment requirement. The pattern is justified by the §9.4
// verbatim-dates lock — ad-hoc today-relative arithmetic was the
// alternative (Path B), but the reviewer ruled in favour of Path A
// to preserve the plan's literal date assertions.
//
// -----------------------------------------------------------------------------
// Cron-mock infrastructure
// -----------------------------------------------------------------------------
// Mirrors tests/integration/cron-decoupling-happy-path.spec.ts (NOT
// pause-resume.spec.ts:381, which tests the auto-resume cron and has
// no QStash interaction):
//   - vi.mock @upstash/qstash + Client.batchJSON spy (no real network)
//   - vi.mock @upstash/qstash/nextjs verifySignatureAppRouter passthrough
//   - vi.mock list-cron-eligible-tenants — narrow per-test to one tenant
//   - dummy QSTASH_TOKEN + QSTASH_FLOW_CONTROL_KEY env vars
//   - GET-import as cronGet (cron handler is GET, not POST)
//
// Three separate tenants (one per it() block) so each tick's
// (tenant_id, target_date) tuple in task_generation_runs cannot
// collide across tests via the migration-0020 UNIQUE constraint.

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const batchJSONSpy = vi.hoisted(() => vi.fn());
vi.mock("@upstash/qstash", () => ({
  Client: function MockClient(this: { batchJSON: typeof batchJSONSpy }) {
    this.batchJSON = batchJSONSpy;
  },
}));

vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

const eligibleTenantIdsSpy = vi.hoisted(() => vi.fn());
vi.mock(
  "../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants",
  () => ({
    listCronEligibleTenantIds: eligibleTenantIdsSpy,
  }),
);

import { GET as cronGet } from "../../src/app/api/cron/generate-tasks/route";
import { withServiceRole, withTenant } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Uuid } from "../../src/shared/types";

import { addSubscriptionException } from "../../src/modules/subscription-exceptions";
import { changeAddressRotation } from "../../src/modules/subscription-addresses";
import { ALL_PERMISSION_IDS } from "../../src/modules/identity/permissions";

const RUN_ID = randomUUID().slice(0, 8);

// 3 separate tenants — one per it() block. Avoids
// task_generation_runs (tenant_id, target_date) UNIQUE collisions
// when two it() blocks happen to fire cron ticks at the same
// system-clock anchor.
const TENANT_E2E = randomUUID() as Uuid;
const TENANT_ROT = randomUUID() as Uuid;
const TENANT_OV = randomUUID() as Uuid;

const SLUG_E2E = `bg4g-e2e-${RUN_ID}`;
const SLUG_ROT = `bg4g-rot-${RUN_ID}`;
const SLUG_OV = `bg4g-ov-${RUN_ID}`;

const USER_E2E = randomUUID() as Uuid;
const USER_ROT = randomUUID() as Uuid;
const USER_OV = randomUUID() as Uuid;

const CONSIGNEE_E2E = randomUUID() as Uuid;
const CONSIGNEE_ROT = randomUUID() as Uuid;
const CONSIGNEE_OV = randomUUID() as Uuid;

const SUB_E2E = randomUUID() as Uuid;
const SUB_ROT = randomUUID() as Uuid;
const SUB_OV = randomUUID() as Uuid;

const ADDR_E2E_PRIMARY = randomUUID() as Uuid;
const ADDR_ROT_PRIMARY = randomUUID() as Uuid; // consignee primary (Layer 4 fallback)
const ADDR_ROT_B = randomUUID() as Uuid; // initial Mon rotation
const ADDR_ROT_C = randomUUID() as Uuid; // post-PATCH Mon rotation
const ADDR_OV_PRIMARY = randomUUID() as Uuid; // consignee primary (Layer 4 fallback)
const ADDR_OV_OVERRIDE = randomUUID() as Uuid; // override target (Layer 1)

const CRON_SECRET = `bg4g-cron-secret-${RUN_ID}`;

function ctxFor(
  tenantId: Uuid,
  userId: Uuid,
  requestPath = "/api/test",
): RequestContext {
  return {
    actor: {
      kind: "user",
      userId,
      tenantId,
      permissions: new Set(ALL_PERMISSION_IDS) as unknown as Set<never>,
      email: `${userId}@bg4g.example`,
      displayName: null,
    },
    tenantId,
    requestId: `req-${RUN_ID}`,
    path: requestPath,
  };
}

async function triggerCron(): Promise<Response> {
  const cronReq = new Request(
    "https://test.example.com/api/cron/generate-tasks",
    { headers: { authorization: `Bearer ${CRON_SECRET}` } },
  );
  return cronGet(cronReq);
}

describe("Block 4-G integration — exception-model happy-path + cron handoff", () => {
  beforeAll(async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.PUBLIC_BASE_URL = "https://test.example.com";
    process.env.QSTASH_TOKEN = `bg4g-qstash-token-${RUN_ID}`;
    process.env.QSTASH_FLOW_CONTROL_KEY = `bg4g-${RUN_ID}`;

    batchJSONSpy.mockResolvedValue(undefined);

    await withServiceRole("bg4g block 4-g setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code) VALUES
          (${TENANT_E2E}, ${SLUG_E2E}, 'Block 4-G E2E Tenant', 'active', ${"E2E-" + RUN_ID}),
          (${TENANT_ROT}, ${SLUG_ROT}, 'Block 4-G Rotation Tenant', 'active', ${"ROT-" + RUN_ID}),
          (${TENANT_OV}, ${SLUG_OV}, 'Block 4-G Override Tenant', 'active', ${"OV-" + RUN_ID})
      `);

      await tx.execute(sqlTag`
        INSERT INTO roles (tenant_id, name, slug, description) VALUES
          (NULL, 'Tenant Admin', 'tenant-admin', 'bg4g block 4-g seed')
        ON CONFLICT (tenant_id, slug) DO NOTHING
      `);

      await tx.execute(sqlTag`
        INSERT INTO auth.users (id, email) VALUES
          (${USER_E2E}, ${"e2e-" + RUN_ID + "@bg4g.example"}),
          (${USER_ROT}, ${"rot-" + RUN_ID + "@bg4g.example"}),
          (${USER_OV}, ${"ov-" + RUN_ID + "@bg4g.example"})
      `);

      await tx.execute(sqlTag`
        INSERT INTO users (id, tenant_id, email) VALUES
          (${USER_E2E}, ${TENANT_E2E}, ${"e2e-" + RUN_ID + "@bg4g.example"}),
          (${USER_ROT}, ${TENANT_ROT}, ${"rot-" + RUN_ID + "@bg4g.example"}),
          (${USER_OV}, ${TENANT_OV}, ${"ov-" + RUN_ID + "@bg4g.example"})
      `);

      // Three role_assignment INSERTs — verbatim per pause-resume.spec.ts
      // pattern. One per (user, tenant).
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_E2E}, r.id, ${TENANT_E2E} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_ROT}, r.id, ${TENANT_ROT} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);
      await tx.execute(sqlTag`
        INSERT INTO role_assignments (user_id, role_id, tenant_id)
        SELECT ${USER_OV}, r.id, ${TENANT_OV} FROM roles r
        WHERE r.tenant_id IS NULL AND r.slug = 'tenant-admin'
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees (
          id, tenant_id, name, phone, address_line, emirate_or_region, district
        ) VALUES
          (${CONSIGNEE_E2E}, ${TENANT_E2E}, 'E2E Consignee',
           ${`e2e-phone-${RUN_ID}`}, 'E2E Addr', 'Dubai', 'E2E District'),
          (${CONSIGNEE_ROT}, ${TENANT_ROT}, 'ROT Consignee',
           ${`rot-phone-${RUN_ID}`}, 'ROT Addr', 'Dubai', 'ROT District'),
          (${CONSIGNEE_OV}, ${TENANT_OV}, 'OV Consignee',
           ${`ov-phone-${RUN_ID}`}, 'OV Addr', 'Dubai', 'OV District')
      `);

      // One primary address per consignee + extras for rotation/override.
      // Layer 4 (primary) is the cron's COALESCE fallback when no
      // override/rotation row matches.
      await tx.execute(sqlTag`
        INSERT INTO addresses (
          id, tenant_id, consignee_id, label, is_primary,
          line, district, emirate
        ) VALUES
          (${ADDR_E2E_PRIMARY}, ${TENANT_E2E}, ${CONSIGNEE_E2E},
           'home', true, 'E2E Primary Line', 'E2E District', 'Dubai'),
          (${ADDR_ROT_PRIMARY}, ${TENANT_ROT}, ${CONSIGNEE_ROT},
           'home', true, 'ROT Primary Line', 'ROT District', 'Dubai'),
          (${ADDR_ROT_B}, ${TENANT_ROT}, ${CONSIGNEE_ROT},
           'office', false, 'ROT B Line', 'ROT District', 'Dubai'),
          (${ADDR_ROT_C}, ${TENANT_ROT}, ${CONSIGNEE_ROT},
           'other', false, 'ROT C Line', 'ROT District', 'Dubai'),
          (${ADDR_OV_PRIMARY}, ${TENANT_OV}, ${CONSIGNEE_OV},
           'home', true, 'OV Primary Line', 'OV District', 'Dubai'),
          (${ADDR_OV_OVERRIDE}, ${TENANT_OV}, ${CONSIGNEE_OV},
           'office', false, 'OV Override Line', 'OV District', 'Dubai')
      `);
    });
  });

  beforeEach(() => {
    // Fakes only Date — leaves setTimeout/setInterval real so
    // postgres-js connection-timeout setTimeouts aren't frozen.
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    delete process.env.CRON_SECRET;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_FLOW_CONTROL_KEY;
  });

  // -------------------------------------------------------------------------
  // it 1 — §9.4 happy-path E2E: skip + cron-handoff materialization.
  //
  // Locked dates per plan §9.4:
  //   start_date     = 2026-05-04 (Mon — week before "today" 2026-05-06)
  //   end_date       = 2026-05-29 (Fri — original final delivery)
  //   skip_date      = 2026-05-13 (Wed — eligible weekday)
  //   new_end_date   = 2026-06-01 (Mon — first eligible past Fri 2026-05-29)
  //
  // Time-travel anchors:
  //   "2026-05-06T09:00:00.000Z" — Wed Dubai 13:00. Cut-off for skip
  //     (2026-05-12 18:00 Dubai = 2026-05-12 14:00 UTC) has NOT
  //     elapsed; skip accepted. cron target = 2026-05-20.
  //   "2026-05-18T09:00:00.000Z" — Mon Dubai 13:00. cron target =
  //     2026-06-01, which captures the tail-end task per the
  //     extended end_date.
  // -------------------------------------------------------------------------
  it("§9.4 happy-path E2E: skip Wed 2026-05-13 → end_date 2026-06-01 → cron materializes tail-end task", async () => {
    eligibleTenantIdsSpy.mockResolvedValue([TENANT_E2E]);

    const SUB_START = "2026-05-04";
    const SUB_END = "2026-05-29";
    const MAT_THROUGH_INITIAL = "2026-05-03"; // start_date - 1
    const SKIP_DATE = "2026-05-13"; // Wed
    const EXPECTED_NEW_END_DATE = "2026-06-01"; // Mon

    await withServiceRole("bg4g it1 sub seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status,
          start_date, end_date, days_of_week,
          delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUB_E2E}, ${TENANT_E2E}, ${CONSIGNEE_E2E}, 'active',
          ${SUB_START}::date, ${SUB_END}::date,
          ARRAY[1,2,3,4,5]::int[], '09:00', '18:00'
        )
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscription_materialization
          (subscription_id, tenant_id, materialized_through_date)
        VALUES
          (${SUB_E2E}, ${TENANT_E2E}, ${MAT_THROUGH_INITIAL}::date)
      `);
    });

    // Step 1 — anchor system time to 2026-05-06 09:00 UTC.
    vi.setSystemTime(new Date("2026-05-06T09:00:00.000Z"));

    // Step 2 — first cron tick materializes Mon-Fri tasks across
    // [2026-05-04, 2026-05-20]. Skip date 2026-05-13 (Wed) lands a
    // CREATED task pre-skip.
    const cron1Res = await triggerCron();
    expect(cron1Res.status).toBe(200);

    await withTenant(TENANT_E2E, async (tx) => {
      type Row = { internal_status: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT internal_status FROM tasks
        WHERE subscription_id = ${SUB_E2E}
          AND delivery_date = ${SKIP_DATE}::date
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].internal_status).toBe("CREATED");
    });

    // Step 3 — POST /api/subscriptions/[id]/skip (called via the
    // service surface; route layer is exercised separately at
    // src/app/api/subscriptions/[id]/skip/tests/route.spec.ts).
    const idempotencyKey = randomUUID() as Uuid;
    const skipResult = await addSubscriptionException(
      ctxFor(
        TENANT_E2E,
        USER_E2E,
        "/api/subscriptions/" + SUB_E2E + "/skip",
      ),
      SUB_E2E,
      {
        type: "skip",
        date: SKIP_DATE,
        idempotencyKey,
        reason: "block 4-g §9.4 happy-path test",
      },
    );

    // Step 4 — response carries correlation_id + new_end_date
    // 2026-06-01 + compensating_date 2026-06-01.
    expect(skipResult.status).toBe("inserted");
    expect(skipResult.httpStatus).toBe(201);
    expect(skipResult.compensatingDate).toBe(EXPECTED_NEW_END_DATE);
    expect(skipResult.newEndDate).toBe(EXPECTED_NEW_END_DATE);
    expect(skipResult.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Step 5 — subscription_exceptions row exists with correct shape.
    await withTenant(TENANT_E2E, async (tx) => {
      type Row = {
        type: string;
        start_date: string;
        compensating_date: string;
        correlation_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT type,
               start_date::text         AS start_date,
               compensating_date::text  AS compensating_date,
               correlation_id
        FROM subscription_exceptions
        WHERE id = ${skipResult.exceptionId}
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].type).toBe("skip");
      expect(rows[0].start_date).toBe(SKIP_DATE);
      expect(rows[0].compensating_date).toBe(EXPECTED_NEW_END_DATE);
      expect(rows[0].correlation_id).toBe(skipResult.correlationId);
    });

    // Step 6 — subscriptions.end_date extended.
    await withTenant(TENANT_E2E, async (tx) => {
      type Row = { end_date: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT end_date::text AS end_date
        FROM subscriptions WHERE id = ${SUB_E2E}
      `);
      expect(rows[0].end_date).toBe(EXPECTED_NEW_END_DATE);
    });

    // Step 7 — task on 2026-05-13 flipped to SKIPPED.
    await withTenant(TENANT_E2E, async (tx) => {
      type Row = { internal_status: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT internal_status FROM tasks
        WHERE subscription_id = ${SUB_E2E}
          AND delivery_date = ${SKIP_DATE}::date
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].internal_status).toBe("SKIPPED");
    });

    // Step 8 — audit pair shares correlation_id.
    await withServiceRole("bg4g it1 audit pair check", async (tx) => {
      type Row = { event_type: string } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT event_type
        FROM audit_events
        WHERE metadata->>'correlation_id' = ${skipResult.correlationId}
        ORDER BY occurred_at ASC
      `);
      const types = rows.map((r) => r.event_type);
      expect(types).toContain("subscription.exception.created");
      expect(types).toContain("subscription.end_date.extended");
    });

    // Step 9 — time-travel to 2026-05-18; cron target now = 2026-06-01.
    vi.setSystemTime(new Date("2026-05-18T09:00:00.000Z"));
    const cron2Res = await triggerCron();
    expect(cron2Res.status).toBe(200);

    // Step 10 — tail-end task materializes for 2026-06-01 with status
    // CREATED. The day was previously beyond materialized_through_date;
    // cron's Phase-2 INSERT picks it up via the per-subscription cap
    // LEAST(target=2026-06-01, end_date=2026-06-01) = 2026-06-01.
    await withTenant(TENANT_E2E, async (tx) => {
      type Row = {
        internal_status: string;
        subscription_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT internal_status, subscription_id
        FROM tasks
        WHERE subscription_id = ${SUB_E2E}
          AND delivery_date = ${EXPECTED_NEW_END_DATE}::date
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].internal_status).toBe("CREATED");
      expect(rows[0].subscription_id).toBe(SUB_E2E);
    });
  });

  // -------------------------------------------------------------------------
  // it 2 — §9.3 row 10: address rotation cron re-materialization at
  // Layer 3 of the materialization service's COALESCE.
  //
  // Time-travel anchors picked so target_dates do NOT collide with it 1's
  // (TENANT_E2E uses 2026-05-20 + 2026-06-01; we use a different tenant
  // so collision is moot, but anchors are also offset for clarity):
  //   "2026-05-06T09:00:00.000Z" — Wed; target = 2026-05-20.
  //     Mons in horizon: 2026-05-04 ("today"-2; not future so cut-off
  //     elapsed but materialization runs forward of mat_through, not
  //     forward of cut-off — generate_series picks it up unconditionally),
  //     2026-05-11, 2026-05-18.
  //   "2026-05-19T09:00:00.000Z" — Tue; target = 2026-06-02.
  //     Mons in [2026-05-21, 2026-06-02]: 2026-05-25, 2026-06-01.
  //
  // Per plan §3.2 step 14 + brief §3.1.6 Phase 2 deferral: rotation
  // changes do NOT update already-materialized rows. The pre-PATCH
  // Mons stay with ADDR_ROT_B (Layer 3 baseline); the post-PATCH Mons
  // resolve to ADDR_ROT_C via Layer 3 of COALESCE in the new INSERT.
  // -------------------------------------------------------------------------
  it("§9.3 row 10: rotation Mon→C re-materialization at Layer 3 of cron COALESCE", async () => {
    eligibleTenantIdsSpy.mockResolvedValue([TENANT_ROT]);

    const SUB_START = "2026-05-04"; // Mon
    const SUB_END = "2026-06-15"; // Mon, far past second cron horizon
    const MAT_THROUGH_INITIAL = "2026-05-03"; // start_date - 1

    // Initial rotation: Mon → ADDR_ROT_B (set up before any cron tick).
    await withServiceRole("bg4g it2 sub seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status,
          start_date, end_date, days_of_week,
          delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUB_ROT}, ${TENANT_ROT}, ${CONSIGNEE_ROT}, 'active',
          ${SUB_START}::date, ${SUB_END}::date,
          ARRAY[1,2,3,4,5]::int[], '09:00', '18:00'
        )
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscription_materialization
          (subscription_id, tenant_id, materialized_through_date)
        VALUES
          (${SUB_ROT}, ${TENANT_ROT}, ${MAT_THROUGH_INITIAL}::date)
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscription_address_rotations
          (subscription_id, tenant_id, weekday, address_id)
        VALUES
          (${SUB_ROT}, ${TENANT_ROT}, 1, ${ADDR_ROT_B})
      `);
    });

    // Step 1 — first cron tick at 2026-05-06; horizon = 2026-05-20.
    // Mons within: 2026-05-04, 2026-05-11, 2026-05-18.
    vi.setSystemTime(new Date("2026-05-06T09:00:00.000Z"));
    const cron1Res = await triggerCron();
    expect(cron1Res.status).toBe(200);

    await withTenant(TENANT_ROT, async (tx) => {
      type Row = {
        delivery_date: string;
        address_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT delivery_date::text AS delivery_date, address_id
        FROM tasks
        WHERE subscription_id = ${SUB_ROT}
          AND delivery_date IN (
            '2026-05-04'::date, '2026-05-11'::date, '2026-05-18'::date
          )
        ORDER BY delivery_date ASC
      `);
      expect(rows.length).toBe(3);
      for (const row of rows) {
        expect(row.address_id).toBe(ADDR_ROT_B);
      }
    });

    // Step 2 — PATCH rotation Mon → ADDR_ROT_C (called via the
    // service surface).
    const rotationResult = await changeAddressRotation(
      ctxFor(
        TENANT_ROT,
        USER_ROT,
        "/api/subscriptions/" + SUB_ROT + "/address-rotation",
      ),
      SUB_ROT,
      {
        rotation: [{ weekday: 1, addressId: ADDR_ROT_C }],
      },
    );
    expect(rotationResult.status).toBe("updated");

    // Step 3 — time-travel to 2026-05-19; horizon = 2026-06-02.
    vi.setSystemTime(new Date("2026-05-19T09:00:00.000Z"));
    const cron2Res = await triggerCron();
    expect(cron2Res.status).toBe(200);

    // Step 4 — post-PATCH Mons (2026-05-25, 2026-06-01) get
    // ADDR_ROT_C via Layer 3 of the new-INSERT COALESCE.
    await withTenant(TENANT_ROT, async (tx) => {
      type Row = {
        delivery_date: string;
        address_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT delivery_date::text AS delivery_date, address_id
        FROM tasks
        WHERE subscription_id = ${SUB_ROT}
          AND delivery_date IN (
            '2026-05-25'::date, '2026-06-01'::date
          )
        ORDER BY delivery_date ASC
      `);
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.address_id).toBe(ADDR_ROT_C);
      }
    });

    // Step 5 — pre-PATCH Mons preserved at ADDR_ROT_B (Phase-2
    // deferral; cron does NOT UPDATE already-materialized rows).
    await withTenant(TENANT_ROT, async (tx) => {
      type Row = {
        delivery_date: string;
        address_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT delivery_date::text AS delivery_date, address_id
        FROM tasks
        WHERE subscription_id = ${SUB_ROT}
          AND delivery_date IN (
            '2026-05-04'::date, '2026-05-11'::date, '2026-05-18'::date
          )
        ORDER BY delivery_date ASC
      `);
      expect(rows.length).toBe(3);
      for (const row of rows) {
        expect(row.address_id).toBe(ADDR_ROT_B);
      }
    });
  });

  // -------------------------------------------------------------------------
  // it 3 — §9.3 row 11: address-override one-off cron re-materialization
  // at Layer 1 of the materialization service's COALESCE.
  //
  // Time-travel anchors:
  //   "2026-05-06T09:00:00.000Z" — Wed; target = 2026-05-20. The
  //     override date 2026-05-27 is BEYOND this horizon → no task
  //     exists at exception-create time (avoids plan §3.2 step 14
  //     Phase-2 UPDATE-existing defer).
  //   "2026-05-13T09:00:00.000Z" — Wed; target = 2026-05-27. Cron's
  //     Phase 2 INSERT picks up 2026-05-27 with Layer 1 of COALESCE
  //     (the address_override_one_off exception) → ADDR_OV_OVERRIDE.
  //
  // Skip date 2026-05-27 = Wed, 21 days from 2026-05-06; Mon-Fri
  // eligible. Per Block 4-G prompt: "at least 21 days beyond the
  // first setSystemTime so it's beyond the initial 14-day horizon".
  // -------------------------------------------------------------------------
  it("§9.3 row 11: address-override one-off → cron Layer-1 COALESCE materializes future Wed with override", async () => {
    eligibleTenantIdsSpy.mockResolvedValue([TENANT_OV]);

    const SUB_START = "2026-05-04"; // Mon
    const SUB_END = "2026-06-15";
    const MAT_THROUGH_INITIAL = "2026-05-03"; // start_date - 1
    const OVERRIDE_DATE = "2026-05-27"; // Wed, 21 days from 2026-05-06

    await withServiceRole("bg4g it3 sub seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO subscriptions (
          id, tenant_id, consignee_id, status,
          start_date, end_date, days_of_week,
          delivery_window_start, delivery_window_end
        ) VALUES (
          ${SUB_OV}, ${TENANT_OV}, ${CONSIGNEE_OV}, 'active',
          ${SUB_START}::date, ${SUB_END}::date,
          ARRAY[1,2,3,4,5]::int[], '09:00', '18:00'
        )
      `);
      await tx.execute(sqlTag`
        INSERT INTO subscription_materialization
          (subscription_id, tenant_id, materialized_through_date)
        VALUES
          (${SUB_OV}, ${TENANT_OV}, ${MAT_THROUGH_INITIAL}::date)
      `);
    });

    // Step 1 — anchor system time to 2026-05-06; OVERRIDE_DATE
    // 2026-05-27 is BEYOND the 14-day horizon (target = 2026-05-20).
    vi.setSystemTime(new Date("2026-05-06T09:00:00.000Z"));

    // Step 2 — POST /api/subscriptions/[id]/address-override one-off
    // (called via the service surface).
    const idempotencyKey = randomUUID() as Uuid;
    const overrideResult = await addSubscriptionException(
      ctxFor(
        TENANT_OV,
        USER_OV,
        "/api/subscriptions/" + SUB_OV + "/address-override",
      ),
      SUB_OV,
      {
        type: "address_override_one_off",
        date: OVERRIDE_DATE,
        idempotencyKey,
        addressOverrideId: ADDR_OV_OVERRIDE,
        reason: "block 4-g §9.3 row 11 test",
      },
    );

    expect(overrideResult.status).toBe("inserted");
    expect(overrideResult.httpStatus).toBe(201);
    // Address overrides do NOT extend end_date — null per Service A
    // contract (compensatingDate + newEndDate both null).
    expect(overrideResult.compensatingDate).toBeNull();
    expect(overrideResult.newEndDate).toBeNull();

    // Step 3 — exception row inserted with correct shape.
    await withTenant(TENANT_OV, async (tx) => {
      type Row = {
        type: string;
        start_date: string;
        address_override_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT type,
               start_date::text     AS start_date,
               address_override_id
        FROM subscription_exceptions
        WHERE id = ${overrideResult.exceptionId}
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].type).toBe("address_override_one_off");
      expect(rows[0].start_date).toBe(OVERRIDE_DATE);
      expect(rows[0].address_override_id).toBe(ADDR_OV_OVERRIDE);
    });

    // Step 4 — confirm OVERRIDE_DATE has NO task yet (beyond initial
    // horizon; cron tick has not been triggered with target reaching
    // 2026-05-27 yet).
    await withTenant(TENANT_OV, async (tx) => {
      type Row = { count: number } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT COUNT(*)::int AS count
        FROM tasks
        WHERE subscription_id = ${SUB_OV}
          AND delivery_date = ${OVERRIDE_DATE}::date
      `);
      expect(rows[0].count).toBe(0);
    });

    // Step 5 — time-travel to 2026-05-13; horizon = 2026-05-27.
    vi.setSystemTime(new Date("2026-05-13T09:00:00.000Z"));
    const cronRes = await triggerCron();
    expect(cronRes.status).toBe(200);

    // Step 6 — OVERRIDE_DATE task INSERTed with override address
    // resolved via Layer 1 of COALESCE.
    await withTenant(TENANT_OV, async (tx) => {
      type Row = {
        internal_status: string;
        address_id: string;
      } & Record<string, unknown>;
      const rows = await tx.execute<Row>(sqlTag`
        SELECT internal_status, address_id
        FROM tasks
        WHERE subscription_id = ${SUB_OV}
          AND delivery_date = ${OVERRIDE_DATE}::date
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].internal_status).toBe("CREATED");
      expect(rows[0].address_id).toBe(ADDR_OV_OVERRIDE);
    });
  });
});
