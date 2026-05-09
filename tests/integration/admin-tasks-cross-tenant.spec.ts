// tests/integration/admin-tasks-cross-tenant.spec.ts
// =============================================================================
// Day-19 / Phase 1.5 — listAllTasks cross-tenant integration coverage.
//
// Pins the real-Postgres behavior of the /admin/tasks service-layer fn
// (src/modules/tasks/service.ts:listAllTasks). Coverage:
//   1. RBAC positive: actor with task:read_all resolves and sees rows.
//   2. RBAC negative: actor without task:read_all → ForbiddenError.
//   3. Cross-tenant scope: rows from MULTIPLE tenants returned in one call.
//   4. Merchant filter: ?merchantSlug=foo narrows to foo's rows only.
//   5. Unknown merchantSlug → ValidationError per merged plan §3.6 OQ-3.
//   6. Pagination: limit + offset return correct slice.
//   7. Merchant JOIN: returned rows expose merchant.{tenantId, slug, name, status}.
//
// API-key actor coverage: skipped at the integration layer because the
// Actor type union (src/shared/tenant-context.ts) only has 'user' and
// 'system' kinds; the API_KEY_FORBIDDEN_PERMISSIONS guarantee is
// covered statically by the SYSTEM_ONLY_PERMISSIONS ⊆
// API_KEY_FORBIDDEN_PERMISSIONS invariant test at
// src/modules/identity/tests/permissions.spec.ts:102-106 — Commit 1
// added the 3 new perms to both sets so that test passes by construction.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ROLES } from "../../src/modules/identity";
import { listAllTasks } from "../../src/modules/tasks/service";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError, ValidationError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const TENANT_C = randomUUID();
const SLUG_A = `att-a-${RUN_ID}`;
const SLUG_B = `att-b-${RUN_ID}`;
const SLUG_C = `att-c-${RUN_ID}`;

const CONSIGNEE_A = randomUUID();
const CONSIGNEE_B = randomUUID();
const CONSIGNEE_C = randomUUID();

const TASK_A1 = randomUUID() as Uuid;
const TASK_A2 = randomUUID() as Uuid;
const TASK_B1 = randomUUID() as Uuid;
const TASK_C1 = randomUUID() as Uuid;

const SYSADMIN_PERMS = ROLES["transcorp-sysadmin"].permissions;
const TENANT_ADMIN_PERMS = ROLES["tenant-admin"].permissions;

function makeCtx(perms: ReadonlySet<Permission>): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      tenantId: TENANT_A,
      permissions: perms,
    },
    tenantId: TENANT_A,
    requestId: randomUUID(),
    path: "/admin/tasks",
  };
}

describe("Day-19 / Phase 1.5 — listAllTasks (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("Day-19 listAllTasks integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_A}, ${SLUG_A}, 'Phase-1.5 Tenant A', 'active'),
          (${TENANT_B}, ${SLUG_B}, 'Phase-1.5 Tenant B', 'active'),
          (${TENANT_C}, ${SLUG_C}, 'Phase-1.5 Tenant C', 'provisioning')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
        VALUES
          (${CONSIGNEE_A}, ${TENANT_A}, 'Cons A', ${`+97150a${RUN_ID}`}, 'Bldg A', 'Dubai', 'D-A'),
          (${CONSIGNEE_B}, ${TENANT_B}, 'Cons B', ${`+97150b${RUN_ID}`}, 'Bldg B', 'Dubai', 'D-B'),
          (${CONSIGNEE_C}, ${TENANT_C}, 'Cons C', ${`+97150c${RUN_ID}`}, 'Bldg C', 'Dubai', 'D-C')
      `);
      // Seed dates are 2099-XX so the DESC delivery_date ordering puts
      // these rows at the top, ahead of any production data (cron only
      // materializes 14 days forward; nothing reaches 2099). Without
      // this, the default limit=50 page is dominated by production
      // cron-generated tasks and our 4 seed rows fall off the window.
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, customer_order_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          created_via
        ) VALUES
          (${TASK_A1}, ${TENANT_A}, ${CONSIGNEE_A}, ${`A1-${RUN_ID}`},
           'CREATED', '2099-01-01', '08:00', '10:00', 'manual_admin'),
          (${TASK_A2}, ${TENANT_A}, ${CONSIGNEE_A}, ${`A2-${RUN_ID}`},
           'CREATED', '2099-01-02', '08:00', '10:00', 'manual_admin'),
          (${TASK_B1}, ${TENANT_B}, ${CONSIGNEE_B}, ${`B1-${RUN_ID}`},
           'CREATED', '2099-01-03', '08:00', '10:00', 'manual_admin'),
          (${TASK_C1}, ${TENANT_C}, ${CONSIGNEE_C}, ${`C1-${RUN_ID}`},
           'CREATED', '2099-01-04', '08:00', '10:00', 'manual_admin')
      `);
    });
  });

  // ---------------------------------------------------------------------------
  // RBAC
  // ---------------------------------------------------------------------------

  it("RBAC positive — actor with task:read_all resolves", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllTasks(ctx);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("RBAC negative — actor without task:read_all → ForbiddenError", async () => {
    const ctx = makeCtx(TENANT_ADMIN_PERMS);
    await expect(listAllTasks(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------------------
  // Cross-tenant scope
  // ---------------------------------------------------------------------------

  it("returns rows from multiple tenants in one call", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllTasks(ctx);
    const slugs = new Set(rows.map((r) => r.merchant.slug));
    expect(slugs.has(SLUG_A)).toBe(true);
    expect(slugs.has(SLUG_B)).toBe(true);
    expect(slugs.has(SLUG_C)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Merchant filter
  // ---------------------------------------------------------------------------

  it("merchantSlug filter narrows to a single tenant's tasks", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllTasks(ctx, { merchantSlug: SLUG_B });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.merchant.slug).toBe(SLUG_B);
    }
  });

  it("unknown merchantSlug → ValidationError", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    await expect(
      listAllTasks(ctx, { merchantSlug: `does-not-exist-${RUN_ID}` }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  it("pagination — limit caps row count; offset shifts the window", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const page1 = await listAllTasks(ctx, { limit: 1 });
    const page2 = await listAllTasks(ctx, { limit: 1, offset: 1 });
    expect(page1.length).toBe(1);
    expect(page2.length).toBe(1);
    expect(page1[0].task.id).not.toBe(page2[0].task.id);
  });

  // ---------------------------------------------------------------------------
  // Merchant JOIN shape
  // ---------------------------------------------------------------------------

  it("returned rows expose merchant.{tenantId, slug, name, status}", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllTasks(ctx, { merchantSlug: SLUG_A });
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0];
    expect(r.merchant.tenantId).toBe(TENANT_A);
    expect(r.merchant.slug).toBe(SLUG_A);
    expect(r.merchant.name).toBe("Phase-1.5 Tenant A");
    expect(r.merchant.status).toBe("active");
  });
});
