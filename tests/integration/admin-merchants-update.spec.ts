// tests/integration/admin-merchants-update.spec.ts
// =============================================================================
// Day 25 / T3 — real-Postgres integration coverage for the Edit Merchant
// surface landing alongside /admin/merchants/[id]/edit:
//   - updateMerchant service (perm gate, validation, FOR UPDATE,
//     diff computation, COALESCE-style UPDATE, audit emit)
//   - updateMerchantFields repo (SQL shape on real Postgres)
//   - merchant.updated audit-event row shape (event_type + metadata)
//
// Day-23 §F discipline: every new SQL path needs a real-Postgres pin
// so column-name drift catches at the regression-grade integration
// tier, not at the unit-tier-with-mocked-tx layer. The updateMerchantFields
// COALESCE statement targets six columns + updated_at — column-name
// drift (e.g., `pickup_address_district` → `pickup_district`) would
// silently pass unit tests + fail in production.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { updateMerchant } from "../../src/modules/merchants/service";
import { withServiceRole } from "../../src/shared/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SLUG_A = `edm-${RUN_ID}-a`;
const SLUG_B = `edm-${RUN_ID}-b`;

const SYSADMIN_ACTOR = randomUUID();
const TENANT_OPERATOR_ACTOR = randomUUID();

function sysadminCtx(): RequestContext {
  const perms: Permission[] = ["merchant:update"];
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: TENANT_A,
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}`,
    path: "/admin/merchants",
  };
}

function tenantOperatorCtx(): RequestContext {
  // Tenant operator: holds merchant:read_all (still a sysadmin-scoped
  // perm in the current catalogue) but NOT merchant:update. The §9.3
  // ruling pinned that read access alone must not unlock edit.
  const perms: Permission[] = ["merchant:read_all"];
  return {
    actor: {
      kind: "user",
      userId: TENANT_OPERATOR_ACTOR,
      tenantId: TENANT_A,
      permissions: new Set(perms),
    },
    tenantId: TENANT_A,
    requestId: `test-${RUN_ID}-op`,
    path: "/admin/merchants",
  };
}

async function selectMerchant(id: string) {
  return withServiceRole("test:select-merchant", async (tx) => {
    const rows = await tx.execute<{
      slug: string;
      name: string;
      pickup_address_line: string | null;
      pickup_address_district: string | null;
      pickup_address_emirate: string | null;
      suitefleet_customer_code: string | null;
    }>(sqlTag`
      SELECT slug, name, pickup_address_line, pickup_address_district,
             pickup_address_emirate, suitefleet_customer_code
      FROM tenants
      WHERE id = ${id}
    `);
    return rows[0] ?? null;
  });
}

type MerchantUpdatedRow = {
  event_type: string;
  resource_id: string;
  metadata: { tenant_id: string; changes: Record<string, { before: unknown; after: unknown }> };
} & Record<string, unknown>;

async function selectMerchantUpdatedEvents(tenantId: string) {
  return withServiceRole("test:select-audit-events", async (tx) => {
    return tx.execute<MerchantUpdatedRow>(sqlTag`
      SELECT event_type, resource_id, metadata
      FROM audit_events
      WHERE event_type = 'merchant.updated'
        AND resource_id = ${tenantId}
      ORDER BY occurred_at ASC
    `);
  });
}

describe("admin merchants update — integration", () => {
  beforeAll(async () => {
    await withServiceRole("edit-merchant integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (
          id, slug, name, status,
          pickup_address_line, pickup_address_district, pickup_address_emirate,
          suitefleet_customer_code
        ) VALUES
          (${TENANT_A}, ${SLUG_A}, 'Edit Merchant Test A', 'active',
           'Building 1', 'Al Quoz', 'Dubai', '588'),
          (${TENANT_B}, ${SLUG_B}, 'Edit Merchant Test B', 'active',
           'Building 2', 'Business Bay', 'Dubai', '586')
      `);
    });
  });

  afterAll(async () => {
    // `audit_events_no_delete` RULE intercepts the CASCADE-internal
    // DELETE that the audit_events.tenant_id FK would normally issue
    // when a tenant row is removed; Postgres then throws "referential
    // integrity query gave unexpected result" because the RULE
    // rewrites the cascade to NOTHING. Documented at
    // `memory/followup_audit_rule_cascade_conflict.md`. The established
    // workaround in other integration specs is to wrap the teardown
    // DELETE in try-catch (see cron-decoupling-happy-path.spec.ts +
    // asset-tracking-tenant-match.spec.ts). Cleanup failure is not a
    // test failure; CI gets a fresh ephemeral DB each run.
    try {
      await withServiceRole("edit-merchant integration teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_A}, ${TENANT_B})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  it("happy path — single-field name update changes the column + emits merchant.updated audit row", async () => {
    const result = await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      name: "Updated Name",
    });

    expect(result.status).toBe("updated");
    expect(result.changedFields).toEqual(["name"]);

    const row = await selectMerchant(TENANT_A);
    expect(row?.name).toBe("Updated Name");
    // Other columns unchanged.
    expect(row?.slug).toBe(SLUG_A);
    expect(row?.pickup_address_line).toBe("Building 1");

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    const last = events[events.length - 1];
    expect(last.event_type).toBe("merchant.updated");
    expect(last.resource_id).toBe(TENANT_A);
    expect(last.metadata.tenant_id).toBe(TENANT_A);
    expect(last.metadata.changes).toEqual({
      name: { before: "Edit Merchant Test A", after: "Updated Name" },
    });

    // Reset name for downstream tests.
    await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      name: "Edit Merchant Test A",
    });
  });

  it("happy path — full pickup update changes all 3 columns + audit emits 3 dot-notation diff keys", async () => {
    const result = await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      pickupAddress: {
        line: "Building 99",
        district: "Marina",
        emirate: "Sharjah",
      },
    });

    expect([...result.changedFields].sort()).toEqual([
      "pickup_address.district",
      "pickup_address.emirate",
      "pickup_address.line",
    ]);

    const row = await selectMerchant(TENANT_A);
    expect(row?.pickup_address_line).toBe("Building 99");
    expect(row?.pickup_address_district).toBe("Marina");
    expect(row?.pickup_address_emirate).toBe("Sharjah");

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    const last = events[events.length - 1];
    expect(last.metadata.changes).toEqual({
      "pickup_address.line": { before: "Building 1", after: "Building 99" },
      "pickup_address.district": { before: "Al Quoz", after: "Marina" },
      "pickup_address.emirate": { before: "Dubai", after: "Sharjah" },
    });

    // Reset pickup for downstream tests.
    await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      pickupAddress: {
        line: "Building 1",
        district: "Al Quoz",
        emirate: "Dubai",
      },
    });
  });

  it("happy path — suitefleet_customer_code update changes column + audit emits one diff key", async () => {
    const result = await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      suitefleetCustomerCode: "612",
    });

    expect(result.changedFields).toEqual(["suitefleet_customer_code"]);

    const row = await selectMerchant(TENANT_A);
    expect(row?.suitefleet_customer_code).toBe("612");

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    const last = events[events.length - 1];
    expect(last.metadata.changes).toEqual({
      suitefleet_customer_code: { before: "588", after: "612" },
    });

    // Reset for downstream tests.
    await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      suitefleetCustomerCode: "588",
    });
  });

  it("multi-field update — name + slug emits 2 keys in changes payload", async () => {
    const baselineEvents = await selectMerchantUpdatedEvents(TENANT_A);
    const baselineCount = baselineEvents.length;

    const result = await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      name: "Multi-Field Name",
      slug: `${SLUG_A}-v2`,
    });
    expect([...result.changedFields].sort()).toEqual(["name", "slug"]);

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    expect(events).toHaveLength(baselineCount + 1);
    const last = events[events.length - 1];
    expect(Object.keys(last.metadata.changes).sort()).toEqual(["name", "slug"]);
    expect(last.metadata.changes.name).toEqual({
      before: "Edit Merchant Test A",
      after: "Multi-Field Name",
    });
    expect(last.metadata.changes.slug).toEqual({
      before: SLUG_A,
      after: `${SLUG_A}-v2`,
    });

    // Reset for downstream tests.
    await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      name: "Edit Merchant Test A",
      slug: SLUG_A,
    });
  });

  // ---------------------------------------------------------------------------
  // Rejections
  // ---------------------------------------------------------------------------

  it("slug uniqueness rejection — updating A's slug to B's slug throws ConflictError + leaves A unchanged + emits no audit", async () => {
    const baselineEvents = await selectMerchantUpdatedEvents(TENANT_A);
    const baselineCount = baselineEvents.length;

    await expect(
      updateMerchant(sysadminCtx(), TENANT_A as Uuid, { slug: SLUG_B }),
    ).rejects.toBeInstanceOf(ConflictError);

    const row = await selectMerchant(TENANT_A);
    expect(row?.slug).toBe(SLUG_A);

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    expect(events).toHaveLength(baselineCount);
  });

  it("slug self-update — submitting current slug throws ValidationError(no changes) + no DB write + no audit", async () => {
    const baselineEvents = await selectMerchantUpdatedEvents(TENANT_A);
    const baselineCount = baselineEvents.length;

    await expect(
      updateMerchant(sysadminCtx(), TENANT_A as Uuid, { slug: SLUG_A }),
    ).rejects.toBeInstanceOf(ValidationError);

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    expect(events).toHaveLength(baselineCount);
  });

  it("validation — suitefleet_customer_code with leading zero throws ValidationError + no DB write", async () => {
    const baselineEvents = await selectMerchantUpdatedEvents(TENANT_A);
    const baselineCount = baselineEvents.length;

    await expect(
      updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
        suitefleetCustomerCode: "0588",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const row = await selectMerchant(TENANT_A);
    expect(row?.suitefleet_customer_code).toBe("588");

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    expect(events).toHaveLength(baselineCount);
  });

  it("validation — pickup partial (only line populated) throws ValidationError + no DB write", async () => {
    const baselineEvents = await selectMerchantUpdatedEvents(TENANT_A);
    const baselineCount = baselineEvents.length;

    await expect(
      updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
        pickupAddress: { line: "Building 5", district: "", emirate: "" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const row = await selectMerchant(TENANT_A);
    expect(row?.pickup_address_line).toBe("Building 1");

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    expect(events).toHaveLength(baselineCount);
  });

  it("permission rejection — actor without merchant:update throws ForbiddenError + no DB write + no audit", async () => {
    const baselineEvents = await selectMerchantUpdatedEvents(TENANT_A);
    const baselineCount = baselineEvents.length;

    await expect(
      updateMerchant(tenantOperatorCtx(), TENANT_A as Uuid, {
        name: "Should Not Land",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const row = await selectMerchant(TENANT_A);
    expect(row?.name).toBe("Edit Merchant Test A");

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    expect(events).toHaveLength(baselineCount);
  });

  it("not-found — random UUID throws NotFoundError + no audit", async () => {
    const ghost = randomUUID();
    await expect(
      updateMerchant(sysadminCtx(), ghost as Uuid, { name: "Ghost" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const events = await selectMerchantUpdatedEvents(ghost);
    expect(events).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Audit payload shape pin (FLAT dot-notation per plan §2.5 metadataNotes)
  // ---------------------------------------------------------------------------

  it("audit payload shape — changed-only keys in changes object; every entry carries {before, after}", async () => {
    // Update only name; assert nothing else surfaces in the changes
    // payload (no zero-information diff keys for unchanged fields).
    await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      name: "Shape Pin",
    });

    const events = await selectMerchantUpdatedEvents(TENANT_A);
    const last = events[events.length - 1];
    expect(Object.keys(last.metadata.changes)).toEqual(["name"]);
    expect(last.metadata.changes.name).toHaveProperty("before");
    expect(last.metadata.changes.name).toHaveProperty("after");

    // Reset for downstream tests (if any).
    await updateMerchant(sysadminCtx(), TENANT_A as Uuid, {
      name: "Edit Merchant Test A",
    });
  });
});
