// tests/integration/tenants-archived-status.spec.ts
// =============================================================================
// Day-18 / C-cleanup integration coverage.
//
// Pins the real-Postgres behavior of the soft-archive scope:
//   1. listMerchants default-filter excludes archived rows
//   2. listMerchants explicit-status='archived' returns archived rows
//      (forensic-review path)
//   3. listMerchants excludeArchived: false returns all rows
//   4. listCronEligibleTenantIds excludes archived rows from the cron
//      walk even when those rows have populated suitefleet_customer_code
//      (post-archive bg4g-* alphanumeric-customer_code DLQ-flood guard)
//
// Why integration vs unit:
//   - Unit specs assert SQL shape via mocked tx.execute; they pin that
//     the WHERE clauses are emitted but cannot prove Postgres applies
//     them as expected. Behavior under real CHECK constraints + the
//     widened 'archived' value lives only at the DB layer.
//   - listMerchants and listCronEligibleTenantIds both consume the
//     5-state TenantStatus union; this spec seeds all 5 statuses and
//     verifies the correct rows are returned.
//
// Per-run isolation: random RUN_ID slug suffix prevents cross-run
// collisions; teardown is implicit via random suffix per
// memory/followup_audit_rule_cascade_conflict.md (audit_events_no_delete
// RULE blocks DELETE cascade from tenants, so we cannot afterAll-clean).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole } from "../../src/shared/db";
import { listMerchants } from "../../src/modules/merchants/repository";
import { listCronEligibleTenantIds } from "../../src/app/api/cron/generate-tasks/list-cron-eligible-tenants";

const RUN_ID = randomUUID().slice(0, 8);

// Five tenants, one per status, each with a unique customer_code.
// All five carry non-null + non-empty customer_code so the cron β
// customer_code filter alone (the pre-Day-18 form) wouldn't narrow
// the set — the status filter is the gate that does.
const TENANT_PROVISIONING = randomUUID();
const TENANT_ACTIVE = randomUUID();
const TENANT_SUSPENDED = randomUUID();
const TENANT_INACTIVE = randomUUID();
const TENANT_ARCHIVED = randomUUID();

const SEEDED_IDS = new Set<string>([
  TENANT_PROVISIONING,
  TENANT_ACTIVE,
  TENANT_SUSPENDED,
  TENANT_INACTIVE,
  TENANT_ARCHIVED,
]);

describe("Day-18 — tenants archived-status filter behavior (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-18 cleanup integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code) VALUES
          (${TENANT_PROVISIONING}, ${`d18-${RUN_ID}-prov`}, 'Day-18 Provisioning', 'provisioning', ${`PROV-${RUN_ID}`}),
          (${TENANT_ACTIVE},       ${`d18-${RUN_ID}-act`},  'Day-18 Active',       'active',       ${`ACT-${RUN_ID}`}),
          (${TENANT_SUSPENDED},    ${`d18-${RUN_ID}-sus`},  'Day-18 Suspended',    'suspended',    ${`SUS-${RUN_ID}`}),
          (${TENANT_INACTIVE},     ${`d18-${RUN_ID}-ina`},  'Day-18 Inactive',     'inactive',     ${`INA-${RUN_ID}`}),
          (${TENANT_ARCHIVED},     ${`d18-${RUN_ID}-arc`},  'Day-18 Archived',     'archived',     ${`ARC-${RUN_ID}`})
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // listMerchants — repository-level filter behavior
  // ---------------------------------------------------------------------------

  it("listMerchants default (no filter) excludes archived rows from the seeded set", async () => {
    const all = await withServiceRole("d18 list default", async (tx) =>
      listMerchants(tx),
    );
    const seeded = all.filter((m) => SEEDED_IDS.has(m.tenantId));
    // 4 of the 5 seeded statuses survive the default filter:
    // provisioning, active, suspended, inactive. Archived hidden.
    expect(seeded).toHaveLength(4);
    expect(seeded.map((m) => m.status).sort()).toEqual([
      "active",
      "inactive",
      "provisioning",
      "suspended",
    ]);
    expect(seeded.find((m) => m.status === "archived")).toBeUndefined();
  });

  it("listMerchants {status: 'archived'} returns archived rows (forensic-review path)", async () => {
    const archived = await withServiceRole("d18 list archived", async (tx) =>
      listMerchants(tx, { status: "archived" }),
    );
    const seededArchived = archived.filter((m) => SEEDED_IDS.has(m.tenantId));
    expect(seededArchived).toHaveLength(1);
    expect(seededArchived[0].tenantId).toBe(TENANT_ARCHIVED);
    expect(seededArchived[0].status).toBe("archived");
  });

  it("listMerchants {excludeArchived: false} returns all rows including archived", async () => {
    const all = await withServiceRole("d18 list excludeArchived false", async (tx) =>
      listMerchants(tx, { excludeArchived: false }),
    );
    const seeded = all.filter((m) => SEEDED_IDS.has(m.tenantId));
    expect(seeded).toHaveLength(5);
    expect(seeded.map((m) => m.status).sort()).toEqual([
      "active",
      "archived",
      "inactive",
      "provisioning",
      "suspended",
    ]);
  });

  // ---------------------------------------------------------------------------
  // listCronEligibleTenantIds — cron β filter behavior (CP1 scope addition)
  // ---------------------------------------------------------------------------

  it("listCronEligibleTenantIds returns ONLY provisioning + active rows from the seeded set", async () => {
    // All 5 seeded rows carry non-null + non-empty customer_code, so
    // the customer_code filter alone wouldn't exclude any of them.
    // The status filter (Day-18 / PR #189 §6 + CP1 scope addition) is
    // what narrows to the 2 expected.
    const ids = await listCronEligibleTenantIds();
    const seededReturned = ids.filter((id) => SEEDED_IDS.has(id));
    expect(seededReturned.sort()).toEqual(
      [TENANT_PROVISIONING, TENANT_ACTIVE].sort(),
    );
  });

  it("listCronEligibleTenantIds excludes archived rows even with populated customer_code", async () => {
    // Targeted assertion for the load-bearing scenario: the post-archive
    // bg4g-* row class (alphanumeric customer_code + status='archived')
    // must be invisible to the cron walk so A1's incoming numeric-only
    // resolver never sees them.
    const ids = await listCronEligibleTenantIds();
    expect(ids).not.toContain(TENANT_ARCHIVED);
  });

  it("listCronEligibleTenantIds excludes suspended + inactive rows (status filter is total)", async () => {
    const ids = await listCronEligibleTenantIds();
    expect(ids).not.toContain(TENANT_SUSPENDED);
    expect(ids).not.toContain(TENANT_INACTIVE);
  });
});
