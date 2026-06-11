// tests/integration/admin-merchants-detail.spec.ts
// =============================================================================
// Day 25 / T2 — real-Postgres integration coverage for the new
// /admin/merchants/[id] read-only detail page (PR #270 plan §3 + §7.2):
//   - getMerchantById service (post C-2 perm-gate relaxation to merchant:read_all)
//   - buildWebhookUrl pure derivation
//   - Permission pin: merchant:read_all is the read gate; merchant:update
//     alone is rejected (defense-in-depth check for future role-mix)
//   - Pickup-address null + populated projection through the mapRow
//     boundary (catches column-name drift on a new SQL surface that
//     mocked specs can't catch).
//
// Day-23 §F discipline + the post-PR #269 try-catch teardown convention.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMerchantById } from "../../src/modules/merchants/service";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";
import {
  buildWebhookUrl,
  resolvePublicBaseUrl,
} from "../../src/modules/webhooks";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_FULL = randomUUID();
const TENANT_NULL_PICKUP = randomUUID();
const SLUG_FULL = `det-${RUN_ID}-full`;
const SLUG_NULL = `det-${RUN_ID}-null`;

const SYSADMIN_ACTOR = randomUUID();
const READ_ONLY_ACTOR = randomUUID();
const NO_PERM_ACTOR = randomUUID();

function ctxWith(perms: readonly Permission[], actor: string): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: actor,
      tenantId: TENANT_FULL,
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}`,
    path: "/admin/merchants",
  };
}

describe("admin merchants detail — integration", () => {
  beforeAll(async () => {
    await withServiceRole("detail-page integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (
          id, slug, name, status,
          pickup_address_line, pickup_address_district, pickup_address_emirate,
          suitefleet_customer_code
        ) VALUES
          (${TENANT_FULL}, ${SLUG_FULL}, 'Detail Test Full', 'active',
           'Building 1', 'Al Quoz', 'Dubai', '588'),
          (${TENANT_NULL_PICKUP}, ${SLUG_NULL}, 'Detail Test NullPickup', 'provisioning',
           NULL, NULL, NULL, NULL)
      `);
    });
  });

  afterAll(async () => {
    // Same try-catch convention as admin-merchants-update.spec.ts +
    // cron-decoupling-happy-path.spec.ts — audit_events_no_delete RULE
    // can intercept the cascade DELETE; ephemeral DB tolerates leak.
    try {
      await withServiceRole("detail-page integration teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_FULL}, ${TENANT_NULL_PICKUP})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  it("read-only happy path — fully-populated merchant returns all fields", async () => {
    const merchant = await getMerchantById(
      ctxWith(["merchant:read_all"], READ_ONLY_ACTOR),
      TENANT_FULL as Uuid,
    );
    expect(merchant).not.toBeNull();
    expect(merchant?.tenantId).toBe(TENANT_FULL);
    expect(merchant?.slug).toBe(SLUG_FULL);
    expect(merchant?.name).toBe("Detail Test Full");
    expect(merchant?.status).toBe("active");
    expect(merchant?.pickupAddress).toEqual({
      line: "Building 1",
      district: "Al Quoz",
      emirate: "Dubai",
    });
    expect(merchant?.suitefleetCustomerCode).toBe("588");
  });

  it("read-only happy path — null pickup tenant returns pickupAddress=null + customer_code=null", async () => {
    const merchant = await getMerchantById(
      ctxWith(["merchant:read_all"], READ_ONLY_ACTOR),
      TENANT_NULL_PICKUP as Uuid,
    );
    expect(merchant).not.toBeNull();
    expect(merchant?.pickupAddress).toBeNull();
    expect(merchant?.suitefleetCustomerCode).toBeNull();
    expect(merchant?.status).toBe("provisioning");
  });

  it("sysadmin (holds both merchant:read_all AND merchant:update) reads the same row", async () => {
    // Pin both code paths green — the gate is read_all-or-anything-with-it.
    const merchant = await getMerchantById(
      ctxWith(
        ["merchant:read_all", "merchant:update"],
        SYSADMIN_ACTOR,
      ),
      TENANT_FULL as Uuid,
    );
    expect(merchant?.tenantId).toBe(TENANT_FULL);
  });

  it("not-found — random UUID returns null (page renders Next.js notFound)", async () => {
    const ghost = randomUUID();
    expect(
      await getMerchantById(
        ctxWith(["merchant:read_all"], READ_ONLY_ACTOR),
        ghost as Uuid,
      ),
    ).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Permission rejections
  // ---------------------------------------------------------------------------

  it("rejects actor with no permissions (ForbiddenError, no DB read)", async () => {
    await expect(
      getMerchantById(ctxWith([], NO_PERM_ACTOR), TENANT_FULL as Uuid),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects actor with merchant:update alone (gate is read_all, not update)", async () => {
    // §9.2 ruling: gate relaxed to merchant:read_all. update alone is
    // NOT sufficient. No role holds update without read_all in current
    // catalogue (sysadmin has ALL), but the pin guards future role-mix.
    await expect(
      getMerchantById(
        ctxWith(["merchant:update"], SYSADMIN_ACTOR),
        TENANT_FULL as Uuid,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ---------------------------------------------------------------------------
  // Webhook URL helper pin (read at integration tier for end-to-end)
  // ---------------------------------------------------------------------------

  it("buildWebhookUrl produces canonical /api/webhooks/suitefleet/<uuid> shape", async () => {
    const baseUrl = "https://example.com";
    const url = buildWebhookUrl(TENANT_FULL as Uuid, baseUrl);
    expect(url).toBe(`https://example.com/api/webhooks/suitefleet/${TENANT_FULL}`);
  });

  it("buildWebhookUrl normalises trailing slash on baseUrl", async () => {
    const url = buildWebhookUrl(TENANT_FULL as Uuid, "https://example.com/");
    expect(url).toBe(`https://example.com/api/webhooks/suitefleet/${TENANT_FULL}`);
  });

  it("resolvePublicBaseUrl falls back to production alias when no env set", async () => {
    // Force-empty env; resolution chain should hit the FALLBACK_BASE_URL
    // arm at queries.ts:145 (hard-coded production alias).
    const url = resolvePublicBaseUrl({});
    expect(url).toBe("https://planner-olive-sigma.vercel.app");
  });

  it("resolvePublicBaseUrl prefers PUBLIC_BASE_URL when set", async () => {
    const url = resolvePublicBaseUrl({
      PUBLIC_BASE_URL: "https://configured.example.com",
    });
    expect(url).toBe("https://configured.example.com");
  });
});
