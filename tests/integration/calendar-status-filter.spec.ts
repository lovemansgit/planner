// tests/integration/calendar-status-filter.spec.ts
// =============================================================================
// Phase 12.2 Batch A · FIX 1 — /calendar status filter, render-aligned (real DB).
//
// The calendar repository's buildFilterClause matched ONLY the FINE
// `tasks.courier_status` column (`t.courier_status = ${status}`). But the coarse
// internal states the operator filters by — CREATED / SKIPPED — live on
// `internal_status` with `courier_status NULL`, so they matched ZERO rows on the
// week / month / day views (all three route through buildFilterClause).
//
// /tasks and /admin/tasks were already repaired (#554 / D57) to use
// buildCourierStatusFilter's coarse fallback:
//   (t.courier_status = ${s} OR (t.courier_status IS NULL AND t.internal_status = ${s}))
// This pins the SAME render-aligned behaviour for the calendar surface.
//
// Under the pre-fix predicate every "Created" / "Skipped" assertion below
// returns 0 (RED); under the coarse-fallback fix they return the seeded counts
// (GREEN). Fine-only states (OUT_FOR_DELIVERY) still match via courier_status,
// proving the fine branch is intact.
//
// No teardown — `audit_events_no_delete` blocks tenant DELETE cascade; random
// per-run UUIDs prevent cross-run collisions (matches calendar-day-view.spec).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  countTasksGroupedByDay,
  listTasksForDayAcrossConsignees,
} from "../../src/modules/calendar/repository";
import { withServiceRole } from "../../src/shared/db";
import type { Uuid } from "../../src/shared/types";

const RUN = randomUUID().slice(0, 8);
const TENANT = randomUUID();
const SLUG = `csf-${RUN}`;
const DAY = "2026-05-20"; // Wednesday
const WEEK_START = "2026-05-18"; // Monday of that week
const WEEK_END = "2026-05-24"; // Sunday

// Coarse-only rows (courier_status NULL → render via internal_status fallback).
const COARSE = { CREATED: 2, SKIPPED: 1, DELIVERED: 1 } as const;
// One genuinely-fine row (courier_status set) to prove fine matching survives.
const FINE_OFD = 1; // courier_status='OUT_FOR_DELIVERY', internal_status='IN_TRANSIT'
const TOTAL = COARSE.CREATED + COARSE.SKIPPED + COARSE.DELIVERED + FINE_OFD;

describe("Phase 12.2 FIX 1 — /calendar status filter (render-aligned, real DB)", () => {
  beforeAll(async () => {
    await withServiceRole("csf setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'CSF Test', 'active')`);
      const consignee = randomUUID();
      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${consignee}, ${TENANT}, 'CSF Consignee', ${`csf-${RUN}-1`}, 'Addr', 'Dubai', 'D', 'ACTIVE')`);
      let i = 0;
      const ins = async (internal: string, courier: string | null) => {
        await tx.execute(sqlTag`
          INSERT INTO tasks (
            id, tenant_id, consignee_id, customer_order_number,
            delivery_date, delivery_start_time, delivery_end_time, created_via,
            internal_status, courier_status
          ) VALUES (
            ${randomUUID()}, ${TENANT}, ${consignee}, ${`CSF-${RUN}-${i++}`},
            ${DAY}, '14:00', '16:00', 'manual_admin', ${internal}, ${courier}
          )`);
      };
      for (let n = 0; n < COARSE.CREATED; n++) await ins("CREATED", null);
      for (let n = 0; n < COARSE.SKIPPED; n++) await ins("SKIPPED", null);
      for (let n = 0; n < COARSE.DELIVERED; n++) await ins("DELIVERED", null);
      for (let n = 0; n < FINE_OFD; n++) await ins("IN_TRANSIT", "OUT_FOR_DELIVERY");
    });
  });

  // --- Day view (listTasksForDayAcrossConsignees) ---------------------------

  it("day view — 'Created' (NULL-courier coarse) returns the 2 rows — was 0 pre-fix", async () => {
    const rows = await withServiceRole("csf day created", (tx) =>
      listTasksForDayAcrossConsignees(tx, TENANT as Uuid, DAY, { status: "CREATED" }),
    );
    expect(rows).toHaveLength(COARSE.CREATED);
    expect(rows.every((r) => r.status === "CREATED")).toBe(true);
  });

  it("day view — 'Skipped' (coarse fallback) returns the 1 row", async () => {
    const rows = await withServiceRole("csf day skipped", (tx) =>
      listTasksForDayAcrossConsignees(tx, TENANT as Uuid, DAY, { status: "SKIPPED" }),
    );
    expect(rows).toHaveLength(COARSE.SKIPPED);
    expect(rows[0]?.status).toBe("SKIPPED");
  });

  it("day view — fine OUT_FOR_DELIVERY still matches via courier_status", async () => {
    const rows = await withServiceRole("csf day ofd", (tx) =>
      listTasksForDayAcrossConsignees(tx, TENANT as Uuid, DAY, { status: "OUT_FOR_DELIVERY" }),
    );
    expect(rows).toHaveLength(FINE_OFD);
    expect(rows[0]?.courierStatus).toBe("OUT_FOR_DELIVERY");
  });

  it("day view — unfiltered returns every seeded row", async () => {
    const rows = await withServiceRole("csf day all", (tx) =>
      listTasksForDayAcrossConsignees(tx, TENANT as Uuid, DAY, {}),
    );
    expect(rows).toHaveLength(TOTAL);
  });

  // --- Week / month counts (countTasksGroupedByDay) -------------------------

  const dayTotal = (status: string | undefined) =>
    withServiceRole("csf count", async (tx) => {
      const days = await countTasksGroupedByDay(tx, TENANT as Uuid, WEEK_START, WEEK_END, {
        status,
      });
      return days.find((d) => d.date === DAY)?.total ?? 0;
    });

  it("week/month count — 'Created' tallies the 2 coarse rows — was 0 pre-fix", async () => {
    expect(await dayTotal("CREATED")).toBe(COARSE.CREATED);
  });

  it("week/month count — 'Skipped' tallies the 1 coarse row", async () => {
    expect(await dayTotal("SKIPPED")).toBe(COARSE.SKIPPED);
  });

  it("week/month count — fine OUT_FOR_DELIVERY tallies the 1 fine row", async () => {
    expect(await dayTotal("OUT_FOR_DELIVERY")).toBe(FINE_OFD);
  });

  it("week/month count — unfiltered tallies every seeded row on the day", async () => {
    expect(await dayTotal(undefined)).toBe(TOTAL);
  });
});
