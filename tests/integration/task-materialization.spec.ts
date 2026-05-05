// tests/integration/task-materialization.spec.ts
// =============================================================================
// §7.1 — task-materialization service + run-row state machine + Phase 1
// reconciliation integration tests per merged plan PR #145
// memory/plans/day-14-cron-decoupling.md §7.1.
//
// Rows covered (13 of plan §7.1's ~13):
//   1   Happy path
//   2   Skip exception (no INSERT for skipped date)
//   3   Pause_window (no INSERT inside paused range)
//   4   Address rotation (per-weekday → primary fallback)
//   5   Address_override_one_off (single-day; rotation/primary outside)
//   6   Address_override_forward + supersession (Layer 2 ORDER BY DESC)
//   7   Append_without_skip (no override; rotation/primary fallback)
//   8   Null-address quarantine (refuse-to-materialize + counter)
//   9   Horizon cap at S.end_date (LEAST(target, end_date))
//   10  Paused filter (status='paused' → no materialization; flip → resume)
//   11  Phase 1 reconciliation (listReconciliationCandidatesByTenant)
//   12  Run-row UNIQUE conflict — 4 happy-status branches
//   13  Run-row UNIQUE conflict — stale-running CAS recovery
//
// Plan §7.1 row 14 (batchJSON enqueue shape) is unit-level; covered by
// tests/unit/task-materialization-queue.spec.ts (mocked QStash).
//
// Pattern follows tests/integration/task-generation.spec.ts:
//   - Per-test fresh tenant via random UUID + slug
//   - withServiceRole for fixture INSERTs (bypasses RLS via service role)
//   - Real materializeTenant / writeRunRowPhase4 / listReconciliationCandidatesByTenant
//   - afterEach cleanup wrapped in try/catch per audit_events_no_delete RULE
//     (memory/followup_audit_rule_cascade_conflict.md)
//
// Date pinning: tests use fixed dates anchored at materialized_through_date
// = 2026-05-04 (Monday) and target_date = 2026-05-18 (Monday two weeks
// later), giving a 14-day generate_series window. Fully deterministic;
// no `now()` dependency in fixture math.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { listReconciliationCandidatesByTenant } from "@/modules/tasks/repository";
import { materializeTenant } from "@/modules/task-materialization/service";
import { writeRunRowPhase4 } from "@/modules/task-materialization/run-row";
import { withServiceRole } from "@/shared/db";
import type { Uuid } from "@/shared/types";

// Test horizon math:
//   materialized_through_date = 2026-05-04 (Monday, ISODOW=1)
//   target_date                = 2026-05-18 (Monday two weeks later)
//   range = (2026-05-04, 2026-05-18] = 14 calendar days
//   weekdays Mon-Fri in range  = 10 (Tue 5/5 Wed 5/6 Thu 5/7 Fri 5/8
//                                    Mon 5/11 Tue 5/12 Wed 5/13 Thu 5/14
//                                    Fri 5/15 Mon 5/18)
const MAT_THROUGH = "2026-05-04";
const TARGET_DATE = "2026-05-18";
const WINDOW_START = "2026-05-04T12:00:00Z";
const WINDOW_END = "2026-05-04T13:00:00Z";
const SUB_START = "2026-05-01"; // before the range
const SUB_END = "2026-12-31"; // after the range
const DOW_MON_FRI = [1, 2, 3, 4, 5];

interface SeededTenant {
  tenantId: string;
  slug: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const runId = randomUUID().slice(0, 8);
  const tenantId = randomUUID();
  const slug = `d14-mat-${label}-${runId}`;
  await withServiceRole(`§7.1 mat seed tenant ${label}`, async (tx) => {
    await tx.execute(sqlTag`
      INSERT INTO tenants (id, slug, name)
      VALUES (${tenantId}, ${slug}, ${`§7.1 mat ${label}`})
    `);
  });
  return { tenantId, slug };
}

