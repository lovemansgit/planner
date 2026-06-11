// tests/integration/addresses-create.spec.ts
// =============================================================================
// Day-53 / add-a-second-address lane — integration spec for the new
// `createAddress` service (operator adds a non-primary address from the
// consignee detail page). Plan:
// memory/plans/day-53-session-c-add-second-address.md §7.
//
// Pins:
//   1. Happy path — non-primary addresses row INSERTed; immediately
//      visible to `listConsigneeAddresses` (the exact function the
//      R4/R5 override pickers consume), primary first then the new row.
//   2. Partial-UNIQUE invariant — after the add the consignee still has
//      exactly one is_primary=true row; a second non-primary add also
//      succeeds (no schema delta needed for multi-address).
//   3. Audit event `consignee.address.added` emitted with the typed
//      metadata (also proves the event-type registration — real emit
//      validates the eventType against the catalogue).
//   4. Tenant isolation negative — a tenant-B actor adding to a
//      tenant-A consignee gets NotFoundError (RLS default-deny) and no
//      row is created.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAddress } from "../../src/modules/addresses/service";
import { createConsignee } from "../../src/modules/consignees/service";
import { listConsigneeAddresses } from "../../src/modules/subscription-addresses/service";
import { withServiceRole } from "../../src/shared/db";
import { NotFoundError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const ACTOR_ID = randomUUID();
const SLUG = `address-create-${RUN_ID}`;
const OTHER_SLUG = `address-create-${RUN_ID}-other`;

function ctx(perms: readonly Permission[], tenantId: string = TENANT_ID): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ACTOR_ID,
      tenantId,
      permissions: new Set(perms),
    },
    tenantId,
    requestId: `addresses-create-${RUN_ID}`,
    path: "/consignees",
  };
}

const PERMS: readonly Permission[] = [
  "consignee:create",
  "consignee:read",
  "consignee:update",
];

let consigneeId: Uuid;

describe("Day-53 integration — createAddress (non-primary add from the detail page)", () => {
  beforeAll(async () => {
    await withServiceRole("addresses-create integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_ID}, ${SLUG}, 'Address Create Spec', 'active'),
          (${OTHER_TENANT_ID}, ${OTHER_SLUG}, 'Other Tenant', 'active')
      `);
    });
    const created = await createConsignee(ctx(PERMS), {
      identity: { name: "Second Address Test", phone: "+971504444444" },
      address: {
        label: "home",
        line: "Villa 9, Street 3",
        district: "Umm Suqeim",
        emirate: "Dubai",
      },
    });
    consigneeId = created.id as Uuid;
  });

  afterAll(async () => {
    // audit_events_no_delete RULE blocks DELETE FROM tenants when matching
    // audit_events exist (see memory/followup_audit_rule_cascade_conflict.md).
    // Established pattern: best-effort teardown; test tenants leak with
    // random per-run UUIDs.
    try {
      await withServiceRole("addresses-create integration teardown", async (tx) => {
        await tx.execute(sqlTag`DELETE FROM tenants WHERE id IN (${TENANT_ID}, ${OTHER_TENANT_ID})`);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("adds a non-primary address visible to listConsigneeAddresses (the override-picker path), primary first", async () => {
    const added = await createAddress(ctx(PERMS), consigneeId, {
      label: "office",
      line: "Office Tower 3, Floor 12",
      district: "DIFC",
      emirate: "Dubai",
    });
    expect(added.isPrimary).toBe(false);
    expect(added.consigneeId).toBe(consigneeId);

    // The R4/R5 ChangeAddressPanel renders exactly what this returns.
    const list = await listConsigneeAddresses(ctx(PERMS), consigneeId);
    expect(list).toHaveLength(2);
    expect(list[0].isPrimary).toBe(true);
    expect(list[0].line).toBe("Villa 9, Street 3");
    expect(list[1].isPrimary).toBe(false);
    expect(list[1].id).toBe(added.id);
    expect(list[1].line).toBe("Office Tower 3, Floor 12");
  });

  it("keeps the partial-UNIQUE invariant — exactly one primary; further non-primary adds succeed", async () => {
    await createAddress(ctx(PERMS), consigneeId, {
      label: "other",
      line: "Warehouse Gate 4",
      district: "Al Quoz",
      emirate: "Dubai",
    });
    await withServiceRole("primary invariant assertion", async (tx) => {
      const rows = await tx.execute<{ cnt: number }>(sqlTag`
        SELECT COUNT(*)::int AS cnt FROM addresses
        WHERE consignee_id = ${consigneeId} AND is_primary = true
      `);
      expect(Number(rows[0].cnt)).toBe(1);
      const all = await tx.execute<{ cnt: number }>(sqlTag`
        SELECT COUNT(*)::int AS cnt FROM addresses
        WHERE consignee_id = ${consigneeId}
      `);
      expect(Number(all[0].cnt)).toBe(3);
    });
  });

  it("emits consignee.address.added with the typed metadata", async () => {
    await withServiceRole("audit assertion", async (tx) => {
      const events = await tx.execute<{ event_type: string; metadata: unknown }>(sqlTag`
        SELECT event_type, metadata FROM audit_events
        WHERE resource_id = ${consigneeId} AND event_type = 'consignee.address.added'
        ORDER BY occurred_at ASC
      `);
      expect(events.length).toBeGreaterThanOrEqual(1);
      const meta = events[0].metadata as Record<string, unknown>;
      expect(meta.consignee_id).toBe(consigneeId);
      expect(typeof meta.address_id).toBe("string");
      expect(meta.label).toBe("office");
      expect(meta.is_primary).toBe(false);
    });
  });

  it("tenant isolation negative — tenant B cannot add to tenant A's consignee, and no row lands", async () => {
    let addressesBefore = 0;
    await withServiceRole("pre-count", async (tx) => {
      const rows = await tx.execute<{ cnt: number }>(sqlTag`
        SELECT COUNT(*)::int AS cnt FROM addresses WHERE consignee_id = ${consigneeId}
      `);
      addressesBefore = Number(rows[0].cnt);
    });

    await expect(
      createAddress(ctx(PERMS, OTHER_TENANT_ID), consigneeId, {
        label: "home",
        line: "Cross Tenant Line",
        district: "Nowhere",
        emirate: "Dubai",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await withServiceRole("post-count", async (tx) => {
      const rows = await tx.execute<{ cnt: number }>(sqlTag`
        SELECT COUNT(*)::int AS cnt FROM addresses WHERE consignee_id = ${consigneeId}
      `);
      expect(Number(rows[0].cnt)).toBe(addressesBefore);
      const crossTenantRows = await tx.execute<{ cnt: number }>(sqlTag`
        SELECT COUNT(*)::int AS cnt FROM addresses
        WHERE consignee_id = ${consigneeId} AND tenant_id = ${OTHER_TENANT_ID}
      `);
      expect(Number(crossTenantRows[0].cnt)).toBe(0);
    });
  });
});
