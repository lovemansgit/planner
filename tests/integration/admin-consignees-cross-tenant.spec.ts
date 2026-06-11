// tests/integration/admin-consignees-cross-tenant.spec.ts
// =============================================================================
// Day-19 / Phase 1.5 — listAllConsignees cross-tenant integration coverage.
//
// Mirrors admin-tasks-cross-tenant.spec.ts coverage shape against the
// consignees module's listAllConsignees fn
// (src/modules/consignees/service.ts).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ROLES } from "../../src/modules/identity";
import { listAllConsignees } from "../../src/modules/consignees/service";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError, ValidationError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const TENANT_C = randomUUID();
const SLUG_A = `acc-a-${RUN_ID}`;
const SLUG_B = `acc-b-${RUN_ID}`;
const SLUG_C = `acc-c-${RUN_ID}`;

const CONSIGNEE_A1 = randomUUID();
const CONSIGNEE_A2 = randomUUID();
const CONSIGNEE_B1 = randomUUID();
const CONSIGNEE_C1 = randomUUID();

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
    path: "/admin/consignees",
  };
}

describe("Day-19 / Phase 1.5 — listAllConsignees (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole(
      "Day-19 listAllConsignees integration setup",
      async (tx) => {
        await tx.execute(sqlTag`
          INSERT INTO tenants (id, slug, name, status) VALUES
            (${TENANT_A}, ${SLUG_A}, 'Phase-1.5 ACC Tenant A', 'active'),
            (${TENANT_B}, ${SLUG_B}, 'Phase-1.5 ACC Tenant B', 'active'),
            (${TENANT_C}, ${SLUG_C}, 'Phase-1.5 ACC Tenant C', 'provisioning')
        `);
        await tx.execute(sqlTag`
          INSERT INTO consignees (id, tenant_id, name, phone, address_line, emirate_or_region, district)
          VALUES
            (${CONSIGNEE_A1}, ${TENANT_A}, 'Cons A1', ${`+97150aa${RUN_ID}`}, 'Bldg A1', 'Dubai', 'D-A'),
            (${CONSIGNEE_A2}, ${TENANT_A}, 'Cons A2', ${`+97150ab${RUN_ID}`}, 'Bldg A2', 'Dubai', 'D-A'),
            (${CONSIGNEE_B1}, ${TENANT_B}, 'Cons B1', ${`+97150bb${RUN_ID}`}, 'Bldg B1', 'Dubai', 'D-B'),
            (${CONSIGNEE_C1}, ${TENANT_C}, 'Cons C1', ${`+97150cc${RUN_ID}`}, 'Bldg C1', 'Dubai', 'D-C')
        `);
      },
    );
  });

  it("RBAC positive — actor with consignee:read_all resolves", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllConsignees(ctx);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("RBAC negative — actor without consignee:read_all → ForbiddenError", async () => {
    const ctx = makeCtx(TENANT_ADMIN_PERMS);
    await expect(listAllConsignees(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns rows from multiple tenants in one call", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllConsignees(ctx);
    const slugs = new Set(rows.map((r) => r.merchant.slug));
    expect(slugs.has(SLUG_A)).toBe(true);
    expect(slugs.has(SLUG_B)).toBe(true);
    expect(slugs.has(SLUG_C)).toBe(true);
  });

  it("merchantSlug filter narrows to a single tenant's consignees", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllConsignees(ctx, { merchantSlug: SLUG_A });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.merchant.slug).toBe(SLUG_A);
    }
  });

  it("unknown merchantSlug → ValidationError", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    await expect(
      listAllConsignees(ctx, { merchantSlug: `does-not-exist-${RUN_ID}` }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("pagination — limit caps row count; offset shifts the window", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const page1 = await listAllConsignees(ctx, { limit: 1 });
    const page2 = await listAllConsignees(ctx, { limit: 1, offset: 1 });
    expect(page1.length).toBe(1);
    expect(page2.length).toBe(1);
    expect(page1[0].consignee.id).not.toBe(page2[0].consignee.id);
  });

  it("returned rows expose merchant.{tenantId, slug, name, status}", async () => {
    const ctx = makeCtx(SYSADMIN_PERMS);
    const rows = await listAllConsignees(ctx, { merchantSlug: SLUG_C });
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0];
    expect(r.merchant.tenantId).toBe(TENANT_C);
    expect(r.merchant.slug).toBe(SLUG_C);
    expect(r.merchant.name).toBe("Phase-1.5 ACC Tenant C");
    expect(r.merchant.status).toBe("provisioning");
  });
});