async function teardownTenant(tenantId: string): Promise<void> {
  // Cleanup wrapped in try/catch — audit_events_no_delete RULE (0002)
  // breaks DELETE CASCADE from tenants when audit rows exist.
  // Random per-run tenant UUIDs prevent cross-run pollution.
  try {
    await withServiceRole("§7.1 mat teardown", async (tx) => {
      await tx.execute(sqlTag`DELETE FROM tasks WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`
        DELETE FROM subscription_address_rotations WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`
        DELETE FROM subscription_exceptions WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`
        DELETE FROM subscription_materialization WHERE tenant_id = ${tenantId}
      `);
      await tx.execute(sqlTag`DELETE FROM subscriptions WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`DELETE FROM addresses WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`DELETE FROM consignees WHERE tenant_id = ${tenantId}`);
      await tx.execute(sqlTag`
        DELETE FROM task_generation_runs WHERE tenant_id = ${tenantId}
      `);
    });
  } catch {
    /* audit RULE; ignore */
  }
}

interface SeedSubscriptionInput {
  tenantId: string;
  daysOfWeek?: readonly number[];
  startDate?: string;
  endDate?: string | null;
  status?: "active" | "paused";
  materializedThroughDate?: string;
  /** Set false to omit primary address (for null-address quarantine test). */
  primaryAddress?: boolean;
}

interface SeededSubscription {
  consigneeId: Uuid;
  subscriptionId: Uuid;
  primaryAddressId: Uuid | null;
}

async function seedSubscription(
  input: SeedSubscriptionInput,
): Promise<SeededSubscription> {
  return withServiceRole("§7.1 mat seed subscription", async (tx) => {
    const cR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO consignees (
        tenant_id, name, phone, address_line, emirate_or_region, district
      ) VALUES (
        ${input.tenantId}, 'Test Consignee',
        ${`phone-${randomUUID().slice(0, 8)}`},
        'Addr Line', 'Dubai', 'Test District'
      )
      RETURNING id
    `);
    const consigneeId = cR[0].id;

    let primaryAddressId: Uuid | null = null;
    if (input.primaryAddress !== false) {
      const aR = await tx.execute<{ id: Uuid }>(sqlTag`
        INSERT INTO addresses (
          tenant_id, consignee_id, label, is_primary, line, district, emirate
        ) VALUES (
          ${input.tenantId}, ${consigneeId}, 'home', true,
          'Primary Addr', 'Test District', 'Dubai'
        )
        RETURNING id
      `);
      primaryAddressId = aR[0].id;
    }

    // days_of_week passed as Postgres array-literal text + cast.
    // Drizzle's sqlTag splats JS arrays into separate parameters
    // ($6,$7,$8,...), which Postgres parses as a row constructor and
    // can't cast to integer[]. Building the text form `{1,2,3,4,5}`
    // keeps the parameter as a single string that Postgres parses as
    // an array literal.
    const dowText = `{${(input.daysOfWeek ?? DOW_MON_FRI).join(",")}}`;
    const sR = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO subscriptions (
        tenant_id, consignee_id, status,
        start_date, end_date,
        days_of_week, delivery_window_start, delivery_window_end
      ) VALUES (
        ${input.tenantId}, ${consigneeId}, ${input.status ?? "active"},
        ${input.startDate ?? SUB_START}, ${input.endDate ?? SUB_END},
        ${dowText}::integer[],
        '09:00', '11:00'
      )
      RETURNING id
    `);
    const subscriptionId = sR[0].id;

    await tx.execute(sqlTag`
      INSERT INTO subscription_materialization
        (subscription_id, tenant_id, materialized_through_date)
      VALUES
        (${subscriptionId}, ${input.tenantId},
         ${input.materializedThroughDate ?? MAT_THROUGH}::date)
    `);

    return { consigneeId, subscriptionId, primaryAddressId };
  });
}

async function seedAdditionalAddress(
  tenantId: Uuid,
  consigneeId: Uuid,
  label: "office" | "other",
): Promise<Uuid> {
  return withServiceRole("§7.1 mat seed addr", async (tx) => {
    const r = await tx.execute<{ id: Uuid }>(sqlTag`
      INSERT INTO addresses (
        tenant_id, consignee_id, label, is_primary, line, district, emirate
      ) VALUES (
        ${tenantId}, ${consigneeId}, ${label}, false,
        ${`${label} addr`}, 'Test District', 'Dubai'
      )
      RETURNING id
    `);
    return r[0].id;
  });
}

interface ListedTask {
  subscriptionId: Uuid;
  deliveryDate: string;
  addressId: Uuid | null;
  pushedToExternalAt: string | null;
}

async function listTenantTasks(tenantId: Uuid): Promise<ListedTask[]> {
  return withServiceRole("§7.1 list tasks", async (tx) => {
    const rows = await tx.execute<{
      subscription_id: Uuid;
      delivery_date: string;
      address_id: Uuid | null;
      pushed_to_external_at: string | null;
    }>(sqlTag`
      SELECT subscription_id,
             delivery_date::text  AS delivery_date,
             address_id,
             pushed_to_external_at::text AS pushed_to_external_at
      FROM tasks
      WHERE tenant_id = ${tenantId}
      ORDER BY subscription_id, delivery_date
    `);
    return rows.map((r) => ({
      subscriptionId: r.subscription_id,
      deliveryDate: r.delivery_date,
      addressId: r.address_id,
      pushedToExternalAt: r.pushed_to_external_at,
    }));
  });
}

async function readMaterializedThrough(
  subscriptionId: Uuid,
): Promise<string> {
  return withServiceRole("§7.1 read mat", async (tx) => {
    const r = await tx.execute<{ d: string }>(sqlTag`
      SELECT materialized_through_date::text AS d
      FROM subscription_materialization
      WHERE subscription_id = ${subscriptionId}
    `);
    return r[0].d;
  });
}

const standardInput = (tenantId: Uuid) => ({
  tenantId,
  targetDate: TARGET_DATE,
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  requestId: `test-${randomUUID().slice(0, 8)}`,
});

// =============================================================================
// Test scenarios
// =============================================================================

describe("§7.1 — task-materialization integration", () => {
  describe("row 1: happy path", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("materializes 10 Mon-Fri tasks per sub for the 14-day window", async () => {
      t = await seedTenant("happy");
      const a = await seedSubscription({ tenantId: t.tenantId });
      const b = await seedSubscription({ tenantId: t.tenantId });

      const result = await withServiceRole("happy mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );

      expect(result.cappedByGate).toBe(false);
      expect(result.runRowOutcome.kind).toBe("inserted");
      expect(result.newInsertedTaskIds).toHaveLength(20); // 10 each
      expect(result.advancedSubscriptionIds).toHaveLength(2);
      expect(result.addressResolutionFailedCount).toBe(0);

      const tasks = await listTenantTasks(t.tenantId);
      expect(tasks.filter((row) => row.subscriptionId === a.subscriptionId))
        .toHaveLength(10);
      expect(tasks.filter((row) => row.subscriptionId === b.subscriptionId))
        .toHaveLength(10);

      // All tasks land at the consignee's primary address (no rotation, no override).
      for (const task of tasks) {
        if (task.subscriptionId === a.subscriptionId) {
          expect(task.addressId).toBe(a.primaryAddressId);
        } else {
          expect(task.addressId).toBe(b.primaryAddressId);
        }
      }

      // Horizon advanced for both subs.
      expect(await readMaterializedThrough(a.subscriptionId)).toBe(TARGET_DATE);
      expect(await readMaterializedThrough(b.subscriptionId)).toBe(TARGET_DATE);
    });
  });

  describe("row 2: skip exception", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("excludes the skip date — 9 tasks for skip-on-Wed sub", async () => {
      t = await seedTenant("skip");
      const sub = await seedSubscription({ tenantId: t.tenantId });

      // Wed of week 1 = 2026-05-06.
      await withServiceRole("seed skip", (tx) =>
        tx.execute(sqlTag`
          INSERT INTO subscription_exceptions (
            subscription_id, tenant_id, type, start_date,
            correlation_id, idempotency_key, created_by
          ) VALUES (
            ${sub.subscriptionId}, ${t.tenantId}, 'skip', '2026-05-06',
            ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
          )
        `),
      );

      const result = await withServiceRole("skip mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );
      expect(result.newInsertedTaskIds).toHaveLength(9); // 10 - 1 skipped

      const tasks = await listTenantTasks(t.tenantId);
      const dates = tasks.map((task) => task.deliveryDate);
      expect(dates).not.toContain("2026-05-06");
      expect(dates).toContain("2026-05-13"); // Wed week 2 still materializes
    });
  });

  describe("row 3: pause_window", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("excludes the paused range — week 2 only materialized", async () => {
      t = await seedTenant("pause");
      const sub = await seedSubscription({ tenantId: t.tenantId });

      // Pause covers Tue 5/5 through Fri 5/8 inclusive (week 1's eligible days).
      await withServiceRole("seed pause", (tx) =>
        tx.execute(sqlTag`
          INSERT INTO subscription_exceptions (
            subscription_id, tenant_id, type, start_date, end_date,
            correlation_id, idempotency_key, created_by
          ) VALUES (
            ${sub.subscriptionId}, ${t.tenantId}, 'pause_window',
            '2026-05-05', '2026-05-08',
            ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
          )
        `),
      );

      const result = await withServiceRole("pause mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );
      // Week 1: Tue/Wed/Thu/Fri (4 days) excluded.
      // Week 2: Mon/Tue/Wed/Thu/Fri/Mon-of-week-3 = 6 days remain.
      expect(result.newInsertedTaskIds).toHaveLength(6);

      const dates = (await listTenantTasks(t.tenantId)).map(
        (task) => task.deliveryDate,
      );
      expect(dates).not.toContain("2026-05-05");
      expect(dates).not.toContain("2026-05-06");
      expect(dates).not.toContain("2026-05-07");
      expect(dates).not.toContain("2026-05-08");
      expect(dates).toContain("2026-05-11");
    });
  });

  describe("row 4: address rotation", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("Mon→home, Tue→office, Wed-Fri fallback to primary", async () => {
      t = await seedTenant("rotation");
      const sub = await seedSubscription({ tenantId: t.tenantId });
      // Primary is the home address (created by seedSubscription).
      const officeId = await seedAdditionalAddress(
        t.tenantId,
        sub.consigneeId,
        "office",
      );

      // Mon (ISODOW=1) → primary (home), Tue (ISODOW=2) → office.
      // Wed/Thu/Fri have no rotation row → fall through to Layer 4 primary.
      await withServiceRole("seed rot", async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO subscription_address_rotations
            (subscription_id, tenant_id, weekday, address_id)
          VALUES
            (${sub.subscriptionId}, ${t.tenantId}, 1, ${sub.primaryAddressId}),
            (${sub.subscriptionId}, ${t.tenantId}, 2, ${officeId})
        `);
      });

      await withServiceRole("rot mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );

      const tasks = await listTenantTasks(t.tenantId);
      // Mondays: 5/11, 5/18 → primary (home).
      // Tuesdays: 5/5, 5/12 → office.
      // Wed/Thu/Fri: 5/6, 5/7, 5/8, 5/13, 5/14, 5/15 → primary (Layer-4 fallback).
      const byDate = new Map(tasks.map((task) => [task.deliveryDate, task.addressId]));
      expect(byDate.get("2026-05-11")).toBe(sub.primaryAddressId);
      expect(byDate.get("2026-05-18")).toBe(sub.primaryAddressId);
      expect(byDate.get("2026-05-05")).toBe(officeId);
      expect(byDate.get("2026-05-12")).toBe(officeId);
      expect(byDate.get("2026-05-06")).toBe(sub.primaryAddressId);
      expect(byDate.get("2026-05-07")).toBe(sub.primaryAddressId);
      expect(byDate.get("2026-05-08")).toBe(sub.primaryAddressId);
    });
  });

  describe("row 5: address_override_one_off", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("uses override only on its date; rotation/primary outside", async () => {
      t = await seedTenant("oneoff");
      const sub = await seedSubscription({ tenantId: t.tenantId });
      const officeId = await seedAdditionalAddress(
        t.tenantId,
        sub.consigneeId,
        "office",
      );

      // One-off override for Wed 5/6 → office. Other dates → primary
      // (no rotation seeded, so Layer 4 fires).
      await withServiceRole("seed one-off", (tx) =>
        tx.execute(sqlTag`
          INSERT INTO subscription_exceptions (
            subscription_id, tenant_id, type, start_date,
            address_override_id,
            correlation_id, idempotency_key, created_by
          ) VALUES (
            ${sub.subscriptionId}, ${t.tenantId}, 'address_override_one_off',
            '2026-05-06',
            ${officeId},
            ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
          )
        `),
      );

      await withServiceRole("oneoff mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );

      const tasks = await listTenantTasks(t.tenantId);
      const byDate = new Map(tasks.map((task) => [task.deliveryDate, task.addressId]));
      expect(byDate.get("2026-05-06")).toBe(officeId); // override fires
      expect(byDate.get("2026-05-05")).toBe(sub.primaryAddressId); // primary fallback
      expect(byDate.get("2026-05-13")).toBe(sub.primaryAddressId); // Wed week 2 — override didn't carry forward
    });
  });

  describe("row 6: address_override_forward + supersession", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("most-recent forward override wins (Layer 2 ORDER BY DESC)", async () => {
      // Plan §7.1 row 6 sketches a two-step (run-then-amend) sequence; the
      // SQL only inserts net-new rows (never updates already-materialized
      // rows), so the "switch" semantic in the plan can't hold across two
      // calls. Test pins the canonical case: BOTH forward overrides
      // present pre-materialization, ORDER BY start_date DESC selects
      // the most-recent. Wed/Thu use override A; Fri-and-after use override B.
      t = await seedTenant("forward");
      const sub = await seedSubscription({ tenantId: t.tenantId });
      const overrideAId = await seedAdditionalAddress(
        t.tenantId,
        sub.consigneeId,
        "office",
      );
      const overrideBId = await seedAdditionalAddress(
        t.tenantId,
        sub.consigneeId,
        "other",
      );

      // Override A: forward from Wed week 1 (5/6).
      // Override B: forward from Fri week 1 (5/8) — supersedes A from 5/8.
      await withServiceRole("seed forward", (tx) =>
        tx.execute(sqlTag`
          INSERT INTO subscription_exceptions (
            subscription_id, tenant_id, type, start_date,
            address_override_id,
            correlation_id, idempotency_key, created_by
          ) VALUES
            (${sub.subscriptionId}, ${t.tenantId}, 'address_override_forward',
              '2026-05-06', ${overrideAId},
              ${randomUUID()}, ${randomUUID()}, ${randomUUID()}),
            (${sub.subscriptionId}, ${t.tenantId}, 'address_override_forward',
              '2026-05-08', ${overrideBId},
              ${randomUUID()}, ${randomUUID()}, ${randomUUID()})
        `),
      );

      await withServiceRole("forward mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );

      const tasks = await listTenantTasks(t.tenantId);
      const byDate = new Map(tasks.map((task) => [task.deliveryDate, task.addressId]));
      expect(byDate.get("2026-05-05")).toBe(sub.primaryAddressId); // before any forward override
      expect(byDate.get("2026-05-06")).toBe(overrideAId); // Wed: A starts here, B not yet active
      expect(byDate.get("2026-05-07")).toBe(overrideAId); // Thu: A still most-recent active
      expect(byDate.get("2026-05-08")).toBe(overrideBId); // Fri: B activates, supersedes A
      expect(byDate.get("2026-05-15")).toBe(overrideBId); // Fri week 2: B still most-recent
      expect(byDate.get("2026-05-18")).toBe(overrideBId); // Mon week 3: B still most-recent
    });
  });

  describe("row 7: append_without_skip", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("operator extends end_date → tail-end days materialize via primary fallback", async () => {
      // §2.4 row 5: append_without_skip is materialized as a normal
      // tail-end task (no override layer applies; rotation/primary
      // fallback). The exception row exists for audit; its functional
      // effect is on subscription.end_date, applied at exception-create
      // time, not at materialization time. The materialization handler
      // sees a sub whose end_date moved out → eligible_dates picks up
      // the new dates naturally on the next tick.
      //
      // Test simulates: sub end_date originally 2026-05-08 (Fri week 1);
      // operator extends to 2026-05-12 via append_without_skip; cron
      // materializes 5/11 + 5/12 as tail-end days.
      t = await seedTenant("append");
      const sub = await seedSubscription({
        tenantId: t.tenantId,
        endDate: "2026-05-12", // already-extended end_date for the test
      });
      // Audit-trail row (does not affect materialization SQL):
      await withServiceRole("seed append", (tx) =>
        tx.execute(sqlTag`
          INSERT INTO subscription_exceptions (
            subscription_id, tenant_id, type, start_date,
            correlation_id, idempotency_key, created_by
          ) VALUES (
            ${sub.subscriptionId}, ${t.tenantId}, 'append_without_skip',
            '2026-05-12',
            ${randomUUID()}, ${randomUUID()}, ${randomUUID()}
          )
        `),
      );

      await withServiceRole("append mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );

      const tasks = await listTenantTasks(t.tenantId);
      // Range: 5/5..5/12 (capped by end_date), Mon-Fri only.
      // = 5/5, 5/6, 5/7, 5/8, 5/11, 5/12 = 6 days
      expect(tasks).toHaveLength(6);
      // All tasks fall back to primary (no override applies, no rotation).
      for (const task of tasks) {
        expect(task.addressId).toBe(sub.primaryAddressId);
      }
    });
  });

  describe("row 8: null-address quarantine", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("refuses to materialize rows with no address resolution; counter incremented", async () => {
      t = await seedTenant("quar");
      const sub = await seedSubscription({
        tenantId: t.tenantId,
        primaryAddress: false, // no primary; no rotation; no override → all 4 layers NULL
      });

      const result = await withServiceRole("quar mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );
      expect(result.newInsertedTaskIds).toHaveLength(0);
      // 10 Mon-Fri eligible dates failed address resolution.
      expect(result.addressResolutionFailedCount).toBe(10);
      expect(result.runRowOutcome.kind).toBe("inserted");
      expect(result.cappedByGate).toBe(false);

      const tasks = await listTenantTasks(t.tenantId);
      expect(tasks).toHaveLength(0);

      // Phase 3 still advances horizon — implementation choice (c):
      // horizon advance is independent of Phase 2 row production.
      expect(await readMaterializedThrough(sub.subscriptionId)).toBe(TARGET_DATE);
    });
  });

  describe("row 9: horizon cap at S.end_date", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("caps horizon at end_date when end_date < target", async () => {
      t = await seedTenant("hcap");
      const shortSub = await seedSubscription({
        tenantId: t.tenantId,
        endDate: "2026-05-07", // end_date 3 days into the range (Tue/Wed/Thu eligible)
      });

      await withServiceRole("hcap mat", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );

      const tasks = await listTenantTasks(t.tenantId);
      expect(tasks.map((task) => task.deliveryDate)).toEqual([
        "2026-05-05",
        "2026-05-06",
        "2026-05-07",
      ]);
      // §3.2 amendment 3: materialized_through_date capped at LEAST(target, end_date).
      expect(await readMaterializedThrough(shortSub.subscriptionId)).toBe(
        "2026-05-07",
      );
    });
  });

  describe("row 10: paused filter", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("paused sub not materialized; flip to active → next tick materializes", async () => {
      t = await seedTenant("paused");
      const sub = await seedSubscription({
        tenantId: t.tenantId,
        status: "paused",
      });

      // Tick 1: paused → no rows.
      await withServiceRole("paused mat 1", (tx) =>
        materializeTenant(tx, standardInput(t.tenantId)),
      );
      expect(await listTenantTasks(t.tenantId)).toHaveLength(0);
      // Horizon does NOT advance for paused subs (Phase 3 filters status='active').
      expect(await readMaterializedThrough(sub.subscriptionId)).toBe(MAT_THROUGH);

      // Flip to active.
      await withServiceRole("flip active", (tx) =>
        tx.execute(sqlTag`
          UPDATE subscriptions SET status = 'active' WHERE id = ${sub.subscriptionId}
        `),
      );

      // Tick 2: a different target_date AND different (window_start, window_end)
      // to avoid run-row UNIQUE conflicts. The (tenant_id, target_date)
      // UNIQUE from migration 0020 needs a fresh target_date. The pre-
      // existing (tenant_id, window_start, window_end) UNIQUE from 0012
      // (retained per §0.5 amendment D4-4 + gate 6) also needs a fresh
      // window. In production, every cron tick has a new `now()` so both
      // UNIQUEs are naturally distinct; tests must mirror that pattern.
      const tick2Target = "2026-05-19"; // one day later
      const tick2WindowStart = "2026-05-05T12:00:00Z";
      const tick2WindowEnd = "2026-05-05T13:00:00Z";
      await withServiceRole("paused mat 2", (tx) =>
        materializeTenant(tx, {
          ...standardInput(t.tenantId),
          targetDate: tick2Target,
          windowStart: tick2WindowStart,
          windowEnd: tick2WindowEnd,
        }),
      );
      const tasks = await listTenantTasks(t.tenantId);
      expect(tasks.length).toBeGreaterThan(0);
      expect(await readMaterializedThrough(sub.subscriptionId)).toBe(tick2Target);
    });
  });

  describe("row 11: Phase 1 reconciliation", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("returns null-pushed rows with non-null address_id, ordered created_at ASC", async () => {
      t = await seedTenant("recon");
      const sub = await seedSubscription({ tenantId: t.tenantId });

      // Seed 3 reconciliation candidates (pushed_to_external_at IS NULL,
      // address_id IS NOT NULL) + 1 already-pushed (should NOT appear) +
      // 1 with null address_id (quarantined; should NOT appear).
      const taskIds = await withServiceRole("seed recon", async (tx) => {
        const earliest = "2026-04-01T08:00:00Z";
        const middle = "2026-04-01T09:00:00Z";
        const latest = "2026-04-01T10:00:00Z";
        const pushed = "2026-04-01T11:00:00Z";
        const nullAddr = "2026-04-01T12:00:00Z";

        const recA = await tx.execute<{ id: Uuid }>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            address_id, created_at
          ) VALUES (
            ${t.tenantId}, ${sub.consigneeId}, ${sub.subscriptionId},
            'REC-A', '2026-04-01', '09:00', '11:00',
            ${sub.primaryAddressId}, ${earliest}::timestamptz
          ) RETURNING id
        `);
        const recB = await tx.execute<{ id: Uuid }>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            address_id, created_at
          ) VALUES (
            ${t.tenantId}, ${sub.consigneeId}, ${sub.subscriptionId},
            'REC-B', '2026-04-02', '09:00', '11:00',
            ${sub.primaryAddressId}, ${middle}::timestamptz
          ) RETURNING id
        `);
        const recC = await tx.execute<{ id: Uuid }>(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time,
            address_id, created_at
          ) VALUES (
            ${t.tenantId}, ${sub.consigneeId}, ${sub.subscriptionId},
            'REC-C', '2026-04-03', '09:00', '11:00',
            ${sub.primaryAddressId}, ${latest}::timestamptz
          ) RETURNING id
        `);
        // Already-pushed: should be excluded by `pushed_to_external_at IS NULL`.
        // subscription_id NULL with created_via='manual_admin' satisfies
        // tasks_creation_source_invariant CHECK.
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id, customer_order_number,
            created_via,
            delivery_date, delivery_start_time, delivery_end_time,
            address_id, pushed_to_external_at, created_at
          ) VALUES (
            ${t.tenantId}, ${sub.consigneeId}, NULL,
            'PUSHED', 'manual_admin', '2026-04-04', '09:00', '11:00',
            ${sub.primaryAddressId}, now(), ${pushed}::timestamptz
          )
        `);
        // Null-address: should be excluded by `address_id IS NOT NULL`.
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            tenant_id, consignee_id, subscription_id, customer_order_number,
            created_via,
            delivery_date, delivery_start_time, delivery_end_time,
            address_id, created_at
          ) VALUES (
            ${t.tenantId}, ${sub.consigneeId}, NULL,
            'NULL-ADDR', 'manual_admin', '2026-04-05', '09:00', '11:00',
            NULL, ${nullAddr}::timestamptz
          )
        `);
        return [recA[0].id, recB[0].id, recC[0].id];
      });

      const candidates = await withServiceRole("recon scan", (tx) =>
        listReconciliationCandidatesByTenant(tx, t.tenantId),
      );

      // Three candidates only, ordered created_at ASC (earliest → latest).
      expect(candidates).toEqual(taskIds);
    });
  });

  describe("row 12: run-row §4.4 happy-status conflict branches", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it.each([
      ["completed"],
      ["capped"],
      ["skipped_already_run"],
      ["failed"],
    ] as const)(
      "returns skipped_idempotent when existing row status=%s",
      async (existingStatus) => {
        t = await seedTenant(`conflict-${existingStatus}`);
        const localTarget = TARGET_DATE;

        // Pre-INSERT a terminal-status row at (tenant, target_date).
        const existingId = await withServiceRole("seed run-row", async (tx) => {
          const r = await tx.execute<{ id: Uuid }>(sqlTag`
            INSERT INTO task_generation_runs (
              tenant_id, window_start, window_end, target_date,
              status, cap_threshold, started_at, completed_at
            ) VALUES (
              ${t.tenantId}, '2026-05-04T00:00:00Z'::timestamptz,
              '2026-05-04T01:00:00Z'::timestamptz, ${localTarget}::date,
              ${existingStatus}, 7000,
              '2026-05-04T00:00:00Z'::timestamptz, now()
            ) RETURNING id
          `);
          return r[0].id;
        });

        const outcome = await withServiceRole("write run-row", (tx) =>
          writeRunRowPhase4(tx, {
            tenantId: t.tenantId,
            targetDate: localTarget,
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
            startedAt: new Date().toISOString(),
            capThreshold: 7000,
            projectedCount: 0,
            subscriptionsWalked: 0,
            tasksCreated: 0,
            tasksSkippedExisting: 0,
            status: "completed",
            requestId: `test-${randomUUID().slice(0, 8)}`,
          }),
        );

        expect(outcome.kind).toBe("skipped_idempotent");
        if (outcome.kind !== "skipped_idempotent") return;
        expect(outcome.existingRunId).toBe(existingId);
        expect(outcome.existingStatus).toBe(existingStatus);
      },
    );
  });

  describe("row 13: run-row §4.4 stale-running CAS recovery", () => {
    let t: SeededTenant;
    afterEach(async () => {
      if (t) await teardownTenant(t.tenantId);
    });

    it("CAS-reclaims stale running row > 15min old; existing row updated to completed", async () => {
      t = await seedTenant("stale");
      const localTarget = TARGET_DATE;
      // 20 minutes ago → past the 15-min STALE_RUNNING_THRESHOLD.
      const staleStartedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();

      const staleRunId = await withServiceRole("seed stale", async (tx) => {
        const r = await tx.execute<{ id: Uuid }>(sqlTag`
          INSERT INTO task_generation_runs (
            tenant_id, window_start, window_end, target_date,
            status, cap_threshold, started_at
          ) VALUES (
            ${t.tenantId}, '2026-05-04T00:00:00Z'::timestamptz,
            '2026-05-04T01:00:00Z'::timestamptz, ${localTarget}::date,
            'running', 7000, ${staleStartedAt}::timestamptz
          ) RETURNING id
        `);
        return r[0].id;
      });

      const outcome = await withServiceRole("recover stale", (tx) =>
        writeRunRowPhase4(tx, {
          tenantId: t.tenantId,
          targetDate: localTarget,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          startedAt: new Date().toISOString(),
          capThreshold: 7000,
          projectedCount: 0,
          subscriptionsWalked: 0,
          tasksCreated: 0,
          tasksSkippedExisting: 0,
          status: "completed",
          requestId: `test-${randomUUID().slice(0, 8)}`,
        }),
      );

      expect(outcome.kind).toBe("stale_running_recovered");
      if (outcome.kind !== "stale_running_recovered") return;
      expect(outcome.recoveredRunId).toBe(staleRunId);

      // Verify the row was UPDATEd in-place: same id, new status, new started_at.
      const after = await withServiceRole("verify recover", async (tx) => {
        const r = await tx.execute<{ status: string; started_at: string }>(sqlTag`
          SELECT status, started_at::text AS started_at
          FROM task_generation_runs WHERE id = ${staleRunId}
        `);
        return r[0];
      });
      expect(after.status).toBe("completed");
      expect(new Date(after.started_at).getTime()).toBeGreaterThan(
        new Date(staleStartedAt).getTime(),
      );
    });

    it("returns skipped_idempotent for fresh-running row < 15min old", async () => {
      // §4.4 row: running AND started_at >= 15min ago → skipped_idempotent
      // (concurrent run wins; not a recovery candidate).
      t = await seedTenant("fresh-run");
      const localTarget = TARGET_DATE;
      const freshStartedAt = new Date(Date.now() - 60 * 1000).toISOString(); // 1min ago

      const freshRunId = await withServiceRole("seed fresh", async (tx) => {
        const r = await tx.execute<{ id: Uuid }>(sqlTag`
          INSERT INTO task_generation_runs (
            tenant_id, window_start, window_end, target_date,
            status, cap_threshold, started_at
          ) VALUES (
            ${t.tenantId}, '2026-05-04T00:00:00Z'::timestamptz,
            '2026-05-04T01:00:00Z'::timestamptz, ${localTarget}::date,
            'running', 7000, ${freshStartedAt}::timestamptz
          ) RETURNING id
        `);
        return r[0].id;
      });

      const outcome = await withServiceRole("conflict fresh", (tx) =>
        writeRunRowPhase4(tx, {
          tenantId: t.tenantId,
          targetDate: localTarget,
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          startedAt: new Date().toISOString(),
          capThreshold: 7000,
          projectedCount: 0,
          subscriptionsWalked: 0,
          tasksCreated: 0,
          tasksSkippedExisting: 0,
          status: "completed",
          requestId: `test-${randomUUID().slice(0, 8)}`,
        }),
      );

      expect(outcome.kind).toBe("skipped_idempotent");
      if (outcome.kind !== "skipped_idempotent") return;
      expect(outcome.existingRunId).toBe(freshRunId);
      expect(outcome.existingStatus).toBe("running");
    });
  });
});
