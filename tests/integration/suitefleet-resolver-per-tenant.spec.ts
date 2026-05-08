// tests/integration/suitefleet-resolver-per-tenant.spec.ts
// =============================================================================
// A1 plan §3.2 — real-Postgres integration test for per-tenant customerId
// resolution. Five cases pinning the post-A1 resolver behaviour against
// real DB rows.
//
// Load-bearing pin: case 1 (three distinct tenants → three distinct
// customerId values). The "returns identical credentials" regression that
// A1 fixes manifests as case 1 failing.
//
// Setup:
//   - Six rows in `tenants` keyed by per-run UUIDs (no cross-suite
//     pollution; teardown by id list)
//   - Region env vars defaulted to harmless test values if the runner
//     hasn't already set them
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withServiceRole } from "@/shared/db";
import { CredentialError } from "@/shared/errors";
import type { Uuid } from "@/shared/types";

import { resolveSuiteFleetCredentials } from "@/modules/credentials/suitefleet-resolver";

const RUN_ID = randomUUID().slice(0, 8);

const TENANT_MPL: Uuid = randomUUID();
const TENANT_DNR: Uuid = randomUUID();
const TENANT_FBU: Uuid = randomUUID();
const TENANT_NULL_CC: Uuid = randomUUID();
const TENANT_EMPTY_CC: Uuid = randomUUID();
const TENANT_PROVISIONING: Uuid = randomUUID();
const TENANT_MISSING: Uuid = randomUUID(); // intentionally never inserted

const SLUG = (label: string) => `a1-resolver-${label}-${RUN_ID}`;

function ensureRegionEnv() {
  if (!process.env.SUITEFLEET_SANDBOX_USERNAME) {
    process.env.SUITEFLEET_SANDBOX_USERNAME = "test-username";
  }
  if (!process.env.SUITEFLEET_SANDBOX_PASSWORD) {
    process.env.SUITEFLEET_SANDBOX_PASSWORD = "test-password";
  }
  if (!process.env.SUITEFLEET_SANDBOX_CLIENT_ID) {
    process.env.SUITEFLEET_SANDBOX_CLIENT_ID = "transcorpsb";
  }
}

describe("§3.2 integration — suitefleet-resolver per-tenant DB lookup", () => {
  beforeAll(async () => {
    ensureRegionEnv();
    await withServiceRole(`a1 resolver setup ${RUN_ID}`, async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code) VALUES
          (${TENANT_MPL},          ${SLUG("mpl")},   'A1 MPL',           'active',       '588'),
          (${TENANT_DNR},          ${SLUG("dnr")},   'A1 DNR',           'active',       '586'),
          (${TENANT_FBU},          ${SLUG("fbu")},   'A1 FBU',           'active',       '578'),
          (${TENANT_NULL_CC},      ${SLUG("null")},  'A1 NULL-cc',       'active',       NULL),
          (${TENANT_EMPTY_CC},     ${SLUG("empty")}, 'A1 EMPTY-cc',      'active',       ''),
          (${TENANT_PROVISIONING}, ${SLUG("prov")},  'A1 provisioning',  'provisioning', '999')
      `);
    });
  });

  afterAll(async () => {
    // audit_events_no_delete RULE (0002) blocks DELETE from tenants when
    // audit rows exist. Wrap in try/catch — random per-run UUIDs prevent
    // cross-run pollution if cleanup partially fails.
    try {
      await withServiceRole(`a1 resolver teardown ${RUN_ID}`, async (tx) => {
        const ids = [
          TENANT_MPL,
          TENANT_DNR,
          TENANT_FBU,
          TENANT_NULL_CC,
          TENANT_EMPTY_CC,
          TENANT_PROVISIONING,
        ];
        await tx.execute(sqlTag`
          DELETE FROM tenants
          WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])
        `);
      });
    } catch (err) {
      // audit_events_no_delete RULE blocks DELETE FROM tenants if any audit
      // row references this tenant. Logged so a future regression where
      // the rule starts blocking legitimate teardown deletes surfaces in
      // test output instead of silently leaking rows.
      console.warn("[a1-resolver-test teardown] swallowed cascade-conflict:", err);
    }
  });

  it("returns three DISTINCT customerId values for three tenants — load-bearing pin", async () => {
    const credsMPL = await resolveSuiteFleetCredentials(TENANT_MPL);
    const credsDNR = await resolveSuiteFleetCredentials(TENANT_DNR);
    const credsFBU = await resolveSuiteFleetCredentials(TENANT_FBU);

    expect(credsMPL.customerId).toBe(588);
    expect(credsDNR.customerId).toBe(586);
    expect(credsFBU.customerId).toBe(578);

    // Region creds are shared across tenants in the same region.
    expect(credsMPL.clientId).toBe(credsDNR.clientId);
    expect(credsDNR.clientId).toBe(credsFBU.clientId);
  });

  it("throws CredentialError when tenant has NULL suitefleet_customer_code", async () => {
    await expect(
      resolveSuiteFleetCredentials(TENANT_NULL_CC),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("throws CredentialError when tenant has empty-string suitefleet_customer_code", async () => {
    await expect(
      resolveSuiteFleetCredentials(TENANT_EMPTY_CC),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it("throws CredentialError when tenant row does not exist", async () => {
    await expect(
      resolveSuiteFleetCredentials(TENANT_MISSING),
    ).rejects.toMatchObject({
      code: "CREDENTIAL",
      message: expect.stringMatching(/tenant row not found/),
    });
  });

  it("returns customerId for tenant in 'provisioning' status (status does not gate the resolver)", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_PROVISIONING);
    expect(creds.customerId).toBe(999);
  });
});
