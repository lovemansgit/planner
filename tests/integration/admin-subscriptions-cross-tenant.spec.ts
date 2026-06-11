// tests/integration/admin-subscriptions-cross-tenant.spec.ts
// =============================================================================
// Day-19 / Phase 1.5 — listAllSubscriptions cross-tenant integration coverage.
//
// Mirrors admin-tasks-cross-tenant.spec.ts coverage shape against the
// subscriptions module's listAllSubscriptions fn
// (src/modules/subscriptions/service.ts).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ROLES } from "../../src/modules/identity";
import { listAllSubscriptions } from "../../src/modules/subscriptions/service";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError, ValidationError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const TENANT_C = randomUUID();
const SLUG_A = `asc-a-${RUN_ID}`;
const SLUG_B = `asc-b-${RUN_ID}`;
const SLUG_C = `asc-c-${RUN_ID}`;

const CONSIGNEE_A = randomUUID();
const CONSIGNEE_B = randomUUID();
const CONSIGNEE_C = randomUUID();

const SUB_A1 = randomUUID();
const SUB_A2 = randomUUID();
const SUB_B1 = randomUUID();
const SUB_C1 = randomUUID();

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
    path: "/admin/subscriptions",
  };
}

describe("Day-19 / Phase 1.5 — listAllSubscriptions (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole(
      "Day-19 listAllSubscriptions integration setup",
      async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO tenants (id, slug, name, status) VALUES
            (${TENANT_A}, ${SLUG_A}, 'Phase-1.5 ASC Tenant A', 'active'),
            (${TENANT_B}, ${SLUG_B}, 'Phase-1.5 ASC Tenant B', 'active'),
            (${TENANT_C}, ${SLUG_C}, 'Phase-1.5 ASC Tenant C', 'provisioning')
        `);
        await tx.execute(sqlTag`
          INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
          VALUES
            (${CONSIGNEE_A}, ${TENANT_A}, 'Cons A', ${`+97150sa${RUN_ID}`}, 'Bldg A', 'Dubai', 'D-A'),
            (${CONSIGNEE_B}, ${TENANT_B}, 'Cons B', ${`+97150sb${RUN_ID}`}, 'Bldg B', 'Dubai', 'D-B'),
            (${CONSIGNEE_C}, ${TENANT_C}, 'Cons C', ${`+97150sc${RUN_ID}`}, 'Bldg C', 'Dubai', 'D-C')
        `);
        await tx.execute(sqlTag`
          INSERT INTO subscriptions (
            id, tenant_id, consignee_id, status,
            start_date, days_of_week,
            delivery_window_start, delivery_window_end
          ) VALUES
            (${SUB_A1}, ${TENANT_A}, ${CONSIGNEE_A}, 'active',
             '2026-05-12', ARRAY[1,2,3,4,5]::int[], '08:00', '10:00'),
            (${SUB_A2}, ${TENANT_A}, ${CONSIGNEE_A}, 'active',
             '2026-05-13', ARRAY[1,3,5]::int[], '08:00', '10:00'),
            (${SUB_B1}, ${TENANT_B}, ${CONSIGNEE_B}, 'active',
             '2026-05-14', ARRAY[2,4]::int[], '08:00', '10:00'),
            (${SUB_C1}, ${TENANT_C}, ${CONSIGNEE_C}, 'active',
             '2026-05-15', ARRAY[6,7]::int[], '08:00', '10:00')
        `);
      },
    );
  });

  it("RBAC positive — actor with subscription:read_all resolves", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllSubscriptions(ctx);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("RBAC negative — actor without subscription:read_all → ForbiddenError", async () => {
    const ctx = makeCtx(TENANT_ADMIN_PERMS);
    await expect(listAllSubscriptions(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns rows from multiple tenants in one call", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllSubscriptions(ctx);
    const slugs = new Set(rows.map((r) => r.merchant.slug));
    expect(slugs.has(SLUG_A)).toBe(true);
    expect(slugs.has(SLUG_B)).toBe(true);
    expect(slugs.has(SLUG_C)).toBe(true);
  });

  it("merchantSlug filter narrows to a single tenant's subscriptions", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllSubscriptions(ctx, { merchantSlug: SLUG_A });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.merchant.slug).toBe(SLUG_A);
    }
  });

  it("unknown merchantSlug → ValidationError", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    await expect(
      listAllSubscriptions(ctx, { merchantSlug: `does-not-exist-${RUN_ID}` }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("pagination — limit caps row count; offset shifts the window", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const page1 = await listAllSubscriptions(ctx, { limit: 1 });
    const page2 = await listAllSubscriptions(ctx, { limit: 1, offset: 1 });
    expect(page1.length).toBe(1);
    expect(page2.length).toBe(1);
    expect(page1[0].subscription.id).not.toBe(page2[0].subscription.id);
  });

  it("returned rows expose merchant.{tenantId, slug, name, status}", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllSubscriptions(ctx, { merchantSlug: SLUG_B });
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0];
    expect(r.merchant.tenantId).toBe(TENANT_B);
    expect(r.merchant.slug).toBe(SLUG_B);
    expect(r.merchant.name).toBe("Phase-1.5 ASC Tenant B");
    expect(r.merchant.status).toBe("active");
  });
});
