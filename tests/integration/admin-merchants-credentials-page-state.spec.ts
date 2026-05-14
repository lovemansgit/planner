// tests/integration/admin-merchants-credentials-page-state.spec.ts
// =============================================================================
// Day-26 T3 Sub-PR 3 — real-Postgres coverage for loadCredentialsPageState,
// the single-query SSR loader powering /admin/merchants/[id]/credentials.
//
// Cases pinned:
//   1. tenant on oauth region, no credentials → { hasCredentials:false,
//      region.authMethod:'oauth', merchantName }
//   2. tenant on api_key region with credentials populated → { hasCredentials:true,
//      region.authMethod:'api_key' }
//   3. NotFoundError when tenant id is unknown
//   4. ForbiddenError when actor lacks merchant:update
//   5. CRITICAL — the loader MUST NOT return decrypted_secret payload
//      or Vault UUIDs. (Type-system enforced via CredentialsPageState
//      shape; runtime sanity here pins the property absence.)
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createRegion,
  loadCredentialsPageState,
  storeSuitefleetCredentials,
} from "../../src/modules/credentials";
import { withServiceRole } from "../../src/shared/db";
import { ForbiddenError, NotFoundError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const ALPHA_TAG =
  (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 8) || "tagfb";
const REGION_OAUTH_CLIENT_ID = `cps${ALPHA_TAG}o`;
const REGION_API_KEY_CLIENT_ID = `cps${ALPHA_TAG}a`;
const TENANT_NO_CREDS = randomUUID();
const TENANT_WITH_CREDS = randomUUID();
const SLUG_NO = `cps-${RUN_ID}-no`;
const SLUG_WITH = `cps-${RUN_ID}-with`;

const SYSADMIN_ACTOR = randomUUID();
const NON_SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(label: string): RequestContext {
  const perms: Permission[] = ["region:manage", "merchant:update"];
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants/x/credentials",
  };
}

function nonSysadminCtx(label: string): RequestContext {
  const perms: Permission[] = ["merchant:read_all"];
  return {
    actor: {
      kind: "user",
      userId: NON_SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set(perms),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants/x/credentials",
  };
}

let regionOauthId: Uuid;
let regionApiKeyId: Uuid;

describe("loadCredentialsPageState — integration (Day-26 T3 Sub-PR 3)", () => {
  beforeAll(async () => {
    const o = await createRegion(sysadminCtx("seed-oauth-region"), {
      clientId: REGION_OAUTH_CLIENT_ID,
      displayName: "CPS OAuth Region",
      authMethod: "oauth",
    });
    regionOauthId = o.regionId;
    const a = await createRegion(sysadminCtx("seed-api-region"), {
      clientId: REGION_API_KEY_CLIENT_ID,
      displayName: "CPS API Region",
      authMethod: "api_key",
    });
    regionApiKeyId = a.regionId;

    await withServiceRole("cps test: tenant seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_region_id)
        VALUES (${TENANT_NO_CREDS}, ${SLUG_NO}, 'CPS NoCreds', 'active', ${regionOauthId})
      `);
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_region_id, suitefleet_customer_code)
        VALUES (${TENANT_WITH_CREDS}, ${SLUG_WITH}, 'CPS WithCreds', 'active', ${regionApiKeyId}, '700')
      `);
    });

    // Provision credentials for the second tenant.
    const noopInvalidator = vi.fn();
    await storeSuitefleetCredentials(
      sysadminCtx("seed-creds"),
      TENANT_WITH_CREDS as Uuid,
      { credential1: "fixture-api-key", credential2: "fixture-secret-key" },
      noopInvalidator,
    );
  });

  afterAll(async () => {
    // Canonical teardown skeleton (memory/followup_audit_rule_cascade_conflict.md).
    try {
      await withServiceRole("cps teardown — tenants", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_NO_CREDS}, ${TENANT_WITH_CREDS})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
    try {
      await withServiceRole("cps teardown — regions", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM suitefleet_regions WHERE id IN (${regionOauthId}, ${regionApiKeyId})
        `);
      });
    } catch {
      /* FK RESTRICT; ignore */
    }
  });

  it("tenant on oauth region with no credentials → hasCredentials false + auth_method oauth", async () => {
    const state = await loadCredentialsPageState(
      sysadminCtx("load-no-creds"),
      TENANT_NO_CREDS as Uuid,
    );
    expect(state.tenantId).toBe(TENANT_NO_CREDS);
    expect(state.merchantName).toBe("CPS NoCreds");
    expect(state.hasCredentials).toBe(false);
    expect(state.region.id).toBe(regionOauthId);
    expect(state.region.authMethod).toBe("oauth");
    expect(state.region.status).toBe("active");
  });

  it("tenant on api_key region with credentials populated → hasCredentials true + auth_method api_key", async () => {
    const state = await loadCredentialsPageState(
      sysadminCtx("load-with-creds"),
      TENANT_WITH_CREDS as Uuid,
    );
    expect(state.tenantId).toBe(TENANT_WITH_CREDS);
    expect(state.hasCredentials).toBe(true);
    expect(state.region.authMethod).toBe("api_key");
  });

  it("returns a shape that excludes decrypted_secret and Vault UUIDs (write-only-by-design pin)", async () => {
    const state = await loadCredentialsPageState(
      sysadminCtx("load-shape-check"),
      TENANT_WITH_CREDS as Uuid,
    );
    // The page MUST NOT have access to plaintext or even the Vault
    // UUIDs (the UUIDs aren't secret per se, but exposing them on the
    // page would imply an echo path that we don't want; the page reads
    // only the presence boolean). The type system enforces this; the
    // runtime sanity below pins the property absence so a future
    // service-layer change that widens the shape lights up here.
    const flat = JSON.stringify(state);
    expect(flat).not.toContain("decrypted_secret");
    expect(flat).not.toContain("vault_id");
    expect(flat).not.toContain("fixture-api-key");
    expect(flat).not.toContain("fixture-secret-key");
  });

  it("NotFoundError when tenant id is unknown", async () => {
    const ghost = randomUUID();
    await expect(
      loadCredentialsPageState(sysadminCtx("load-ghost"), ghost as Uuid),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ForbiddenError when actor lacks merchant:update", async () => {
    await expect(
      loadCredentialsPageState(
        nonSysadminCtx("forbidden-load"),
        TENANT_NO_CREDS as Uuid,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
